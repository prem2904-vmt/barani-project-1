'use strict';
/**
 * "Connect an analyzer" — what this PC's network looks like, what is in the
 * way, and (with the user's OK) the one firewall fix. Host module (plain
 * Node, no Electron import — host-electron.js wires it to IPC), Windows
 * first, macOS / Linux degrade gracefully.
 *
 * Safety rules (next-phase plan §5, reviewed):
 *   - Every command is `execFile` with a FIXED program + FIXED arguments; the
 *     only values ever placed in an argument are integers (a port, a PID)
 *     validated first. No shell, no string-built command lines.
 *   - Reading never needs admin. The ONE write is fixFirewall(): one UAC
 *     prompt (Start-Process -Verb RunAs) running a fixed script passed as
 *     -EncodedCommand (no temp file another process could swap before the
 *     elevated run). Its only inputs — ports, this exe's own path, network
 *     card names Windows itself reported — are validated against strict
 *     patterns and embedded as single-quoted literals.
 *   - A program holding a port is NAMED, never killed.
 *   - The LAN probe is opt-in, connect-only (no byte is ever written), only
 *     on a private /24 one of THIS PC's own cards is on, rate-limited.
 *
 * Parsers are pure and unit-tested on captured outputs
 * (test/fixtures/netdiag/*, modelled on the Arun Lab PC: two cards on
 * 192.168.1.x, an old LIS program on port 5600, a Public analyzer network).
 */
const { execFile } = require('child_process');
const nodeOs = require('os');
const nodeNet = require('net');
const { isPrivateIpv4 } = require('../bridges/local-request');

/** The Windows Firewall rule this module owns (one, replaced on every fix). */
const RULE_NAME = 'Prefrontal analyzers (inbound)';
/** Ports the wizard hands out to analyzers (analyzer = TCP client → us). */
const PORT_RANGE = { start: 5599, end: 5650 };
/** LIS ports analyzers commonly LISTEN on (we dial them) — the opt-in probe. */
const COMMON_LIS_PORTS = [5000, 5100, 5150, 5555, 5600, 6000, 9000, 10001];
const PROBE_COOLDOWN_MS = 60 * 1000;
const PROBE_TIMEOUT_MS = 400;
const PROBE_CONCURRENCY = 16;
const EXEC_TIMEOUT_MS = 15 * 1000;
/** Windows ERROR_CANCELLED — the user said No to the UAC prompt. */
const UAC_CANCELLED = 1223;

const lines = (t) => String(t || '').split(/\r\n|\r|\n/);
const validPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

// ── parsers (pure) ─────────────────────────────────────────────────────────

/** `ipconfig /all` → [{ name, kind, description, mac, dhcp, mediaDisconnected, ipv4: [{address, netmask}], gateway }] */
function parseIpconfig(text) {
  const out = [];
  let cur = null;
  let lastKey = null;
  for (const raw of lines(text)) {
    const head = /^(\S.*?) adapter (.+):\s*$/.exec(raw);
    if (head) {
      cur = { name: head[2].trim(), kind: head[1].trim(), description: null, mac: null, dhcp: null, mediaDisconnected: false, ipv4: [], gateway: null };
      out.push(cur);
      lastKey = null;
      continue;
    }
    if (!cur || !raw.trim()) continue;
    const kv = /^\s{2,}([^:]+?)[ .]*:\s?(.*)$/.exec(raw);
    if (kv && /\.\s/.test(raw.slice(0, raw.indexOf(':') + 1) + ' ')) {
      const key = kv[1].trim().toLowerCase();
      const val = kv[2].trim();
      lastKey = key;
      if (key === 'description') cur.description = val || null;
      else if (key === 'physical address') cur.mac = val || null;
      else if (key === 'dhcp enabled') cur.dhcp = /^yes$/i.test(val);
      else if (key === 'media state') cur.mediaDisconnected = /disconnected/i.test(val);
      else if (key === 'ipv4 address' || key === 'autoconfiguration ipv4 address') {
        const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(val);
        if (m) cur.ipv4.push({ address: m[1], netmask: null });
      } else if (key === 'subnet mask') {
        const last = cur.ipv4[cur.ipv4.length - 1];
        if (last && !last.netmask) last.netmask = val || null;
      } else if (key === 'default gateway') {
        const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(val);
        cur.gateway = m ? m[1] : null;
      }
      continue;
    }
    // continuation line (a second gateway / DNS server)
    if (lastKey === 'default gateway' && !cur.gateway) {
      const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(raw);
      if (m) cur.gateway = m[1];
    }
  }
  return out;
}

