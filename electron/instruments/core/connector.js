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
const { parseMessage, buildAck } = require('./parsers');
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
    this.stopped = true;
    this.hbTimer = null;
    this.drainTimer = null;
    this.draining = false;
    this.cfgTimer = null;
    this.idleWaiters = [];
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

  /** Re-pull config; restart the transport if its settings changed. */
  async reload() {
    const before = JSON.stringify(this.remote && this.remote.config);
    const cfg = await this._loadConfig();
    if (cfg && JSON.stringify(cfg) !== before) {
      if (this.transport) { try { await this.transport.stop(); } catch { /* ignore */ } }
      this.links.clear();
      await this._startTransport(cfg);
    }
  }

  async _loadConfig() {
    const cacheFile = path.join(this.dataDir, 'config.json');
    try {
      const remote = await this.uploader.getConfig();
      this.remote = remote;
      if (remote && remote.name) this.name = remote.name;
      fs.writeFileSync(cacheFile, JSON.stringify(remote, null, 2));
      return remote.config;
    } catch (e) {
      this.lastError = `config: ${e.message}`;
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
    const linkCfg = cfg.link || { type: 'auto' };
    t.on('status', (s) => this._setState(s));
    t.on('error', (e) => { this.lastError = e.message; this.rawlog.write('note', `transport error: ${e.message}`); this._emitStatus(); });
    t.on('session-start', (id, info) => {
      this.rawlog.write('note', `session ${id} opened ${info && info.remote ? `(${info.remote})` : ''}`);
      this.links.set(id, this._makeLink(linkCfg, cfg.parser || {}, id));
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
      if (!l) { l = this._makeLink(linkCfg, cfg.parser || {}, id); this.links.set(id, l); }
      l.feed(buf);
    });
    t.on('file', (text, name) => {
      this.rawlog.write('note', `file ${name}`);
      this.rawlog.write('in', text);
      this._onFile(text, cfg.parser || {});
    });
    try {
      await t.start();
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
      this.lastError = `parse: ${e.message}`;
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
      const key = idempotencyKey(this.instrumentId, protocol, text, i);
      const payload = {
        idempotencyKey: key,
        protocol,
        receivedAt: new Date(t).toISOString(),
        raw: text,
        message: {
          sampleId: m.sampleId,
          instrumentSerial: m.instrumentSerial || null,
          runAt: m.runAt || null,
          qc: !!m.qc,
          results: m.results.map((r) => ({ code: r.code, value: r.value, unit: r.unit, flags: r.flags, rawRecord: r.rawRecord })),
        },
      };
      const { added } = this.queue.add({ key, payload });
      this.lastMessageAt = payload.receivedAt;
      const day = istDayKey(t);
      if (day !== this.day) { this.day = day; this.messagesToday = 0; }
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
          this.emit('uploaded', { id: it.id, sampleId: it.payload.message.sampleId, result: res });
        } catch (e) {
          if (e.kind === 'permanent') {
            this.queue.dead(it.id, e.message);
            this.rawlog.write('note', `server rejected sample ${it.payload.message.sampleId}: ${e.message} (moved to dead letter)`);
          } else {
            this.queue.retry(it.id, e.message);
          }
          this.lastError = `upload: ${e.message}`;
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
      try {
        await this.uploader.heartbeat({
          status: this._wireState(),
          queueLength: this.queue.length,
          lastMessageAt: this.lastMessageAt,
          lastError: this.lastError,
          connectorVersion: VERSION,
          host: os.hostname(),
        });
      } catch { /* heartbeat is best-effort */ }
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
  _fail(msg) { this.lastError = msg; this.state = 'error'; this.rawlog.write('note', msg); this._emitStatus(); }

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
    };
  }

  _emitStatus() { this.emit('status', this.status()); }
}

module.exports = { Connector, idempotencyKey, VERSION };
