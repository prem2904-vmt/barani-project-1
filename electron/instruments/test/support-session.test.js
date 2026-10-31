'use strict';
/**
 * support-session.js — "Allow Prefrontal support" (beta). The HTTP server,
 * the SignalR hub, the dialog, NetDiag and the ConnectorManager are doubles:
 * no Electron, no network, no listener. Pins the contract's safety rules:
 *   no connection while idle · Join after every (re)connect · strict argument
 *   checks · every CHANGE asks the PC (Deny = default) · deny → nothing
 *   changes · 'Ended' / not_found / 404 / stop / expiry / sign-out end it ·
 *   too-large results re-sent without data · one session per PC.
 * Server contract: prefrontal-mw feat/shared-state 38c031a (Hubs/SupportHub.cs,
 * Controllers/SupportSessionsController.cs, Services/Support/SupportRelay.cs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SupportSession, parseCommand, parseStart, cleanApiUrl, askApproval, capData, ACTIONS, displayCode, serverRow, MAX_RESULT_CHARS,
} = require('../support-session');

const IID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const BRANCH = '9b2d1c3e-1111-4222-8333-944455556666';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl';
const API = 'https://med-fetch-dev.prefrontal.health';
const tick = () => new Promise((r) => setImmediate(r));
/** Every session a test makes is stopped at the end, pass or fail. */
const made = [];
test.after(async () => { for (const s of made) { try { await s.stop(); } catch { /* done */ } } });
async function until(fn, n = 400) { for (let i = 0; i < n; i++) { if (fn()) return; await tick(); } throw new Error('timed out waiting'); }

/**
 * The lab's HTTP side (SupportSessionsController): Start, Get, Stop. Every
 * request is recorded.
 */