function splitHostPort(s) {
  const v = String(s || '');
  const i = v.lastIndexOf(':');
  if (i < 0) return { host: v, port: null };
  return { host: v.slice(0, i).replace(/^\[|\]$/g, ''), port: Number(v.slice(i + 1)) };
}

/** `netstat -ano -p TCP` → [{ local, localPort, remote, remotePort, state, pid }] */
function parseNetstat(text) {
  const out = [];
  for (const raw of lines(text)) {
    const m = /^\s*TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/i.exec(raw);
    if (!m) continue;
    const l = splitHostPort(m[1]);
    const r = splitHostPort(m[2]);
    out.push({ local: l.host, localPort: l.port, remote: r.host, remotePort: r.port, state: m[3].toUpperCase(), pid: Number(m[4]) });
  }
  return out;
}

/** `Get-NetTCPConnection` default table → same shape as parseNetstat. */
function parseGetNetTcpConnection(text) {
  const out = [];
  const STATE = { LISTEN: 'LISTENING', ESTABLISHED: 'ESTABLISHED', TIMEWAIT: 'TIME_WAIT', CLOSEWAIT: 'CLOSE_WAIT' };
  for (const raw of lines(text)) {
    const m = /^\s*(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+([A-Za-z]+)\s+(?:([A-Za-z]+)\s+)?(\d+)\s*$/.exec(raw);
    if (!m) continue;
    out.push({
      local: m[1], localPort: Number(m[2]), remote: m[3], remotePort: Number(m[4]),
      state: STATE[m[5].toUpperCase()] || m[5].toUpperCase(), pid: Number(m[7]),
    });
  }
  return out;
}

/** Minimal CSV line splitter for tasklist / ConvertTo-Csv ("a","b,c"). */
function csvRow(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** `tasklist /FO CSV /NH` → [{ name, pid }] ("INFO: No tasks…" → []). */
function parseTasklist(text) {
  const out = [];
  for (const raw of lines(text)) {
    if (!raw.startsWith('"')) continue;
    const f = csvRow(raw.trim());
    const pid = Number(f[1]);
    if (f[0] && Number.isInteger(pid)) out.push({ name: f[0], pid });
  }
  return out;
}

/** `Get-NetConnectionProfile | Format-List …` → [{ name, alias, index, category, ipv4 }] */
function parseNetConnectionProfile(text) {
  const out = [];
  let cur = null;
  for (const raw of lines(text)) {
    const m = /^(\w+)\s*:\s*(.*)$/.exec(raw.trim());
    if (!m) { if (!raw.trim()) cur = null; continue; }
    if (!cur) { cur = { name: null, alias: null, index: null, category: null, ipv4: null }; out.push(cur); }
    const [, k, v] = m;
    if (k === 'Name') cur.name = v.trim() || null;
    else if (k === 'InterfaceAlias') cur.alias = v.trim() || null;
    else if (k === 'InterfaceIndex') cur.index = Number(v) || null;
    else if (k === 'NetworkCategory') cur.category = v.trim() || null;
    else if (k === 'IPv4Connectivity') cur.ipv4 = v.trim() || null;
  }
  return out.filter((p) => p.alias);
}

/** `arp -a` (Windows) or `arp -an` (macOS / Linux) → [{ ip, mac, type, iface }] */
function parseArp(text) {
  const out = [];
  let iface = null;
  for (const raw of lines(text)) {
    const w = /^Interface:\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(raw);
    if (w) { iface = w[1]; continue; }
    const win = /^\s+(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\w+)/i.exec(raw);
    if (win) { out.push({ ip: win[1], mac: win[2].toLowerCase().replace(/-/g, ':'), type: win[3].toLowerCase(), iface }); continue; }
    const mac = /^\S+\s+\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-f:]+)\s+on\s+(\S+)(.*)$/i.exec(raw);
    if (mac) {
      const m = mac[2].split(':');
      if (m.length !== 6) continue;
      out.push({ ip: mac[1], mac: m.map((x) => x.padStart(2, '0')).join(':').toLowerCase(), type: /permanent/.test(mac[4]) ? 'static' : 'dynamic', iface: mac[3] });
    }
  }
  return out;
}

