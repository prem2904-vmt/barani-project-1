'use strict';
/**
 * "Allow Prefrontal support" — a remote support session started BY THE LAB
 * (beta `support`, dev only). Plain Node: fetch, the approval dialog, NetDiag
 * and the ConnectorManager are injected, so every rule is unit-tested without
 * launching Electron (test/support-session.test.js).
 *
 * Rules (remote-support contract, owner-approved 2026-10-31):
 *   - NO inbound port, no listener. The app reaches OUT to our server with a
 *     long-poll (GET …/next?wait=25) ONLY while a session is active; idle =
 *     no request at all.
 *   - The lab starts it: start(minutes) → 6-digit code + expiry (default 2 h,
 *     max 4 h). One session per PC. Stop / expiry / app quit / sign-out end
 *     it, and nothing runs after that.
 *   - LOOK actions (network, firewall, who holds a port, connector status,
 *     ARP, connect-only probe, next free port, listen status) run during the
 *     session. CHANGE actions (connector setting, restart, listen capture,
 *     firewall fix) ask MAIN's own dialog EVERY time — Deny is the default
 *     button — and nothing changes without Allow. The firewall fix then
 *     still goes through netdiag.fixFirewall (Windows' own permission
 *     prompt, which no one can click remotely).
 *   - Every argument is checked here with the SAME validators the renderer
 *     IPC uses (netdiag portList / adapterName, diag-ipc probe limits); an
 *     unknown action or an extra argument is refused, never guessed.
 *   - Every action is logged in plain words and shown live to the lab.
 */
const { EventEmitter } = require('events');
const { portList, adapterName, PORT_RANGE } = require('./netdiag');
const { makeDiagHandlers } = require('./diag-ipc');

const MIN_MINUTES = 5;
const MAX_MINUTES = 240;
const DEFAULT_MINUTES = 120;
const POLL_WAIT_S = 25;
/** A long-poll that never answers is aborted after this (server wait + slack). */
const POLL_TIMEOUT_MS = (POLL_WAIT_S + 10) * 1000;
const REQ_TIMEOUT_MS = 15 * 1000;
/** Continuous 401s for this long = the lab user signed out → the session ends. */
const SIGNED_OUT_GRACE_MS = 5 * 60 * 1000;
const LOG_REFRESH_MS = 30 * 1000;
const MAX_LOG = 200;
/** The server caps a result at 128 KB; stay under it. */
const MAX_RESULT_CHARS = 120 * 1024;
const MAX_CAPTURE_TEXT = 32 * 1024;
const MAX_DESCRIPTION = 300;
const BETA_HEADER = 'X-PF-BETA';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CODE_RE = /^\d{6}$/;
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,8192}$/;
/** sampleIdPath: ASTM field[.component] ("3", "3.2") or HL7 "OBR-3" (the server's own rule). */
const SAMPLE_PATH_RE = /^(\d{1,2}(\.\d{1,2})?|[A-Za-z]{3}-\d{1,2})$/;

/** The server sends every setting value as a string; a port may come as a number. */
const valueText = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);
const oneOf = (list) => (v) => { const t = valueText(v); return t !== undefined && list.includes(t) ? t : undefined; };
/** Server-supplied words (analyzer name, plain summary): text only, no control characters, clipped. */
const words = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : undefined);
/** 10/8, 172.16/12, 192.168/16 — never link-local. */
const isPrivateV4 = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(ip));
const net24 = (ip) => String(ip).split('.').slice(0, 3).join('.');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);

// ── argument validators (pure) ─────────────────────────────────────────────

/** Each returns the clean value, or undefined when the argument is bad. */
const V = {
  instrumentId: (v) => (typeof v === 'string' && GUID_RE.test(v) ? v.toLowerCase() : undefined),
  port: (v) => int(v, 1, 65535),
  /** A port we may LISTEN on (never a privileged one). */
  listenPort: (v) => int(v, 1024, 65535),
  probePorts: (v) => portList(v, 8, 1) || undefined,
  firewallPorts: (v) => portList(v, 8, 1024) || undefined,
  host: (v) => (typeof v === 'string' && v.length <= 15 && /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v.split('.').every((o) => Number(o) <= 255) ? v : undefined),
  adapter: (v) => adapterName(v) || undefined,
  captureMinutes: (v) => int(v, 1, 5),
  words: (v) => words(v),
  field: (v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(SETTING_FIELDS, v) ? v : undefined),
};

/**
 * Connector settings support may change — EXACTLY the server's list
 * (SupportSettings.cs: field names, allowed values). The PC only approves;
 * the server writes the instrument config (link.checksum / link.echo …) and
 * this PC picks it up like any edit made on the Instruments screen.
 */