function http({ startStatus = 200, expiresInMs = 2 * 3600e3, now = () => Date.now(), code = 'WDJBMJHT' } = {}) {
  const st = { calls: [], getStatus: null, status: null };
  const json = (status, body) => ({ status, json: async () => body });
  st.fetch = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace('/api/support-sessions', '');
    st.calls.push({ method: init.method, path, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    if (init.method === 'POST' && path === '') {
      if (startStatus !== 200) return json(startStatus, { success: false, error: { message: 'nope' } });
      return json(200, { success: true, data: { sessionId: SID, code: code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code, expiresAt: new Date(now() + expiresInMs).toISOString(), hub: '/hubs/support' } });
    }
    if (init.method === 'GET' && path === `/${SID}`) {
      if (st.getStatus) return json(st.getStatus, null);
      return json(200, { success: true, data: st.status || { sessionId: SID, status: 'waiting', pcId: 'LAB-PC', expiresAt: new Date(now() + expiresInMs).toISOString(), joined: false, joinedBy: null, joinedAt: null, pcConnected: true } });
    }
    if (init.method === 'POST' && path === `/${SID}/stop`) return json(200, { success: true, data: { ok: true, status: 'ended' } });
    return json(404, null);
  };
  return st;
}

/**
 * A fake SignalR hub (SupportHub + SupportRelay): one FakeConn per
 * hubFactory call. Join answers like the hub (backlog log); Result records
 * the answer, logs it like OnPcResultAsync and replies null or a code.
 */
function hub({ now = () => Date.now() } = {}) {
  const h = { conns: [], results: [], joins: 0, log: [], startFails: 0, joinReply: null, resultReply: null, cmds: {} };
  class FakeConn {
    constructor(url, opts) {
      this.url = url; this.opts = opts; this.handlers = {}; this.rcb = []; this.rdcb = []; this.ccb = []; this.state = 'Disconnected'; this.starts = 0; this.stops = 0;
    }
    on(name, cb) { (this.handlers[name] = this.handlers[name] || []).push(cb); }
    onreconnecting(cb) { this.rcb.push(cb); }
    onreconnected(cb) { this.rdcb.push(cb); }
    onclose(cb) { this.ccb.push(cb); }
    async start() {
      this.starts++;
      this.token = await this.opts.accessTokenFactory();
      if (h.startFails > 0) { h.startFails--; throw new Error('WebSocket failed to connect'); }
      this.state = 'Connected';
    }
    async stop() { this.stops++; this.state = 'Disconnected'; for (const cb of this.ccb) cb(); }
    async invoke(name, arg) {
      if (this.state !== 'Connected') throw new Error('Cannot send data if the connection is not in the \'Connected\' State.');
      if (name === 'Join') {
        h.joins++;
        if (h.joinReply) return typeof h.joinReply === 'function' ? h.joinReply(arg) : h.joinReply;
        return { ok: arg === SID, error: arg === SID ? undefined : 'not_found', sessionId: SID, status: h.status || 'waiting', expiresAt: new Date(now() + 2 * 3600e3).toISOString(), log: h.log.slice() };
      }
      if (name === 'Result') {
        const reply = typeof h.resultReply === 'function' ? h.resultReply(arg) : h.resultReply;
        if (JSON.stringify(arg.data ?? null).length > 128 * 1024) { h.tooLarge = (h.tooLarge || 0) + 1; return 'result_too_large'; }
        h.results.push(arg);
        if (reply) return reply;
        const c = h.cmds[arg.commandId] || {};
        const outcome = c.change ? (!arg.approvedOnPc ? 'denied on the PC' : arg.ok ? 'approved on the PC' : 'approved, but it failed') : (arg.ok ? 'done' : 'failed');
        this.emit('Log', { at: new Date(now()).toISOString(), actor: 'pc', action: c.description || c.action || '?', outcome });
        return null;
      }
      throw new Error(`unknown hub method ${name}`);
    }
    emit(name, payload) { for (const cb of this.handlers[name] || []) cb(payload); }
    /** The server pushes a command (and logs "asked", like OnCommandEventAsync). */
    command(c) {
      h.cmds[c.commandId] = c;
      this.emit('Log', { at: new Date(now()).toISOString(), actor: 'support', action: c.description || c.action, outcome: c.change ? 'asked for approval on the PC' : 'asked' });
      this.emit('Command', c);
    }
    drop() { this.state = 'Reconnecting'; for (const cb of this.rcb) cb(new Error('gone')); }
    back() { this.state = 'Connected'; for (const cb of this.rdcb) cb('new-id'); }
    close() { this.state = 'Disconnected'; for (const cb of this.ccb) cb(new Error('closed')); }
  }
  h.factory = (url, opts) => { const c = new FakeConn(url, opts); h.conns.push(c); return c; };
  h.conn = () => h.conns[h.conns.length - 1];
  return h;
}

function doubles() {
  const d = {
    calls: [],
    snapshot: async () => { d.calls.push('snapshot'); return { adapters: [], problems: [] }; },
    firewall: async () => { d.calls.push('firewall'); return { supported: true, blockRules: 0 }; },
    portOwner: async (p) => { d.calls.push(['portOwner', p]); return { pid: 42, name: 'oldlis', ours: false }; },
    arp: async () => { d.calls.push('arp'); return [{ ip: '192.168.10.20', mac: 'aa' }]; },
    nextFreePort: async () => 5603,
    probe: async (a) => { d.calls.push(['probe', a]); return { open: [] }; },
    adapters: async () => [
      { name: 'Wi-Fi', gateway: '10.0.0.1', ipv4: [{ address: '10.0.0.5' }] },
      { name: 'Ethernet 2', gateway: null, ipv4: [{ address: '192.168.10.2' }] },
    ],
    fixFirewall: async ({ ports, adapter, confirm }) => {
      d.calls.push(['fixFirewall', ports, adapter]);
      const ok = await confirm({ lines: [`Allow ports ${ports.join(', ')} on ${adapter}`] });
      if (!ok) return { ok: false, cancelled: true, error: 'Nothing was changed.' };
      d.calls.push('UAC');
      return { ok: true };
    },
  };
  const m = {
    calls: [],
    list: () => [{ instrumentId: IID, name: 'iCARE' }],
    status: () => [{ instrumentId: IID, name: 'iCARE', link: 'error', lastError: 'port 5601 in use', errorDetail: 'Port 5601 is used by oldlis.exe', recentErrors: [{ at: '2026-10-31T10:00:00Z', message: 'connection refused' }], transport: { port: 5601 }, messagesToday: 3 }],
    rawLog: (id, n) => { m.calls.push(['rawLog', id, n]); return [{ text: 'MSH|...' }]; },
    usedEndpoints: () => [{ port: 5601, name: 'iCARE', instrumentId: IID, kind: 'connector' }],
    activeCaptures: () => 0,
    reload: async (id) => { m.calls.push(['reload', id]); return { ok: true, restarted: true }; },
    scanStart: async (o) => { m.calls.push(['scanStart', o]); return { scanId: 'scan-1', ports: [{ port: o.ports[0], ok: true }] }; },
    scanStop: async (id) => { m.calls.push(['scanStop', id]); return { ports: [] }; },
  };
  return { d, m };
}

function rig({ answer = 1, http: ho = {}, opts = {} } = {}) {
  const srv = http(ho);
  const hb = hub(ho);
  const { d, m } = doubles();
  const asked = [];
  const approve = async (q) => { asked.push(q); return answer === 1; };
  const s = new SupportSession({ fetchImpl: srv.fetch, hubFactory: hb.factory, diag: d, manager: m, pcId: 'LAB-PC', approve, sleep: async () => { await tick(); }, backoffMs: [0], statusRefreshMs: 0, minuteMs: 5, ...opts });
  made.push(s);
  return { s, srv, hb, d, m, asked };
}

const start = (s, extra = {}) => s.startFromIpc({ minutes: 120, token: TOKEN, apiUrl: API, ...extra });
const online = (s) => until(() => s.state().connection === 'online');

test('idle: no request and no hub connection until the lab starts a session', async () => {
  const { s, srv, hb } = rig();
  await tick(); await tick();
  assert.equal(srv.calls.length, 0);
  assert.equal(hb.conns.length, 0);
  assert.equal(s.connections, 0);
  assert.equal(s.state().status, 'idle');
  assert.equal(s.state().active, false);
});

test('start → POST {pcId, minutes, instrumentIds}; code XXXX-XXXX; hub with token + X-PF-BETA + branch; Join; one session per PC', async () => {
  const { s, srv, hb } = rig();
  const r = await start(s, { branchId: BRANCH });
  assert.equal(r.ok, true);
  assert.equal(r.state.code, 'WDJB-MJHT');
  assert.equal(r.state.status, 'waiting');
  assert.deepEqual(srv.calls[0].body, { pcId: 'LAB-PC', minutes: 120, instrumentIds: [IID] });
  assert.equal(srv.calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(srv.calls[0].headers['X-PF-BETA'], 'support');
  assert.equal(srv.calls[0].headers['X-Active-Branch'], BRANCH);
  await online(s);
  const c = hb.conn();
  assert.equal(c.url, `${API}/hubs/support`);
  assert.deepEqual(c.opts.headers, { 'X-PF-BETA': 'support', 'X-Active-Branch': BRANCH });
  assert.equal(c.token, TOKEN);
  assert.equal(hb.joins, 1);
  assert.ok(!('token' in r.state), 'the token never goes back to the page');
  const again = await start(s);
  assert.equal(again.ok, false);
  assert.equal(again.error, 'already_active');
  assert.equal(hb.conns.length, 1);
  await s.stop();
});

test('the hub token is always the freshest one the renderer handed over', async () => {
  const { s, hb } = rig();
  await start(s);
  await online(s);
  const fresh = `${TOKEN}.fresh`;
  assert.equal(s.setToken(fresh).ok, true);
  assert.equal(await hb.conn().opts.accessTokenFactory(), fresh);
  assert.equal(s.setToken('x').ok, false);
  await s.stop();
  assert.equal(await hb.conn().opts.accessTokenFactory(), '', 'no token once the session ended');
});

test('reconnect: the line drops → "reconnecting", an open question closes (= Deny), Join again on reconnect', async () => {
  const srv0 = http();
  const hb = hub();
  const { d, m } = doubles();
  let signal = null;
  const approve = (q) => { signal = q.signal; return new Promise((r) => { q.signal.addEventListener('abort', () => r(true)); }); };
  const s = new SupportSession({ fetchImpl: srv0.fetch, hubFactory: hb.factory, diag: d, manager: m, pcId: 'LAB-PC', approve, sleep: async () => { await tick(); }, backoffMs: [0], statusRefreshMs: 0 });
  made.push(s);
  await start(s);
  await online(s);
  hb.conn().command({ commandId: 'c1', action: 'restart_connector', args: { instrumentId: IID }, change: true, description: 'Restart the iCARE connector' });
  await until(() => s.state().approval !== null);
  hb.conn().drop();
  assert.equal(s.state().connection, 'reconnecting');
  assert.equal(signal.aborted, true, 'the dialog is closed: its answer could not reach support');
  await until(() => s.state().approval === null);
  assert.equal(m.calls.filter((c) => c[0] === 'reload').length, 0, 'an aborted question never runs the change, even if it "said" yes');
  // While down, a new question is never asked.
  hb.conn().back();
  await until(() => hb.joins === 2);
  await online(s);
  // Retry policy: keeps going while the session lives, stops (null) after it ends.
  const policy = hb.conn().opts.retryPolicy;
  assert.equal(policy.nextRetryDelayInMilliseconds({ previousRetryCount: 7 }), 0);
  await s.stop();
  assert.equal(policy.nextRetryDelayInMilliseconds({ previousRetryCount: 0 }), null);
});

test('first connect fails → retried with backoff, then Join; onclose (gave up) → connect again + Join', async () => {
  const { s, hb } = rig();
  hb.startFails = 2;
  await start(s);
  await online(s);
  assert.equal(hb.conn().starts, 3);
  assert.equal(hb.joins, 1);
  hb.conn().close();
  await until(() => hb.joins === 2);
  assert.equal(hb.conn().starts, 4, 'the same connection restarted, never a second one');
  assert.equal(hb.conns.length, 1);
  await s.stop();
});

test('stop: hub connection closed, server told, nothing more runs', async () => {
  const { s, srv, hb } = rig();
  await start(s);
  await online(s);
  await s.stop('lab');
  assert.ok(srv.calls.some((c) => c.method === 'POST' && c.path === `/${SID}/stop`));
  assert.equal(hb.conn().stops, 1);
  assert.equal(s.state().status, 'ended');
  assert.equal(s.state().endedReason, 'lab');
  // A command pushed after stop is ignored.
  hb.conn().state = 'Connected';
  hb.conn().command({ commandId: 'late', action: 'arp_table' });
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(hb.results.length, 0);
});

test('server says Ended → session over, no stop call needed', async () => {
  const { s, srv, hb } = rig();
  await start(s);
  await online(s);
  hb.conn().emit('Ended', { reason: 'support' });
  await until(() => !s.state().active);
  assert.equal(s.state().endedReason, 'ended');
  assert.ok(!srv.calls.some((c) => c.path === `/${SID}/stop`));
  assert.equal(hb.conn().stops, 1);
});

test('Join not_found (ended / replaced / another lab\'s id) → session over', async () => {
  const { s, hb } = rig();
  hb.joinReply = { ok: false, error: 'not_found' };
  await start(s);
  await until(() => !s.state().active);
  assert.equal(s.state().endedReason, 'ended');
});

test('GET /{id} 404 → session over; 401/403 for the grace period → signed out; a fresh token keeps it', async () => {
  const a = rig({ opts: { statusRefreshMs: 1 } });
  await start(a.s);
  await online(a.s);
  a.srv.getStatus = 404;
  await until(() => !a.s.state().active);
  assert.equal(a.s.state().endedReason, 'ended');

  let t = 0;
  const b = rig({ opts: { now: () => t, signedOutGraceMs: 1000, statusRefreshMs: 1 } });
  await start(b.s);
  await online(b.s);
  b.srv.getStatus = 401;
  await until(() => b.s.state().signedOut === true);
  assert.equal(b.s.setToken(TOKEN).ok, true);
  assert.equal(b.s.state().signedOut, false);
  await until(() => b.s.state().signedOut === true);
  t += 2000;
  await until(() => !b.s.state().active);
  assert.equal(b.s.state().endedReason, 'signed_out');
});

test('expiry: the session ends by itself at expiresAt (never later than asked)', async () => {
  const realNow = Date.now();
  let t = realNow;
  const { s } = rig({ http: { now: () => t, expiresInMs: 10 * 3600e3 }, opts: { now: () => t } });
  const r = await start(s, { minutes: 5 });
  // The server said 10 h; the lab asked for 5 min — 5 min wins.
  assert.equal(Date.parse(r.state.expiresAt) - realNow, 5 * 60000);
  // Join's expiresAt (2 h) is later → ignored.
  await online(s);
  assert.equal(Date.parse(s.state().expiresAt) - realNow, 5 * 60000);
  await s.stop();
});

test('live log: Join backlog + Log events, each line once; "asked" rows hidden; joined-by shows', async () => {
  const { s, hb } = rig();
  const at = new Date().toISOString();
  hb.log = [
    { at, actor: 'lab', action: 'Allowed Prefrontal support', outcome: 'for 120 minutes' },
    { at, actor: 'pc', action: 'The PC connected', outcome: 'ok' },
  ];
  await start(s);
  await online(s);
  let words = s.state().log.map((l) => l.text);
  assert.deepEqual(words, ['The PC connected', 'Allowed Prefrontal support'], 'newest first');
  // The same line again (the hub sends it as an event too) is not doubled.
  hb.conn().emit('Log', hb.log[1]);
  hb.conn().emit('Log', { at: new Date(Date.now() + 1000).toISOString(), actor: 'support', action: 'Joined the session', outcome: 'eng@prefrontal.health' });
  hb.conn().emit('Log', { at: new Date(Date.now() + 2000).toISOString(), actor: 'support', action: 'Looked at the firewall', outcome: 'asked' });
  hb.conn().emit('Log', { bogus: true });
  words = s.state().log.map((l) => l.text);
  assert.equal(words.filter((w) => w === 'The PC connected').length, 1);
  assert.equal(words[0], 'Joined the session (eng@prefrontal.health)');
  assert.ok(!words.includes('Looked at the firewall'));
  assert.equal(s.state().supportJoined, true);
  assert.equal(s.state().status, 'connected');
  assert.equal(s.state().joinedBy, 'eng@prefrontal.health');
  // A reconnect's backlog replaces the list, keeping nothing twice.
  hb.log = [...hb.log, { at: new Date(Date.now() + 1000).toISOString(), actor: 'support', action: 'Joined the session', outcome: 'eng@prefrontal.health' }];
  hb.conn().drop(); hb.conn().back();
  await until(() => hb.joins === 2);
  await online(s);
  words = s.state().log.map((l) => l.text);
  assert.equal(words.filter((w) => /^Joined/.test(w)).length, 1);
  await s.stop();
  assert.equal(s.state().log[0].text, 'You stopped the support session');
  assert.ok(s.state().log.some((l) => /^Joined/.test(l.text)), 'the ended card keeps the log');
});

test('GET /{id}: joined + joinedBy + pcConnected for the card; expiry only ever moves EARLIER', async () => {
  const t = Date.now();
  const { s, srv } = rig({ opts: { statusRefreshMs: 1 } });
  srv.status = { sessionId: SID, status: 'active', expiresAt: new Date(t + 10 * 3600e3).toISOString(), joined: true, joinedBy: 'eng@prefrontal.health', pcConnected: true };
  const r = await start(s, { minutes: 60 });
  const asked = Date.parse(r.state.expiresAt);
  await until(() => s.state().joinedBy === 'eng@prefrontal.health');
  assert.equal(s.state().status, 'connected');
  assert.equal(s.state().pcConnected, true);
  assert.equal(Date.parse(s.state().expiresAt), asked, 'a later server expiry never extends the session');
  const earlier = t + 30 * 60000;
  srv.status = { ...srv.status, expiresAt: new Date(earlier).toISOString() };
  await until(() => Date.parse(s.state().expiresAt) === earlier);
  await s.stop();
});

test('LOOK commands → the existing netdiag / manager functions → Result; never asks', async () => {
  const { s, hb, d, asked } = rig();
  await start(s);
  await online(s);
  const c = hb.conn();
  [
    { commandId: 'c1', action: 'pc_overview', args: {}, change: false, description: "Looked at the PC's network" },
    { commandId: 'c2', action: 'firewall_status', args: {}, change: false, description: 'Looked at the firewall' },
    { commandId: 'c3', action: 'port_owner', args: { port: 5600 }, change: false, description: 'Checked what is using port 5600' },
    { commandId: 'c4', action: 'arp_table', args: {}, change: false, description: 'Looked at the devices on the network' },
    { commandId: 'c5', action: 'next_free_port', args: {}, change: false, description: 'Looked for a free port' },
    { commandId: 'c6', action: 'listen_status', args: {}, change: false, description: 'Looked at what the PC is listening on' },
    { commandId: 'c7', action: 'recent_errors', args: { instrumentId: null }, change: false, description: 'Read the recent connector errors' },
  ].forEach((x) => c.command(x));
  await until(() => hb.results.length === 7);
  assert.deepEqual(hb.results.map((r) => r.commandId), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'], 'one at a time, in order');
  assert.deepEqual(hb.results.map((r) => r.ok), Array(7).fill(true));
  assert.ok(hb.results.every((r) => r.approvedOnPc === false), 'a look never carries an approval');
  assert.deepEqual(d.calls, ['snapshot', 'firewall', ['portOwner', 5600], 'arp']);
  assert.deepEqual(hb.results[2].data, { port: 5600, owner: { pid: 42, name: 'oldlis', ours: false } });
  assert.deepEqual(hb.results[4].data, { port: 5603 });
  assert.deepEqual(hb.results[6].data, [{ instrumentId: IID, name: 'iCARE', link: 'error', errorDetail: 'Port 5601 is used by oldlis.exe',
    lastError: 'port 5601 in use', errors: [{ at: '2026-10-31T10:00:00Z', error: 'connection refused' }] }]);
  assert.equal(asked.length, 0);
  const words = s.state().log.map((l) => l.text);
  assert.equal(words.filter((w) => w === 'Looked at the firewall').length, 1, 'the server\'s line, once');
  assert.equal(s.state().supportJoined, true);
  await s.stop();
});

test('validation: unknown action, extra / missing / bad arguments are refused and never run', async () => {
  assert.equal(parseCommand({ commandId: 'c', action: 'rm_rf' }).error, 'unknown_action');
  assert.equal(parseCommand({ commandId: 'c', action: 'port_owner' }).error, 'bad_request: port');
  assert.equal(parseCommand({ commandId: 'c', action: 'port_owner', args: { port: 70000 } }).error, 'bad_request: port');
  assert.equal(parseCommand({ commandId: 'c', action: 'port_owner', args: { port: 80 } }).error, 'bad_request: port', 'server rule: 1024–65535');
  assert.equal(parseCommand({ commandId: 'c', action: 'port_owner', args: { port: '5600' } }).error, 'bad_request: port');
  assert.equal(parseCommand({ commandId: 'c', action: 'pc_overview', args: { wide: true } }).error, 'bad_request: wide');
  assert.equal(parseCommand({ commandId: 'c', action: 'probe', args: { host: '192.168.1.8' } }).error, 'bad_request: ports');
  assert.equal(parseCommand({ commandId: 'c', action: 'probe', args: { ports: [5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008] } }).error, 'bad_request: ports', '≤ 8 probe ports');
  assert.equal(parseCommand({ commandId: 'c', action: 'probe', args: { ports: [22] } }).error, 'bad_request: ports', 'probe ports ≥ 1024');
  assert.equal(parseCommand({ commandId: 'c', action: 'probe', args: { ports: [5600], host: '192.168.1.8', wide: true } }).error, 'bad_request: wide', 'no whole-/24 sweep');
  assert.equal(parseCommand({ commandId: 'c', action: 'probe', args: { ports: [5600], host: '999.1.1.1' } }).error, 'bad_request: host');
  assert.equal(parseCommand({ commandId: 'c', action: 'connectors_status' }).error, 'unknown_action', 'answered by the server, never the PC');
  assert.equal(parseCommand({ commandId: 'c', action: 'recent_messages', args: { instrumentId: IID } }).error, 'unknown_action', 'raw messages never come from the PC');
  assert.equal(parseCommand({ commandId: 'c', action: 'pc_overview', args: { summary: 'x' } }).error, 'bad_request: summary', 'summary only where the server sends it');
  assert.equal(parseCommand({ commandId: 'c', action: 'listen_capture', args: { port: 80 } }).error, 'bad_request: port');
  assert.equal(parseCommand({ commandId: 'c', action: 'listen_capture', args: { port: 5603, minutes: 30 } }).error, 'bad_request: minutes');
  assert.equal(parseCommand({ commandId: 'c', action: 'fix_firewall', args: { ports: [5603], adapter: 'a\r\nb' } }).error, 'bad_request: adapter');
  assert.equal(parseCommand({ commandId: 'c', action: 'restart_connector', args: { instrumentId: '../x' } }).error, 'bad_request: instrumentId');
  assert.equal(parseCommand({ commandId: 'c', action: 'set_connector_setting', args: { instrumentId: IID, field: 'deviceKey', value: 'x' } }).error, 'bad_request: field');
  assert.equal(parseCommand({ commandId: 'c', action: 'set_connector_setting', args: { instrumentId: IID, field: 'port', value: '70000' } }).error, 'bad_request: value');
  assert.equal(parseCommand({ commandId: 'c', action: 'set_connector_setting', args: { instrumentId: IID, field: 'parser', value: 'Bad Preset!' } }).error, 'bad_request: value');
  assert.equal(parseCommand({ commandId: 'bad id!', action: 'pc_overview' }).error, 'bad_request: commandId');
  assert.deepEqual(parseCommand({ commandId: 'c', action: 'set_connector_setting', args: { instrumentId: IID.toUpperCase(), field: 'port', value: '5603' } }),
    { commandId: 'c', action: 'set_connector_setting', kind: 'change', args: { instrumentId: IID, field: 'port', value: '5603' }, description: '' });
  // The server's exact shape (SupportRelay pushes {commandId (Guid "N"), action, args, change, description}).
  const full = parseCommand({ commandId: '8f14e45fceea167a5a36dedd4bea2543', action: 'set_connector_setting', change: true,
    description: 'Set the port of iCARE to 5603', args: { instrumentId: IID, name: 'iCARE', field: 'port', value: '5603', summary: 'Set the port of iCARE to 5603' } });
  assert.equal(full.error, undefined);
  assert.equal(full.description, 'Set the port of iCARE to 5603');

  const { s, hb, d, asked } = rig();
  await start(s);
  await online(s);
  hb.conn().command({ commandId: 'c1', action: 'rm_rf' });
  hb.conn().command({ commandId: 'c2', action: 'port_owner', args: { port: 'x' } });
  hb.conn().command({ commandId: 'no good!', action: 'arp_table' });
  await until(() => hb.results.length === 2);
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(hb.results.map((r) => [r.commandId, r.ok, r.error]), [['c1', false, 'unknown_action'], ['c2', false, 'bad_request: port']]);
  assert.equal(d.calls.length, 0);
  assert.equal(asked.length, 0);
  await s.stop();
});

test('every CHANGE action is a "change" in the table and asks the PC; looks never do', () => {
  const change = Object.entries(ACTIONS).filter(([, a]) => a.kind === 'change').map(([k]) => k).sort();
  assert.deepEqual(change, ['fix_firewall', 'listen_capture', 'restart_connector', 'set_connector_setting']);
});

test('approval: Allow → runs; Result carries approvedOnPc=true; plain words name the analyzer', async () => {
  const { s, hb, m, asked } = rig({ answer: 1 });
  await start(s);
  await online(s);
  const c = hb.conn();
  c.command({ commandId: 'c1', action: 'restart_connector', args: { instrumentId: IID, name: 'iCARE', summary: 'Restart the iCARE connector' }, change: true, description: 'Restart the iCARE connector' });
  c.command({ commandId: 'c2', action: 'set_connector_setting', args: { instrumentId: IID, name: 'iCARE', field: 'port', value: '5603', summary: 'Set the port of iCARE to 5603' }, change: true, description: 'Set the port of iCARE to 5603' });
  c.command({ commandId: 'c3', action: 'listen_capture', args: { port: 5610, minutes: 2, summary: 'Listen on port 5610 for 2 minute(s)' }, change: true, description: 'Listen on port 5610 for 2 minute(s)' });
  c.command({ commandId: 'c4', action: 'fix_firewall', args: { ports: [5603], adapter: 'Ethernet 2', summary: 'Open port(s) 5603 in the Windows firewall' }, change: true, description: 'Open port(s) 5603 in the Windows firewall' });
  await until(() => hb.results.length === 4, 20000);
  assert.deepEqual(hb.results.map((r) => [r.ok, r.approvedOnPc]), [[true, true], [true, true], [true, true], [true, true]]);
  assert.deepEqual(asked.map((q) => q.message), [
    'Prefrontal support wants to restart the connection to the iCARE. Allow?',
    'Prefrontal support wants to change the port of the iCARE to 5603. Allow?',
    'Prefrontal support wants to listen on port 5610 for 2 min to see what the analyzer sends. Allow?',
    'Prefrontal support wants to open port 5603 for the analyzers in the Windows firewall. Allow?',
  ]);
  assert.ok(asked.every((q) => /session code WDJB-MJHT/.test(q.detail)));
  assert.ok(m.calls.some((x) => x[0] === 'reload' && x[1] === IID));
  assert.ok(m.calls.some((x) => x[0] === 'scanStart' && x[1].ports[0] === 5610));
  assert.ok(s.state().log.some((l) => l.text === 'Open port(s) 5603 in the Windows firewall' && l.outcome === 'approved'));
  await s.stop();
});

test('deny path: nothing changes, Result says denied_on_pc / approvedOnPc=false, the lab sees it', async () => {
  const { s, hb, d, m, asked } = rig({ answer: 0 });
  await start(s);
  await online(s);
  const c = hb.conn();
  c.command({ commandId: 'c1', action: 'restart_connector', args: { instrumentId: IID }, change: true });
  c.command({ commandId: 'c2', action: 'fix_firewall', args: { ports: [5603], adapter: 'Ethernet 2' }, change: true, description: 'Open port(s) 5603 in the Windows firewall' });
  c.command({ commandId: 'c3', action: 'listen_capture', args: { port: 5610 }, change: true });
  c.command({ commandId: 'c4', action: 'set_connector_setting', args: { instrumentId: IID, field: 'checksumMode', value: 'off' }, change: true });
  await until(() => hb.results.length === 4, 20000);
  assert.equal(asked.length, 4);
  assert.deepEqual(hb.results.map((r) => [r.ok, r.approvedOnPc, r.error]), Array(4).fill([false, false, 'denied_on_pc']));
  assert.equal(m.calls.filter((x) => x[0] === 'reload' || x[0] === 'scanStart').length, 0);
  assert.ok(!d.calls.includes('UAC'), 'Windows is never asked after a Deny');
  assert.ok(s.state().log.some((l) => l.text === 'Open port(s) 5603 in the Windows firewall' && l.outcome === 'denied'));
  await s.stop();
});

test('server change:true on a "look" makes it ask first (stricter only); change:false never skips a question', async () => {
  const { s, hb, d, asked } = rig({ answer: 0 });
  await start(s);
  await online(s);
  hb.conn().command({ commandId: 'c1', action: 'arp_table', change: true, description: 'Read the ARP table' });
  hb.conn().command({ commandId: 'c2', action: 'restart_connector', args: { instrumentId: IID }, change: false, description: 'Restart iCARE\u0007 to re-link' });
  await until(() => hb.results.length === 2);
  assert.equal(asked.length, 2);
  assert.equal(asked[0].message, 'Prefrontal support wants to: Read the ARP table. Allow?');
  assert.deepEqual([hb.results[0].ok, hb.results[0].approvedOnPc], [false, false]);
  assert.ok(!d.calls.includes('arp'));
  assert.match(asked[1].detail, /Prefrontal support says: “Restart iCARE to re-link”/);
  await s.stop();
});

test('stop while the approval dialog is open: the dialog is closed (signal) and the change never runs', async () => {
  const srv0 = http();
  const hb = hub();
  const { d, m } = doubles();
  let signal = null;
  let release;
  const approve = (q) => { signal = q.signal; return new Promise((r) => { release = r; q.signal.addEventListener('abort', () => r(false)); }); };
  const s = new SupportSession({ fetchImpl: srv0.fetch, hubFactory: hb.factory, diag: d, manager: m, pcId: 'LAB-PC', approve, sleep: async () => { await tick(); }, backoffMs: [0], statusRefreshMs: 0 });
  made.push(s);
  await start(s);
  await online(s);
  hb.conn().command({ commandId: 'c1', action: 'restart_connector', args: { instrumentId: IID }, change: true });
  await until(() => s.state().approval !== null);
  assert.equal(s.state().approval.message, 'Prefrontal support wants to restart the connection to the iCARE. Allow?');
  await s.stop('lab');
  assert.equal(signal.aborted, true);
  release(true);
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(m.calls.filter((c) => c[0] === 'reload').length, 0);
  assert.equal(hb.results.length, 0, 'nothing reported after stop');
});

test('too-large result: the server says result_too_large → re-sent without data; a normal big one is pre-cut to a preview', async () => {
  const { s, hb, d } = rig();
  await start(s);
  await online(s);
  // Pre-cut by capData: a 300 KB snapshot goes as a preview the server accepts.
  d.snapshot = async () => ({ raw: 'x'.repeat(300 * 1024) });
  hb.conn().command({ commandId: 'c1', action: 'pc_overview', args: {} });
  await until(() => hb.results.length === 1);
  assert.equal(hb.results[0].data.truncated, true);
  assert.ok(JSON.stringify(hb.results[0].data).length <= MAX_RESULT_CHARS);
  // The server still refuses (its cap changed): answer again with no data.
  let first = true;
  hb.resultReply = () => { if (first) { first = false; return 'result_too_large'; } return null; };
  hb.conn().command({ commandId: 'c2', action: 'arp_table', args: {} });
  await until(() => hb.results.length === 3);
  assert.deepEqual(hb.results[2], { commandId: 'c2', ok: false, data: null, error: 'result_too_large', approvedOnPc: false });
  await s.stop();
});

test('server answers not_connected / unknown_command / already_answered → nothing retried; a dropped line → nothing retried', async () => {
  const { s, hb } = rig();
  await start(s);
  await online(s);
  let n = 0;
  hb.resultReply = () => { n++; return ['not_connected', 'unknown_command', 'already_answered'][n - 1]; };
  for (const id of ['c1', 'c2', 'c3']) hb.conn().command({ commandId: id, action: 'arp_table' });
  await until(() => n === 3);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(n, 3);
  await s.stop();
});

test('listen_capture answers when the capture ends: {messages:[{protocol,text}], bytes}; other commands go on meanwhile', async () => {
  const { s, hb, m } = rig({ opts: { minuteMs: 30 } });
  m.scanStop = async () => ({ ports: [{ port: 5610, raw: '<STX>1H|\\^&|||iCARE', detect: { protocol: 'astm' } }, { port: 5611, raw: '' }] });
  await start(s);
  await online(s);
  hb.conn().command({ commandId: 'c1', action: 'listen_capture', args: { port: 5610, minutes: 1 }, change: true });
  hb.conn().command({ commandId: 'c2', action: 'arp_table' });
  await until(() => hb.results.length === 1);
  assert.equal(hb.results[0].commandId, 'c2', 'the look ran while the capture listened');
  await until(() => hb.results.length === 2, 4000);
  assert.deepEqual(hb.results[1], { commandId: 'c1', ok: true, approvedOnPc: true, error: null,
    data: { messages: [{ protocol: 'astm', text: '<STX>1H|\\^&|||iCARE' }], bytes: 19 } });
  await s.stop();
});

test('fix_firewall: only the analyzer range or a paired port; listen_capture never takes a paired port', async () => {
  const { s, hb, d, asked } = rig();
  await start(s);
  await online(s);
  hb.conn().command({ commandId: 'c1', action: 'fix_firewall', args: { ports: [3389], adapter: 'Ethernet' }, change: true });
  hb.conn().command({ commandId: 'c2', action: 'listen_capture', args: { port: 5601 }, change: true });
  hb.conn().command({ commandId: 'c3', action: 'fix_firewall', args: { ports: [5601], adapter: 'Ethernet 2' }, change: true });
  await until(() => hb.results.length === 3);
  assert.equal(hb.results[0].ok, false);
  assert.match(hb.results[0].error, /analyzer range/);
  assert.equal(hb.results[1].ok, false);
  assert.match(hb.results[1].error, /used by iCARE/);
  assert.equal(hb.results[2].ok, true);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].message, 'Prefrontal support wants to open port 5601 for the iCARE in the Windows firewall. Allow?');
  assert.deepEqual(d.calls.filter((c) => Array.isArray(c) && c[0] === 'fixFirewall'), [['fixFirewall', [5601], 'Ethernet 2']]);
  await s.stop();
});

test('fix_firewall without an adapter: the one analyzer-only card (no gateway); none / several = refused', async () => {
  const { s, hb, d } = rig();
  await start(s);
  await online(s);
  hb.conn().command({ commandId: 'c1', action: 'fix_firewall', args: { ports: [5603], adapter: null }, change: true });
  await until(() => hb.results.length === 1);
  assert.equal(hb.results[0].ok, true);
  assert.deepEqual(d.calls.find((c) => Array.isArray(c) && c[0] === 'fixFirewall'), ['fixFirewall', [5603], 'Ethernet 2']);
  d.adapters = async () => [{ name: 'A', gateway: null, ipv4: [{ address: '192.168.1.2' }] }, { name: 'B', gateway: null, ipv4: [{ address: '192.168.2.2' }] }];
  hb.conn().command({ commandId: 'c2', action: 'fix_firewall', args: { ports: [5603] }, change: true });
  await until(() => hb.results.length === 2);
  assert.match(hb.results[1].error, /adapter/);
  await s.stop();
});

test('probe: server args {ports, host}; host must be ARP-known on one of this PC\'s networks; open list filtered to it', async () => {
  const { s, hb, d } = rig();
  d.probe = async (a) => { d.calls.push(['probe', a]); return { subnet: '192.168.10.0/24', open: [{ host: '192.168.10.20', port: 5600 }, { host: '192.168.10.21', port: 5600 }] }; };
  await start(s);
  await online(s);
  hb.conn().command({ commandId: 'c1', action: 'probe', args: { ports: [5600], host: '192.168.10.20' } });
  hb.conn().command({ commandId: 'c2', action: 'probe', args: { ports: [5600], host: '192.168.10.99' } });
  hb.conn().command({ commandId: 'c3', action: 'probe', args: { ports: [5600], host: '172.20.0.9' } });
  hb.conn().command({ commandId: 'c4', action: 'probe', args: { ports: [5600], host: null } });
  await until(() => hb.results.length === 4);
  assert.deepEqual(hb.results[0].data.open, [{ host: '192.168.10.20', port: 5600 }]);
  assert.match(hb.results[1].error, /ARP/);
  assert.match(hb.results[2].error, /not on any/);
  assert.equal(hb.results[3].ok, true);
  assert.deepEqual(d.calls.filter((c) => Array.isArray(c) && c[0] === 'probe').map((c) => c[1].address), ['192.168.10.2', '192.168.10.2']);
  await s.stop();
});

test('start refused by the server: plain words, no hub connection', async () => {
  const { s, hb } = rig({ http: { startStatus: 404 } });
  const r = await start(s);
  assert.equal(r.ok, false);
  assert.match(r.error, /isn’t switched on/);
  assert.equal(hb.conns.length, 0);
  assert.equal(s.state().active, false);
  const bad = rig({ http: { code: '482913' } });   // not a server code → refused, nothing connects
  assert.equal((await start(bad.s)).ok, false);
  assert.equal(bad.hb.conns.length, 0);
});

test('start arguments: minutes 5–240 (default 120), JWT-shaped token, https API (http only on this machine), branch GUID', () => {
  assert.equal(parseStart({ token: TOKEN, apiUrl: API }).minutes, 120);
  assert.equal(parseStart({ token: TOKEN, apiUrl: API }).branchId, null);
  assert.equal(parseStart({ token: TOKEN, apiUrl: API, branchId: BRANCH.toUpperCase() }).branchId, BRANCH);
  assert.equal(parseStart({ token: TOKEN, apiUrl: API, branchId: 'main\r\nX: y' }).error, 'bad_request: branchId');
  assert.equal(parseStart({ minutes: 241, token: TOKEN, apiUrl: API }).error, 'bad_request: minutes');
  assert.equal(parseStart({ minutes: 4, token: TOKEN, apiUrl: API }).error, 'bad_request: minutes');
  assert.equal(parseStart({ minutes: 5, token: TOKEN, apiUrl: API }).minutes, 5);
  assert.equal(parseStart({ minutes: 60, token: 'a b', apiUrl: API }).error, 'bad_request: token');
  assert.equal(parseStart({ minutes: 60, token: TOKEN, apiUrl: 'http://evil.example' }).error, 'bad_request: apiUrl');
  assert.equal(cleanApiUrl('https://med-fetch-dev.prefrontal.health/'), API);
  assert.equal(cleanApiUrl('http://localhost:5270'), 'http://localhost:5270');
  assert.equal(cleanApiUrl('https://user:pw@x.example'), null);
  assert.equal(cleanApiUrl('https://x.example/api?x=1'), null);
  assert.equal(displayCode('WDJB-MJHT'), 'WDJB-MJHT');
  assert.equal(displayCode('wdjbmjht'), 'WDJB-MJHT');
  assert.equal(displayCode('482913'), null);
  assert.equal(displayCode(null), null);
});

test('askApproval: Deny is the default + Esc answer; parented to the main window, brought forward', async () => {
  const calls = [];
  const win = { isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') };
  const smb = async (w, opts) => { calls.push(['box', w === win, opts]); return { response: 0 }; };
  const yes = await askApproval({ message: 'm', detail: 'd' }, { showMessageBox: smb, getWindow: () => win });
  assert.equal(yes, false);
  const box = calls.find((c) => Array.isArray(c));
  assert.equal(box[1], true);
  assert.deepEqual(box[2].buttons, ['Deny', 'Allow']);
  assert.equal(box[2].defaultId, 0);
  assert.equal(box[2].cancelId, 0);
  assert.deepEqual(calls.slice(0, 3), ['restore', 'show', 'focus']);
  assert.equal(await askApproval({ message: 'm' }, { showMessageBox: async () => ({ response: 1 }), getWindow: () => null }), true);
});

test('capData: a huge result is cut to a preview under the server cap', () => {
  assert.deepEqual(capData({ a: 1 }), { a: 1 });
  const big = capData({ raw: '"'.repeat(300 * 1024) });
  assert.equal(big.truncated, true);
  assert.ok(JSON.stringify(big).length <= MAX_RESULT_CHARS, 'even when escaping doubles it');
  assert.equal(capData(undefined), null);
});

test('serverRow: the relay\'s outcome words → tones', () => {
  const t = (outcome) => (serverRow({ at: 'x', actor: 'pc', action: 'A', outcome }) || {}).outcome;
  assert.equal(t('done'), 'ok');
  assert.equal(t('approved on the PC'), 'approved');
  assert.equal(t('denied on the PC'), 'denied');
  assert.equal(t('refused: no approval on the PC'), 'denied');
  assert.equal(t('approved, but it failed'), 'failed');
  assert.equal(t('No answer from the PC in time'), 'failed');
  assert.equal(t('not saved: bad port'), 'failed');
  assert.equal(t('saved'), 'ok');
  assert.equal(serverRow({ at: 'x', actor: 'support', action: 'A', outcome: 'asked' }), null);
});

test('connector settings: exactly the server fields and values (SupportSettings.cs)', () => {
  const v = (field, value) => { const c = parseCommand({ commandId: 'c', action: 'set_connector_setting', args: { instrumentId: IID, field, value } }); return c.error || c.args.value; };
  assert.equal(v('checksumMode', 'lenient'), 'lenient');
  assert.equal(v('checksumMode', 'optional'), 'bad_request: value');
  assert.equal(v('echoMode', 'on'), 'on');
  assert.equal(v('echoMode', true), 'bad_request: value');
  assert.equal(v('link', 'astm-e1381'), 'astm-e1381');
  assert.equal(v('link', 'stx-etx'), 'bad_request: value');
  assert.equal(v('parser', 'hl7'), 'hl7');
  assert.equal(v('sampleIdPath', '3.2'), '3.2');
  assert.equal(v('sampleIdPath', 'OBR-3'), 'OBR-3');
  assert.equal(v('sampleIdPath', '../x'), 'bad_request: value');
  assert.equal(v('port', 5603), '5603');
  assert.equal(v('checksum', 'off'), 'bad_request: field', 'only the server names');
});

test('defaultHubFactory: WebSockets only, no negotiate, headers + token factory + retry policy (the real @microsoft/signalr)', () => {
  const { defaultHubFactory } = require('../support-session');
  const conn = defaultHubFactory(`${API}/hubs/support`, { accessTokenFactory: () => TOKEN, headers: { 'X-PF-BETA': 'support' }, retryPolicy: { nextRetryDelayInMilliseconds: () => null } });
  assert.equal(typeof conn.invoke, 'function');
  assert.equal(conn.state, 'Disconnected', 'built, never started here — no network in tests');
  const opts = conn.connection._options;
  assert.equal(opts.skipNegotiation, true);
  assert.equal(opts.transport, 1, 'HttpTransportType.WebSockets');
  assert.deepEqual(opts.headers, { 'X-PF-BETA': 'support' });
});
