'use strict';
/**
 * netdiag.js — the "Connect an analyzer" checks, on captured outputs modelled
 * on the Arun Lab PC (24 Oct): two cards on 192.168.1.x (Ethernet .8 to the
 * router, Ethernet 2 .10 straight to the Medonic), an old LIS program
 * (CBCLisM51) holding port 5600, the analyzer card on a Public network, and
 * Windows block rules from a cancelled firewall question.
 *
 * No command really runs: `exec` is a fixture-backed double that ALSO
 * asserts every call is a fixed program + fixed arguments.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nd = require('../netdiag');

const FX = path.join(__dirname, 'fixtures', 'netdiag');
const fx = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const EXE = 'C:\\Users\\lab\\AppData\\Local\\Programs\\Prefrontal\\Prefrontal.exe';

/** os.networkInterfaces() as Windows reports it on the lab PC. */
const WIN_IFACES = {
  Ethernet: [{ address: '192.168.1.8', netmask: '255.255.255.0', family: 'IPv4', mac: '3c:7c:3f:1a:2b:01', internal: false }],
  'Ethernet 2': [{ address: '192.168.1.10', netmask: '255.255.255.0', family: 'IPv4', mac: '00:0e:c6:5d:11:22', internal: false }],
  'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true }],
};

/** Fixture-backed exec: maps each FIXED command line to a captured output. */
function winExec(over = {}) {
  const calls = [];
  const table = {
    'ipconfig /all': fx('win-ipconfig-all.txt'),
    'netstat -ano -p TCP': fx('win-netstat-ano.txt'),
    'tasklist /FO CSV /NH /FI PID eq 7412': fx('win-tasklist-7412.csv'),
    'tasklist /FO CSV /NH /FI PID eq 9020': '"Prefrontal.exe","9020","Console","1","182,544 K"\r\n',
    'netsh advfirewall show allprofiles state': fx('win-netsh-allprofiles-state.txt'),
    'netsh int ipv4 show excludedportrange protocol=tcp': fx('win-netsh-excludedportrange.txt'),
    'arp -a': fx('win-arp-a.txt'),
    ...over,
  };
  const exec = async (file, args, opts) => {
    assert.ok(Array.isArray(args) && args.every((a) => typeof a === 'string'), 'execFile-style args only');
    calls.push({ file, args, opts });
    if (file === 'powershell.exe') {
      const cmd = args[args.length - 1];
      if (/^Get-NetConnectionProfile/.test(cmd)) return { ok: true, code: 0, stdout: over.profiles ?? fx('win-get-netconnectionprofile.txt') };
      if (/Get-NetFirewallApplicationFilter -Program \$env:PF_PROGRAM/.test(cmd)) {
        assert.equal(opts && opts.env && opts.env.PF_PROGRAM, EXE, 'the exe path travels in the environment, not the command');
        return { ok: true, code: 0, stdout: over.rules ?? fx('win-firewall-app-rules.csv') };
      }
      if (/Start-Process -FilePath 'powershell.exe' -Verb RunAs/.test(cmd)) return over.elevate ? over.elevate(cmd) : { ok: true, code: 0, stdout: '' };
      throw new Error(`unexpected powershell: ${cmd.slice(0, 80)}`);
    }
    const key = [file, ...args].join(' ');
    if (!(key in table)) throw new Error(`unexpected command: ${key}`);
    return { ok: true, code: 0, stdout: table[key] };
  };
  return { exec, calls };
}

function winDiag(o = {}) {
  const { exec, calls } = winExec(o.exec || {});
  const d = new nd.NetDiag({
    platform: 'win32', exec, programPath: EXE, selfPid: 9020,
    os: { networkInterfaces: () => WIN_IFACES, hostname: () => 'LAB-RECEPTION' },
    canBind: o.canBind || (async (p) => ![5599, 5600, 5601, 5602].includes(p)),
    usedEndpoints: o.used || (() => [{ port: 5599, name: 'Mindray BC-5130' }, { port: 5601, name: 'Snibe Maglumi' }, { port: 5602, name: 'LifeDx HBPro' }]),
    connect: o.connect, now: o.now,
  });
  return { d, calls };
}

// ── parsers ────────────────────────────────────────────────────────────────