const SETTING_FIELDS = {
  port: { word: 'port', check: (v) => { const t = valueText(v); return t && /^\d{1,5}$/.test(t) && Number(t) >= 1 && Number(t) <= 65535 ? String(Number(t)) : undefined; } },
  link: { word: 'link protocol', check: oneOf(['auto', 'astm-e1381', 'mllp', 'raw']) },
  parser: { word: 'message parser', check: oneOf(['auto', 'astm', 'hl7', 'text']) },
  sampleIdPath: { word: 'sample ID position', check: (v) => { const t = valueText(v); return t && SAMPLE_PATH_RE.test(t) ? t : undefined; } },
  checksumMode: { word: 'checksum mode', check: oneOf(['strict', 'lenient', 'off']) },
  echoMode: { word: 'echo mode', check: oneOf(['on', 'off']) },
};

/**
 * The action table — the exact args the server queues (SupportMcpTools.cs).
 * `look` actions run during a session; `change` actions ask the PC first,
 * every time. `args`: name → [validator, required]. `name` / `summary` are
 * the server's plain words (shown, never acted on). connectors_status and
 * recent_messages are answered by the server itself (heartbeats / scrubbed
 * message store) and never reach the PC.
 */
const ACTIONS = {
  pc_overview: { kind: 'look', args: {} },
  firewall_status: { kind: 'look', args: {} },
  port_owner: { kind: 'look', args: { port: [V.port, true] } },
  recent_errors: { kind: 'look', args: { instrumentId: [V.instrumentId, false] } },
  arp_table: { kind: 'look', args: {} },
  probe: { kind: 'look', args: { ports: [V.probePorts, true], host: [V.host, false] } },
  next_free_port: { kind: 'look', args: {} },
  listen_status: { kind: 'look', args: {} },
  set_connector_setting: { kind: 'change', args: { instrumentId: [V.instrumentId, true], field: [V.field, true], value: [(v) => (valueText(v) === undefined ? undefined : v), true], name: [V.words, false], summary: [V.words, false] } },
  restart_connector: { kind: 'change', args: { instrumentId: [V.instrumentId, true], name: [V.words, false], summary: [V.words, false] } },
  listen_capture: { kind: 'change', args: { port: [V.listenPort, true], minutes: [V.captureMinutes, false], summary: [V.words, false] } },
  fix_firewall: { kind: 'change', args: { ports: [V.firewallPorts, true], adapter: [V.adapter, false], summary: [V.words, false] } },
};

/**
 * A command from the server → { commandId, action, args } or { error }.
 * Strict: unknown action, missing / extra / bad argument = refused.
 */
function parseCommand(raw) {
  const c = obj(raw);
  if (!c) return { error: 'bad_request: command' };
  const commandId = typeof c.commandId === 'string' && ID_RE.test(c.commandId) ? c.commandId : null;
  if (!commandId) return { error: 'bad_request: commandId' };
  const spec = typeof c.action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, c.action) ? ACTIONS[c.action] : null;
  if (!spec) return { commandId, error: 'unknown_action' };
  const a = c.args == null ? {} : obj(c.args);
  if (!a) return { commandId, error: 'bad_request: args' };
  for (const k of Object.keys(a)) if (!Object.prototype.hasOwnProperty.call(spec.args, k)) return { commandId, error: `bad_request: ${k}` };
  const args = {};
  for (const [k, [check, required]] of Object.entries(spec.args)) {
    if (a[k] === undefined || a[k] === null) {
      if (required) return { commandId, error: `bad_request: ${k}` };
      continue;
    }
    const v = check(a[k]);
    if (v === undefined) return { commandId, error: `bad_request: ${k}` };
    args[k] = v;
  }
  if (c.action === 'set_connector_setting') {
    const v = SETTING_FIELDS[args.field].check(args.value);
    if (v === undefined) return { commandId, error: 'bad_request: value' };
    args.value = v;
  }
  // The server may mark a command as a change; our own table may only make
  // it STRICTER (a "look" the server calls a change is asked too), never looser.
  const kind = spec.kind === 'change' || c.change === true ? 'change' : 'look';
  const description = (words(c.description) || args.summary || '').slice(0, MAX_DESCRIPTION);
  return { commandId, action: c.action, kind, args, description };
}

/** The renderer's start request → { minutes, token, apiUrl } or { error }. */
function parseStart(p) {
  const o = obj(p) || {};
  const minutes = o.minutes == null ? DEFAULT_MINUTES : int(o.minutes, MIN_MINUTES, MAX_MINUTES);
  if (minutes === undefined) return { error: 'bad_request: minutes' };
  const token = typeof o.token === 'string' && TOKEN_RE.test(o.token) ? o.token : null;
  if (!token) return { error: 'bad_request: token' };
  const apiUrl = cleanApiUrl(o.apiUrl);
  if (!apiUrl) return { error: 'bad_request: apiUrl' };
  return { minutes, token, apiUrl };
}

