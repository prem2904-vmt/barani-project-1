'use strict';
/**
 * support-session.js — "Allow Prefrontal support" (beta). The server, the
 * dialog, NetDiag and the ConnectorManager are doubles: no Electron, no
 * network, no listener. Pins the contract's safety rules:
 *   no polling while idle · strict argument checks · every CHANGE asks the PC
 *   (Deny = default) · deny → nothing changes · stop / expiry / sign-out end
 *   the polling · one session per PC.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SupportSession, parseCommand, parseStart, cleanApiUrl, askApproval, capData, ACTIONS, spacedCode,
} = require('../support-session');

const IID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl';
const API = 'https://med-fetch-dev.prefrontal.health';
const tick = () => new Promise((r) => setImmediate(r));
/** Every session a test makes is stopped at the end, pass or fail (a failed assertion must not leave a poll loop running). */
const made = [];
test.after(async () => { for (const s of made) { try { await s.stop(); } catch { /* done */ } } });
async function until(fn, n = 200) { for (let i = 0; i < n; i++) { if (fn()) return; await tick(); } throw new Error('timed out waiting'); }

/** A scripted server: queue commands; every request is recorded. */
function server({ startStatus = 200, expiresInMs = 2 * 3600e3, now = () => Date.now() } = {}) {
  const st = { calls: [], queue: [], results: [], nextStatus: null, log: [], cmds: {} };
  const json = (status, body) => ({ status, json: async () => body });
  st.fetch = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace('/api/support-sessions', '');
    st.calls.push({ method: init.method, path, search: u.search, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    if (init.method === 'POST' && path === '') {
      if (startStatus !== 200) return json(startStatus, { success: false, error: { message: 'nope' } });
      return json(200, { success: true, data: { sessionId: 's-1', code: '482913', expiresAt: new Date(now() + expiresInMs).toISOString() } });
    }
    if (init.method === 'GET' && path === '/s-1/next') {
      if (st.nextStatus) return json(st.nextStatus, null);
      const c = st.queue.shift();
      if (c) { st.cmds[c.commandId] = c; return json(200, { success: true, data: c }); }
      await new Promise((r) => setTimeout(r, 2));
      return { status: 204, json: async () => null };
    }
    if (init.method === 'POST' && path === '/s-1/result') {
      const b = JSON.parse(init.body);
      st.results.push(b);
      // Like SupportSession.Complete: the server logs the answer in plain words.
      const c = st.cmds[b.commandId] || {};
      const change = 'approvedOnPc' in b;
      const outcome = change ? (!b.approvedOnPc ? 'denied on the PC' : b.ok ? 'approved on the PC' : 'approved, but it failed') : (b.ok ? 'done' : 'failed');
      st.log.push({ at: new Date(now()).toISOString(), actor: 'pc', action: c.description || c.action || '?', outcome });
      return json(200, { success: true });
    }
    if (init.method === 'POST' && path === '/s-1/stop') return json(200, { success: true });
    if (init.method === 'GET' && path === '/s-1/log') return json(200, { success: true, data: st.log });
    if (init.method === 'GET' && path === '/s-1') return json(200, { success: true, data: st.status || { status: 'active', joined: false, joinedBy: null, expiresAt: new Date(now() + expiresInMs).toISOString() } });
    return json(404, null);
  };
  st.polls = () => st.calls.filter((c) => c.path === '/s-1/next').length;
  return st;
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

function rig({ answer = 1, ...so } = {}) {
  const srv = server(so);
  const { d, m } = doubles();
  const asked = [];
  const approve = async (q) => { asked.push(q); return answer === 1; };
  const s = new SupportSession({ fetchImpl: srv.fetch, diag: d, manager: m, pcId: 'LAB-PC', approve, sleep: async () => { await tick(); }, backoffMs: [0], logRefreshMs: 1e12, minuteMs: 5, ...so.opts });
  made.push(s);
  return { s, srv, d, m, asked };
}

const start = (s, extra = {}) => s.startFromIpc({ minutes: 120, token: TOKEN, apiUrl: API, ...extra });

test('idle: no request at all until the lab starts a session', async () => {
  const { s, srv } = rig();
  await tick(); await tick();
  assert.equal(srv.calls.length, 0);
  assert.equal(s.polls, 0);
  assert.equal(s.state().status, 'idle');
  assert.equal(s.state().active, false);
});

test('start → code + expiry; long-poll carries the bearer + X-PF-BETA: support; one session per PC', async () => {
  const { s, srv } = rig();
  const r = await start(s);
  assert.equal(r.ok, true);
  assert.equal(r.state.code, '482913');
  assert.equal(r.state.status, 'waiting');
  assert.deepEqual(srv.calls[0].body, { pcId: 'LAB-PC', minutes: 120 });
  await until(() => srv.polls() >= 1);
  const poll = srv.calls.find((c) => c.path === '/s-1/next');
  assert.equal(poll.search, '?wait=25');
  assert.equal(poll.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(poll.headers['X-PF-BETA'], 'support');
  assert.ok(!('token' in r.state), 'the token never goes back to the page');
  const again = await start(s);
  assert.equal(again.ok, false);
  assert.equal(again.error, 'already_active');
  await s.stop();
});

test('stop: tells the server, polling stops, nothing more runs', async () => {
  const { s, srv } = rig();
  await start(s);
  await until(() => srv.polls() >= 2);
  await s.stop('lab');
  assert.ok(srv.calls.some((c) => c.method === 'POST' && c.path === '/s-1/stop'));
  const n = srv.polls();
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(srv.polls(), n);
  assert.equal(s.state().status, 'ended');
  assert.equal(s.state().endedReason, 'lab');
});

test('expiry: the session ends by itself at expiresAt (never later than asked)', async () => {
  let t = 1_000_000;
  const { s, srv } = rig({ now: () => t, expiresInMs: 10 * 3600e3, opts: { now: () => t } });
  const r = await start(s, { minutes: 30 });
  // The server said 10 h; the lab asked for 30 min — 30 min wins.
  assert.equal(Date.parse(r.state.expiresAt) - 1_000_000, 30 * 60000);
  await until(() => srv.polls() >= 1);
  t += 31 * 60000;
  await until(() => !s.state().active);
  assert.equal(s.state().endedReason, 'expired');
  const n = srv.polls();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(srv.polls(), n);
});

test('sign-out: 401s for the grace period end the session; a fresh token keeps it alive', async () => {
  let t = 0;
  const { s, srv } = rig({ opts: { now: () => t, signedOutGraceMs: 1000 } });
  await start(s);
  srv.nextStatus = 401;
  await until(() => s.state().signedOut === true);
  assert.equal(s.setToken(TOKEN).ok, true);
  assert.equal(s.state().signedOut, false);
  assert.equal(s.setToken('x').ok, false);
  await until(() => s.state().signedOut === true);
  t += 2000;
  await until(() => !s.state().active);
  assert.equal(s.state().endedReason, 'signed_out');
});

test('server says the session is gone (404) → ended, no stop call needed', async () => {
  const { s, srv } = rig();
  await start(s);
  srv.nextStatus = 404;
  await until(() => !s.state().active);
  assert.equal(s.state().endedReason, 'ended');
});

test('LOOK actions map to the existing netdiag / manager functions and are logged', async () => {
  const { s, srv, d, m, asked } = rig();
  // Exactly what the server queues (SupportMcpTools.cs): args + plain-words description.
  srv.queue.push(
    { commandId: 'c1', action: 'pc_overview', args: {}, change: false, description: "Looked at the PC's network" },
    { commandId: 'c2', action: 'firewall_status', args: {}, change: false, description: 'Looked at the firewall' },
    { commandId: 'c3', action: 'port_owner', args: { port: 5600 }, change: false, description: 'Checked what is using port 5600' },
    { commandId: 'c4', action: 'arp_table', args: {}, change: false, description: 'Looked at the devices on the network' },
    { commandId: 'c5', action: 'next_free_port', args: {}, change: false, description: 'Looked for a free port' },
    { commandId: 'c6', action: 'listen_status', args: {}, change: false, description: 'Looked at what the PC is listening on' },
    { commandId: 'c7', action: 'recent_errors', args: { instrumentId: null }, change: false, description: 'Read the recent connector errors' },
  );
  await start(s);
  await until(() => srv.results.length === 7);
  assert.deepEqual(srv.results.map((r) => r.ok), Array(7).fill(true));
  assert.ok(srv.results.every((r) => !('approvedOnPc' in r)), 'looks carry no approval flag');
  assert.deepEqual(d.calls, ['snapshot', 'firewall', ['portOwner', 5600], 'arp']);
  assert.deepEqual(srv.results[2].data, { port: 5600, owner: { pid: 42, name: 'oldlis', ours: false } });
  assert.deepEqual(srv.results[4].data, { port: 5603 });
  // recent_errors: error TEXT only — no message bodies, no counters.
  assert.deepEqual(srv.results[6].data, [{ instrumentId: IID, name: 'iCARE', link: 'error', errorDetail: 'Port 5601 is used by oldlis.exe',
    lastError: 'port 5601 in use', errors: [{ at: '2026-10-31T10:00:00Z', error: 'connection refused' }] }]);
  assert.equal(asked.length, 0, 'a look never asks the lab');
  // The live log is the server's (plain words), each line once.
  const words = s.state().log.map((l) => l.text);
  assert.ok(words.includes('Looked at the firewall'));
  assert.ok(words.includes('Checked what is using port 5600'));
  assert.equal(words.filter((w) => w === 'Looked at the firewall').length, 1, 'never shown twice');
  assert.equal(s.state().supportJoined, true);
  await s.stop();
});

test('validation: unknown action, extra / missing / bad arguments are refused and never run', async () => {
  assert.equal(parseCommand({ commandId: 'c', action: 'rm_rf' }).error, 'unknown_action');
  assert.equal(parseCommand({ commandId: 'c', action: 'port_owner' }).error, 'bad_request: port');
  assert.equal(parseCommand({ commandId: 'c', action: 'port_owner', args: { port: 70000 } }).error, 'bad_request: port');
  assert.equal(parseCommand({ commandId: 'c', action: 'port_owner', args: { port: '5600' } }).error, 'bad_request: port');
  assert.equal(parseCommand({ commandId: 'c', action: 'pc_overview', args: { wide: true } }).error, 'bad_request: wide');
  assert.equal(parseCommand({ commandId: 'c', action: 'probe', args: { host: '192.168.1.8' } }).error, 'bad_request: ports');
  assert.equal(parseCommand({ commandId: 'c', action: 'probe', args: { ports: [5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008] } }).error, 'bad_request: ports', '≤ 8 probe ports');
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
  // The server's exact shape (name + summary ride along; description = summary).
  const full = parseCommand({ commandId: '8f14e45fceea167a5a36dedd4bea2543', action: 'set_connector_setting', change: true,
    description: 'Set the port of iCARE to 5603', args: { instrumentId: IID, name: 'iCARE', field: 'port', value: '5603', summary: 'Set the port of iCARE to 5603' } });
  assert.equal(full.error, undefined);
  assert.equal(full.description, 'Set the port of iCARE to 5603');

  const { s, srv, d, asked } = rig();
  srv.queue.push({ commandId: 'c1', action: 'rm_rf' }, { commandId: 'c2', action: 'port_owner', args: { port: 'x' } });
  await start(s);
  await until(() => srv.results.length === 2);
  assert.deepEqual(srv.results.map((r) => [r.ok, r.error]), [[false, 'unknown_action'], [false, 'bad_request: port']]);
  assert.equal(d.calls.length, 0);
  assert.equal(asked.length, 0);
  await s.stop();
});

test('every CHANGE action is a "change" in the table and asks the PC; looks never do', () => {
  const change = Object.entries(ACTIONS).filter(([, a]) => a.kind === 'change').map(([k]) => k).sort();
  assert.deepEqual(change, ['fix_firewall', 'listen_capture', 'restart_connector', 'set_connector_setting']);
});

test('approval: Allow → runs; result carries approvedOnPc=true; plain words name the analyzer', async () => {
  const { s, srv, m, asked } = rig({ answer: 1 });
  srv.queue.push(
    { commandId: 'c1', action: 'restart_connector', args: { instrumentId: IID, name: 'iCARE', summary: 'Restart the iCARE connector' }, change: true, description: 'Restart the iCARE connector' },
    { commandId: 'c2', action: 'set_connector_setting', args: { instrumentId: IID, name: 'iCARE', field: 'port', value: '5603', summary: 'Set the port of iCARE to 5603' }, change: true, description: 'Set the port of iCARE to 5603' },
    { commandId: 'c3', action: 'listen_capture', args: { port: 5610, minutes: 2, summary: 'Listen on port 5610 for 2 minute(s)' }, change: true, description: 'Listen on port 5610 for 2 minute(s)' },
    { commandId: 'c4', action: 'fix_firewall', args: { ports: [5603], adapter: 'Ethernet 2', summary: 'Open port(s) 5603 in the Windows firewall' }, change: true, description: 'Open port(s) 5603 in the Windows firewall' },
  );
  await start(s);
  await until(() => srv.results.length === 4, 20000);
  assert.deepEqual(srv.results.map((r) => [r.ok, r.approvedOnPc]), [[true, true], [true, true], [true, true], [true, true]]);
  assert.deepEqual(asked.map((q) => q.message), [
    'Prefrontal support wants to restart the connection to the iCARE. Allow?',
    'Prefrontal support wants to change the port of the iCARE to 5603. Allow?',
    'Prefrontal support wants to listen on port 5610 for 2 min to see what the analyzer sends. Allow?',
    'Prefrontal support wants to open port 5603 for the analyzers in the Windows firewall. Allow?',
  ]);
  assert.ok(asked.every((q) => /session code 482 913/.test(q.detail)));
  assert.ok(m.calls.some((c) => c[0] === 'reload' && c[1] === IID));
  assert.ok(m.calls.some((c) => c[0] === 'scanStart' && c[1].ports[0] === 5610));
  assert.ok(s.state().log.some((l) => l.text === 'Open port(s) 5603 in the Windows firewall' && l.outcome === 'approved'));
  await s.stop();
  assert.ok(m.calls.some((c) => c[0] === 'scanStop' && c[1] === 'scan-1'), 'stop closes the capture');
});

test('deny path: nothing changes, the result says denied_on_pc / approvedOnPc=false, logged for the lab', async () => {
  const { s, srv, d, m, asked } = rig({ answer: 0 });
  srv.queue.push(
    { commandId: 'c1', action: 'restart_connector', args: { instrumentId: IID } },
    { commandId: 'c2', action: 'fix_firewall', args: { ports: [5603], adapter: 'Ethernet 2' }, description: 'Open port(s) 5603 in the Windows firewall' },
    { commandId: 'c3', action: 'listen_capture', args: { port: 5610 } },
    { commandId: 'c4', action: 'set_connector_setting', args: { instrumentId: IID, field: 'checksumMode', value: 'off' } },
  );
  await start(s);
  await until(() => srv.results.length === 4, 20000);
  assert.equal(asked.length, 4);
  assert.deepEqual(srv.results.map((r) => [r.ok, r.approvedOnPc, r.error]), Array(4).fill([false, false, 'denied_on_pc']));
  assert.equal(m.calls.filter((c) => c[0] === 'reload' || c[0] === 'scanStart').length, 0);
  assert.ok(!d.calls.includes('UAC'), 'Windows is never asked after a Deny');
  assert.ok(s.state().log.some((l) => l.text === 'Open port(s) 5603 in the Windows firewall' && l.outcome === 'denied'));
  await s.stop();
});

test('fix_firewall: only the analyzer range or a paired port; listen_capture never takes a paired port', async () => {
  const { s, srv, d, asked } = rig();
  srv.queue.push(
    { commandId: 'c1', action: 'fix_firewall', args: { ports: [3389], adapter: 'Ethernet' } },
    { commandId: 'c2', action: 'listen_capture', args: { port: 5601 } },
    { commandId: 'c3', action: 'fix_firewall', args: { ports: [5601], adapter: 'Ethernet 2' } },
  );
  await start(s);
  await until(() => srv.results.length === 3);
  assert.equal(srv.results[0].ok, false);
  assert.match(srv.results[0].error, /analyzer range/);
  assert.equal(srv.results[1].ok, false);
  assert.match(srv.results[1].error, /used by iCARE/);
  assert.equal(srv.results[2].ok, true);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].message, 'Prefrontal support wants to open port 5601 for the iCARE in the Windows firewall. Allow?');
  assert.deepEqual(d.calls.filter((c) => Array.isArray(c) && c[0] === 'fixFirewall'), [['fixFirewall', [5601], 'Ethernet 2']]);
  await s.stop();
});

test('stop while the approval dialog is open: the dialog is closed (signal) and the change never runs', async () => {
  const srv = server();
  const { d, m } = doubles();
  let signal = null;
  let release;
  const approve = (q) => { signal = q.signal; return new Promise((r) => { release = r; q.signal.addEventListener('abort', () => r(false)); }); };
  const s = new SupportSession({ fetchImpl: srv.fetch, diag: d, manager: m, pcId: 'LAB-PC', approve, sleep: async () => { await tick(); }, backoffMs: [0], logRefreshMs: 1e12 });
  srv.queue.push({ commandId: 'c1', action: 'restart_connector', args: { instrumentId: IID } });
  await start(s);
  await until(() => s.state().approval !== null);
  assert.equal(s.state().approval.message, 'Prefrontal support wants to restart the connection to the iCARE. Allow?');
  await s.stop('lab');
  assert.equal(signal.aborted, true);
  release(true);
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(m.calls.filter((c) => c[0] === 'reload').length, 0);
  assert.equal(srv.results.length, 0, 'nothing reported after stop');
});

test('start refused by the server: plain words, no polling', async () => {
  const { s, srv } = rig({ startStatus: 404 });
  const r = await start(s);
  assert.equal(r.ok, false);
  assert.match(r.error, /isn’t switched on/);
  assert.equal(srv.polls(), 0);
  assert.equal(s.state().active, false);
});

test('start arguments: minutes 5–240 (default 120), JWT-shaped token, https API (http only on this machine)', () => {
  assert.equal(parseStart({ token: TOKEN, apiUrl: API }).minutes, 120);
  assert.equal(parseStart({ minutes: 241, token: TOKEN, apiUrl: API }).error, 'bad_request: minutes');
  assert.equal(parseStart({ minutes: 4, token: TOKEN, apiUrl: API }).error, 'bad_request: minutes');
  assert.equal(parseStart({ minutes: 5, token: TOKEN, apiUrl: API }).minutes, 5);
  assert.equal(parseStart({ minutes: 60, token: 'a b', apiUrl: API }).error, 'bad_request: token');
  assert.equal(parseStart({ minutes: 60, token: TOKEN, apiUrl: 'http://evil.example' }).error, 'bad_request: apiUrl');
  assert.equal(cleanApiUrl('https://med-fetch-dev.prefrontal.health/'), API);
  assert.equal(cleanApiUrl('http://localhost:5270'), 'http://localhost:5270');
  assert.equal(cleanApiUrl('https://user:pw@x.example'), null);
  assert.equal(cleanApiUrl('https://x.example/api?x=1'), null);
  assert.equal(spacedCode('482913'), '482 913');
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

test('capData: a huge result is cut to a preview', () => {
  assert.deepEqual(capData({ a: 1 }), { a: 1 });
  const big = capData({ raw: 'x'.repeat(300 * 1024) });
  assert.equal(big.truncated, true);
  assert.equal(capData(undefined), null);
});

test('server log: "Joined the session" (with the email) shows for the lab; "asked" rows are not doubled', async () => {
  const { s, srv } = rig({ opts: { logRefreshMs: 0 } });
  const at = new Date().toISOString();
  srv.log = [
    { at, actor: 'lab', action: 'Allowed Prefrontal support', outcome: 'for 120 minutes' },
    { at, actor: 'support', action: 'Joined the session', outcome: 'eng@prefrontal.health' },
    { at, actor: 'support', action: 'Looked at the firewall', outcome: 'asked' },
    { at, actor: 'support', action: 'Restart the iCARE connector', outcome: 'asked for approval on the PC' },
  ];
  srv.status = { status: 'active', joined: true, joinedBy: 'eng@prefrontal.health', expiresAt: new Date(Date.now() + 3600e3).toISOString() };
  await start(s);
  await until(() => s.state().supportJoined === true && s.state().log.some((l) => /^Joined/.test(l.text)));
  assert.equal(s.state().status, 'connected');
  const words = s.state().log.map((l) => l.text);
  assert.ok(words.includes('Joined the session (eng@prefrontal.health)'));
  assert.ok(words.includes('Allowed Prefrontal support'));
  assert.ok(!words.includes('Looked at the firewall') && !words.includes('Restart the iCARE connector'));
  await s.stop();
});

// ── server contract (prefrontal-mw, 2026-10-31) ────────────────────────────

test('410 session_ended on the long-poll ends the loop', async () => {
  const { s, srv } = rig();
  await start(s);
  srv.nextStatus = 410;
  await until(() => !s.state().active);
  assert.equal(s.state().endedReason, 'ended');
  const n = srv.polls();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(srv.polls(), n);
});

test('GET /{id}: "support joined: name" for the card; expiry only ever moves EARLIER', async () => {
  let t = 1_000_000;
  const { s, srv } = rig({ now: () => t, opts: { now: () => t, logRefreshMs: 0 } });
  srv.status = { status: 'active', joined: true, joinedBy: 'eng@prefrontal.health', expiresAt: new Date(t + 10 * 3600e3).toISOString() };
  const r = await start(s, { minutes: 60 });
  const asked = Date.parse(r.state.expiresAt);
  await until(() => s.state().joinedBy === 'eng@prefrontal.health');
  assert.equal(s.state().status, 'connected');
  assert.equal(Date.parse(s.state().expiresAt), asked, 'a later server expiry never extends the session');
  srv.status = { ...srv.status, expiresAt: new Date(t + 30 * 60000).toISOString() };
  await until(() => Date.parse(s.state().expiresAt) === t + 30 * 60000);
  srv.status = { ...srv.status, status: 'ended' };
  await until(() => !s.state().active);
});

test('a result the server already has (409) is not retried', async () => {
  const { s, srv } = rig();
  const base = srv.fetch;
  let posts = 0;
  srv.fetch = async (url, init) => {
    if (init.method === 'POST' && url.endsWith('/s-1/result')) { posts++; return { status: 409, json: async () => ({ success: false }) }; }
    return base(url, init);
  };
  s.fetch = srv.fetch;
  srv.queue.push({ commandId: 'c1', action: 'arp_table' });
  await start(s);
  await until(() => posts === 1);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(posts, 1);
  await s.stop();
});

test('server change:true on a "look" makes it ask first (stricter only); its description shows in the dialog', async () => {
  const { s, srv, d, asked } = rig({ answer: 0 });
  srv.queue.push(
    { commandId: 'c1', action: 'arp_table', change: true, description: 'Read the ARP table' },
    { commandId: 'c2', action: 'restart_connector', args: { instrumentId: IID }, change: false, description: 'Restart iCARE\u0007 to re-link' },
  );
  await start(s);
  await until(() => srv.results.length === 2);
  assert.equal(asked.length, 2, 'change:false never makes a change skip the question');
  assert.equal(asked[0].message, 'Prefrontal support wants to: Read the ARP table. Allow?');
  assert.deepEqual([srv.results[0].ok, srv.results[0].approvedOnPc], [false, false]);
  assert.ok(!d.calls.includes('arp'));
  assert.match(asked[1].detail, /Prefrontal support says: “Restart iCARE to re-link”/);
  await s.stop();
});

test('listen_capture answers when the capture ends: {messages:[{protocol,text}], bytes}; the poll goes on meanwhile', async () => {
  const { s, srv, m } = rig({ opts: { minuteMs: 30 } });
  m.scanStop = async () => ({ ports: [{ port: 5610, raw: '<STX>1H|\\^&|||iCARE', detect: { protocol: 'astm' } }, { port: 5611, raw: '' }] });
  srv.queue.push({ commandId: 'c1', action: 'listen_capture', args: { port: 5610, minutes: 1 } }, { commandId: 'c2', action: 'arp_table' });
  await start(s);
  await until(() => srv.results.length === 1);
  assert.equal(srv.results[0].commandId, 'c2', 'the look ran while the capture listened');
  await until(() => srv.results.length === 2, 2000);
  assert.deepEqual(srv.results[1], { commandId: 'c1', ok: true, approvedOnPc: true, error: null,
    data: { messages: [{ protocol: 'astm', text: '<STX>1H|\\^&|||iCARE' }], bytes: 19 } });
  await s.stop();
});

test('connector settings: exactly the server fields and values (SupportSettings.cs)', () => {
  const v = (field, value) => { const c = parseCommand({ commandId: 'c', action: 'set_connector_setting', args: { instrumentId: IID, field, value } }); return c.error || c.args.value; };
  assert.equal(v('checksumMode', 'lenient'), 'lenient');
  assert.equal(v('checksumMode', 'optional'), 'bad_request: value');
  assert.equal(v('echoMode', 'on'), 'on');
  assert.equal(v('echoMode', true), 'bad_request: value');
  assert.equal(v('echoMode', 'Rm -rf'), 'bad_request: value');
  assert.equal(v('link', 'astm-e1381'), 'astm-e1381');
  assert.equal(v('link', 'stx-etx'), 'bad_request: value');
  assert.equal(v('parser', 'hl7'), 'hl7');
  assert.equal(v('sampleIdPath', '3.2'), '3.2');
  assert.equal(v('sampleIdPath', 'OBR-3'), 'OBR-3');
  assert.equal(v('sampleIdPath', '../x'), 'bad_request: value');
  assert.equal(v('port', 5603), '5603');
  assert.equal(v('checksum', 'off'), 'bad_request: field', 'only the server names');
});

test('probe: server args {ports, host}; host must be ARP-known on one of this PC\'s networks; open list filtered to it', async () => {
  const { s, srv, d } = rig();
  d.probe = async (a) => { d.calls.push(['probe', a]); return { subnet: '192.168.10.0/24', open: [{ host: '192.168.10.20', port: 5600 }, { host: '192.168.10.21', port: 5600 }] }; };
  srv.queue.push(
    { commandId: 'c1', action: 'probe', args: { ports: [5600], host: '192.168.10.20' } },
    { commandId: 'c2', action: 'probe', args: { ports: [5600], host: '192.168.10.99' } },
    { commandId: 'c3', action: 'probe', args: { ports: [5600], host: '172.20.0.9' } },
    { commandId: 'c4', action: 'probe', args: { ports: [5600], host: null } },
  );
  await start(s);
  await until(() => srv.results.length === 4);
  assert.deepEqual(srv.results[0].data.open, [{ host: '192.168.10.20', port: 5600 }]);
  assert.match(srv.results[1].error, /ARP/);
  assert.match(srv.results[2].error, /not on any/);
  assert.equal(srv.results[3].ok, true);
  assert.deepEqual(d.calls.filter((c) => Array.isArray(c) && c[0] === 'probe').map((c) => c[1].address), ['192.168.10.2', '192.168.10.2'], 'probes from this PC\'s own card on that /24');
  await s.stop();
});

test('fix_firewall without an adapter: the one analyzer-only card (no gateway); none / several = refused', async () => {
  const { s, srv, d } = rig();
  srv.queue.push({ commandId: 'c1', action: 'fix_firewall', args: { ports: [5603], adapter: null } });
  await start(s);
  await until(() => srv.results.length === 1);
  assert.equal(srv.results[0].ok, true);
  assert.deepEqual(d.calls.find((c) => Array.isArray(c) && c[0] === 'fixFirewall'), ['fixFirewall', [5603], 'Ethernet 2']);
  d.adapters = async () => [{ name: 'A', gateway: null, ipv4: [{ address: '192.168.1.2' }] }, { name: 'B', gateway: null, ipv4: [{ address: '192.168.2.2' }] }];
  srv.queue.push({ commandId: 'c2', action: 'fix_firewall', args: { ports: [5603] } });
  await until(() => srv.results.length === 2);
  assert.match(srv.results[1].error, /adapter/);
  await s.stop();
});

test('410 on a result post ends the session', async () => {
  const { s, srv } = rig();
  const base = srv.fetch;
  s.fetch = async (url, init) => (init.method === 'POST' && url.endsWith('/s-1/result') ? { status: 410, json: async () => ({ success: false }) } : base(url, init));
  srv.queue.push({ commandId: 'c1', action: 'arp_table' });
  await start(s);
  await until(() => !s.state().active);
  assert.equal(s.state().endedReason, 'ended');
});
