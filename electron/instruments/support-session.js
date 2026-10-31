'use strict';
/**
 * "Allow Prefrontal support" — a remote support session started BY THE LAB
 * (beta `support`, dev only). Plain Node: fetch, the SignalR hub connection,
 * the approval dialog, NetDiag and the ConnectorManager are injected, so
 * every rule is unit-tested without launching Electron
 * (test/support-session.test.js).
 *
 * Rules (remote-support + shared-state contracts, owner-approved 2026-10-31):
 *   - NO inbound port, no listener. The app reaches OUT: one SignalR
 *     connection from MAIN to our server (`/hubs/support`, the lab user's
 *     token + X-PF-BETA: support) that exists ONLY while a session is active;
 *     idle = no connection, no request at all.
 *   - The lab starts it: POST /api/support-sessions {pcId, minutes,
 *     instrumentIds} → code "WDJB-MJHT" + expiry (default 2 h, max 4 h). One
 *     session per PC. Stop / expiry / app quit / sign-out / the server's
 *     'Ended' end it, and nothing runs after that.
 *   - The hub: Join(sessionId) after EVERY (re)connect (its answer carries the
 *     live log backlog); the server pushes 'Command' / 'Log' / 'Ended'; the PC
 *     answers each command with Result({commandId, ok, data, error,
 *     approvedOnPc}). Reconnects with backoff while the session lives.
 *   - LOOK actions (network, firewall, who holds a port, connector status,
 *     ARP, connect-only probe, next free port, listen status) run during the
 *     session. CHANGE actions (connector setting, restart, listen capture,
 *     firewall fix) ask MAIN's own dialog EVERY time — Deny is the default
 *     button — and nothing changes without Allow. A dialog open when the
 *     connection drops is closed (= Deny): the answer could not reach support.
 *     The firewall fix then still goes through netdiag.fixFirewall (Windows'
 *     own permission prompt, which no one can click remotely).
 *   - Every argument is checked here with the SAME validators the renderer
 *     IPC uses (netdiag portList / adapterName, diag-ipc probe limits); an
 *     unknown action or an extra argument is refused, never guessed.
 *   - The lab's live log is the SERVER's (Join backlog + 'Log' events, plain
 *     words, no payloads), shown on the Instruments card.
 */
const { EventEmitter } = require('events');
const { portList, adapterName, PORT_RANGE } = require('./netdiag');
const { makeDiagHandlers } = require('./diag-ipc');

const MIN_MINUTES = 5;
const MAX_MINUTES = 240;
const DEFAULT_MINUTES = 120;
const HUB_PATH = '/hubs/support';
const REQ_TIMEOUT_MS = 15 * 1000;
/** Refused sign-in (401/403 on GET /{id}) for this long = signed out → the session ends. */
const SIGNED_OUT_GRACE_MS = 5 * 60 * 1000;
/** GET /{id} (joined / pcConnected / earlier expiry / gone) this often while a session runs. */
const STATUS_REFRESH_MS = 30 * 1000;
const MAX_LOG = 200;
/** The server refuses a result whose data is over 128 KB (SupportSanitize.MaxBytes); stay under it. */
const MAX_RESULT_CHARS = 120 * 1024;
const MAX_CAPTURE_TEXT = 32 * 1024;
const MAX_DESCRIPTION = 300;
const MAX_INSTRUMENTS = 64;
const BETA_HEADER = 'X-PF-BETA';
const BRANCH_HEADER = 'X-Active-Branch';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
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
  /** A port to look at (the server's rule: 1024–65535). */
  port: (v) => int(v, 1024, 65535),
  /** A port we may LISTEN on (never a privileged one). */
  listenPort: (v) => int(v, 1024, 65535),
  probePorts: (v) => portList(v, 8, 1024) || undefined,
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

/**
 * The renderer's start request → { minutes, token, apiUrl, branchId } or
 * { error }. branchId (the active branch, X-Active-Branch) is optional.
 */
