'use strict';
/**
 * Electron host for Prefrontal Bridge local access (bridge-api v1, B.3/B.5):
 * mDNS discovery + pinned HTTPS to a Bridge's local API, for the renderer's
 * `window.electronAPI.bridges` (preload.js). Every IPC call is accepted only
 * from the main window's own web contents. No hotspot join on the desktop.
 */
const { ipcMain } = require('electron');
const { BridgeDiscovery } = require('./discovery');
const { localRequest } = require('./local-request');

let getWindow = () => null;
let discovery = null;

function send(channel, payload) {
  const w = getWindow();
  if (w && !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
}

/** Only our own window may drive discovery / local requests. */
function trusted(e) {
  const w = getWindow();
  return !!(w && !w.isDestroyed() && e && e.sender === w.webContents);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) throw new Error('forbidden');
    return fn(...args);
  });
}

/** @param {() => Electron.BrowserWindow|null} windowGetter */
function register(windowGetter) {
  getWindow = windowGetter;
  handle('bridges:discoverStart', () => {
    if (!discovery) {
      discovery = new BridgeDiscovery();
      discovery.on('found', (ev) => send('bridges:found', ev));
      discovery.on('lost', (ev) => send('bridges:lost', ev));
      discovery.on('error', (err) => console.warn('[bridges] mdns', err && err.message));
    }
    try { discovery.start(); return { ok: true }; } catch (err) { return { ok: false, error: String(err && err.message) }; }
  });
  handle('bridges:discoverStop', () => { if (discovery) discovery.stop(); return { ok: true }; });
  handle('bridges:localRequest', (req) => localRequest(req));
}

function stop() { if (discovery) discovery.stop(); }

module.exports = { register, stop };