/** `netsh advfirewall show allprofiles state` → { domain, private, public } (true = ON). */
function parseFirewallState(text) {
  const out = { domain: null, private: null, public: null };
  let cur = null;
  for (const raw of lines(text)) {
    const h = /^(Domain|Private|Public) Profile Settings:/i.exec(raw.trim());
    if (h) { cur = h[1].toLowerCase(); continue; }
    const s = /^State\s+(ON|OFF)\b/i.exec(raw.trim());
    if (s && cur) out[cur] = s[1].toUpperCase() === 'ON';
  }
  return out;
}

/** `netsh int ipv4 show excludedportrange protocol=tcp` → [{ start, end }] */
function parseExcludedPorts(text) {
  const out = [];
  for (const raw of lines(text)) {
    const m = /^\s*(\d{1,5})\s+(\d{1,5})(\s+\*)?\s*$/.exec(raw);
    if (m) out.push({ start: Number(m[1]), end: Number(m[2]) });
  }
  return out;
}

/** ConvertTo-Csv of Get-NetFirewallRule → [{ name, direction, action, enabled, profile }] */
function parseFirewallRulesCsv(text) {
  const rows = lines(text).filter((l) => l.trim().startsWith('"'));
  if (!rows.length) return [];
  const head = csvRow(rows[0].trim()).map((h) => h.toLowerCase());
  const idx = (k) => head.indexOf(k);
  return rows.slice(1).map((r) => {
    const f = csvRow(r.trim());
    return {
      name: f[idx('displayname')] || '',
      direction: f[idx('direction')] || '',
      action: f[idx('action')] || '',
      enabled: /^true$/i.test(f[idx('enabled')] || ''),
      profile: f[idx('profile')] || '',
    };
  });
}

/** `lsof -nP -iTCP:<port> -sTCP:LISTEN` → [{ name, pid }] */
function parseLsof(text) {
  const out = [];
  for (const raw of lines(text).slice(1)) {
    const f = raw.trim().split(/\s+/);
    if (f.length > 2 && /^\d+$/.test(f[1])) out.push({ name: f[0], pid: Number(f[1]) });
  }
  return out;
}

// ── network math + checks (pure) ───────────────────────────────────────────

function ipToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
const intToIp = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const maskBits = (mask) => { const n = ipToInt(mask); if (n == null) return null; let b = 0; for (let i = 31; i >= 0; i--) { if (n & (1 << i)) b++; else break; } return b; };

/** "192.168.1.10" + "255.255.255.0" → "192.168.1.0/24" */
function subnetOf(address, netmask) {
  const a = ipToInt(address);
  const bits = maskBits(netmask || '255.255.255.0');
  if (a == null || bits == null) return null;
  const m = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return `${intToIp((a & m) >>> 0)}/${bits}`;
}

/**
 * Merge os.networkInterfaces() with `ipconfig /all` (Windows): one row per
 * card with its IPv4s, gateway, DHCP and cable state.
 */
