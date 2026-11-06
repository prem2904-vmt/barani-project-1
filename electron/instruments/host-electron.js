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
const os = require('os');
const { app, ipcMain, safeStorage, dialog } = require('electron');
const { ConnectorManager } = require('./core/manager');
const { NetDiag, portList } = require('./netdiag');
const { makeDiagHandlers, listenTransportOk } = require('./diag-ipc');
const { SupportSession, askApproval } = require('./support-session');

let manager = null;
let diag = null;
let support = null;
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
    if (!listenTransportOk(o.transport)) return bad('transport');
    return manager.listenStart({ transport: o.transport, link: obj(o.link) || undefined, parser: obj(o.parser) || undefined });
  });
  handle('instruments:listenStop', (id) => manager.listenStop(str(id, 64)));
  handle('instruments:preview', (raw, config) => manager.preview(str(raw, 512 * 1024) || '', obj(config) || {}));

  // ── "Connect an analyzer" wizard (netdiag.js). Read-only except
  // diagFixFirewall, which runs ONE fixed, UAC-elevated script — only after
  // MAIN's own dialog (diag-ipc.js) said yes; the renderer's confirm is a
  // courtesy, not the gate. Every argument is re-validated here.
  const diagIpc = makeDiagHandlers({ diag, manager, showMessageBox: (...a) => dialog.showMessageBox(...a), getWindow: () => getWindow() });
  handle('instruments:diagSnapshot', () => diag.snapshot());
  handle('instruments:diagPorts', (ports) => {
    const list = portList(ports);
    return list ? diag.portReport(list) : bad('ports');
  });
  handle('instruments:diagNextPort', () => diag.nextFreePort());
  handle('instruments:diagFixFirewall', (p) => diagIpc.fixFirewall(p));
  handle('instruments:diagArp', () => diag.arp());
  handle('instruments:diagProbe', (p) => diagIpc.probe(p));
  handle('instruments:diagScanStart', (p) => {
    const ports = portList((obj(p) || {}).ports, 12, 1024);
    return ports ? manager.scanStart({ ports }) : bad('ports');
  });
  handle('instruments:diagScanPort', (p) => diagIpc.scanSetPort(p));
  handle('instruments:diagScanStop', (id) => (GUID_RE.test(String(id || '')) ? manager.scanStop(String(id)) : { ports: [] }));

  // ── "Allow Prefrontal support" (beta `support`, support-session.js). The
  // lab starts it; the app only reaches OUT (one SignalR connection from
  // main to /hubs/support, reconnecting with backoff) while it is active;
  // every CHANGE asks MAIN's own dialog (Deny = default). Arguments are
  // re-validated in the module; the token never goes back to the page.
  support = new SupportSession({
    diag,
    manager,
    pcId: os.hostname(),
    approve: (q) => askApproval(q, { showMessageBox: (...a) => dialog.showMessageBox(...a), getWindow: () => getWindow() }),
  });
  support.on('change', (st) => send('instruments:support', st));
  handle('instruments:supportStart', (p) => support.startFromIpc(p));
  handle('instruments:supportStop', () => support.stop('lab'));
  handle('instruments:supportStatus', () => support.state());
  handle('instruments:supportToken', (t) => support.setToken(t));
}

/** Start every paired connector (app ready). Never throws into main. */
async function start() {
  if (!manager) return;
  try { await manager.load(); } catch (e) { console.warn('[instruments] start failed:', e && e.message); }
}

/** Stop connectors and listen sessions (before quit). */
async function stop() {
  if (support) { try { await support.stop('quit'); } catch { /* quitting anyway */ } }
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
