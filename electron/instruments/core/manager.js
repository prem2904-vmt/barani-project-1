'use strict';
/**
 * ConnectorManager — the host-facing API (Electron today, a Raspberry Pi
 * service later). Owns the paired-instrument list, one Connector per paired
 * instrument, and listen sessions. No Electron imports: the host injects a
 * `secrets` codec ({ encrypt(str) → str, decrypt(str) → str }) — Electron
 * passes safeStorage (OS keychain / DPAPI); a headless host uses the default
 * plain codec and relies on the file being 0600.
 *
 * Layout under baseDir:
 *   paired.json                  [{ instrumentId, name, apiUrl, key (encrypted), pairedAt }]
 *   <instrumentId>/queue.jsonl   store-and-forward journal
 *   <instrumentId>/raw.log(.N)   rotating raw traffic log
 *   <instrumentId>/config.json   last config pulled from the server (offline start)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Connector } = require('./connector');
const { Uploader } = require('./uploader');
const { ListenSession, preview } = require('./listen');
const { listSerialPorts } = require('./transports');

const plainSecrets = { encrypt: (s) => `plain:${s}`, decrypt: (s) => String(s).replace(/^plain:/, '') };
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ConnectorManager extends EventEmitter {
  constructor({ baseDir, secrets = plainSecrets, fetchImpl, deps = {}, connectorOpts = {} } = {}) {
    super();
    if (!baseDir) throw new Error('ConnectorManager: baseDir is required');
    this.baseDir = baseDir;
    this.secrets = secrets;
    this.fetchImpl = fetchImpl;
    this.deps = deps;
    this.connectorOpts = connectorOpts;
    this.file = path.join(baseDir, 'paired.json');
    this.paired = [];
    this.connectors = new Map();
    this.listens = new Map();
    fs.mkdirSync(baseDir, { recursive: true });
  }

  _read() {
    try { this.paired = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.paired = []; }
    if (!Array.isArray(this.paired)) this.paired = [];
  }

  _write() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.paired, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Start a connector for every paired instrument. */
  async load() {
    this._read();
    for (const p of this.paired) await this._startOne(p).catch((e) => this.emit('error', e));
    return this.list();
  }

  async _startOne(p) {
    const old = this.connectors.get(p.instrumentId);
    if (old) await old.stop();
    let deviceKey;
    try { deviceKey = this.secrets.decrypt(p.key); } catch (e) { throw new Error(`cannot decrypt key for ${p.instrumentId}: ${e.message}`); }
    const c = new Connector({
      instrumentId: p.instrumentId,
      name: p.name,
      apiUrl: p.apiUrl,
      deviceKey,
      dataDir: path.join(this.baseDir, p.instrumentId),
      fetchImpl: this.fetchImpl,
      deps: this.deps,
      ...this.connectorOpts,
    });
    c.on('status', (s) => this.emit('status', s));
    this.connectors.set(p.instrumentId, c);
    await c.start().catch((e) => this.emit('error', e));
    return c;
  }

  /**
   * Pair this host with an instrument. The key is verified against the
   * server (GET config) BEFORE it is stored — a wrong key never pairs.
   */
  async pair({ instrumentId, deviceKey, apiUrl, name } = {}) {
    if (!GUID_RE.test(String(instrumentId || ''))) return { ok: false, error: 'invalid instrument id' };
    if (!deviceKey || typeof deviceKey !== 'string') return { ok: false, error: 'device key required' };
    if (!/^https?:\/\//i.test(String(apiUrl || ''))) return { ok: false, error: 'invalid api url' };
    const probe = new Uploader({ apiUrl, instrumentId, deviceKey, fetchImpl: this.fetchImpl });
    let remote;
    try { remote = await probe.getConfig(); } catch (e) { return { ok: false, error: e.kind === 'auth' ? 'The server rejected this device key' : e.message }; }
    this._read();
    const entry = {
      instrumentId,
      name: name || (remote && remote.name) || instrumentId,
      apiUrl: String(apiUrl).replace(/\/+$/, ''),
      key: this.secrets.encrypt(deviceKey),
      pairedAt: new Date().toISOString(),
    };
    this.paired = this.paired.filter((p) => p.instrumentId !== instrumentId).concat(entry);
    this._write();
    await this._startOne(entry);
    return { ok: true };
  }

  async unpair(instrumentId) {
    const c = this.connectors.get(instrumentId);
    if (c) await c.stop();
    this.connectors.delete(instrumentId);
    this._read();
    this.paired = this.paired.filter((p) => p.instrumentId !== instrumentId);
    this._write();
    return { ok: true };
  }

  /** Live reload one paired connector (the instrument was saved in the UI):
   *  pulls the config and applies it without re-pairing. */
  async reload(instrumentId) {
    const c = this.connectors.get(instrumentId);
    if (!c) return { ok: false, error: 'not paired on this PC' };
    try { return { ok: true, ...(await c.reload()) }; } catch (e) { return { ok: false, error: e.message }; }
  }

  list() {
    return this.paired.map((p) => ({
      instrumentId: p.instrumentId, name: p.name, apiUrl: p.apiUrl, pairedAt: p.pairedAt,
      status: this.connectors.get(p.instrumentId)?.status() || null,
    }));
  }

  status() { return [...this.connectors.values()].map((c) => c.status()); }

  rawLog(instrumentId, limit = 200) {
    const c = this.connectors.get(instrumentId);
    return c ? c.rawlog.recent(Math.min(Math.max(1, Number(limit) || 200), 500)) : [];
  }

  listSerialPorts() { return listSerialPorts(this.deps); }

  async listenStart(opts = {}) {
    if (!opts || !opts.transport || !opts.transport.type) return { error: 'transport required' };
    // A paired connector may already own the port — stop it first? No: we
    // refuse, so listen mode can never silently take an analyzer offline.
    const s = new ListenSession(opts, this.deps);
    const sessionId = crypto.randomUUID();
    for (const kind of ['raw', 'message', 'detect', 'status', 'error']) {
      s.on(kind, (x) => this.emit('listen', {
        sessionId, kind,
        ...(kind === 'raw' ? { text: x.text, dir: x.dir } : {}),
        ...(kind === 'message' ? { message: x } : {}),
        ...(kind === 'detect' ? { detect: x } : {}),
        ...(kind === 'status' ? { state: x } : {}),
        ...(kind === 'error' ? { error: x && x.message } : {}),
      }));
    }
    try { await s.start(); } catch (e) { return { error: e.message }; }
    this.listens.set(sessionId, s);
    // Safety net: a forgotten listen session closes itself after 30 min.
    const t = setTimeout(() => this.listenStop(sessionId).catch(() => {}), 30 * 60 * 1000);
    if (t.unref) t.unref();
    return { sessionId };
  }

  async listenStop(sessionId) {
    const s = this.listens.get(sessionId);
    if (!s) return { raw: '', detect: { protocol: 'unknown', link: 'raw', confidence: 0, reasons: ['session not found'], proposed: {} }, messages: [] };
    this.listens.delete(sessionId);
    return s.stop();
  }

  preview(raw, config) { return preview(String(raw || ''), config || {}); }

  async stopAll() {
    for (const c of this.connectors.values()) await c.stop();
    for (const id of [...this.listens.keys()]) await this.listenStop(id);
  }
}

module.exports = { ConnectorManager, plainSecrets };