function parseStart(p) {
  const o = obj(p) || {};
  const minutes = o.minutes == null ? DEFAULT_MINUTES : int(o.minutes, MIN_MINUTES, MAX_MINUTES);
  if (minutes === undefined) return { error: 'bad_request: minutes' };
  const token = typeof o.token === 'string' && TOKEN_RE.test(o.token) ? o.token : null;
  if (!token) return { error: 'bad_request: token' };
  const apiUrl = cleanApiUrl(o.apiUrl);
  if (!apiUrl) return { error: 'bad_request: apiUrl' };
  let branchId = null;
  if (o.branchId != null && o.branchId !== '') {
    if (typeof o.branchId !== 'string' || !GUID_RE.test(o.branchId)) return { error: 'bad_request: branchId' };
    branchId = o.branchId.toLowerCase();
  }
  return { minutes, token, apiUrl, branchId };
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
 * The server's code ("WDJB-MJHT", 8 letters) in its display form, or null
 * when it isn't one. Upper-case, dash in the middle — read out on the phone.
 */
function displayCode(c) {
  const t = String(c == null ? '' : c).replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4)}` : null;
}

/**
 * The real hub connection (Electron main = Node: the token rides the
 * Authorization header on the WebSocket upgrade, plus X-PF-BETA and the
 * active branch). WebSockets only, no negotiate round trip — any container
 * behind the load balancer can take the connection (no sticky sessions).
 * Required lazily so tests never load it.
 */
function defaultHubFactory(url, { accessTokenFactory, headers, retryPolicy }) {
  // eslint-disable-next-line global-require
  const signalR = require('@microsoft/signalr');
  return new signalR.HubConnectionBuilder()
    .withUrl(url, {
      accessTokenFactory,
      headers,
      transport: signalR.HttpTransportType.WebSockets,
      skipNegotiation: true,
    })
    .withAutomaticReconnect(retryPolicy)
    .configureLogging(signalR.LogLevel.None)
    .build();
}

/**
 * One row of the server's log ({at, actor, action, outcome} — `action` is
 * already plain words, e.g. "Open port(s) 5603 in the Windows firewall",
 * `outcome` e.g. "approved on the PC") → the card's row, or null for the
 * "asked" rows (the answer row follows; the open question shows as the
 * approval banner). `outcome` becomes a tone the card can word.
 */
function serverRow(r) {
  const outcome = String(r.outcome || '').toLowerCase();
  if (outcome === 'asked' || outcome === 'asked for approval on the pc') return null;
  const tone = /denied|refused|no approval/.test(outcome) ? 'denied'
    : /failed|timed out|stopped before|not saved|no answer/.test(outcome) ? 'failed'
      : /approved/.test(outcome) ? 'approved' : 'ok';
  const text = String(r.action || '').trim();
  if (!text) return null;
  // "Joined the session" carries the support person's email as its outcome.
  const detail = r.actor === 'support' && /^joined/i.test(text) ? ` (${String(r.outcome || '').slice(0, 120)})` : '';
  return { at: r.at, actor: r.actor, text: `${text}${detail}`, outcome: tone };
}

/** A server log line (Join backlog / 'Log' event), cleaned, or null. */
function cleanLogLine(x) {
  if (!obj(x) || typeof x.action !== 'string' || typeof x.at !== 'string') return null;
  const clip = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200);
  return { at: x.at.slice(0, 40), actor: clip(x.actor).slice(0, 16), action: clip(x.action), outcome: clip(x.outcome) };
}
const logKey = (l) => `${l.at}|${l.actor}|${l.action}|${l.outcome}`;

class SupportSession extends EventEmitter {
  /**
   * @param {object} o
   * @param {Function} [o.fetchImpl]   fetch (global fetch in Electron main)
   * @param {Function} [o.hubFactory]  (url, {accessTokenFactory, headers, retryPolicy}) → HubConnection
   * @param {object}   o.diag          NetDiag
   * @param {object}   o.manager       ConnectorManager
   * @param {string}   o.pcId          this PC's id (os.hostname())
   * @param {Function} o.approve       ({ message, detail, signal }) → Promise<boolean> (askApproval)
   * @param {Function} [o.now]
   * @param {Function} [o.sleep]       (ms) → Promise (tests make it instant)
   * @param {number[]} [o.backoffMs]   reconnect waits
   */
  constructor(o = {}) {
    super();
    this.fetch = o.fetchImpl || ((...a) => globalThis.fetch(...a));
    this.hubFactory = o.hubFactory || defaultHubFactory;
    this.diag = o.diag;
    this.manager = o.manager;
    this.pcId = String(o.pcId || 'pc').slice(0, 128);
    this.approve = o.approve;
    this.now = o.now || Date.now;
    this.sleep = o.sleep || ((ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }));
    this.backoffMs = o.backoffMs || [0, 2000, 5000, 10000, 30000];
    this.signedOutGraceMs = o.signedOutGraceMs == null ? SIGNED_OUT_GRACE_MS : o.signedOutGraceMs;
    this.statusRefreshMs = o.statusRefreshMs == null ? STATUS_REFRESH_MS : o.statusRefreshMs;
    /** One capture minute (tests shorten it). */
    this.minuteMs = o.minuteMs || 60000;
    this.diagIpc = this.diag ? makeDiagHandlers({ diag: this.diag, showMessageBox: async () => ({ response: 0 }), getWindow: () => null }) : null;
    this.gen = 0;
    this.s = null;              // the active session, or null
    this.last = null;           // the last ended session's summary (for the card)
    this.connections = 0;       // hub connections made (tests: none while idle)
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
      /** This PC's live line to Prefrontal: connecting | online | reconnecting. */
      connection: s.connection,
      /** The server's own view (GET /{id} pcConnected), null until asked. */
      pcConnected: s.pcConnected,
      approval: s.approval ? { message: s.approval.message } : null,
      signedOut: s.unauthSince != null,
      log: this._rows(s),
    };
  }

  _emit() { this.emit('change', this.state()); }

  /** The server's log → card rows, newest first. */
  _rows(s) {
    return s.serverLog.map(serverRow).filter(Boolean).reverse().slice(0, MAX_LOG);
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

  /** The analyzers paired on THIS PC (support is scoped to them on the server). */
  _pairedIds() {
    let list = [];
    try { list = (this.manager && this.manager.list()) || []; } catch { list = []; }
    const ids = list.map((p) => String((p && p.instrumentId) || '').toLowerCase()).filter((id) => GUID_RE.test(id));
    return [...new Set(ids)].slice(0, MAX_INSTRUMENTS);
  }

  /**
   * POST /api/support-sessions {pcId, minutes, instrumentIds} →
   * {sessionId, code, expiresAt, hub}; then the hub connection + Join.
   * One session per PC: a second start while one runs is refused.
   */
  async start({ minutes, token, apiUrl, branchId = null }) {
    if (this.s) return { ok: false, error: 'already_active', state: this.state() };
    const gen = ++this.gen;
    const s = {
      gen, token, apiUrl, branchId, minutes, status: 'starting', sessionId: null, code: null,
      startedAt: this.now(), expiresAt: this.now() + minutes * 60000,
      supportJoined: false, joinedBy: null, pcConnected: null, connection: 'connecting', approval: null, unauthSince: null,
      serverLog: [], approvalCtl: null, expiryTimer: null, statusTimer: null, scans: new Set(),
      conn: null, connecting: false, queue: Promise.resolve(), description: '',
    };
    this.s = s;
    this.last = null;
    this._emit();
    let r;
    try {
      r = await this._req(s, 'POST', '', { pcId: this.pcId, minutes, instrumentIds: this._pairedIds() });
    } catch (e) {
      this._drop(gen);
      return { ok: false, error: `Couldn’t reach Prefrontal: ${e.message}` };
    }
    const d = obj(r.data) || {};
    if (gen !== this.gen) {
      // Stopped while starting: end the session the server just made.
      if (typeof d.sessionId === 'string' && GUID_RE.test(d.sessionId)) {
        try { await this._req(s, 'POST', `/${encodeURIComponent(d.sessionId)}/stop`, {}); } catch { /* it expires anyway */ }
      }
      return { ok: false, error: 'stopped' };
    }
    const code = displayCode(d.code);
    if (r.status < 200 || r.status >= 300 || typeof d.sessionId !== 'string' || !GUID_RE.test(d.sessionId) || !code) {
      this._drop(gen);
      return { ok: false, error: r.status === 404 ? 'Remote support isn’t switched on for this lab.' : r.status === 403 ? 'Your account may not start a support session.' : (r.message || 'Couldn’t start the support session.') };
    }
    s.sessionId = d.sessionId.toLowerCase();
    s.code = code;
    // Never longer than asked (or the 4 h cap), whatever the server says.
    const serverExp = Date.parse(d.expiresAt);
    const cap = s.startedAt + minutes * 60000;
    s.expiresAt = Number.isFinite(serverExp) ? Math.min(serverExp, cap) : cap;
    s.status = 'waiting';
    this._armExpiry(s);
    this._armStatus(gen);
    this._openHub(gen);
    this._emit();
    return { ok: true, state: this.state() };
  }

  _armExpiry(s) {
    clearTimeout(s.expiryTimer);
    s.expiryTimer = setTimeout(() => { void this.stop('expired'); }, Math.max(0, s.expiresAt - this.now()));
    if (s.expiryTimer.unref) s.expiryTimer.unref();
  }

  _armStatus(gen) {
    const s = this.s;
    if (!s || !this.statusRefreshMs) return;
    clearTimeout(s.statusTimer);
    s.statusTimer = setTimeout(async () => {
      if (!this._live(gen)) return;
      await this._refreshStatus(gen);
      if (this._live(gen)) this._armStatus(gen);
    }, this.statusRefreshMs);
    if (s.statusTimer.unref) s.statusTimer.unref();
  }

  /**
   * End the session: the hub connection closes, nothing more runs; the server
   * is told (best effort). reason: 'lab' | 'expired' | 'quit' | 'signed_out' | 'ended'.
   */
  async stop(reason = 'lab') {
    const s = this.s;
    if (!s) return { ok: true, state: this.state() };
    this.gen++;
    this.s = null;
    clearTimeout(s.expiryTimer);
    clearTimeout(s.statusTimer);
    try { if (s.approvalCtl) s.approvalCtl.abort(); } catch { /* no dialog open */ }
    const conn = s.conn;
    s.conn = null;
    if (conn) { try { await conn.stop(); } catch { /* already closed */ } }
    for (const scanId of s.scans) { try { await this.manager.scanStop(scanId); } catch { /* best effort */ } }
    s.scans.clear();
    const said = { lab: 'You stopped the support session', expired: 'The support session expired', quit: 'The app closed — support session ended', signed_out: 'Signed out — support session ended', ended: 'Prefrontal support ended the session' };
    const endRow = { at: new Date(this.now()).toISOString(), actor: reason === 'lab' ? 'lab' : 'pc', text: said[reason] || 'Support session ended', outcome: 'ok' };
    this.last = { reason, log: [endRow, ...this._rows(s)].slice(0, MAX_LOG) };
    this._emit();
    if (s.sessionId && reason !== 'ended') {
      try { await this._req(s, 'POST', `/${encodeURIComponent(s.sessionId)}/stop`, {}); } catch { /* the server expires it anyway */ }
    }
    return { ok: true, state: this.state() };
  }

  _drop(gen) {
    if (gen !== this.gen || !this.s) return;
    clearTimeout(this.s.expiryTimer);
    clearTimeout(this.s.statusTimer);
    this.s = null;
    this.gen++;
    this._emit();
  }

  _live(gen) { return !!this.s && this.s.gen === gen && gen === this.gen; }

  _headers(s) {
    const h = { [BETA_HEADER]: 'support' };
    if (s.branchId) h[BRANCH_HEADER] = s.branchId;
    return h;
  }

  async _req(s, method, path, body, timeoutMs = REQ_TIMEOUT_MS) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await this.fetch(`${s.apiUrl}/api/support-sessions${path}`, {
        method,
        headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...this._headers(s) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'network');
    } finally {
      clearTimeout(t);
    }
    let json = null;
    if (res.status !== 204) { try { json = await res.json(); } catch { json = null; } }
    const data = json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
    const message = json && typeof json === 'object' ? (json.error && (json.error.message || json.error)) || json.message : null;
    return { status: res.status, data, message: typeof message === 'string' ? message : null };
  }

  // ── the hub ────────────────────────────────────────────────────────────

  /** Build this session's ONE connection, wire it, connect. */
  _openHub(gen) {
    const s = this.s;
    const backoff = (n) => this.backoffMs[Math.min(n, this.backoffMs.length - 1)];
    const conn = this.hubFactory(`${s.apiUrl}${HUB_PATH}`, {
      // Always the freshest token the renderer handed over.
      accessTokenFactory: () => (this._live(gen) ? this.s.token : ''),
      headers: this._headers(s),
      // Keep reconnecting while the session lives; stop the moment it ends.
      retryPolicy: { nextRetryDelayInMilliseconds: (ctx) => (this._live(gen) ? backoff(ctx.previousRetryCount) : null) },
    });
    this.connections++;
    s.conn = conn;
    conn.on('Command', (raw) => {
      if (!this._live(gen)) return;
      s.queue = s.queue.then(() => this._handle(gen, raw)).catch(() => undefined);
    });
    conn.on('Log', (line) => { if (this._live(gen)) this._addLog(gen, line); });
    conn.on('Ended', () => { if (this._live(gen)) void this.stop('ended'); });
    conn.onreconnecting(() => {
      if (!this._live(gen)) return;
      this._lineDown(gen);
    });
    conn.onreconnected(() => { if (this._live(gen)) void this._join(gen); });
    conn.onclose(() => {
      // Automatic reconnect gave up (or the server closed for good): start over while the session lives.
      if (!this._live(gen)) return;
      this._lineDown(gen);
      void this._connect(gen, 1);
    });
    void this._connect(gen, 0);
  }

  /** The line dropped: an open question can no longer reach support → closed (= Deny). */
  _lineDown(gen) {
    const s = this.s;
    s.connection = 'reconnecting';
    try { if (s.approvalCtl) s.approvalCtl.abort(); } catch { /* none open */ }
    this._emit();
    void this._refreshStatus(gen);
  }

  /** Start the connection, retrying with backoff while the session lives; then Join. */
  async _connect(gen, fails) {
    const s = this.s;
    if (!s || s.connecting) return;
    s.connecting = true;
    try {
      while (this._live(gen)) {
        if (fails > 0) await this.sleep(this.backoffMs[Math.min(fails - 1, this.backoffMs.length - 1)]);
        if (!this._live(gen)) return;
        try {
          await s.conn.start();
        } catch {
          fails++;
          if (!this._live(gen)) return;
          if (s.connection !== 'reconnecting') { s.connection = 'reconnecting'; this._emit(); }
          void this._refreshStatus(gen);
          continue;
        }
        if (!this._live(gen)) return;
        await this._join(gen);
        return;
      }
    } finally {
      s.connecting = false;
    }
  }

  /** Join(sessionId): after EVERY (re)connect. Its log is the backlog. */
  async _join(gen) {
    const s = this.s;
    let r;
    try { r = await s.conn.invoke('Join', s.sessionId); } catch { return; /* dropped again: the reconnect joins */ }
    if (!this._live(gen)) return;
    const o = obj(r);
    if (!o || o.ok !== true) {
      // not_found = the session is gone (ended, expired, replaced); invalid_request = it can never be joined.
      if (!o || o.error === 'not_found' || o.error === 'invalid_request') await this.stop('ended');
      return;
    }
    s.connection = 'online';
    if (o.status === 'active') { s.supportJoined = true; s.status = 'connected'; }
    const exp = Date.parse(o.expiresAt);
    if (Number.isFinite(exp) && exp < s.expiresAt) { s.expiresAt = exp; this._armExpiry(s); }
    // Backlog is the record; keep any line that arrived meanwhile and isn't in it.
    const backlog = (Array.isArray(o.log) ? o.log : []).map(cleanLogLine).filter(Boolean);
    const seen = new Set(backlog.map(logKey));
    const lastAt = backlog.length ? backlog[backlog.length - 1].at : '';
    const extra = s.serverLog.filter((l) => !seen.has(logKey(l)) && l.at > lastAt);
    s.serverLog = [...backlog, ...extra].slice(-MAX_LOG);
    this._emit();
    void this._refreshStatus(gen);
  }

  _addLog(gen, line) {
    const s = this.s;
    const l = cleanLogLine(line);
    if (!l) return;
    if (s.serverLog.some((x) => logKey(x) === logKey(l))) return;   // Join's backlog may carry it already
    s.serverLog.push(l);
    if (s.serverLog.length > MAX_LOG) s.serverLog.splice(0, s.serverLog.length - MAX_LOG);
    if (l.actor === 'support' && /^joined/i.test(l.action)) {
      s.supportJoined = true;
      s.status = 'connected';
      if (l.outcome && l.outcome.length <= 254) s.joinedBy = l.outcome;
    }
    this._emit();
  }

  /** GET /{id} → {status, joined, joinedBy, expiresAt, pcConnected}. 404 = gone;
   *  401/403 for the grace period = signed out. The expiry only moves EARLIER. */
  async _refreshStatus(gen) {
    const s = this.s;
    if (!s || !s.sessionId) return;
    let r;
    try { r = await this._req(s, 'GET', `/${encodeURIComponent(s.sessionId)}`); } catch { return; /* offline: the hub reconnects */ }
    if (!this._live(gen)) return;
    if (r.status === 404 || r.status === 410) { await this.stop('ended'); return; }
    if (r.status === 401 || r.status === 403) {
      if (s.unauthSince == null) { s.unauthSince = this.now(); this._emit(); }
      if (this.now() - s.unauthSince >= this.signedOutGraceMs) await this.stop('signed_out');
      return;
    }
    const d = obj(r.data);
    if (r.status !== 200 || !d) return;
    if (s.unauthSince != null) s.unauthSince = null;
    if (d.joined === true || d.status === 'active') { s.supportJoined = true; s.status = 'connected'; }
    if (typeof d.joinedBy === 'string' && d.joinedBy.length <= 254) s.joinedBy = d.joinedBy.replace(/[\u0000-\u001f\u007f]/g, '');
    if (typeof d.pcConnected === 'boolean') s.pcConnected = d.pcConnected;
    const exp = Date.parse(d.expiresAt);
    if (Number.isFinite(exp) && exp < s.expiresAt) { s.expiresAt = exp; this._armExpiry(s); }
    this._emit();
  }

  /** Run one command (one at a time — one dialog at a time) and answer it. */
  async _handle(gen, raw) {
    if (!this._live(gen)) return;
    const cmd = parseCommand(raw);
    if (!cmd.commandId) return;   // nothing to answer to
    const s = this.s;
    if (!s.supportJoined) { s.supportJoined = true; s.status = 'connected'; this._emit(); }
    let result;
    if (cmd.error) {
      result = { ok: false, error: cmd.error };
    } else {
      try { result = await this._run(gen, cmd); } catch (e) { result = { ok: false, error: (e && e.message) || 'failed' }; }
    }
    // A long capture answers later; other commands carry on meanwhile.
    if (result && result.later) {
      void result.later.then((r) => this._post(gen, cmd, r), (e) => this._post(gen, cmd, { ok: false, approvedOnPc: true, error: (e && e.message) || 'failed' }));
      return;
    }
    await this._post(gen, cmd, result);
  }

  /**
   * Result({commandId, ok, data, error, approvedOnPc}). The server answers
   * null (recorded) or a code; result_too_large → the answer is re-sent
   * without its data. not_connected / unknown_command / already_answered:
   * the server already closed that command (e.g. the line dropped) — nothing
   * to retry. A dropped connection = the server failed it already.
   */
  async _post(gen, cmd, result) {
    if (!this._live(gen)) return;   // stopped meanwhile: report nothing more
    const s = this.s;
    const r = result || { ok: false, error: 'failed' };
    const body = {
      commandId: cmd.commandId, ok: !!r.ok, data: capData(r.data), error: r.error || null,
      approvedOnPc: cmd.kind === 'change' ? r.approvedOnPc === true : false,
    };
    try {
      const said = await s.conn.invoke('Result', body);
      if (said === 'result_too_large' && this._live(gen)) {
        await s.conn.invoke('Result', { ...body, ok: false, data: null, error: 'result_too_large' });
      }
    } catch { /* line dropped: the server answered support "offline" already */ }
  }

  _instrument(id) {
    const list = this.manager.list();
    return list.find((p) => String(p.instrumentId).toLowerCase() === id) || null;
  }

  /** Ask the lab on this PC. Only one dialog at a time. */
  async _ask(gen, message, detailExtra) {
    const s = this.s;
    // The line is down: the answer could not reach support — don't ask.
    if (s.connection !== 'online') return false;
    s.approval = { message };
    s.approvalCtl = new AbortController();
    this._emit();
    let yes = false;
    try {
      const said = s.description ? `Prefrontal support says: “${s.description}”\n\n` : '';
      const detail = `${said}${detailExtra ? `${detailExtra}\n\n` : ''}Only allow this if you are talking to Prefrontal support right now (session code ${s.code}).`;
      yes = await this.approve({ message, detail, signal: s.approvalCtl.signal });
    } catch { yes = false; }
    const aborted = s.approvalCtl.signal.aborted;
    s.approvalCtl = null;
    if (this.s === s) { s.approval = null; this._emit(); }
    return yes === true && !aborted && this._live(gen);
  }

  async _run(gen, { action, args, kind, description }) {
    const d = this.diag;
    const m = this.manager;
    this.s.description = description || '';
    // The server called a "look" a change: ask first (stricter, never looser).
    if (kind === 'change' && ACTIONS[action].kind === 'look') {
      if (!(await this._ask(gen, `Prefrontal support wants to: ${description || action.replace(/_/g, ' ')}. Allow?`))) return this._denied();
      const r = await this._run(gen, { action, args, kind: 'look', description });
      return { ...r, approvedOnPc: true };
    }
    const look = (data) => ({ ok: true, data });
    switch (action) {
      case 'pc_overview': return look(await d.snapshot());
      case 'firewall_status': return look(await d.firewall());
      case 'port_owner': return look({ port: args.port, owner: await d.portOwner(args.port) });
      case 'recent_errors': {
        // Error TEXT only (never a message body): what the connector logged.
        const st = m.status().filter((x) => !args.instrumentId || String(x.instrumentId).toLowerCase() === args.instrumentId);
        return look(st.map((x) => ({
          instrumentId: x.instrumentId, name: x.name, link: x.link || x.state || null,
          errorDetail: typeof x.errorDetail === 'string' ? x.errorDetail : null,
          lastError: typeof x.lastError === 'string' ? x.lastError : null,
          errors: (Array.isArray(x.recentErrors) ? x.recentErrors : []).map((e) => ({ at: e && e.at, error: String((e && e.message) || '').slice(0, 300) })),
        })));
      }
      case 'arp_table': return look(await d.arp());
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
        if (!r || r.error) return { ok: false, error: (r && r.error) || 'probe failed', data: r };
        return look(args.host ? { ...r, open: (r.open || []).filter((o) => o.host === args.host) } : r);
      }
      case 'next_free_port': return look({ port: await d.nextFreePort() });
      case 'listen_status': return look({ endpoints: m.usedEndpoints(), activeCaptures: m.activeCaptures() });
      case 'set_connector_setting': {
        const p = this._instrument(args.instrumentId);
        if (!p) return { ok: false, error: 'not paired on this PC' };
        const f = SETTING_FIELDS[args.field];
        const text = `the ${f.word} of the ${p.name} to ${args.value}`;
        if (!(await this._ask(gen, `Prefrontal support wants to change ${text}. Allow?`, 'Prefrontal saves it like a change made on the Instruments screen.'))) return this._denied();
        // Approval ONLY: the server applies it through the instrument config
        // (validation, audit, bridge bump) and this PC picks it up.
        return { ok: true, approvedOnPc: true, data: { approved: true } };
      }
      case 'restart_connector': {
        const p = this._instrument(args.instrumentId);
        if (!p) return { ok: false, error: 'not paired on this PC' };
        if (!(await this._ask(gen, `Prefrontal support wants to restart the connection to the ${p.name}. Allow?`, 'Results the analyzer sends during the restart are kept and sent after it.'))) return this._denied();
        const r = await m.reload(p.instrumentId);
        return { ok: !!(r && r.ok), approvedOnPc: true, data: r, error: r && !r.ok ? r.error : undefined };
      }
      case 'listen_capture': {
        const minutes = args.minutes || 2;
        // Never a port a paired analyzer uses (manager.scanStart refuses it too).
        const used = m.usedEndpoints().find((u) => u.port === args.port);
        if (used) return { ok: false, error: `port ${args.port} is used by ${used.name} on this PC` };
        if (!(await this._ask(gen, `Prefrontal support wants to listen on port ${args.port} for ${minutes} min to see what the analyzer sends. Allow?`, 'Nothing is sent to the lab’s results while listening.'))) return this._denied();
        const r = await m.scanStart({ ports: [args.port] });
        if (!r || !r.scanId) {
          return { ok: false, approvedOnPc: true, error: (r && (r.error || (r.ports && r.ports[0] && r.ports[0].error))) || 'could not listen', data: r };
        }
        const s = this.s;
        s.scans.add(r.scanId);
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
        if (asked && !yes) return this._denied();
        return { ok: !!(r && r.ok), approvedOnPc: asked && yes, data: r, error: r && !r.ok ? r.error : undefined };
      }
      default: return { ok: false, error: 'unknown_action' };
    }
  }

  _denied() {
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

/**
 * Keep a result under the server's cap (it counts the JSON text of `data`):
 * a bigger one becomes a preview the server still accepts.
 */
function capData(data) {
  if (data === undefined) return null;
  let text;
  try { text = JSON.stringify(data); } catch { return { unserialisable: true }; }
  if (text === undefined) return null;
  if (text.length <= MAX_RESULT_CHARS) return data;
  // The preview string is JSON-escaped once more; leave room for that.
  let preview = text.slice(0, Math.floor(MAX_RESULT_CHARS / 2));
  while (JSON.stringify({ truncated: true, preview }).length > MAX_RESULT_CHARS) preview = preview.slice(0, Math.floor(preview.length * 0.9));
  return { truncated: true, preview };
}

module.exports = {
  SupportSession, ACTIONS, SETTING_FIELDS, parseCommand, captureResult, parseStart, cleanApiUrl, askApproval, capData, displayCode,
  serverRow, defaultHubFactory, HUB_PATH, MIN_MINUTES, MAX_MINUTES, DEFAULT_MINUTES, MAX_RESULT_CHARS,
};
