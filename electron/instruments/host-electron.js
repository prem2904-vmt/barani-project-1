'use strict';
/**
 * Electron host for the instrument connector core.
 *
 * - Runs in the MAIN process, so connectors keep running while the window is
 *   closed / hidden in the tray (the app is single-instance + tray-resident).
 * - Device keys are encrypted with Electron safeStorage (Keychain on macOS,
 *   DPAPI on Windows, libsecret on Linux) before they touch disk.
 * - The renderer stays sandboxed: it reaches this only through the narrow
 *   `window.electronAPI.instruments` bridge in preload.js, and every IPC
 *   call is accepted only from the main window's own web contents.
 *
 * All protocol logic lives in ./core (plain Node) — nothing here is needed
 * by the future Raspberry Pi host (./host-node.js).
 */
const path = require('path');
const { app, ipcMain, safeStorage } = require('electron');
const { ConnectorManager } = require('./core/manager');
const { NetDiag, portList, aliasList } = require('./netdiag');

let manager = null;
let diag = null;
let getWindow = () => null;

const secrets = {
  encrypt(s) {
    if (safeStorage.isEncryptionAvailable()) return `ss:${safeStorage.encryptString(String(s)).toString('base64')}`;
    // No OS keychain (rare: headless Linux) — the file is still 0600.
    return `plain:${s}`;
  },
  decrypt(s) {
    const v = String(s || '');
    if (v.startsWith('ss:')) return safeStorage.decryptString(Buffer.from(v.slice(3), 'base64'));
    return v.replace(/^plain:/, '');
  },
};

function send(channel, payload) {
  const w = getWindow();
  if (w && !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
}

/** Only our own window may drive the connector. */
function trusted(e) {
  const w = getWindow();
  return !!(w && !w.isDestroyed() && e && e.sender === w.webContents);
}

const str = (v, max = 4096) => (typeof v === 'string' && v.length <= max ? v : null);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (what) => ({ error: `bad_request: ${what}` });

function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) throw new Error('forbidden');
    if (!manager) throw new Error('instrument connector not started');
    return fn(...args);
  });
}

/**
 * Register IPC handlers. Call once, before the window loads.
 * @param {() => Electron.BrowserWindow|null} windowGetter
 */
