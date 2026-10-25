'use strict';
/**
 * Connector — one analyzer, end to end, host-agnostic (plain Node):
 *
 *   transport (serial / TCP server / TCP client / folder)
 *     → link (ASTM E1381 / MLLP / raw; one link state machine per session)
 *       → parser (ASTM E1394 / HL7 ORU / text template) → InstrumentMessage[]
 *         → disk queue (JSONL, idempotency key) → uploader (device key) → LMS
 *
 * plus a raw traffic log, a heartbeat, and a status snapshot for the UI.
 * The analyzer is acknowledged at the link layer as soon as the message is
 * reassembled and QUEUED ON DISK — upload happens asynchronously, so the
 * analyzer never waits on the network and nothing is lost while offline.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { EventEmitter } = require('events');
const { createTransport } = require('./transports');
const { createLink, describeFrame } = require('./link');
const { parseMessage, buildAck, redactForUpload } = require('./parsers');
const { unframeAstm, unframeMllp } = require('./detect');
const { applyMaps } = require('./mapper');
const { DiskQueue } = require('./queue');
const { RawLog } = require('./rawlog');
const { Uploader } = require('./uploader');
const { toBuffer, C, NAMES } = require('./bytes');
const { BidiHost } = require('./bidi');

/** Links that are opt-in only (never auto-picked): their frame notes and
 *  "no results" handling never touch the ASTM / MLLP / raw paths. */
const OPT_IN_LINKS = new Set(['stx-etx', 'sinocare-sn']);

function describeEmpty(text, link) {
  if (link === 'sinocare-sn') {
    try { const e = JSON.parse(text); if (e && e.resource) return `${e.resource} details received (kept for the result that follows)`; } catch { /* fall through */ }
    return 'SN frame received — no results in it';
  }
  return 'record received but nothing parsed (check the protocol settings)';
}

const VERSION = '0.1.0';

function idempotencyKey(instrumentId, protocol, text, index) {
  return crypto.createHash('sha256').update(`${instrumentId}\n${protocol}\n${index}\n`).update(Buffer.from(text, 'latin1')).digest('hex');
}