test('ipconfig /all (CRLF): both lab cards, fixed IPs, gateway only on the router card; disconnected Wi-Fi kept but empty', () => {
  const a = nd.parseIpconfig(fx('win-ipconfig-all.txt'));
  assert.deepEqual(a.map((x) => x.name), ['Ethernet', 'Ethernet 2', 'Wi-Fi', 'Bluetooth Network Connection']);
  assert.deepEqual(a[0].ipv4, [{ address: '192.168.1.8', netmask: '255.255.255.0' }]);
  assert.equal(a[0].gateway, '192.168.1.1');
  assert.equal(a[0].dhcp, false);
  assert.equal(a[1].description, 'ASIX AX88179 USB 3.0 to Gigabit Ethernet Adapter');
  assert.deepEqual(a[1].ipv4, [{ address: '192.168.1.10', netmask: '255.255.255.0' }]);
  assert.equal(a[1].gateway, null);
  assert.equal(a[2].mediaDisconnected, true);
  assert.deepEqual(a[2].ipv4, []);
});

test('netstat -ano and Get-NetTCPConnection agree on who holds 5600 (PID 7412, IPv4 + IPv6 listeners)', () => {
  const ns = nd.parseNetstat(fx('win-netstat-ano.txt'));
  const l5600 = ns.filter((r) => r.localPort === 5600 && r.state === 'LISTENING');
  assert.deepEqual(l5600.map((r) => [r.local, r.pid]), [['0.0.0.0', 7412], ['::', 7412]]);
  const est = ns.find((r) => r.localPort === 5600 && r.state === 'ESTABLISHED');
  assert.deepEqual([est.local, est.remote, est.remotePort], ['192.168.1.10', '192.168.1.21', 49731], 'the Medonic is talking to the OLD program');
  const g = nd.parseGetNetTcpConnection(fx('win-get-nettcpconnection.txt'));
  assert.deepEqual(g.map((r) => [r.local, r.localPort, r.state, r.pid]), [['::', 5600, 'LISTENING', 7412], ['192.168.1.10', 5600, 'ESTABLISHED', 7412], ['0.0.0.0', 5600, 'LISTENING', 7412]]);
});

test('tasklist CSV (quoted, thousands separator) and the "no tasks" line', () => {
  assert.deepEqual(nd.parseTasklist(fx('win-tasklist-7412.csv')), [{ name: 'CBCLisM51.exe', pid: 7412 }]);
  assert.deepEqual(nd.parseTasklist(fx('win-tasklist-none.txt')), []);
  assert.equal(nd.parseTasklist(fx('win-tasklist-full.csv')).length, 6);
});

test('Get-NetConnectionProfile: the analyzer card is an Unidentified, Public network', () => {
  assert.deepEqual(nd.parseNetConnectionProfile(fx('win-get-netconnectionprofile.txt')), [
    { name: 'Network 3', alias: 'Ethernet', index: 11, category: 'Private', ipv4: 'Internet' },
    { name: 'Unidentified network', alias: 'Ethernet 2', index: 17, category: 'Public', ipv4: 'LocalNetwork' },
  ]);
});

test('arp -a (Windows, per interface) and arp -an (macOS, short octets padded, incomplete skipped)', () => {
  const w = nd.parseArp(fx('win-arp-a.txt'));
  assert.deepEqual(w.filter((e) => e.type === 'dynamic').map((e) => [e.ip, e.mac, e.iface]), [
    ['192.168.1.1', 'a4:2b:b0:6e:10:01', '192.168.1.8'],
    ['192.168.1.24', '00:1b:2c:44:55:66', '192.168.1.8'],
    ['192.168.1.30', 'b8:27:eb:12:34:56', '192.168.1.8'],
    ['192.168.1.21', '00:50:c2:0a:0b:0c', '192.168.1.10'],
  ]);
  const m = nd.parseArp(fx('mac-arp-an.txt'));
  assert.deepEqual(m.map((e) => e.ip), ['192.168.1.1', '192.168.1.21', '192.168.1.255', '224.0.0.251']);
  assert.equal(m[1].mac, '00:50:c2:0a:0b:0c');
});

test('netsh: firewall on for every profile; reserved port ranges; firewall rules CSV; lsof (macOS)', () => {
  assert.deepEqual(nd.parseFirewallState(fx('win-netsh-allprofiles-state.txt')), { domain: true, private: true, public: true });
  assert.deepEqual(nd.parseExcludedPorts(fx('win-netsh-excludedportrange.txt')).slice(0, 2), [{ start: 5357, end: 5357 }, { start: 50000, end: 50059 }]);
  const rules = nd.parseFirewallRulesCsv(fx('win-firewall-app-rules.csv'));
  assert.equal(rules.filter((r) => r.action === 'Block').length, 2);
  assert.deepEqual(nd.parseLsof(fx('mac-lsof-5600.txt')), [{ name: 'CBCLisM51', pid: 41234 }]);
});

