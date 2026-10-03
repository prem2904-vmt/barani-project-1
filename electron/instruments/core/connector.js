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
const { createLink } = require('./link');
const { parseMessage, buildAck, redactForUpload } = require('./parsers');
const { unframeAstm, unframeMllp } = require('./detect');
const { applyMaps } = require('./mapper');
const { DiskQueue } = require('./queue');
const { RawLog } = require('./rawlog');
const { Uploader } = require('./uploader');
const { toBuffer, C } = require('./bytes');

const VERSION = '0.1.0';

function idempotencyKey(instrumentId, protocol, text, index) {
  return crypto.createHash('sha256').update(`${instrumentId}\n${protocol}\n${index}\n`).update(Buffer.from(text, 'latin1')).digest('hex');
}

function istDayKey(ms) {
  // Business day in IST (UTC+05:30) — "messages today" on the status card.
  return new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
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
  }

  // ── lifecycle ─────────────────────────────────────────────────────────
  async start() {
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
    this._scheduleHeartbeat(0);
    this._kick(0);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.hbTimer);
    clearTimeout(this.drainTimer);
    clearTimeout(this.cfgTimer);
    for (const l of this.links.values()) l.close();
    this.links.clear();
    if (this.transport) { try { await this.transport.stop(); } catch { /* ignore */ } }
    this.transport = null;
    this._setState('stopped');
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
    this.reloading = this._reload().finally(() => { this.reloading = null; });
    return this.reloading;
  }

  async _reload() {
    const none = { changed: false, restarted: false };
    if (this.stopped) return none;
    const before = this.active;
    const cfg = await this._loadConfig();
    if (!cfg || this.stopped) return none;
    const tKey = this._transportKey(cfg);
    if (!this.transport || tKey !== this.transportKey) {
      if (this.transport) { try { await this.transport.stop(); } catch { /* ignore */ } }
      this.transport = null;
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
    this.transport = t;
    this.active = cfg;
    this.transportKey = null;
    // Links read the CURRENT config when a session opens, so a live reload of
    // the link/parser applies without restarting the transport.
    const linkCfg = () => (this.active && this.active.link) || { type: 'auto' };
    const parserCfg = () => (this.active && this.active.parser) || {};
    t.on('status', (s) => this._setState(s));
    t.on('error', (e) => { this._recordError(e.message); this.rawlog.write('note', `transport error: ${e.message}`); this._emitStatus(); });
    t.on('session-start', (id, info) => {
      this.rawlog.write('note', `session ${id} opened ${info && info.remote ? `(${info.remote})` : ''}`);
      this.links.set(id, this._makeLink(linkCfg(), parserCfg(), id));
    });
    t.on('session-end', (id) => {
      const l = this.links.get(id);
      if (l) { l.flush(); l.close(); }
      this.links.delete(id);
      this.rawlog.write('note', `session ${id} closed`);
    });
    t.on('data', (buf, id) => {
      this.rawlog.write('in', buf);
      this.emit('raw', { dir: 'in', bytes: buf });
      let l = this.links.get(id);
      if (!l) { l = this._makeLink(linkCfg(), parserCfg(), id); this.links.set(id, l); }
      l.feed(buf);
    });
    t.on('file', (text, name) => {
      this.rawlog.write('note', `file ${name}`);
      this.rawlog.write('in', text);
      this._onFile(text, parserCfg());
    });
    try {
      await t.start();
      this.transportKey = this._transportKey(cfg);
      this.rawlog.write('note', `started ${t.describe()}`);
    } catch (e) {
      this._fail(`${t.describe()}: ${e.message}`);
      throw e;
    }
  }

  _makeLink(linkCfg, parserCfg, sessionId) {
    const link = createLink(linkCfg, {
      write: (bytes) => {
        this.rawlog.write('out', bytes);
        this.emit('raw', { dir: 'out', bytes });
        if (this.transport) this.transport.write(bytes, sessionId);
      },
      reply: (text) => buildAck(text),
    });
    link.on('message', (text, meta) => this._onText(text, parserCfg, meta));
    link.on('frame', (f) => { if (!f.ok) this.rawlog.write('note', `frame rejected (NAK): ${f.reason}`); });
    link.on('timeout', () => this.rawlog.write('note', 'link timeout — partial message discarded'));
    return link;
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
    };
  }

  _emitStatus() { this.emit('status', this.status()); }
}

module.exports = { Connector, idempotencyKey, VERSION };