function register(windowGetter) {
  getWindow = windowGetter;
  // Netdiag names a program holding an analyzer port (never kills it) — the
  // connector core asks through `portOwner` and stays shell-free itself.
  diag = new NetDiag({ usedEndpoints: () => (manager ? manager.usedEndpoints() : []) });
  manager = new ConnectorManager({
    baseDir: path.join(app.getPath('userData'), 'instruments'),
    secrets,
    connectorOpts: { portOwner: (port) => diag.portOwner(port) },
  });
  manager.on('status', (s) => send('instruments:status', s));
  manager.on('listen', (ev) => send('instruments:listen', ev));
  manager.on('diag', (ev) => send('instruments:diag', ev));
  manager.on('error', (err) => console.warn('[instruments]', err && err.message));

  handle('instruments:list', () => manager.list());
  handle('instruments:status', () => manager.status());
  handle('instruments:pair', (p) => {
    const o = obj(p) || {};
    return manager.pair({ instrumentId: str(o.instrumentId, 64), deviceKey: str(o.deviceKey, 512), apiUrl: str(o.apiUrl, 512), name: str(o.name, 200) || undefined });
  });
  handle('instruments:unpair', (id) => manager.unpair(str(id, 64)));
  handle('instruments:reload', (id) => manager.reload(str(id, 64)));
  handle('instruments:rawLog', (id, limit) => manager.rawLog(str(id, 64), Number(limit) || 200));
  handle('instruments:listSerialPorts', () => manager.listSerialPorts());
  handle('instruments:listenStart', (opts) => {
    const o = obj(opts);
    if (!o || !obj(o.transport)) return { error: 'transport required' };
    return manager.listenStart({ transport: o.transport, link: obj(o.link) || undefined, parser: obj(o.parser) || undefined });
  });
  handle('instruments:listenStop', (id) => manager.listenStop(str(id, 64)));
  handle('instruments:preview', (raw, config) => manager.preview(str(raw, 512 * 1024) || '', obj(config) || {}));

  // ── "Connect an analyzer" wizard (netdiag.js). Read-only except
  // diagFixFirewall, which runs ONE fixed, UAC-elevated script after the
  // user confirmed in the UI. Every argument is re-validated here.
  handle('instruments:diagSnapshot', () => diag.snapshot());
  handle('instruments:diagPorts', (ports) => {
    const list = portList(ports);
    return list ? diag.portReport(list) : bad('ports');
  });
  handle('instruments:diagNextPort', () => diag.nextFreePort());
  handle('instruments:diagFixFirewall', async (p) => {
    const o = obj(p) || {};
    const asked = o.ports == null ? [] : portList(o.ports, 24, 1024);
    const aliases = aliasList(o.aliases);
    if (!asked || !aliases) return bad('fix');
    // The rule covers the analyzer ports this PC uses + the ones asked for.
    const mine = manager.usedEndpoints().map((u) => u.port).filter((x) => Number.isInteger(x) && x >= 1024);
    const ports = [...new Set([...mine, ...asked])].slice(0, 24);
    if (!ports.length) return bad('ports');
    return diag.fixFirewall({ ports, aliases });
  });
  handle('instruments:diagArp', () => diag.arp());
  handle('instruments:diagProbe', (p) => {
    const o = obj(p) || {};
    const address = str(o.address, 15);
    const ports = o.ports == null ? undefined : portList(o.ports, 8);
    if (!address || ports === null) return bad('probe');
    return diag.probe({ address, ports, wide: o.wide === true });
  });
  handle('instruments:diagScanStart', (p) => {
    const ports = portList((obj(p) || {}).ports, 12, 1024);
    return ports ? manager.scanStart({ ports }) : bad('ports');
  });
  handle('instruments:diagScanStop', (id) => (GUID_RE.test(String(id || '')) ? manager.scanStop(String(id)) : { ports: [] }));
}

/** Start every paired connector (app ready). Never throws into main. */
async function start() {
  if (!manager) return;
  try { await manager.load(); } catch (e) { console.warn('[instruments] start failed:', e && e.message); }
}

/** Stop connectors and listen sessions (before quit). */
async function stop() {
  if (!manager) return;
  try { await manager.stopAll(); } catch { /* quitting anyway */ }
}

/** Every paired connector's current status() snapshot — [] before start() /
 *  if nothing is paired. Used by the updater's "don't restart mid-run"
 *  guard (electron/updater-guard.js); never thrown into the caller. */
function statusSnapshot() {
  try { return manager ? manager.status() : []; } catch { return []; }
}

/** statusSnapshot() plus one pseudo entry per open listen / "find the
 *  analyzer" capture (in-flight work too) — what the updater's restart
 *  guard reads. The tray uses statusSnapshot() (real instruments only). */
function guardSnapshot() {
  try {
    if (!manager) return [];
    const captures = Array.from({ length: manager.activeCaptures() }, () => ({ name: 'Analyzer capture', state: 'listening' }));
    return [...manager.status(), ...captures];
  } catch { return []; }
}

/** Live status ticks for electron/tray.js (menu rebuild, attention icon,
 *  the debounced disconnect/reconnect notification). Call AFTER register()
 *  (main.js does: instruments.register → updater.register → tray.create) —
 *  the manager is created inside register(), and the tray only needs the
 *  stream from app launch onward (statusSnapshot() covers the state as of
 *  "right now" for anything created first). */
function onStatus(cb) {
  if (manager) manager.on('status', cb);
}

module.exports = { register, start, stop, secrets, statusSnapshot, guardSnapshot, onStatus };