test('subnet math', () => {
  assert.equal(nd.subnetOf('192.168.1.10', '255.255.255.0'), '192.168.1.0/24');
  assert.equal(nd.subnetOf('10.20.30.40', '255.255.0.0'), '10.20.0.0/16');
  assert.equal(nd.subnetOf('bad', '255.255.255.0'), null);
});

// ── checks ─────────────────────────────────────────────────────────────────

test('snapshot (Windows): both cards, the two-cards-one-network warning, Public analyzer card, block rules, next free port', async () => {
  const { d } = winDiag();
  const s = await d.snapshot();
  assert.equal(s.hostname, 'LAB-RECEPTION');
  assert.deepEqual(s.adapters.map((a) => [a.name, a.ipv4[0].address, a.gateway]), [['Ethernet', '192.168.1.8', '192.168.1.1'], ['Ethernet 2', '192.168.1.10', null]]);
  assert.equal(s.adapters[1].description, 'ASIX AX88179 USB 3.0 to Gigabit Ethernet Adapter');
  const codes = s.problems.map((p) => p.code);
  assert.deepEqual(codes, ['two_nics_same_subnet', 'public_network', 'firewall_block_rule', 'firewall_no_rule']);
  const two = s.problems[0];
  assert.match(two.message, /Ethernet \(192\.168\.1\.8\) and Ethernet 2 \(192\.168\.1\.10\) — are on the same network 192\.168\.1\.x/);
  assert.equal(s.problems[1].card, 'Ethernet 2');
  assert.equal(s.firewall.blockRules, 2);
  assert.equal(s.firewall.ourRule, false);
  // 5599/5601/5602 are paired analyzers here, 5600 is held by CBCLisM51 → 5603.
  assert.equal(s.suggestedPort, 5603);
});

test('after the fix: our rule present, no block rules → no firewall problems', async () => {
  const { d } = winDiag({ exec: { rules: fx('win-firewall-app-rules-fixed.csv'), profiles: fx('win-get-netconnectionprofile.txt').replace('Public', 'Private') } });
  const s = await d.snapshot();
  assert.deepEqual(s.problems.map((p) => p.code), ['two_nics_same_subnet']);
});

test('portOwner names the program (never kills it); our own PID is recognised; nobody → null', async () => {
  const { d, calls } = winDiag();
  assert.deepEqual(await d.portOwner(5600), { pid: 7412, name: 'CBCLisM51', ours: false });
  assert.deepEqual(await d.portOwner(5599), { pid: 9020, name: 'Prefrontal', ours: true });
  assert.equal(await d.portOwner(5604), null);
  assert.equal(await d.portOwner('5600; calc'), null, 'non-integer port never reaches a command');
  assert.ok(calls.every((c) => !/taskkill|Stop-Process/i.test([c.file, ...c.args].join(' '))));
});

test('portReport: ours / busy (named) / reserved / free', async () => {
  const { d } = winDiag({ canBind: async (p) => ![5599, 5600].includes(p) });
  const r = await d.portReport([5599, 5600, 5357, 5604]);
  assert.deepEqual(r.map((x) => x.state), ['ours', 'busy', 'reserved', 'free']);
  assert.equal(r[1].message, 'Port 5600 is used by CBCLisM51 (PID 7412).');
  assert.equal(r[0].name, 'Mindray BC-5130');
});

test('macOS: no firewall fix (it asks by itself), port owner via lsof, adapters from os only', async () => {
  const d = new nd.NetDiag({
    platform: 'darwin', selfPid: 1,
    exec: async (file, args) => {
      if (file === 'lsof') { assert.deepEqual(args, ['-nP', '-iTCP:5600', '-sTCP:LISTEN']); return { ok: true, code: 0, stdout: fx('mac-lsof-5600.txt') }; }
      if (file === 'arp') return { ok: true, code: 0, stdout: fx('mac-arp-an.txt') };
      throw new Error(`unexpected ${file}`);
    },
    os: { networkInterfaces: () => ({ en0: [{ address: '192.168.1.40', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false }] }), hostname: () => 'lab-mac' },
    canBind: async () => true,
  });
  const s = await d.snapshot();
  assert.equal(s.firewall.supported, false);
  assert.match(s.firewall.message, /macOS asks by itself/);
  assert.deepEqual(s.problems, []);
  assert.equal(s.suggestedPort, 5599);
  assert.deepEqual(await d.portOwner(5600), { pid: 41234, name: 'CBCLisM51', ours: false });
  assert.deepEqual((await d.fixFirewall({ ports: [5600] })).unsupported, true);
  assert.deepEqual((await d.arp()).map((e) => e.ip), ['192.168.1.1', '192.168.1.21']);
});