function mergeAdapters(osIfaces = {}, ipconfig = []) {
  const rows = new Map();
  for (const [name, addrs] of Object.entries(osIfaces || {})) {
    const v4 = (addrs || []).filter((a) => (a.family === 'IPv4' || a.family === 4) && !a.internal);
    if (!v4.length) continue;
    rows.set(name, {
      name, description: null, mac: v4[0].mac && v4[0].mac !== '00:00:00:00:00:00' ? v4[0].mac : null,
      dhcp: null, gateway: null, up: true,
      ipv4: v4.map((a) => ({ address: a.address, netmask: a.netmask, subnet: subnetOf(a.address, a.netmask) })),
    });
  }
  for (const a of ipconfig || []) {
    const r = rows.get(a.name);
    if (r) {
      r.description = a.description; r.dhcp = a.dhcp; r.gateway = a.gateway;
      if (!r.mac && a.mac) r.mac = a.mac.toLowerCase().replace(/-/g, ':');
    } else if (a.ipv4.length && !a.mediaDisconnected) {
      rows.set(a.name, {
        name: a.name, description: a.description, mac: a.mac ? a.mac.toLowerCase().replace(/-/g, ':') : null,
        dhcp: a.dhcp, gateway: a.gateway, up: true,
        ipv4: a.ipv4.map((x) => ({ address: x.address, netmask: x.netmask, subnet: subnetOf(x.address, x.netmask) })),
      });
    }
  }
  return [...rows.values()];
}

/**
 * Problems a layman can act on, each { code, severity, message, fix? }:
 *   no_network, apipa, two_nics_same_subnet, public_network, firewall_block_rule.
 */
function findProblems({ adapters = [], profiles = [], firewall = null } = {}) {
  const out = [];
  const v4 = adapters.flatMap((a) => a.ipv4.map((x) => ({ ...x, card: a.name, gateway: a.gateway })));
  if (!v4.some((x) => isPrivateIpv4(x.address) && !x.address.startsWith('169.254.'))) {
    out.push({ code: 'no_network', severity: 'error', message: 'This PC has no network address on a lab network. Plug in the network cable (or join the lab Wi-Fi).' });
  }
  for (const x of v4.filter((y) => y.address.startsWith('169.254.'))) {
    out.push({ code: 'apipa', severity: 'warning', card: x.card, message: `${x.card} has no proper address (${x.address}): the cable is in, but nothing gave it an IP. Give this card a fixed IP on the analyzer's network.` });
  }
  const bySubnet = new Map();
  for (const x of v4.filter((y) => y.subnet && !y.address.startsWith('169.254.'))) {
    const l = bySubnet.get(x.subnet) || [];
    if (!l.some((y) => y.card === x.card)) l.push(x);
    bySubnet.set(x.subnet, l);
  }
  for (const [subnet, cards] of bySubnet) {
    if (cards.length < 2) continue;
    const names = cards.map((c) => `${c.card} (${c.address})`).join(' and ');
    out.push({
      code: 'two_nics_same_subnet', severity: 'warning', subnet, cards: cards.map((c) => c.card),
      message: `Two network cards — ${names} — are on the same network ${subnet.replace(/\.0\/24$/, '.x')}. Windows may answer the analyzer through the wrong card. Give the analyzer cable its own network (for example 192.168.10.x on both this card and the analyzer), or unplug one of them.`,
    });
  }
  for (const p of profiles.filter((q) => /^public$/i.test(q.category || ''))) {
    out.push({
      code: 'public_network', severity: 'warning', card: p.alias, fix: 'firewall',
      message: `${p.alias} is set as a Public network, so Windows blocks analyzers on it. Fix sets it to Private.`,
    });
  }
  if (firewall && firewall.blockRules > 0) {
    out.push({
      code: 'firewall_block_rule', severity: 'error', fix: 'firewall',
      message: `Windows Firewall has ${firewall.blockRules === 1 ? 'a rule' : `${firewall.blockRules} rules`} blocking Prefrontal (someone pressed Cancel on the firewall question). Fix removes ${firewall.blockRules === 1 ? 'it' : 'them'}.`,
    });
  }
  if (firewall && firewall.supported && !firewall.ourRule) {
    out.push({ code: 'firewall_no_rule', severity: 'warning', fix: 'firewall', message: 'Windows Firewall has no rule letting analyzers reach Prefrontal yet. Fix adds one (only for Prefrontal, only the analyzer ports, only this local network).' });
  }
  return out;
}

const excluded = (port, ranges) => (ranges || []).some((r) => port >= r.start && port <= r.end);

