'use strict';
/**
 * diag-ipc.js — main's own confirm before the ONE elevated write (M3) and the
 * probe's renderer-facing limits (L2). Electron's dialog is injected, so no
 * Electron process is launched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDiagHandlers } = require('../diag-ipc');
const nd = require('../netdiag');

const EXE = 'C:\\Users\\lab\\AppData\\Local\\Programs\\Prefrontal\\Prefrontal.exe';
const IFACES = {
  Ethernet: [{ address: '192.168.1.8', netmask: '255.255.255.0', family: 'IPv4', mac: '3c:7c:3f:1a:2b:01', internal: false }],
  'Ethernet 2': [{ address: '192.168.10.5', netmask: '255.255.255.0', family: 'IPv4', mac: '00:0e:c6:5d:11:22', internal: false }],
};
const PROFILES = [
  'Name             : Network 3', 'InterfaceAlias   : Ethernet', 'InterfaceIndex   : 11', 'NetworkCategory  : Public', 'IPv4Connectivity : Internet', '',
  'Name             : Unidentified network', 'InterfaceAlias   : Ethernet 2', 'InterfaceIndex   : 17', 'NetworkCategory  : Public', 'IPv4Connectivity : LocalNetwork', '',
].join('\r\n');

/** A Windows NetDiag whose only "elevated" effect is recording the script. */
function rig({ paired = [{ port: 5601, name: 'Snibe Maglumi', kind: 'connector' }, { port: 5620, name: 'a listen session', kind: 'listen' }] } = {}) {
  const st = { elevated: [] };
  const exec = async (file, args) => {
    const cmd = args[args.length - 1];
    if (/ipconfig\.exe$/i.test(file)) return { ok: false, code: 1, stdout: '' };
    if (/netsh\.exe$/i.test(file)) return { ok: true, code: 0, stdout: '' };
    if (/^Get-NetConnectionProfile/.test(cmd)) return { ok: true, code: 0, stdout: PROFILES };
    if (/Get-NetFirewallApplicationFilter -Program \$env:PF_PROGRAM/.test(cmd)) return { ok: true, code: 0, stdout: '' };
    if (/-Verb RunAs/.test(cmd)) {
      st.elevated.push(Buffer.from(/-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(cmd)[1], 'base64').toString('utf16le'));
      return { ok: true, code: 0, stdout: '' };
    }
    throw new Error(`unexpected: ${file} ${cmd}`);
  };
  const diag = new nd.NetDiag({
    platform: 'win32', exec, programPath: EXE, env: { SystemRoot: 'C:\\Windows' },
    os: { networkInterfaces: () => IFACES, hostname: () => 'LAB' }, usedEndpoints: () => paired,
  });
  return { diag, st };
}

function dialogDouble(response) {
  const calls = [];
  const win = { isDestroyed: () => false, id: 'main' };
  return {
    calls, win,
    showMessageBox: async (...a) => { calls.push(a); return { response }; },
    getWindow: () => win,
  };
}

test('M3: Cancel in main\'s dialog → "Nothing was changed", Windows never asked', async () => {
  const { diag, st } = rig();
  const dlg = dialogDouble(0);
  const h = makeDiagHandlers({ diag, showMessageBox: dlg.showMessageBox, getWindow: dlg.getWindow });
  const r = await h.fixFirewall({ ports: [5603], adapter: 'Ethernet 2' });
  assert.deepEqual(r, { ok: false, cancelled: true, error: 'Nothing was changed.' });
  assert.equal(st.elevated.length, 0);
  assert.equal(dlg.calls.length, 1);
  const [parent, opts] = dlg.calls[0];
  assert.equal(parent, dlg.win, 'the dialog is parented to the main window');
  assert.equal(opts.cancelId, 0);
  assert.equal(opts.defaultId, 0, 'Enter = Cancel');
  assert.deepEqual(opts.buttons, ['Cancel', 'Fix with Windows permission']);
  // Plain words, the exact changes.
  assert.match(opts.detail, /• Let analyzers on 192\.168\.10\.x \(Ethernet 2\) reach Prefrontal on ports 5601, 5603 — only Prefrontal, nothing else\./);
  assert.match(opts.detail, /• Set Ethernet 2 to a Private network\./);
  assert.doesNotMatch(opts.detail, /Set Ethernet to/, 'the Internet card is never mentioned for a flip');
});

test('M3: Fix in main\'s dialog → one elevated script, matching what the dialog said', async () => {
  const { diag, st } = rig();
  const dlg = dialogDouble(1);
  const h = makeDiagHandlers({ diag, showMessageBox: dlg.showMessageBox, getWindow: dlg.getWindow });
  const r = await h.fixFirewall({ ports: [5603, 5604], adapter: 'Ethernet 2' });
  assert.equal(r.ok, true);
  assert.equal(st.elevated.length, 1);
  assert.match(st.elevated[0], /\$ports = @\(5601,5603,5604\)/);
  assert.match(st.elevated[0], /\$remote = @\('192\.168\.10\.0\/24'\)/);
  assert.match(st.elevated[0], /\$aliases = @\('Ethernet 2'\)/);
});