test('no lab network at all, and a card with a 169.254 address', () => {
  const p = nd.findProblems({ adapters: [{ name: 'Ethernet 2', gateway: null, ipv4: [{ address: '169.254.10.20', netmask: '255.255.0.0', subnet: '169.254.0.0/16' }] }] });
  assert.deepEqual(p.map((x) => x.code), ['no_network', 'apipa']);
  assert.match(p[1].message, /Ethernet 2 has no proper address \(169\.254\.10\.20\)/);
});

// ── the one elevated write ─────────────────────────────────────────────────

test('firewall script: fixed text, validated literals only, our exe, LocalSubnet, Public cards → Private', () => {
  const s = nd.buildFirewallScript({ ports: [5599, 5600, 5603], program: EXE, aliases: ['Ethernet 2'] });
  assert.match(s, /\$program = 'C:\\Users\\lab\\AppData\\Local\\Programs\\Prefrontal\\Prefrontal\.exe'/);
  assert.match(s, /\$ports = @\(5599,5600,5603\)/);
  assert.match(s, /\$aliases = @\('Ethernet 2'\)/);
  assert.match(s, /New-NetFirewallRule -DisplayName \$name -Direction Inbound -Action Allow -Protocol TCP -LocalPort \$ports -Program \$program -RemoteAddress LocalSubnet/);
  assert.match(s, /Where-Object \{ \$_.Direction -eq 'Inbound' -and \$_.Action -eq 'Block' \} \| Remove-NetFirewallRule/, 'only inbound BLOCK rules of this exe are removed');
  assert.match(s, /Set-NetConnectionProfile -InterfaceAlias \$a -NetworkCategory Private/);
  assert.doesNotMatch(s, /Invoke-Expression|iex |DownloadString|Stop-Process|taskkill/i);

  for (const bad of [
    { ports: [80], program: EXE },                                     // below 1024
    { ports: [5600, 'x'], program: EXE },
    { ports: [], program: EXE },
    { ports: Array.from({ length: 25 }, (_, i) => 6000 + i), program: EXE },
    { ports: [5600], program: "C:\\x\\a'; Remove-Item C:\\ -Recurse; '.exe" },
    { ports: [5600], program: 'C:\\x\\$(calc).exe' },
    { ports: [5600], program: '\\\\server\\share\\Prefrontal.exe' },  // UNC path
    { ports: [5600], program: '/Applications/Prefrontal.app' },
    { ports: [5600], program: EXE, aliases: ["Ethernet 2'; calc; '"] },
    { ports: [5600], program: EXE, aliases: ['Eth`ernet'] },
  ]) assert.throws(() => nd.buildFirewallScript(bad), /bad_request/, JSON.stringify(bad));
});

test('elevation: one RunAs launcher carrying only base64; UAC cancelled → nothing changed, said plainly', async () => {
  let launcher = null;
  const { d } = winDiag({ exec: { elevate: (cmd) => { launcher = cmd; return { ok: false, code: nd.UAC_CANCELLED, stdout: '' }; } } });
  const r = await d.fixFirewall({ ports: [5603], aliases: ['Ethernet 2', 'Ethernet', 'Wi-Fi'] });
  assert.equal(r.ok, false);
  assert.equal(r.cancelled, true);
  assert.match(r.error, /Nothing was changed/);
  const m = /-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(launcher);
  assert.ok(m, 'base64 payload');
  const script = Buffer.from(m[1], 'base64').toString('utf16le');
  assert.match(script, /\$aliases = @\('Ethernet 2'\)/, 'only the card Windows reports as Public right now — Ethernet (Private) and Wi-Fi (unknown) dropped');
  assert.match(script, /\$ports = @\(5603\)/);
  assert.equal(launcher.replace(m[1], '<b64>'), "try { $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','<b64>'; exit $p.ExitCode } catch { exit 1223 }");
});

