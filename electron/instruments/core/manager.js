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
const { detect } = require('./detect');
const { guess, headerOf } = require('./analyzer-guess');
const { friendlyTransportError } = require('./errors');

/** Most ports one "find the analyzer" scan may open at once. */
const MAX_SCAN_PORTS = 12;
const SCAN_TTL_MS = 15 * 60 * 1000;

const validPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

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
    this.scans = new Map();   // scanId → { sessions: Map<port, ListenSession>, info: Map<port, object>, timer }
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
    // Two analyzers on this PC can never share a listen port (the wizard's
    // fixed-port "Change" made this reachable): refuse before storing the key.
    const rt = remote && remote.config && remote.config.transport;
    if (rt && rt.type === 'tcp-server') {
      const clash = this.conflictFor(rt, { exceptInstrumentId: instrumentId });
      if (clash && /is used by the analyzer/.test(clash)) return { ok: false, error: clash };
    }
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

  /**
   * Ports / serial paths this PC's connectors (and open listen / scan
   * sessions) hold right now: [{ port?, path?, name, instrumentId?, kind }].
   */
  usedEndpoints() {
    const out = [];
    for (const c of this.connectors.values()) {
      const t = { ...((c.active && c.active.transport) || {}), ...((c.o && c.o.transportOverride) || {}) };
      const port = c.listenPort || (t.type === 'tcp-server' ? Number(t.port) : null);
      if (port) out.push({ port, name: c.name, instrumentId: c.instrumentId, kind: 'connector' });
      if (t.type === 'serial' && t.path) out.push({ path: String(t.path), name: c.name, instrumentId: c.instrumentId, kind: 'connector' });
    }
    for (const s of this.listens.values()) {
      const t = s.transportCfg || {};
      if (t.type === 'tcp-server') out.push({ port: s.port() || Number(t.port), name: 'a listen session', kind: 'listen' });
      if (t.type === 'serial' && t.path) out.push({ path: String(t.path), name: 'a listen session', kind: 'listen' });
    }
    for (const sc of this.scans.values()) for (const port of sc.sessions.keys()) out.push({ port, name: 'the analyzer finder', kind: 'scan' });
    return out;
  }

  /** Plain-words refusal when `transport` would take a port / COM port this
   *  PC already uses (paired analyzer or another listen) — else null. */
  conflictFor(transport, { exceptInstrumentId } = {}) {
    const t = transport || {};
    for (const u of this.usedEndpoints()) {
      if (exceptInstrumentId && u.instrumentId === exceptInstrumentId) continue;
      if (t.type === 'tcp-server' && u.port && Number(t.port) === u.port) {
        return u.kind === 'connector'
          ? `Port ${u.port} is used by the analyzer "${u.name}" on this PC. Pick another port, or open that analyzer instead.`
          : `Port ${u.port} is already open in ${u.name}. Stop it first.`;
      }
      if (t.type === 'serial' && u.path && String(t.path || '').toLowerCase() === u.path.toLowerCase()) {
        return u.kind === 'connector'
          ? `${u.path} is used by the analyzer "${u.name}" on this PC.`
          : `${u.path} is already open in ${u.name}. Stop it first.`;
      }
    }
    return null;
  }

  async listenStart(opts = {}) {
    if (!opts || !opts.transport || !opts.transport.type) return { error: 'transport required' };
    // A paired connector may already own the port — stop it first? No: we
    // refuse, so listen mode can never silently take an analyzer offline.
    const conflict = this.conflictFor(opts.transport);
    if (conflict) return { error: conflict, code: 'port_in_use' };
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
    try { await s.start(); } catch (e) { return { error: await this._friendly(e, opts.transport) }; }
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

  async _friendly(e, transport) {
    let owner = null;
    const lookup = this.connectorOpts && this.connectorOpts.portOwner;
    if (e && e.code === 'EADDRINUSE' && transport && transport.type === 'tcp-server' && typeof lookup === 'function') {
      try { owner = await Promise.race([lookup(Number(transport.port)), new Promise((r) => setTimeout(() => r(null), 5000).unref?.())]); } catch { owner = null; }
    }
    return friendlyTransportError(e, transport, owner);
  }

  /**
   * "Find the analyzer": listen on several TCP ports at once (the port the
   * wizard asked the lab to set, plus the usual 5599–5610 an analyzer may
   * already point at). Nothing is uploaded; each port is a ListenSession
   * (ACKs like a real LIS so the analyzer keeps talking). Events go out as
   * 'diag' { scanId, kind: 'listening'|'connected'|'detect'|'error', port, … }.
   * Ports this PC already uses are skipped with a reason, never taken over.
   * @returns {Promise<{ scanId: string, ports: {port:number, ok:boolean, error?:string}[] } | { error: string }>}
   */
  async scanStart({ ports } = {}) {
    const list = [...new Set((Array.isArray(ports) ? ports : []).map(Number))].filter(validPort).slice(0, MAX_SCAN_PORTS);
    if (!list.length) return { error: 'ports required' };
    const scanId = crypto.randomUUID();
    const sc = { sessions: new Map(), info: new Map(), timer: null };
    this.scans.set(scanId, sc);
    const out = [];
    for (const port of list) out.push(await this._scanOpen(sc, scanId, port));
    if (!sc.sessions.size) { this.scans.delete(scanId); return { scanId: null, ports: out }; }
    sc.timer = setTimeout(() => this.scanStop(scanId).catch(() => {}), SCAN_TTL_MS);
    if (sc.timer.unref) sc.timer.unref();
    return { scanId, ports: out };
  }

  /** Open ONE port into a scan: { port, ok } or { port, ok:false, error, code? }. Never takes a port this PC already uses. */
  async _scanOpen(sc, scanId, port) {
    const emit = (kind, p, extra = {}) => this.emit('diag', { scanId, kind, port: p, ...extra });
    const transport = { type: 'tcp-server', port, host: '0.0.0.0' };
    const conflict = this.conflictFor(transport);
    if (conflict) return { port, ok: false, error: conflict, code: 'port_in_use' };
    const s = new ListenSession({ transport }, this.deps);
    const info = { port, remote: null, local: null, connectedAt: null, messages: 0, detect: null, guess: null };
    s.on('session', (x) => {
      info.remote = x.remote || null; info.local = x.local || null; info.connectedAt = x.since || new Date().toISOString();
      emit('connected', port, { remote: info.remote, local: info.local });
    });
    s.on('message', () => { info.messages++; });
    s.on('detect', () => {
      const d = detect(s.raw());
      info.detect = { protocol: d.protocol, link: d.link, confidence: d.confidence, reasons: d.reasons, proposed: d.proposed };
      info.guess = guess({ ...headerOf(d.text), protocol: d.protocol });
      emit('detect', port, { remote: info.remote, detect: info.detect, guess: info.guess, messages: info.messages });
    });
    s.on('error', (e) => emit('error', port, { error: e && e.message }));
    try {
      await s.start();
    } catch (e) {
      return { port, ok: false, error: await this._friendly(e, transport), code: e && e.code === 'EADDRINUSE' ? 'port_in_use' : 'cannot_open' };
    }
    sc.sessions.set(port, s);
    sc.info.set(port, info);
    emit('listening', port);
    return { port, ok: true };
  }

  /**
   * The lab's analyzer has a FIXED host port: listen on `port` in this scan,
   * and only once it really opened let go of `previous` (the port we had
   * suggested — never one of the usual `keep` ports). A bad / busy port
   * leaves the scan exactly as it was, so the old port keeps listening.
   * Validation: whole number 1–65535; not a port a paired analyzer / another
   * listen on this PC uses (conflictFor); not held by another program (the
   * bind fails → the host's portOwner names it, never kills it).
   * @returns {Promise<{ ok: true, port: number, ports: number[], warning?: string } | { ok: false, error: string, code: string }>}
   */
  async scanSetPort({ scanId, port, previous, keep = [] } = {}) {
    const sc = this.scans.get(scanId);
    if (!sc) return { ok: false, error: 'The listening session has ended. Press Start listening, then try again.', code: 'no_scan' };
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'A port is a whole number from 1 to 65535.', code: 'invalid_port' };
    const warning = port < 1024 ? `Ports below 1024 may need Prefrontal to run as administrator, and the firewall fix cannot open them.` : undefined;
    if (!sc.sessions.has(port)) {
      const r = await this._scanOpen(sc, scanId, port);
      if (!r.ok) return { ok: false, error: r.error, code: r.code };
    }
    const prev = Number.isInteger(previous) ? previous : null;
    if (prev != null && prev !== port && !keep.includes(prev) && sc.sessions.has(prev)) {
      const old = sc.sessions.get(prev);
      sc.sessions.delete(prev); sc.info.delete(prev);
      try { await old.stop(); } catch { /* already closed */ }
    }
    return { ok: true, port, ports: [...sc.sessions.keys()], ...(warning ? { warning } : {}) };
  }

  /** Stop a scan; per port: who connected, what was detected, the capture. */
  async scanStop(scanId) {
    const sc = this.scans.get(scanId);
    if (!sc) return { ports: [] };
    this.scans.delete(scanId);
    clearTimeout(sc.timer);
    const ports = [];
    for (const [port, s] of sc.sessions) {
      let res = null;
      try { res = await s.stop(); } catch { res = null; }
      const info = sc.info.get(port) || {};
      const heard = !!(res && res.raw);
      const d = heard ? res.detect : info.detect;
      ports.push({
        port, remote: info.remote, local: info.local, connectedAt: info.connectedAt, messages: res ? res.messages.length : info.messages,
        detect: d || null,
        guess: info.guess || (heard ? guess({ ...headerOf(detect(s.raw()).text), protocol: d && d.protocol }) : null),
        raw: res ? res.raw : '',
      });
    }
    return { ports };
  }

  /** Open listen + scan sessions (the updater holds a restart while > 0). */
  activeCaptures() { return this.listens.size + this.scans.size; }

  async stopAll() {
    for (const c of this.connectors.values()) await c.stop();
    for (const id of [...this.listens.keys()]) await this.listenStop(id);
    for (const id of [...this.scans.keys()]) await this.scanStop(id);
  }
}

module.exports = { ConnectorManager, plainSecrets };