test('M3: remote-admin ports are dropped (a paired analyzer\'s port stays); only-forbidden → refused before any dialog', async () => {
  const { diag, st } = rig({ paired: [{ port: 6100, name: 'Old LIS analyzer', kind: 'connector' }] });
  const dlg = dialogDouble(1);
  const h = makeDiagHandlers({ diag, showMessageBox: dlg.showMessageBox, getWindow: dlg.getWindow });
  await h.fixFirewall({ ports: [3389, 5985, 5603], adapter: 'Ethernet 2' });
  assert.match(st.elevated[0], /\$ports = @\(5603,6100\)/, '3389 (RDP) / 5985 (WinRM) never opened; the paired 6100 is');

  const none = rig({ paired: [] });
  const dlg2 = dialogDouble(1);
  const h2 = makeDiagHandlers({ diag: none.diag, showMessageBox: dlg2.showMessageBox, getWindow: dlg2.getWindow });
  const r = await h2.fixFirewall({ ports: [3389], adapter: 'Ethernet 2' });
  assert.equal(r.ok, false);
  assert.match(r.error, /1024 or higher/);
  assert.equal(dlg2.calls.length, 0);
  assert.equal(none.st.elevated.length, 0);
});

test('M3: bad IPC input is refused before any dialog (no card, junk ports, ports < 1024, a card this PC does not have)', async () => {
  const { diag, st } = rig();
  const dlg = dialogDouble(1);
  const h = makeDiagHandlers({ diag, showMessageBox: dlg.showMessageBox, getWindow: dlg.getWindow });
  assert.deepEqual(await h.fixFirewall({ ports: [5603] }), { error: 'bad_request: fix' });
  assert.deepEqual(await h.fixFirewall({ ports: ['5603; calc'], adapter: 'Ethernet 2' }), { error: 'bad_request: fix' });
  assert.deepEqual(await h.fixFirewall({ ports: [80], adapter: 'Ethernet 2' }), { error: 'bad_request: fix' });
  assert.deepEqual(await h.fixFirewall({ ports: [5603], adapter: 'x'.repeat(300) }), { error: 'bad_request: fix' });
  assert.deepEqual(await h.fixFirewall({ ports: [5603], adapter: 42 }), { error: 'bad_request: fix' });
  const r = await h.fixFirewall({ ports: [5603], adapter: 'Wi-Fi' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Pick the network card/);
  assert.equal(dlg.calls.length, 0);
  assert.equal(st.elevated.length, 0);
});

test('M3: no main window → the dialog is still shown (unparented), never skipped', async () => {
  const { diag, st } = rig();
  const calls = [];
  const h = makeDiagHandlers({ diag, showMessageBox: async (...a) => { calls.push(a); return { response: 0 }; }, getWindow: () => null });
  const r = await h.fixFirewall({ ports: [5603], adapter: 'Ethernet 2' });
  assert.equal(r.cancelled, true);
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0][0].detail, 'string');
  assert.equal(st.elevated.length, 0);
});

test('L2: probe ports must be ≥ 1024; `wide` from the renderer is ignored', async () => {
  const seen = [];
  const diag = { probe: async (o) => { seen.push(o); return { open: [] }; } };
  const h = makeDiagHandlers({ diag, showMessageBox: async () => ({ response: 0 }), getWindow: () => null });
  assert.deepEqual(await h.probe({ address: '192.168.1.10', ports: [22, 445] }), { error: 'bad_request: probe' });
  assert.deepEqual(await h.probe({ address: 5 }), { error: 'bad_request: probe' });
  await h.probe({ address: '192.168.1.10', ports: [5100], wide: true });
  assert.deepEqual(seen, [{ address: '192.168.1.10', ports: [5100] }]);
  await h.probe({ address: '192.168.1.10' });
  assert.deepEqual(seen[1], { address: '192.168.1.10', ports: undefined });
});

test('scanSetPort IPC: strict args — GUID scan id, whole-number port 1–65535 (no strings / floats), `keep` is main\'s own', async () => {
  const { diag } = rig();
  const calls = [];
  const manager = { scanSetPort: (a) => { calls.push(a); return { ok: true, port: a.port }; } };
  const dlg = dialogDouble(0);
  const h = makeDiagHandlers({ diag, manager, showMessageBox: dlg.showMessageBox, getWindow: dlg.getWindow });
  const id = '11111111-2222-3333-4444-555555555555';
  assert.equal((await h.scanSetPort({ scanId: id, port: 8080, previous: 5603 })).ok, true);
  assert.deepEqual(calls[0].previous, 5603);
  assert.ok(calls[0].keep.includes(5599) && calls[0].keep.includes(5610) && !calls[0].keep.includes(8080));
  assert.equal((await h.scanSetPort({ scanId: id, port: 8080, keep: [8080] })) && calls[1].previous, null);
  assert.deepEqual(calls[1].keep.includes(8080), false, 'the page cannot choose which ports stay open');
  const n = calls.length;
  for (const bad of [
    { scanId: 'x', port: 8080 }, { scanId: id, port: '8080' }, { scanId: id, port: 0 }, { scanId: id, port: 65536 },
    { scanId: id, port: 80.5 }, { scanId: id, port: 8080, previous: '5603' }, { scanId: id }, null, 'x', [],
  ]) assert.match((await h.scanSetPort(bad)).error, /^bad_request/);
  assert.equal(calls.length, n, 'nothing reached the manager');
});

test('listenStart IPC transport check: port whole 1–65535, host short string', () => {
  const { listenTransportOk } = require('../diag-ipc');
  assert.equal(listenTransportOk({ type: 'tcp-client', host: '192.168.1.30', port: 5100 }), true);
  assert.equal(listenTransportOk({ type: 'serial', path: 'COM3' }), true);
  for (const t of [{ port: '5100' }, { port: 0 }, { port: 70000 }, { port: 1.5 }, { host: 5 }, { host: 'x'.repeat(300) }, null, []]) assert.equal(listenTransportOk(t), false);
});