test('elevation: success re-reads the firewall; exit 2 = rule added but a card could not go Private', async () => {
  const ok = winDiag({ exec: { elevate: () => ({ ok: true, code: 0 }), rules: fx('win-firewall-app-rules-fixed.csv') } });
  const r = await ok.d.fixFirewall({ ports: [5603], aliases: ['Ethernet 2'] });
  assert.equal(r.ok, true);
  assert.equal(r.firewall.ourRule, true);
  assert.equal(r.firewall.blockRules, 0);
  const part = winDiag({ exec: { elevate: () => ({ ok: false, code: 2 }) } });
  const p = await part.d.fixFirewall({ ports: [5603], aliases: [] });
  assert.equal(p.ok, true);
  assert.equal(p.partial, true);
  assert.match(p.error, /would not change one network to Private/);
});

test('elevation refuses an exe path that fails the safety check — never prompts', async () => {
  let prompted = false;
  const { exec } = winExec({ elevate: () => { prompted = true; return { ok: true, code: 0 }; } });
  const d = new nd.NetDiag({ platform: 'win32', exec, programPath: 'C:\\evil\\$(x).exe', os: { networkInterfaces: () => WIN_IFACES, hostname: () => 'x' } });
  const r = await d.fixFirewall({ ports: [5603] });
  assert.equal(r.ok, false);
  assert.match(r.error, /safety check/);
  assert.equal(prompted, false);
});

// ── the opt-in LAN probe ───────────────────────────────────────────────────

test('probe: only this PC\'s own private /24, ARP hosts by default, connect-only, once a minute', async () => {
  let now = 1_000_000;
  const tried = [];
  const { d } = winDiag({ now: () => now, connect: async (h, p) => { tried.push(`${h}:${p}`); return h === '192.168.1.21' && p === 5100; } });
  assert.deepEqual(await d.probe({ address: '8.8.8.8' }), { error: 'bad_request: address' }, 'not a private address');
  assert.deepEqual(await d.probe({ address: '192.168.1.99' }), { error: 'bad_request: address' }, 'not one of THIS PC\'s addresses');
  const r = await d.probe({ address: '192.168.1.10', ports: [5100, 5600] });
  assert.deepEqual(r.open, [{ host: '192.168.1.21', port: 5100 }]);
  assert.equal(r.subnet, '192.168.1.0/24');
  // ARP hosts on 192.168.1.x minus our own .8/.10 and broadcast: .1 .24 .30 .21 → × 2 ports.
  assert.equal(r.tried, 8);
  assert.ok(!tried.some((t) => /^192\.168\.1\.(8|10|255):/.test(t)));
  const again = await d.probe({ address: '192.168.1.10' });
  assert.equal(again.error, 'rate_limited');
  now += nd.PROBE_COOLDOWN_MS;
  const wide = await d.probe({ address: '192.168.1.10', ports: [5100], wide: true });
  assert.equal(wide.tried, 252, 'every host of the /24 except .0/.255 and this PC\'s two addresses');
});

test('probe connect-only: the real connector writes nothing and closes', async () => {
  const net = require('net');
  let bytes = 0;
  const srv = net.createServer((s) => s.on('data', (b) => { bytes += b.length; }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const d = new nd.NetDiag({ platform: 'linux' });
  const { connect } = d;
  assert.equal(await connect('127.0.0.1', srv.address().port, 400), true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(bytes, 0);
  srv.close();
});

test('IPC argument checks: ports are integers in range (no strings with junk, no floats, ≤ max); card names short strings', () => {
  assert.deepEqual(nd.portList([5600, 5600, '5603']), [5600, 5603]);
  assert.equal(nd.portList([]), null);
  assert.equal(nd.portList('5600'), null);
  assert.equal(nd.portList([5600.5]), null);
  assert.equal(nd.portList(['5600; calc']), null);
  assert.equal(nd.portList([{}]), null);
  assert.equal(nd.portList([70000]), null);
  assert.equal(nd.portList([80], 24, 1024), null, 'firewall / scan ports must be ≥ 1024');
  assert.equal(nd.portList(Array.from({ length: 13 }, (_, i) => 6000 + i), 12), null);
  assert.deepEqual(nd.aliasList(undefined), []);
  assert.deepEqual(nd.aliasList(['Ethernet 2']), ['Ethernet 2']);
  assert.equal(nd.aliasList('Ethernet 2'), null);
  assert.equal(nd.aliasList([''.padEnd(81, 'x')]), null);
  assert.equal(nd.aliasList([1]), null);
});