// ── the one elevated write (Windows) ───────────────────────────────────────

const PROGRAM_RE = /^[A-Za-z]:\\[^'"`$\r\n\t;|&<>%*?]+\.exe$/i;
const ALIAS_RE = /^[A-Za-z0-9 _.()#-]{1,80}$/;
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * The fixed firewall script. Inputs are validated here (throws bad_request):
 *   ports    1–24 integers 1024–65535
 *   program  this exe's own absolute path (drive:\…\X.exe, no quotes/metachars)
 *   aliases  0–8 network card names Windows reported as Public
 * What it does, nothing else:
 *   1. removes inbound BLOCK rules whose program is exactly this exe;
 *   2. replaces our one rule: inbound TCP allow, program = this exe,
 *      local ports = the analyzer ports, remote = LocalSubnet only. It is
 *      on every profile because a direct analyzer cable is an
 *      "Unidentified network" that Windows may flip back to Public after a
 *      reboot — the program + port + local-subnet scope is what keeps it
 *      narrow, not the profile;
 *   3. sets each named card's network profile to Private (skips a
 *      domain-managed one).
 */
function buildFirewallScript({ ports, program, aliases = [] } = {}) {
  const list = [...new Set((ports || []).map(Number))];
  if (!list.length || list.length > 24 || !list.every((p) => Number.isInteger(p) && p >= 1024 && p <= 65535)) throw new Error('bad_request: ports');
  if (!PROGRAM_RE.test(String(program || ''))) throw new Error('bad_request: program');
  const cards = [...new Set(aliases || [])];
  if (cards.length > 8 || !cards.every((a) => ALIAS_RE.test(String(a)))) throw new Error('bad_request: aliases');
  return [
    "$ErrorActionPreference = 'Stop'",
    `$name = ${psq(RULE_NAME)}`,
    `$program = ${psq(program)}`,
    `$ports = @(${list.join(',')})`,
    `$aliases = @(${cards.map(psq).join(',')})`,
    '$code = 0',
    "try { Get-NetFirewallApplicationFilter -Program $program -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } | Remove-NetFirewallRule } catch { $code = 3 }",
    'Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule',
    "New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ports -Program $program -RemoteAddress LocalSubnet -Profile Domain,Private,Public | Out-Null",
    "foreach ($a in $aliases) { try { $p = Get-NetConnectionProfile -InterfaceAlias $a -ErrorAction Stop; if ($p.NetworkCategory -eq 'Public') { Set-NetConnectionProfile -InterfaceAlias $a -NetworkCategory Private } } catch { $code = 2 } }",
    'exit $code',
  ].join('\r\n');
}

/** PowerShell -EncodedCommand payload (base64 of UTF-16LE). */
function encodePowerShell(script) { return Buffer.from(String(script), 'utf16le').toString('base64'); }

/** The non-elevated launcher: one UAC prompt, waits, passes the exit code back. */
function elevationCommand(encoded) {
  if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new Error('bad_request: encoded');
  return `try { $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'; exit $p.ExitCode } catch { exit ${UAC_CANCELLED} }`;
}

// ── IPC argument checks (host-electron.js; pure, tested) ───────────────────

/** A list of TCP ports from the renderer: integers in [min, 65535], 1..max of them, else null. */
function portList(v, max = 24, min = 1) {
  if (!Array.isArray(v) || !v.length || v.length > max) return null;
  if (!v.every((p) => typeof p === 'number' || (typeof p === 'string' && /^\d{1,5}$/.test(p)))) return null;
  const out = v.map(Number);
  return out.every((p) => Number.isInteger(p) && p >= min && p <= 65535) ? [...new Set(out)] : null;
}

/** Network card names from the renderer — strings, ≤ 8, 1–80 chars (re-checked against Windows' own list before use). */
function aliasList(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 8) return null;
  return v.every((a) => typeof a === 'string' && a.length > 0 && a.length <= 80) ? v : null;
}

// ── the host-facing class ──────────────────────────────────────────────────

