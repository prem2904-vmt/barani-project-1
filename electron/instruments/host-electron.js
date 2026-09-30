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

let manager = null;
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
  manager = new ConnectorManager({ baseDir: path.join(app.getPath('userData'), 'instruments'), secrets });
  manager.on('status', (s) => send('instruments:status', s));
  manager.on('listen', (ev) => send('instruments:listen', ev));
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

module.exports = { register, start, stop, secrets };