/** https://host[:port] (or http on this machine for local runs) — no path tricks, no credentials. */
function cleanApiUrl(v) {
  if (typeof v !== 'string' || v.length > 512) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return `${u.protocol}//${u.host}`;
}

const cleanToken = (t) => (typeof t === 'string' && TOKEN_RE.test(t) ? t : null);

/** Plain words for a 6-digit code: "482 913". */
const spacedCode = (c) => `${String(c).slice(0, 3)} ${String(c).slice(3)}`;

/**
 * Main's own approval, in plain words. Deny is the default and the Esc
 * answer; resolves true only on Allow. The main window is brought forward
 * first (it may sit in the tray), and the dialog is parented to it.
 */
async function askApproval({ message, detail, signal }, { showMessageBox, getWindow }) {
  const opts = {
    type: 'question',
    title: 'Prefrontal support',
    message,
    detail,
    buttons: ['Deny', 'Allow'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    // The session ending (Stop / expiry / quit) closes the question = Deny.
    ...(signal ? { signal } : {}),
  };
  const w = getWindow && getWindow();
  const live = !!w && !(typeof w.isDestroyed === 'function' && w.isDestroyed());
  if (live) {
    try { if (typeof w.isMinimized === 'function' && w.isMinimized()) w.restore(); } catch { /* best effort */ }
    try { if (typeof w.show === 'function') w.show(); } catch { /* best effort */ }
    try { if (typeof w.focus === 'function') w.focus(); } catch { /* best effort */ }
  }
  const r = live ? await showMessageBox(w, opts) : await showMessageBox(opts);
  return !!r && r.response === 1;
}

/**
 * One row of the server's log (GET …/log: {at, actor, action, outcome} —
 * `action` is already plain words, e.g. "Open port(s) 5603 in the Windows
 * firewall", `outcome` e.g. "approved on the PC") → the card's row, or null
 * for the "asked" rows (the answer row follows; the open question shows as
 * the approval banner). `outcome` becomes a tone the card can word.
 */
function serverRow(r) {
  const outcome = String(r.outcome || '').toLowerCase();
  if (outcome === 'asked' || outcome === 'asked for approval on the pc') return null;
  const tone = /denied|refused|no approval/.test(outcome) ? 'denied'
    : /failed|timed out|stopped before/.test(outcome) ? 'failed'
      : /approved/.test(outcome) ? 'approved' : 'ok';
  const text = String(r.action || '').trim();
  if (!text) return null;
  // "Joined the session" carries the support person's email as its outcome.
  const detail = r.actor === 'support' && /^joined/i.test(text) ? ` (${String(r.outcome || '').slice(0, 120)})` : '';
  return { at: r.at, actor: r.actor, text: `${text}${detail}`, outcome: tone };
}

class SupportSession extends EventEmitter {
  /**
   * @param {object} o
   * @param {Function} [o.fetchImpl]   fetch (global fetch in Electron main)
   * @param {object}   o.diag          NetDiag
   * @param {object}   o.manager       ConnectorManager
   * @param {string}   o.pcId          this PC's id (the hostname the heartbeat reports)
   * @param {Function} o.approve       ({ message, detail }) → Promise<boolean> (askApproval)
   * @param {Function} [o.now]
   * @param {Function} [o.sleep]       (ms) → Promise (tests make it instant)
   * @param {number[]} [o.backoffMs]   retry waits after a failed poll
   */
  constructor(o = {}) {
    super();
    this.fetch = o.fetchImpl || ((...a) => globalThis.fetch(...a));
    this.diag = o.diag;
    this.manager = o.manager;
    this.pcId = String(o.pcId || 'pc').slice(0, 128);
    this.approve = o.approve;
    this.now = o.now || Date.now;
    this.sleep = o.sleep || ((ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }));
    this.backoffMs = o.backoffMs || [2000, 5000, 15000, 30000];
    this.signedOutGraceMs = o.signedOutGraceMs == null ? SIGNED_OUT_GRACE_MS : o.signedOutGraceMs;
    this.logRefreshMs = o.logRefreshMs == null ? LOG_REFRESH_MS : o.logRefreshMs;
    /** One capture minute (tests shorten it). */
    this.minuteMs = o.minuteMs || 60000;
    this.diagIpc = this.diag ? makeDiagHandlers({ diag: this.diag, showMessageBox: async () => ({ response: 0 }), getWindow: () => null }) : null;
    this.gen = 0;
    this.s = null;              // the active session, or null
    this.last = null;           // the last ended session's summary (for the card)
    this.polls = 0;             // GET …/next calls made (tests: none while idle)
  }

  /** Card state (never the token). */
  state() {
    const s = this.s;
    if (!s) {
      return { active: false, status: this.last ? 'ended' : 'idle', endedReason: this.last ? this.last.reason : null, log: this.last ? this.last.log : [] };
    }
    return {
      active: true,
      status: s.status,
      sessionId: s.sessionId,
      code: s.code,
      startedAt: new Date(s.startedAt).toISOString(),
      expiresAt: new Date(s.expiresAt).toISOString(),
      minutes: s.minutes,
      supportJoined: s.supportJoined,
      joinedBy: s.joinedBy,
      approval: s.approval ? { message: s.approval.message } : null,
      signedOut: s.unauthSince != null,
      log: this._mergedLog(),
    };
  }

  _emit() { this.emit('change', this.state()); }

  /**
   * The server's log is the record (it sees support's side too); this PC's
   * own lines fill the gap until the next fetch, so nothing shows twice.
   */
  _mergedLog(s = this.s) {
    if (!s) return [];
    const server = s.serverLog.map(serverRow).filter(Boolean);
    const local = s.serverLogFetchedAt ? s.log.filter((l) => Date.parse(l.at) > s.serverLogFetchedAt) : s.log;
    return [...local, ...server].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, MAX_LOG);
  }

  _log(text, outcome, actor = 'pc') {
    if (!this.s) return;
    this.s.log.unshift({ at: new Date(this.now()).toISOString(), actor, text, outcome });
    if (this.s.log.length > MAX_LOG) this.s.log.length = MAX_LOG;
    this._emit();
  }

  /** The renderer pushes every fresh access token (AuthService refresh). */
  setToken(t) {
    const tok = cleanToken(t);
    if (!tok) return { ok: false, error: 'bad_request: token' };
    if (this.s) { this.s.token = tok; this.s.unauthSince = null; }
    return { ok: true };
  }

  /** IPC start: validate, then start. */
  async startFromIpc(p) {
    const a = parseStart(p);
    if (a.error) return { ok: false, error: a.error };
    return this.start(a);
  }

  /**
   * POST /api/support-sessions {pcId, minutes} → {sessionId, code, expiresAt}.
   * One session per PC: a second start while one runs is refused.
   */
  async start({ minutes, token, apiUrl }) {
    if (this.s) return { ok: false, error: 'already_active', state: this.state() };
    const gen = ++this.gen;
    const s = {
      gen, token, apiUrl, minutes, status: 'starting', sessionId: null, code: null,
      startedAt: this.now(), expiresAt: this.now() + minutes * 60000,
      supportJoined: false, joinedBy: null, approval: null, unauthSince: null, log: [], serverLog: [], serverLogFetchedAt: 0, lastLogAt: 0,
      ctl: null, approvalCtl: null, expiryTimer: null, scans: new Set(),
    };
    this.s = s;
    this.last = null;
    this._emit();
    let r;
    try {
      r = await this._req(s, 'POST', '', { pcId: this.pcId, minutes });
    } catch (e) {
      this._drop(gen);
      return { ok: false, error: `Couldn’t reach Prefrontal: ${e.message}` };
    }
    const d = r.data || {};
    if (gen !== this.gen) {
      // Stopped while starting: end the session the server just made.
      if (typeof d.sessionId === 'string' && ID_RE.test(d.sessionId)) {
        try { await this._req(s, 'POST', `/${encodeURIComponent(d.sessionId)}/stop`, {}); } catch { /* it expires anyway */ }
      }
      return { ok: false, error: 'stopped' };
    }
    if (r.status < 200 || r.status >= 300 || typeof d.sessionId !== 'string' || !ID_RE.test(d.sessionId) || !CODE_RE.test(String(d.code || ''))) {
      this._drop(gen);
      return { ok: false, error: r.status === 404 ? 'Remote support isn’t switched on for this lab.' : r.status === 403 ? 'Your account may not start a support session.' : (r.message || 'Couldn’t start the support session.') };
    }
    s.sessionId = d.sessionId;
    s.code = String(d.code);
    // Never longer than asked (or the 4 h cap), whatever the server says.
    const serverExp = Date.parse(d.expiresAt);
    const cap = s.startedAt + minutes * 60000;
    s.expiresAt = Number.isFinite(serverExp) ? Math.min(serverExp, cap) : cap;
    s.status = 'waiting';
    s.lastLogAt = this.now();
    const left = Math.max(0, s.expiresAt - this.now());
    s.expiryTimer = setTimeout(() => { void this.stop('expired'); }, left);
    if (s.expiryTimer.unref) s.expiryTimer.unref();
    this._log(`Support session started — code ${spacedCode(s.code)}`, 'ok', 'lab');
    void this._loop(gen);
    return { ok: true, state: this.state() };
  }

  /**
   * End the session: no more polls, nothing more runs; the server is told
   * (best effort). reason: 'lab' | 'expired' | 'quit' | 'signed_out' | 'ended'.
   */
  async stop(reason = 'lab') {
    const s = this.s;
    if (!s) return { ok: true, state: this.state() };
    this.gen++;
    this.s = null;
    clearTimeout(s.expiryTimer);
    try { if (s.ctl) s.ctl.abort(); } catch { /* already done */ }
    try { if (s.approvalCtl) s.approvalCtl.abort(); } catch { /* no dialog open */ }
    for (const scanId of s.scans) { try { await this.manager.scanStop(scanId); } catch { /* best effort */ } }
    const words = { lab: 'You stopped the support session', expired: 'The support session expired', quit: 'The app closed — support session ended', signed_out: 'Signed out — support session ended', ended: 'Prefrontal support ended the session' };
    const endRow = { at: new Date(this.now()).toISOString(), actor: reason === 'lab' ? 'lab' : 'pc', text: words[reason] || 'Support session ended', outcome: 'ok' };
    this.last = { reason, log: [endRow, ...this._mergedLog(s)].slice(0, MAX_LOG) };
    this._emit();
    if (s.sessionId && reason !== 'ended') {
      try { await this._req(s, 'POST', `/${encodeURIComponent(s.sessionId)}/stop`, {}, REQ_TIMEOUT_MS); } catch { /* the server expires it anyway */ }
    }
    return { ok: true, state: this.state() };
  }

  _drop(gen) {
    if (gen !== this.gen || !this.s) return;
    clearTimeout(this.s.expiryTimer);
    this.s = null;
    this.gen++;
    this._emit();
  }

  _live(gen) { return !!this.s && this.s.gen === gen && gen === this.gen; }

  async _req(s, method, path, body, timeoutMs = REQ_TIMEOUT_MS, track = false) {
    const ctl = new AbortController();
    if (track) s.ctl = ctl;
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await this.fetch(`${s.apiUrl}/api/support-sessions${path}`, {
        method,
        headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Accept: 'application/json', [BETA_HEADER]: 'support' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'network');
    } finally {
      clearTimeout(t);
      if (track && s.ctl === ctl) s.ctl = null;
    }
    let json = null;
    if (res.status !== 204) { try { json = await res.json(); } catch { json = null; } }
    const data = json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
    const message = json && typeof json === 'object' ? (json.error && (json.error.message || json.error)) || json.message : null;
    return { status: res.status, data, message: typeof message === 'string' ? message : null };
  }

  /** The long-poll: one command at a time, only while this session lives. */
  async _loop(gen) {
    let fails = 0;
    while (this._live(gen)) {
      const s = this.s;
      if (this.now() >= s.expiresAt) { await this.stop('expired'); return; }
      let r;
      try {
        this.polls++;
        r = await this._req(s, 'GET', `/${encodeURIComponent(s.sessionId)}/next?wait=${POLL_WAIT_S}`, undefined, POLL_TIMEOUT_MS, true);
      } catch {
        if (!this._live(gen)) return;
        await this.sleep(this.backoffMs[Math.min(fails++, this.backoffMs.length - 1)]);
        continue;
      }
      if (!this._live(gen)) return;
      if (r.status === 401 || r.status === 403) {
        if (s.unauthSince == null) { s.unauthSince = this.now(); this._emit(); }
        if (this.now() - s.unauthSince >= this.signedOutGraceMs) { await this.stop('signed_out'); return; }
        await this.sleep(this.backoffMs[Math.min(fails++, this.backoffMs.length - 1)]);
        continue;
      }
      if (r.status === 404 || r.status === 410) { await this.stop('ended'); return; }
      if (r.status >= 500 || r.status === 429 || r.status === 408) {
        await this.sleep(this.backoffMs[Math.min(fails++, this.backoffMs.length - 1)]);
        continue;
      }
      fails = 0;
      if (s.unauthSince != null) { s.unauthSince = null; this._emit(); }
      if (r.status === 200 && r.data) await this._handle(gen, r.data);
      if (this._live(gen) && this.now() - s.lastLogAt >= this.logRefreshMs) await this._refreshLog(gen);
    }
  }

  async _refreshLog(gen, withStatus = true) {
    const s = this.s;
    s.lastLogAt = this.now();
    try {
      const asked = this.now();
      const r = await this._req(s, 'GET', `/${encodeURIComponent(s.sessionId)}/log`);
      if (!this._live(gen) || r.status !== 200 || !Array.isArray(r.data)) return;
      s.serverLog = r.data.slice(-MAX_LOG).filter((x) => obj(x) && typeof x.action === 'string' && typeof x.at === 'string')
        .map((x) => ({ at: x.at, actor: String(x.actor || ''), action: x.action.slice(0, 200), outcome: String(x.outcome || '').slice(0, 200) }));
      s.serverLogFetchedAt = asked;
      this._emit();
    } catch { /* the log is a courtesy */ }
    if (withStatus && this._live(gen)) await this._refreshStatus(gen);
  }

  /** GET /{id} → {status, joined, joinedBy, expiresAt}: who joined (for the
   *  card) and the server's end. The expiry may only come EARLIER, never later. */
  async _refreshStatus(gen) {
    const s = this.s;
    try {
      const r = await this._req(s, 'GET', `/${encodeURIComponent(s.sessionId)}`);
      if (!this._live(gen)) return;
      if (r.status === 404 || r.status === 410) { await this.stop('ended'); return; }
      const d = obj(r.data);
      if (r.status !== 200 || !d) return;
      if (d.joined === true) { s.supportJoined = true; s.status = 'connected'; }
      if (typeof d.joinedBy === 'string' && d.joinedBy.length <= 254) s.joinedBy = d.joinedBy.replace(/[\u0000-\u001f\u007f]/g, '');
      const exp = Date.parse(d.expiresAt);
      if (Number.isFinite(exp) && exp < s.expiresAt) {
        s.expiresAt = exp;
        clearTimeout(s.expiryTimer);
        s.expiryTimer = setTimeout(() => { void this.stop('expired'); }, Math.max(0, exp - this.now()));
        if (s.expiryTimer.unref) s.expiryTimer.unref();
      }
      if (typeof d.status === 'string' && /^(ended|expired|stopped)$/.test(d.status)) { await this.stop('ended'); return; }
      this._emit();
    } catch { /* a courtesy */ }
  }

  /** Run one command and post its result. */
  async _handle(gen, raw) {
    const cmd = parseCommand(raw);
    if (!cmd.commandId) return;   // nothing to answer to
    const s = this.s;
    if (!s.supportJoined) { s.supportJoined = true; s.status = 'connected'; s.lastLogAt = 0; /* who joined: ask after this command */ }
    let result;
    if (cmd.error) {
      result = { ok: false, error: cmd.error };
      this._log(`Refused a support request (${cmd.error})`, 'refused');
    } else {
      try { result = await this._run(gen, cmd); } catch (e) { result = { ok: false, error: (e && e.message) || 'failed' }; }
    }
    // A long capture answers later; the long-poll carries on meanwhile.
    if (result && result.later) {
      void result.later.then((r) => this._post(gen, cmd, r), (e) => this._post(gen, cmd, { ok: false, approvedOnPc: true, error: (e && e.message) || 'failed' }));
      return;
    }
    await this._post(gen, cmd, result);
  }

  /** POST /{id}/result. 409 = already answered (done); 5xx / network retried. */
  async _post(gen, cmd, result) {
    if (!this._live(gen)) return;   // stopped meanwhile: report nothing more
    const s = this.s;
    const body = { commandId: cmd.commandId, ok: !!result.ok, data: capData(result.data), error: result.error || null };
    if (cmd.kind === 'change') body.approvedOnPc = result.approvedOnPc === true;
    for (let i = 0; i < 3 && this._live(gen); i++) {
      try {
        const r = await this._req(s, 'POST', `/${encodeURIComponent(s.sessionId)}/result`, body);
        if (r.status === 410) { await this.stop('ended'); return; }
        if (r.status < 500) { if (this._live(gen)) await this._refreshLog(gen, false); break; }
      } catch { /* retry */ }
      await this.sleep(this.backoffMs[Math.min(i, this.backoffMs.length - 1)]);
    }
  }

  _instrument(id) {
    const list = this.manager.list();
    return list.find((p) => String(p.instrumentId).toLowerCase() === id) || null;
  }

  /** Ask the lab on this PC. Only one dialog at a time. */
  async _ask(gen, message, detailExtra) {
    const s = this.s;
    s.approval = { message };
    s.approvalCtl = new AbortController();
    this._emit();
    let yes = false;
    try {
      const said = s.description ? `Prefrontal support says: “${s.description}”\n\n` : '';
      const detail = `${said}${detailExtra ? `${detailExtra}\n\n` : ''}Only allow this if you are talking to Prefrontal support right now (session code ${spacedCode(s.code)}).`;
      yes = await this.approve({ message, detail, signal: s.approvalCtl.signal });
    } catch { yes = false; }
    s.approvalCtl = null;
    if (this.s === s) { s.approval = null; this._emit(); }
    return yes === true && this._live(gen);
  }

  async _run(gen, { action, args, kind, description }) {
    const d = this.diag;
    const m = this.manager;
    this.s.description = description || '';
    // The server called a "look" a change: ask first (stricter, never looser).
    if (kind === 'change' && ACTIONS[action].kind === 'look') {
      if (!(await this._ask(gen, `Prefrontal support wants to: ${description || action.replace(/_/g, ' ')}. Allow?`))) return this._denied(action.replace(/_/g, ' '));
      const r = await this._run(gen, { action, args, kind: 'look', description });
      return { ...r, approvedOnPc: true };
    }
    const look = (text, data) => { this._log(text, 'ok'); return { ok: true, data }; };
    switch (action) {
      case 'pc_overview': return look('Looked at this PC’s network', await d.snapshot());
      case 'firewall_status': return look('Looked at the firewall', await d.firewall());
      case 'port_owner': return look(`Checked which program uses port ${args.port}`, { port: args.port, owner: await d.portOwner(args.port) });
      case 'recent_errors': {
        // Error TEXT only (never a message body): what the connector logged.
        const st = m.status().filter((x) => !args.instrumentId || String(x.instrumentId).toLowerCase() === args.instrumentId);
        return look('Looked at recent analyzer errors', st.map((x) => ({
          instrumentId: x.instrumentId, name: x.name, link: x.link || x.state || null,
          errorDetail: typeof x.errorDetail === 'string' ? x.errorDetail : null,
          lastError: typeof x.lastError === 'string' ? x.lastError : null,
          errors: (Array.isArray(x.recentErrors) ? x.recentErrors : []).map((e) => ({ at: e && e.at, error: String((e && e.message) || '').slice(0, 300) })),
        })));
      }
      case 'arp_table': return look('Looked at devices on the lab network', await d.arp());
      case 'probe': {
        // netdiag.probe dials only ARP-known hosts on the /24 of one of THIS
        // PC's own private addresses; pick that address from the host asked
        // for (which must be ARP-known), or the first card with neighbours.
        const own = (await d.adapters()).flatMap((a) => (a.ipv4 || []).map((x) => x.address)).filter((ip) => isPrivateV4(ip));
        const arp = await d.arp();
        let address;
        if (args.host) {
          address = own.find((ip) => net24(ip) === net24(args.host));
          if (!address) return { ok: false, error: `${args.host} is not on any of this PC’s networks` };
          if (!arp.some((e) => e.ip === args.host)) return { ok: false, error: `${args.host} is not in this PC’s ARP table (it hasn’t talked to it)` };
        } else {
          address = own.find((ip) => arp.some((e) => net24(e.ip) === net24(ip) && e.ip !== ip)) || own[0];
          if (!address) return { ok: false, error: 'this PC has no private network address' };
        }
        const r = await this.diagIpc.probe({ address, ports: args.ports });
        const what = args.host ? `Checked ${args.host} on port(s) ${args.ports.join(', ')}` : `Checked the devices on the network on port(s) ${args.ports.join(', ')}`;
        if (!r || r.error) { this._log(what, 'failed'); return { ok: false, error: (r && r.error) || 'probe failed', data: r }; }
        return look(what, args.host ? { ...r, open: (r.open || []).filter((o) => o.host === args.host) } : r);
      }
      case 'next_free_port': return look('Looked for a free analyzer port', { port: await d.nextFreePort() });
      case 'listen_status': return look('Looked at open listening ports', {
        endpoints: m.usedEndpoints(), activeCaptures: m.activeCaptures(),
      });
      case 'set_connector_setting': {
        const p = this._instrument(args.instrumentId);
        if (!p) return { ok: false, error: 'not paired on this PC' };
        const f = SETTING_FIELDS[args.field];
        const text = `the ${f.word} of the ${p.name} to ${args.value}`;
        if (!(await this._ask(gen, `Prefrontal support wants to change ${text}. Allow?`, 'Prefrontal saves it like a change made on the Instruments screen.'))) return this._denied(`Change ${text}`);
        this._log(`Change ${text}`, 'approved');
        // Approval ONLY: the server applies it through the instrument config
        // (validation, audit, bridge bump) and this PC picks it up.
        return { ok: true, approvedOnPc: true, data: { approved: true } };
      }
      case 'restart_connector': {
        const p = this._instrument(args.instrumentId);
        if (!p) return { ok: false, error: 'not paired on this PC' };
        if (!(await this._ask(gen, `Prefrontal support wants to restart the connection to the ${p.name}. Allow?`, 'Results the analyzer sends during the restart are kept and sent after it.'))) return this._denied(`Restart the ${p.name} connection`);
        const r = await m.reload(p.instrumentId);
        this._log(`Restarted the ${p.name} connection — approved`, r && r.ok ? 'approved' : 'failed');
        return { ok: !!(r && r.ok), approvedOnPc: true, data: r, error: r && !r.ok ? r.error : undefined };
      }
      case 'listen_capture': {
        const minutes = args.minutes || 2;
        // Never a port a paired analyzer uses (manager.scanStart refuses it too).
        const used = m.usedEndpoints().find((u) => u.port === args.port);
        if (used) return { ok: false, error: `port ${args.port} is used by ${used.name} on this PC` };
        if (!(await this._ask(gen, `Prefrontal support wants to listen on port ${args.port} for ${minutes} min to see what the analyzer sends. Allow?`, 'Nothing is sent to the lab’s results while listening.'))) return this._denied(`Listen on port ${args.port}`);
        const r = await m.scanStart({ ports: [args.port] });
        if (!r || !r.scanId) {
          this._log(`Listen on port ${args.port} — couldn’t start`, 'failed');
          return { ok: false, approvedOnPc: true, error: (r && (r.error || (r.ports && r.ports[0] && r.ports[0].error))) || 'could not listen', data: r };
        }
        const s = this.s;
        s.scans.add(r.scanId);
        this._log(`Listening on port ${args.port} for ${minutes} min — approved`, 'approved');
        // Answers when the capture ends: {messages:[{protocol, text}], bytes}
        // (the server scrubs the text before support sees it).
        const later = new Promise((resolve) => {
          const t = setTimeout(async () => {
            if (!s.scans.delete(r.scanId)) { resolve({ ok: false, approvedOnPc: true, error: 'the session ended before the capture finished' }); return; }
            let out = null;
            try { out = await m.scanStop(r.scanId); } catch { out = null; }
            resolve({ ok: true, approvedOnPc: true, data: captureResult(out) });
          }, minutes * this.minuteMs);
          if (t.unref) t.unref();
        });
        return { later };
      }
      case 'fix_firewall': {
        let adapter = args.adapter;
        if (!adapter) {
          // Not named: the ONE analyzer-only card (private address, no gateway), else ask support to name it.
          const cards = (await d.adapters()).filter((a) => !a.gateway && (a.ipv4 || []).some((x) => isPrivateV4(x.address)));
          if (cards.length !== 1) return { ok: false, error: 'bad_request: adapter (name the analyzer network card from pc_overview)' };
          adapter = V.adapter(cards[0].name);
          if (!adapter) return { ok: false, error: 'bad_request: adapter' };
        }
        const paired = m.usedEndpoints().filter((u) => u.kind === 'connector' && u.port);
        const allowed = (p) => (p >= PORT_RANGE.start && p <= PORT_RANGE.end) || paired.some((u) => u.port === p);
        if (!args.ports.every(allowed)) return { ok: false, error: 'bad_request: ports (analyzer range 5599–5650 or a paired analyzer port only)' };
        const names = [...new Set(paired.filter((u) => args.ports.includes(u.port)).map((u) => u.name))];
        const portWords = args.ports.length === 1 ? `port ${args.ports[0]}` : `ports ${args.ports.join(', ')}`;
        const forWhom = names.length ? ` for the ${names.join(' and ')}` : ' for the analyzers';
        let asked = false;
        let yes = false;
        const r = await d.fixFirewall({
          ports: args.ports,
          adapter,
          confirm: async (plan) => {
            asked = true;
            yes = await this._ask(gen, `Prefrontal support wants to open ${portWords}${forWhom} in the Windows firewall. Allow?`,
              `Changes:\n${(plan.lines || []).map((l) => `• ${l}`).join('\n')}\n\nWindows then asks "Do you want to allow this app to make changes?" — choose Yes.`);
            return yes;
          },
        });
        if (asked && !yes) return this._denied(`Open ${portWords} in the firewall`);
        this._log(`Opened ${portWords} in the firewall${asked ? ' — approved' : ''}`, r && r.ok ? 'approved' : 'failed');
        return { ok: !!(r && r.ok), approvedOnPc: asked && yes, data: r, error: r && !r.ok ? r.error : undefined };
      }
      default: return { ok: false, error: 'unknown_action' };
    }
  }

  _denied(what) {
    this._log(`${what} — denied on this PC`, 'denied', 'lab');
    return { ok: false, approvedOnPc: false, error: 'denied_on_pc' };
  }
}

/** scanStop() → {messages:[{protocol, text}], bytes} for the server. */
function captureResult(out) {
  const ports = (out && Array.isArray(out.ports)) ? out.ports : [];
  let bytes = 0;
  const messages = [];
  for (const p of ports) {
    const raw = String((p && p.raw) || '');
    bytes += raw.length;
    if (raw) messages.push({ protocol: (p.detect && p.detect.protocol) || 'unknown', text: raw.slice(0, MAX_CAPTURE_TEXT) });
  }
  return { messages, bytes };
}

/** Keep a result small enough for the server (and Claude). */
function capData(data) {
  if (data === undefined) return null;
  let text;
  try { text = JSON.stringify(data); } catch { return { unserialisable: true }; }
  if (text === undefined) return null;
  return text.length > MAX_RESULT_CHARS ? { truncated: true, preview: text.slice(0, MAX_RESULT_CHARS) } : data;
}

module.exports = {
  SupportSession, ACTIONS, SETTING_FIELDS, parseCommand, captureResult, parseStart, cleanApiUrl, askApproval, capData, spacedCode,
  MIN_MINUTES, MAX_MINUTES, DEFAULT_MINUTES, POLL_WAIT_S,
};