function istDayKey(ms) {
  // Business day in IST (UTC+05:30) — "messages today" on the status card.
  return new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** A single, payload-less control byte — some analyzers (e.g. the Mindray
 *  BC-5130) ping a lone <STX> every few seconds between real messages. ENQ
 *  and VT are excluded: those are genuine protocol-start signals (ASTM
 *  handshake / MLLP block), never noise. */
function isLoneKeepAliveByte(buf) {
  return !!buf && buf.length === 1 && buf[0] < 0x20 && buf[0] !== C.ENQ && buf[0] !== C.VT;
}

class Connector extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.instrumentId
   * @param {string} o.apiUrl
   * @param {string} o.deviceKey
   * @param {string} o.dataDir         per-instrument folder (queue, raw log, cached config)
   * @param {string} [o.name]
   * @param {object} [o.config]        fallback/override { transport, link, parser } (used when the server is unreachable and nothing is cached)
   * @param {Function} [o.fetchImpl]
   * @param {object} [o.deps]          { SerialPort } injection
   * @param {number} [o.heartbeatMs]
   * @param {number} [o.configRetryMs]
   * @param {object} [o.queueOpts]     DiskQueue overrides (tests: small delays)
   * @param {object} [o.transportOverride]  host-local transport settings merged over the
   *                                   server's (e.g. this PC's COM port / a free TCP port)
   */
  constructor(o = {}) {
    super();
    if (!o.instrumentId) throw new Error('Connector: instrumentId is required');
    if (!o.dataDir) throw new Error('Connector: dataDir is required');
    this.o = o;
    this.instrumentId = o.instrumentId;
    this.name = o.name || o.instrumentId;
    this.dataDir = o.dataDir;
    this.deps = o.deps || {};
    this.now = o.now || Date.now;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.queue = new DiskQueue({ dir: this.dataDir, ...(o.queueOpts || {}) }).load();
    this.rawlog = new RawLog({ dir: this.dataDir });
    this.uploader = o.uploader || new Uploader({ apiUrl: o.apiUrl, instrumentId: o.instrumentId, deviceKey: o.deviceKey, fetchImpl: o.fetchImpl });
    this.bidi = new BidiHost(this, o.bidiOpts || {});   // two-way interfacing; inert unless config.bidirectional.mode != 'off'
    this.remote = null;           // server config response
    this.transport = null;
    this.links = new Map();       // sessionId → Link
    this.state = 'stopped';
    this.lastMessageAt = null;
    this.lastUploadAt = null;
    this.lastError = null;
    this.day = istDayKey(this.now());
    this.messagesToday = 0;
    // A message's upload response carries `state` ('matched' | 'unmatched' |
    // 'superseded' | …, electron/instruments/e2e/fake-api.js / the server's
    // real contract) — this just tallies today's 'unmatched' responses for
    // the tray; the authoritative, cumulative count is the server's own
    // InstrumentDto.unmatchedCount (apps/lms, the admin Instruments page),
    // which needs a user session the main process doesn't have.
    this.unmatchedToday = 0;
    // null = no heartbeat has completed yet (unknown); true/false = the last
    // heartbeat (electron/updater-guard.js-style "light periodic ping",
    // already ~30s by default) reached the server or didn't.
    this.serverOnline = null;
    this.serverOfflineSince = null;
    // Bounded ring of this connector's own short error strings (never raw
    // analyzer traffic — see electron/diagnostics.js's header comment) for
    // the tray's "Copy diagnostic info".
    this.errors = [];
    this.stopped = true;
    this.hbTimer = null;
    this.drainTimer = null;
    this.draining = false;
    this.cfgTimer = null;
    this.idleWaiters = [];
    this.active = null;           // the config the running transport / links use
    this.transportKey = null;     // JSON of the effective transport settings that are running
    this.reloading = null;        // in-flight reload() (serialised)
    this._chain = Promise.resolve(); // serialises start()/stop()/reload() against each other — at most one touches this.transport at a time
    this.generation = 0;             // bumped on every transport (re)start/stop; a transport's own event handlers check this and no-op once stale
    this._keepAlive = null;          // { byte, count, windowStart } — throttles raw.log for a repeating lone control-byte keep-alive
  }

  // ── lifecycle ─────────────────────────────────────────────────────────
  // start(), stop() and reload() all funnel through _enqueue so at most one
  // of them ever runs at a time per connector. Two independent triggers (the
  // host's "instrument saved" IPC and the heartbeat's own background config
  // poll landing close together, or a retrying start() overlapping a reload)
  // could otherwise each create a transport without the other knowing,
  // leaving an orphaned, untracked socket holding the analyzer's (often
  // single) connection slot. _startTransport()'s generation token is the
  // second half of the fix: even a transport that slips through briefly
  // tears itself down the moment it notices it has been superseded.
  _enqueue(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.catch(() => {});
    return run;
  }

  start() { return this._enqueue(() => this._start()); }

  async _start() {
    this.stopped = false;
    this._setState('starting');
    const cfg = await this._loadConfig();
    if (!cfg) {
      this._fail('No configuration yet (server unreachable and nothing cached)');
      this.cfgTimer = setTimeout(() => { if (!this.stopped) this.start().catch(() => {}); }, this.o.configRetryMs || 30000);
      if (this.cfgTimer.unref) this.cfgTimer.unref();
      return;
    }
    await this._startTransport(cfg);
    this.bidi.start();
    this._scheduleHeartbeat(0);
    this._kick(0);
  }

  stop() { return this._enqueue(() => this._stop()); }

  async _stop() {
    this.stopped = true;
    clearTimeout(this.hbTimer);
    clearTimeout(this.drainTimer);
    clearTimeout(this.cfgTimer);
    this.bidi.stop();
    for (const l of this.links.values()) l.close();
    this.links.clear();
    await this._stopTransport();
    this._setState('stopped');
  }

  /** Stop and clear the current transport, if any. Bumps the generation
   *  token FIRST so an in-flight _startTransport (one that was started just
   *  before this ran, e.g. a TCP client whose start() resolves before the
   *  socket actually connects) recognises — once its await resolves — that
   *  it has been superseded, and tears itself down instead of being left
   *  live: never more than one transport / client socket per instrument. */
  async _stopTransport() {
    this.generation++;
    const t = this.transport;
    this.transport = null;
    this.transportKey = null;
    if (t) { try { await t.stop(); } catch { /* ignore */ } }
  }

  /**
   * Live reload: re-pull the config and apply what changed, without a
   * re-pair or an app restart. Called by the host when an instrument is saved
   * and on every heartbeat (poll), so an edit reaches a running connector.
   *   transport changed      → stop + start the transport (new port / serial path …)
   *   only link/parser changed → keep the transport; drop the per-session links
   *                              so the next bytes use the new framing/parser
   * Serialised; a no-op when stopped or when nothing changed.
   * @returns {Promise<{ changed: boolean, restarted: boolean }>}
   */
  reload() {
    if (this.reloading) return this.reloading.then(() => this.reload());
    this.reloading = this._enqueue(() => this._reload()).finally(() => { this.reloading = null; });
    return this.reloading;
  }

  async _reload() {
    const none = { changed: false, restarted: false };
    if (this.stopped) return none;
    const before = this.active;
    const cfg = await this._loadConfig();
    if (!cfg || this.stopped) return none;
    this.bidi.refresh();   // two-way settings may have changed (timer on/off, cache purge)
    const tKey = this._transportKey(cfg);
    if (!this.transport || tKey !== this.transportKey) {
      await this._stopTransport();
      this._closeLinks();
      this.rawlog.write('note', 'configuration changed — restarting the connection');
      try { await this._startTransport(cfg); } catch { /* _startTransport recorded the failure; the next reload retries */ }
      this._emitStatus();
      return { changed: true, restarted: true };
    }
    if (JSON.stringify(before) === JSON.stringify(cfg)) return none;
    this.active = cfg;
    const framing = JSON.stringify([before && before.link, before && before.parser]) !== JSON.stringify([cfg.link, cfg.parser]);
    if (framing) {
      this._closeLinks();
      this.rawlog.write('note', 'configuration changed — protocol settings applied');
    }
    this._emitStatus();
    return { changed: true, restarted: false };
  }

  _transportKey(cfg) {
    return JSON.stringify({ ...((cfg && cfg.transport) || {}), ...(this.o.transportOverride || {}) });
  }

  _closeLinks() {
    for (const l of this.links.values()) { try { l.flush(); } catch { /* ignore */ } try { l.close(); } catch { /* ignore */ } }
    this.links.clear();
  }

  async _loadConfig() {
    const cacheFile = path.join(this.dataDir, 'config.json');
    try {
      const remote = await this.uploader.getConfig();
      this.remote = remote;
      if (remote && remote.name) this.name = remote.name;
      fs.writeFileSync(cacheFile, JSON.stringify(remote, null, 2));
      if (typeof this.lastError === 'string' && this.lastError.startsWith('config:')) this.lastError = null;
      return remote.config;
    } catch (e) {
      this._recordError(`config: ${e.message}`);
      if (fs.existsSync(cacheFile)) {
        try {
          this.remote = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          return this.remote.config;
        } catch { /* fall through */ }
      }
      if (this.o.config) { this.remote = { config: this.o.config, codeMaps: [] }; return this.o.config; }
      return null;
    }
  }

  async _startTransport(cfg) {
    const t = createTransport({ ...(cfg.transport || {}), ...(this.o.transportOverride || {}) }, this.deps);
    const gen = ++this.generation;
    this.transport = t;
    this.active = cfg;
    this.transportKey = null;
    // True only while THIS transport is still the one the connector owns —
    // a stop()/reload() that ran while we were (still synchronously, or via
    // an awaited t.start()) coming up bumps `generation` and/or replaces
    // `this.transport`, and every handler below checks this before touching
    // connector state, so a superseded transport's late events are no-ops.
    const isCurrent = () => this.generation === gen && this.transport === t;
    // Links read the CURRENT config when a session opens, so a live reload of
    // the link/parser applies without restarting the transport.
    const linkCfg = () => (this.active && this.active.link) || { type: 'auto' };
    const parserCfg = () => (this.active && this.active.parser) || {};
    t.on('status', (s) => { if (isCurrent()) this._setState(s); });
    t.on('error', (e) => { if (!isCurrent()) return; this._recordError(e.message); this.rawlog.write('note', `transport error: ${e.message}`); this._emitStatus(); });
    t.on('session-start', (id, info) => {
      if (!isCurrent()) return;
      this.bidi.onSessionStart();
      this.rawlog.write('note', `session ${id} opened ${info && info.remote ? `(${info.remote})` : ''}`);
      this.links.set(id, this._makeLink(linkCfg(), parserCfg(), id));
    });
    t.on('session-end', (id) => {
      if (!isCurrent()) return;
      const l = this.links.get(id);
      if (l) { l.flush(); l.close(); }
      this.links.delete(id);
      this.rawlog.write('note', `session ${id} closed`);
    });
    t.on('data', (buf, id) => {
      if (!isCurrent()) return;
      this._logIncoming(buf);
      this.emit('raw', { dir: 'in', bytes: buf });
      let l = this.links.get(id);
      if (!l) { l = this._makeLink(linkCfg(), parserCfg(), id); this.links.set(id, l); }
      l.feed(buf);
      this.bidi.feed(buf, id);
    });
    t.on('file', (text, name) => {
      if (!isCurrent()) return;
      this.rawlog.write('note', `file ${name}`);
      this.rawlog.write('in', text);
      this._onFile(text, parserCfg());
    });
    try {
      await t.start();
      if (!isCurrent()) {
        // A stop()/reload() raced us while we were connecting — this
        // transport has already been superseded. Tear it down rather than
        // leaving an untracked, still-open socket holding the analyzer's
        // (often single) connection slot.
        try { await t.stop(); } catch { /* ignore */ }
        return;
      }
      this.transportKey = this._transportKey(cfg);
      this.rawlog.write('note', `started ${t.describe()}`);
    } catch (e) {
      if (isCurrent()) this._fail(`${t.describe()}: ${e.message}`);
      throw e;
    }
  }

  /** Writes incoming bytes to raw.log — except a repeating lone control-byte
   *  keep-alive ping (see isLoneKeepAliveByte), which would otherwise flood
   *  the log every few seconds: log the first one, then at most once a
   *  minute while it keeps repeating. Either way the bytes are still fed to
   *  the link (harmless once a real protocol is established; see
   *  link/index.js for the auto-detect side of this fix). */
  _logIncoming(buf) {
    if (!isLoneKeepAliveByte(buf)) { this.rawlog.write('in', buf); this._keepAlive = null; return; }
    const byte = buf[0];
    const name = NAMES[byte] || `x${byte.toString(16).padStart(2, '0')}`;
    const t = this.now();
    if (!this._keepAlive || this._keepAlive.byte !== byte) {
      this._keepAlive = { byte, count: 1, windowStart: t };
      this.rawlog.write('note', `<< <${name}> keep-alive (analyzer idle ping) — suppressing repeats for up to a minute`);
      return;
    }
    this._keepAlive.count++;
    if (t - this._keepAlive.windowStart >= 60000) {
      this.rawlog.write('note', `<< <${name}> keep-alive × ${this._keepAlive.count} in the last minute`);
      this._keepAlive.count = 0;
      this._keepAlive.windowStart = t;
    }
  }

  _makeLink(linkCfg, parserCfg, sessionId) {
    const link = createLink(linkCfg, {
      write: (bytes) => this._writeOut(bytes, sessionId),
      // Two-way: a query we answer ourselves (and an ACK to our worklist) must
      // not also get the automatic ORU ACK. Inert (always false) when off.
      reply: (text) => (this.bidi.suppressAck(text) ? null : buildAck(text)),
    });
    link.on('message', (text, meta) => {
      if (this.bidi.intercept(text, meta, sessionId)) return;
      this._onText(text, parserCfg, meta);
    });
    link.on('frame', (f) => {
      if (f && f.kind) { const n = describeFrame(f); if (n) this.rawlog.write('note', n); return; }   // stx-etx / sinocare-sn only
      if (!f.ok) this.rawlog.write('note', `frame rejected (NAK): ${f.reason}`);
    });
    link.on('timeout', () => this.rawlog.write('note', 'link timeout — partial message discarded'));
    return link;
  }

  /** Every byte we send goes through here (raw log + live viewer + transport). */
  _writeOut(bytes, sessionId) {
    this.rawlog.write('out', bytes);
    this.emit('raw', { dir: 'out', bytes });
    if (this.transport) this.transport.write(bytes, sessionId);
  }

  _onFile(text, parserCfg) {
    const buf = toBuffer(text);
    if (buf.includes(C.STX)) { const u = unframeAstm(buf); if (u.frames) { this._onText(u.text, parserCfg, { link: 'astm-e1381' }); return; } }
    if (buf.includes(C.VT)) { for (const m of unframeMllp(buf)) this._onText(m, parserCfg, { link: 'mllp' }); return; }
    this._onText(text, parserCfg, { link: 'raw' });
  }

  _onText(text, parserCfg, meta = {}) {
    let msgs = [];
    try {
      msgs = parseMessage(text, parserCfg, meta);
    } catch (e) {
      this._recordError(`parse: ${e.message}`);
      this.rawlog.write('note', `parse failed: ${e.message}`);
    }
    // stx-etx / sinocare-sn: a frame with no results (Device / Patient
    // context, an HBPro record before its result positions are set) is shown
    // in the log but never queued for upload.
    if (OPT_IN_LINKS.has(meta.link)) {
      const empty = msgs.filter((m) => !m.results.length);
      for (const m of empty) this.rawlog.write('note', `record for sample ${m.sampleId || '?'} has no results to send${meta.link === 'stx-etx' ? ' (set the result positions in the instrument editor)' : ''}`);
      msgs = msgs.filter((m) => m.results.length);
      if (!msgs.length) {
        if (!empty.length) this.rawlog.write('note', describeEmpty(text, meta.link));
        this._emitStatus();
        return;
      }
    }
    if (!msgs.length) {
      this.rawlog.write('note', 'message received but nothing parsed (check the protocol/template)');
      this._emitStatus();
      return;
    }
    const t = this.now();
    msgs.forEach((m, i) => {
      const protocol = m.protocol;
      // The idempotency key is hashed from the ORIGINAL bytes (unchanged —
      // redacting `raw` below must never change what a re-sent message
      // de-dupes against).
      const key = idempotencyKey(this.instrumentId, protocol, text, i);
      const payload = {
        idempotencyKey: key,
        protocol,
        receivedAt: new Date(t).toISOString(),
        // Embedded-image base64 (ED segments) is redacted to a short
        // placeholder here — it travels in message.images instead — so a
        // message with images never blows past mw's raw-size cap.
        raw: redactForUpload(text, protocol),
        message: {
          sampleId: m.sampleId,
          instrumentSerial: m.instrumentSerial || null,
          runAt: m.runAt || null,
          qc: !!m.qc,
          results: m.results.map((r) => ({ code: r.code, value: r.value, unit: r.unit, flags: r.flags, rawRecord: r.rawRecord })),
          ...(m.images && m.images.length ? { images: m.images.map((im) => ({ code: im.code, label: im.label, format: im.format, base64: im.base64 })) } : {}),
        },
      };
      const { added } = this.queue.add({ key, payload });
      this.lastMessageAt = payload.receivedAt;
      this._rollDay(t);
      if (added) this.messagesToday++;
      this.rawlog.write('note', `${added ? 'queued' : 'already queued'} sample ${m.sampleId || '?'}${m.qc ? ' (QC)' : ''}: ${m.results.length} result(s)`);
      this.emit('message', { message: m, preview: applyMaps(m, (this.remote && this.remote.codeMaps) || []), queued: added });
    });
    this._emitStatus();
    this._kick(0);
  }

  // ── upload ────────────────────────────────────────────────────────────
  _kick(ms) {
    if (this.stopped) return;
    clearTimeout(this.drainTimer);
    this.drainTimer = setTimeout(() => this._drain(), ms);
    if (this.drainTimer.unref) this.drainTimer.unref();
  }

  async _drain() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      for (const it of this.queue.due()) {
        if (this.stopped) break;
        this.queue.begin(it.id);
        try {
          const res = await this.uploader.postMessage(it.payload);
          this.queue.done(it.id);
          this.lastUploadAt = new Date(this.now()).toISOString();
          this._rollDay(this.now());
          if (res && res.state === 'unmatched') this.unmatchedToday++;
          this.emit('uploaded', { id: it.id, sampleId: it.payload.message.sampleId, result: res });
        } catch (e) {
          if (e.kind === 'permanent') {
            this.queue.dead(it.id, e.message);
            this.rawlog.write('note', `server rejected sample ${it.payload.message.sampleId}: ${e.message} (moved to dead letter)`);
          } else {
            this.queue.retry(it.id, e.message);
          }
          this._recordError(`upload: ${e.message}`);
          if (e.kind !== 'permanent') break;   // keep order; wait for backoff
        }
      }
    } finally {
      this.draining = false;
      this._emitStatus();
      const next = this.queue.nextDueAt();
      if (next !== null) this._kick(Math.max(50, next - this.now()));
      if (this.queue.length === 0) { const w = this.idleWaiters; this.idleWaiters = []; w.forEach((r) => r()); }
    }
  }

  /** Resolves once the upload queue is empty (tests / graceful shutdown). */
  idle() {
    if (this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  // ── heartbeat + status ──────────────────────────────────────────────────
  _scheduleHeartbeat(ms) {
    clearTimeout(this.hbTimer);
    if (this.stopped) return;
    this.hbTimer = setTimeout(async () => {
      let hb = null;
      let reached = false;
      try {
        hb = await this.uploader.heartbeat({
          status: this._wireState(),
          queueLength: this.queue.length,
          lastMessageAt: this.lastMessageAt,
          lastError: this.lastError,
          connectorVersion: VERSION,
          host: os.hostname(),
        });
        reached = true;
      } catch (e) {
        // Heartbeat stays best-effort (never throws out of this timer), but
        // IS the tray's "server connection status" signal — a light,
        // already-periodic (~30s) ping, per the owner's ask, reused rather
        // than adding a second one.
        this._recordError(`heartbeat: ${e.message}`);
      }
      this._setServerOnline(reached);
      // Config poll: a heartbeat answer that carries a config version only
      // triggers a pull when it differs; without one, pull every beat (one
      // small GET) — either way a saved edit reaches the connector.
      const ver = hb && (hb.configVersion ?? hb.configUpdatedAt);
      if (!this.stopped && (ver == null || ver !== this.configVersion)) {
        try { await this.reload(); if (ver != null) this.configVersion = ver; } catch { /* next beat retries */ }
      }
      const secs = (this.remote && this.remote.heartbeatSeconds) || 30;
      this._scheduleHeartbeat(this.o.heartbeatMs || secs * 1000);
    }, ms);
    if (this.hbTimer.unref) this.hbTimer.unref();
  }

  _wireState() {
    if (this.state === 'error') return 'error';
    if (this.state === 'connected') return 'connected';
    if (this.state === 'listening') return 'listening';
    return 'disconnected';
  }

  _setState(s) { if (this.state !== s) { this.state = s; this._emitStatus(); } }
  _fail(msg) { this._recordError(msg); this.state = 'error'; this.rawlog.write('note', msg); this._emitStatus(); }

  /** Record a short operational error string (never raw analyzer/message
   *  content) for the tray's "Copy diagnostic info" — bounded ring, last 10
   *  exposed via status(). */
  _recordError(msg) {
    this.lastError = msg;
    this.errors.push({ at: new Date(this.now()).toISOString(), message: String(msg == null ? '' : msg).slice(0, 300) });
    if (this.errors.length > 20) this.errors.splice(0, this.errors.length - 20);
  }

  /** IST business-day rollover for the "today" counters (messagesToday,
   *  unmatchedToday) — same day key as messagesToday has always used. */
  _rollDay(t) {
    const day = istDayKey(t);
    if (day !== this.day) { this.day = day; this.messagesToday = 0; this.unmatchedToday = 0; }
  }

  _setServerOnline(reached) {
    const t = this.now();
    if (reached) {
      if (this.serverOnline !== true) { this.serverOnline = true; this.serverOfflineSince = null; this._emitStatus(); }
    } else if (this.serverOnline !== false) {
      this.serverOnline = false;
      this.serverOfflineSince = new Date(t).toISOString();
      this._emitStatus();
    }
  }

  status() {
    return {
      instrumentId: this.instrumentId,
      name: this.name,
      state: this.state,
      transport: this.transport ? this.transport.describe() : null,
      lastMessageAt: this.lastMessageAt,
      lastUploadAt: this.lastUploadAt,
      queueLength: this.queue.length,
      lastError: this.lastError,
      messagesToday: this.messagesToday,
      unmatchedToday: this.unmatchedToday,
      serverOnline: this.serverOnline,
      serverOfflineSince: this.serverOfflineSince,
      recentErrors: this.errors.slice(-10),
      // Present only when two-way is on, so an un-configured instrument's
      // status object is exactly what it always was.
      ...(this.bidi.active() ? { bidi: this.bidi.summary() } : {}),
    };
  }

  _emitStatus() { this.emit('status', this.status()); }
}

module.exports = { Connector, idempotencyKey, isLoneKeepAliveByte, VERSION };