function defaultExec(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: EXEC_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

const PS = ['-NoProfile', '-NonInteractive', '-Command'];

class NetDiag {
  /**
   * @param {object} [o]
   * @param {string} [o.platform]          process.platform
   * @param {Function} [o.exec]            (file, args, opts) → Promise<{ok, code, stdout, stderr}>
   * @param {object} [o.os]                { networkInterfaces, hostname }
   * @param {Function} [o.connect]         (host, port, timeoutMs) → Promise<boolean> (probe; tests)
   * @param {Function} [o.canBind]         (port) → Promise<boolean>
   * @param {Function} [o.now]
   * @param {string} [o.programPath]       this app's exe (firewall rule scope)
   * @param {number} [o.selfPid]
   * @param {Function} [o.usedEndpoints]   () → [{ port?, path?, name }] (ConnectorManager.usedEndpoints)
   */
  constructor(o = {}) {
    this.platform = o.platform || process.platform;
    this.exec = o.exec || defaultExec;
    this.os = o.os || nodeOs;
    this.connect = o.connect || tcpConnectOnly;
    this.canBind = o.canBind || canBindPort;
    this.now = o.now || Date.now;
    this.programPath = o.programPath || process.execPath;
    this.selfPid = o.selfPid || process.pid;
    this.usedEndpoints = o.usedEndpoints || (() => []);
    this.lastProbeAt = 0;
    this.fixing = false;
  }

  get windows() { return this.platform === 'win32'; }

  async _run(file, args) {
    try { return await this.exec(file, args); } catch (e) { return { ok: false, code: -1, stdout: '', stderr: String(e && e.message) }; }
  }

  async adapters() {
    let ipc = [];
    if (this.windows) { const r = await this._run('ipconfig', ['/all']); if (r.ok) ipc = parseIpconfig(r.stdout); }
    let ifs = {};
    try { ifs = this.os.networkInterfaces(); } catch { ifs = {}; }
    return mergeAdapters(ifs, ipc);
  }

  async profiles() {
    if (!this.windows) return [];
    const r = await this._run('powershell.exe', [...PS, 'Get-NetConnectionProfile | Format-List Name,InterfaceAlias,InterfaceIndex,NetworkCategory,IPv4Connectivity']);
    return r.ok ? parseNetConnectionProfile(r.stdout) : [];
  }

  async excludedPorts() {
    if (!this.windows) return [];
    const r = await this._run('netsh', ['int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp']);
    return r.ok ? parseExcludedPorts(r.stdout) : [];
  }

  /** Who listens on `port` — { pid, name, ours } or null. Never kills anything. */
  async portOwner(port) {
    if (!validPort(Number(port))) return null;
    const p = Number(port);
    if (this.windows) {
      const ns = await this._run('netstat', ['-ano', '-p', 'TCP']);
      const row = ns.ok ? parseNetstat(ns.stdout).find((x) => x.localPort === p && x.state === 'LISTENING') : null;
      if (!row || !row.pid) return null;
      const ours = row.pid === this.selfPid;
      const tl = await this._run('tasklist', ['/FO', 'CSV', '/NH', '/FI', `PID eq ${row.pid}`]);
      const t = tl.ok ? parseTasklist(tl.stdout)[0] : null;
      return { pid: row.pid, name: t ? t.name.replace(/\.exe$/i, '') : null, ours };
    }
    const r = await this._run('lsof', ['-nP', `-iTCP:${p}`, '-sTCP:LISTEN']);
    const row = r.ok ? parseLsof(r.stdout)[0] : null;
    return row ? { pid: row.pid, name: row.name, ours: row.pid === this.selfPid } : null;
  }

  async firewall() {
    if (!this.windows) {
      return { supported: false, message: this.platform === 'darwin' ? 'macOS asks by itself the first time an analyzer connects — choose Allow.' : 'Check this computer\'s firewall allows the analyzer ports.' };
    }
    const [st, profiles, rules] = await Promise.all([
      this._run('netsh', ['advfirewall', 'show', 'allprofiles', 'state']),
      this.profiles(),
      // The exe path travels in an environment variable, never in the command text.
      this.exec('powershell.exe', [...PS, 'Get-NetFirewallApplicationFilter -Program $env:PF_PROGRAM -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Select-Object DisplayName,Direction,Action,Enabled,Profile | ConvertTo-Csv -NoTypeInformation'],
        { env: { ...process.env, PF_PROGRAM: this.programPath } }).catch(() => ({ ok: false, stdout: '' })),
    ]);
    const list = rules.ok ? parseFirewallRulesCsv(rules.stdout) : [];
    const inbound = list.filter((r) => /^inbound$/i.test(r.direction) && r.enabled);
    return {
      supported: true,
      enabled: st.ok ? parseFirewallState(st.stdout) : { domain: null, private: null, public: null },
      profiles,
      rules: list,
      blockRules: inbound.filter((r) => /^block$/i.test(r.action)).length,
      ourRule: inbound.some((r) => r.name === RULE_NAME && /^allow$/i.test(r.action)),
    };
  }

  /**
   * The one fix (Windows): ONE UAC prompt. `aliases` must be cards Windows
   * reports as Public right now (re-read here, never trusted from the UI).
   * @returns {Promise<{ ok: boolean, cancelled?: boolean, partial?: boolean, error?: string, firewall?: object }>}
   */
  async fixFirewall({ ports, aliases = [] } = {}) {
    if (!this.windows) return { ok: false, unsupported: true, error: 'The firewall fix is for Windows.' };
    if (this.fixing) return { ok: false, error: 'A firewall fix is already running.' };
    this.fixing = true;
    try {
      const publicNow = new Set((await this.profiles()).filter((p) => /^public$/i.test(p.category || '')).map((p) => p.alias));
      const cards = (Array.isArray(aliases) ? aliases : []).filter((a) => typeof a === 'string' && publicNow.has(a) && ALIAS_RE.test(a));
      const script = buildFirewallScript({ ports, program: this.programPath, aliases: cards });
      const r = await this._run('powershell.exe', [...PS, elevationCommand(encodePowerShell(script))]);
      const firewall = await this.firewall();
      if (r.code === UAC_CANCELLED) return { ok: false, cancelled: true, error: 'Windows did not get permission (the question was cancelled). Nothing was changed.', firewall };
      if (r.code === 0) return { ok: true, firewall };
      if (r.code === 2 || r.code === 3) return { ok: true, partial: true, error: r.code === 2 ? 'The rule was added, but Windows would not change one network to Private (it may be managed by your IT).' : 'The rule was added, but an old blocking rule could not be removed.', firewall };
      return { ok: false, error: 'Windows could not apply the firewall fix.', firewall };
    } catch (e) {
      return { ok: false, error: /^bad_request/.test(String(e && e.message)) ? 'This PC\'s details did not pass the safety check, so nothing was changed.' : String(e && e.message) };
    } finally {
      this.fixing = false;
    }
  }

  async arp() {
    const r = await this._run('arp', this.windows ? ['-a'] : ['-an']);
    return r.ok ? parseArp(r.stdout).filter((e) => isPrivateIpv4(e.ip) && e.mac !== 'ff:ff:ff:ff:ff:ff' && !e.ip.endsWith('.255')) : [];
  }

  /**
   * Next port to hand to a new analyzer: free to bind, not used by a paired
   * analyzer / open listen on this PC, not in a Windows-reserved range.
   */
  async nextFreePort({ start = PORT_RANGE.start, end = PORT_RANGE.end, skip = [] } = {}) {
    const used = new Set(this.usedEndpoints().map((u) => u.port).filter(Boolean).concat(skip.map(Number)));
    const ranges = await this.excludedPorts();
    for (let p = start; p <= end; p++) {
      if (used.has(p) || excluded(p, ranges)) continue;
      if (await this.canBind(p)) return p;
    }
    return null;
  }

  /** Per port: free / used by an analyzer here / used by another program (named). */
  async portReport(ports) {
    const list = [...new Set((ports || []).map(Number))].filter(validPort).slice(0, 24);
    const used = this.usedEndpoints();
    const ranges = await this.excludedPorts();
    const out = [];
    for (const port of list) {
      const mine = used.find((u) => u.port === port);
      if (mine) { out.push({ port, state: 'ours', name: mine.name }); continue; }
      if (excluded(port, ranges)) { out.push({ port, state: 'reserved', message: `Windows has reserved port ${port}.` }); continue; }
      if (await this.canBind(port)) { out.push({ port, state: 'free' }); continue; }
      const owner = await this.portOwner(port);
      out.push({ port, state: 'busy', pid: owner && owner.pid, name: owner && owner.name, ours: !!(owner && owner.ours),
        message: owner && owner.name ? `Port ${port} is used by ${owner.name}${owner.pid ? ` (PID ${owner.pid})` : ''}.` : `Port ${port} is used by another program.` });
    }
    return out;
  }

  /** Everything step 1 ("This PC") shows. */
  async snapshot() {
    const [adapters, firewall] = await Promise.all([this.adapters(), this.firewall()]);
    const profiles = firewall.profiles || [];
    const problems = findProblems({ adapters, profiles, firewall });
    const suggestedPort = await this.nextFreePort();
    let hostname = '';
    try { hostname = this.os.hostname(); } catch { hostname = ''; }
    return { platform: this.platform, hostname, adapters, profiles, firewall, problems, suggestedPort };
  }

  /**
   * Opt-in, connect-only probe for an analyzer that LISTENS (we would dial
   * it): only hosts on the private /24 of `address`, which must be one of
   * THIS PC's own addresses; by default only hosts already in the ARP table
   * (`wide` = every host of the /24). Once a minute at most.
   */
  async probe({ address, ports, wide = false } = {}) {
    const t = this.now();
    if (t - this.lastProbeAt < PROBE_COOLDOWN_MS) return { error: 'rate_limited', retryInMs: PROBE_COOLDOWN_MS - (t - this.lastProbeAt) };
    const own = (await this.adapters()).flatMap((a) => a.ipv4.map((x) => x.address));
    if (!isPrivateIpv4(address) || !own.includes(address) || address.startsWith('169.254.')) return { error: 'bad_request: address' };
    const list = [...new Set((Array.isArray(ports) && ports.length ? ports : COMMON_LIS_PORTS).map(Number))].filter(validPort).slice(0, 8);
    if (!list.length) return { error: 'bad_request: ports' };
    this.lastProbeAt = t;
    const base = address.split('.').slice(0, 3).join('.');
    let hosts;
    if (wide) hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
    else hosts = (await this.arp()).map((e) => e.ip).filter((ip) => ip.startsWith(`${base}.`));
    hosts = [...new Set(hosts)].filter((h) => !own.includes(h) && !h.endsWith('.0') && !h.endsWith('.255'));
    const jobs = hosts.flatMap((host) => list.map((port) => ({ host, port })));
    const open = [];
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const j = jobs[i++];
        if (await this.connect(j.host, j.port, PROBE_TIMEOUT_MS)) open.push(j);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, jobs.length) }, worker));
    open.sort((a, b) => (ipToInt(a.host) - ipToInt(b.host)) || (a.port - b.port));
    return { subnet: `${base}.0/24`, tried: jobs.length, hosts: hosts.length, open };
  }
}

/** Connect, then close at once — not one byte is written. */
function tcpConnectOnly(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const s = nodeNet.connect({ host, port });
    let done = false;
    const end = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}

/** Can this PC listen on `port` right now (all cards)? */
function canBindPort(port) {
  return new Promise((resolve) => {
    const srv = nodeNet.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: '0.0.0.0', exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

module.exports = {
  NetDiag, RULE_NAME, PORT_RANGE, COMMON_LIS_PORTS, PROBE_COOLDOWN_MS, UAC_CANCELLED,
  parseIpconfig, parseNetstat, parseGetNetTcpConnection, parseTasklist, parseNetConnectionProfile, parseArp,
  parseFirewallState, parseExcludedPorts, parseFirewallRulesCsv, parseLsof,
  subnetOf, mergeAdapters, findProblems, buildFirewallScript, encodePowerShell, elevationCommand,
  portList, aliasList,
};
