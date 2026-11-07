'use strict';
/**
 * Desktop self-update — electron-updater, generic provider, DigitalOcean
 * Spaces bucket `prefrontal-updates` (blr1, the one public bucket — others
 * are firewall-restricted). See docs/DESKTOP-RELEASES.md for the
 * bucket layout and the release script that fills it.
 *
 * Behaviour (owner's design): check at launch + every 4h, download in the
 * background, NEVER force a restart. The renderer shows its own small
 * non-blocking banner (shared/components/update-banner) driven by the
 * `window.electronAPI.updater` bridge (preload.js); main only decides
 * whether a user-confirmed restart may proceed right now, refusing it while
 * a paired analyzer looks busy (updater-guard.js) and retrying shortly after.
 *
 * Errors are logged quietly (a line to userData/logs/updater.log) — never a
 * popup. Offline / a 404 on a channel with nothing published yet both land
 * on the 'error' event and just get retried on the next 4h tick.
 */
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { resolveFeed } = require('./updater-feed');
const { canRestartNow } = require('./updater-guard');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEFER_RETRY_MS = 5 * 60 * 1000; // re-offer a deferred restart after 5 min

let getWindow = () => null;
let autoUpdaterRef = null;
let feed = null;
let statusSnapshot = () => []; // wired from main.js to instruments.statusSnapshot()
let state = { phase: 'idle', version: null, progress: null, error: null, deferReasons: null };
let deferTimer = null;
let pendingRestart = false;
let intervalHandle = null;
const stateListeners = new Set(); // electron/tray.js: rebuild the menu's "Check for updates" line

function send(payload) {
  const w = getWindow();
  if (w && !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
    w.webContents.send('updater:state', payload);
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  send(state);
  for (const cb of stateListeners) { try { cb(state); } catch { /* a bad listener never breaks updates */ } }
}

/** electron/tray.js subscribes to rebuild its menu label on every phase
 *  change (checking / downloading / ready / deferred). Returns an
 *  unsubscribe function. */
function onState(cb) {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

function log(line) {
  try { console.log(`[updater] ${line}`); } catch { /* noop */ }
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'updater.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* never let logging break updates */ }
}

/** Build the real autoUpdater lazily: a dev run with no feed never touches
 *  electron-updater (which expects a packaged app) at all. */
function ensureAutoUpdater() {
  if (autoUpdaterRef) return autoUpdaterRef;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  // sha512 verification is ON by default (builder-util-runtime's http
  // executor checks it against the manifest) — never set
  // autoUpdater.disableDifferentialDownload-adjacent flags to skip it.
  autoUpdater.logger = {
    info: (m) => log(`info: ${m}`),
    warn: (m) => log(`warn: ${m}`),
    error: (m) => log(`error: ${m}`),
    debug: () => {},
  };
  // NOT passing `channel` here: our channel is the bucket FOLDER (dev /
  // stage / prod, already baked into feed.url); the manifest filename stays
  // the default "latest(-mac).yml" the release script writes.
  autoUpdater.setFeedURL({ provider: 'generic', url: feed.url });
  autoUpdater.on('checking-for-update', () => setState({ phase: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => setState({ phase: 'idle', error: null }));
  autoUpdater.on('update-available', (info) => {
    setState({ phase: 'downloading', version: (info && info.version) || null, progress: 0, error: null });
  });
  autoUpdater.on('download-progress', (p) => setState({ progress: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    setState({ phase: 'ready', version: (info && info.version) || state.version, progress: 100, error: null });
    log(`update ${(info && info.version) || ''} downloaded + verified, ready to install`);
    if (pendingRestart) tryRestart(); // user already clicked Restart while this was in flight
  });
  autoUpdater.on('error', (err) => {
    // Quiet: keep whatever phase we were in if a downloaded update is still
    // good to go, otherwise fall back to idle. Never throw into the app.
    setState({ phase: state.phase === 'ready' ? 'ready' : 'idle', error: (err && err.message) || String(err) });
    log(`error: ${(err && err.stack) || err}`);
  });
  autoUpdaterRef = autoUpdater;
  return autoUpdater;
}

function check() {
  if (!feed) return;
  try { ensureAutoUpdater().checkForUpdates(); } catch (e) { log(`check failed: ${e && e.message}`); }
}

/** The one "Check for updates" click, shared by the tray, the application
 *  menu and the avatar menu: a downloaded update restarts (tryRestart keeps
 *  the instrument-busy guard), anything else starts a check. */
function checkOrRestart() {
  if (state.phase === 'ready') { tryRestart(); return; }
  check();
}

function busySnapshot() {
  try { return canRestartNow(statusSnapshot()); } catch { return { safe: true, reasons: [] }; }
}

/** Called once the user clicks "Restart now" (and again automatically if we
 *  had to defer). Never called on its own initiative. */
function tryRestart() {
  const { safe, reasons } = busySnapshot();
  if (!safe) {
    pendingRestart = true;
    setState({ phase: 'deferred', deferReasons: reasons });
    log(`restart deferred — busy: ${reasons.join(', ')}`);
    if (deferTimer) clearTimeout(deferTimer);
    deferTimer = setTimeout(() => {
      deferTimer = null;
      if (pendingRestart) tryRestart();
    }, DEFER_RETRY_MS);
    if (deferTimer.unref) deferTimer.unref();
    return { ok: false, deferred: true, reasons };
  }
  pendingRestart = false;
  if (deferTimer) { clearTimeout(deferTimer); deferTimer = null; }
  log('restarting to install update');
  // electron-updater's quitAndInstall ultimately calls the plain
  // Electron app.quit() (ElectronAppAdapter.quit), which fires 'before-quit'
  // before any window's own 'close' handler — so main.js's hide-on-close
  // (mainWindow.on('close', …)) already steps aside once calls.setQuitting()
  // is set there. Setting it explicitly here too, before quitAndInstall even
  // starts, means the real quit never depends on that event-ordering detail:
  // the window closing for an update install must never be swallowed into a
  // tray-hide.
  try { require('./calls').setQuitting(); } catch { /* calls.js always loads before this fires in main.js */ }
  // isSilent=false (the installer's own, minimal UI — NSIS is silent by
  // default on Windows regardless), isForceRunAfter=true relaunches once
  // installed. Never skip this to force a hard kill-and-hope.
  setImmediate(() => ensureAutoUpdater().quitAndInstall(false, true));
  return { ok: true };
}

/**
 * @param {() => Electron.BrowserWindow|null} windowGetter
 * @param {() => object[]} [statusSnapshotFn] instruments.statusSnapshot
 */
function register(windowGetter, statusSnapshotFn) {
  getWindow = windowGetter || (() => null);
  if (typeof statusSnapshotFn === 'function') statusSnapshot = statusSnapshotFn;

  ipcMain.handle('updater:getState', () => state);
  // Only our own window may start a check (same rule as fullscreen.js).
  ipcMain.handle('updater:check', (e) => {
    const w = getWindow();
    if (!(w && !w.isDestroyed() && e && e.sender === w.webContents)) throw new Error('forbidden');
    checkOrRestart();
    return state;
  });
  ipcMain.handle('updater:restartNow', () => {
    if (state.phase !== 'ready') return { ok: false, reason: 'not-ready' };
    return tryRestart();
  });
}

/** Resolve this build's channel + start checking. No-op (quietly) for a dev
 *  run or a build with no pfDataProfile (unknown channel). */
function start() {
  let profile = process.env.PF_DATA_PROFILE;
  if (!profile) { try { profile = require('../package.json').pfDataProfile; } catch { profile = undefined; } }
  // PF_UPDATE_BASE: TEST-ONLY escape hatch to point a real packaged build at
  // a local static server instead of the real bucket (see
  // docs/DESKTOP-RELEASES.md's round-trip test). Never set in a real release.
  feed = resolveFeed({ pfDataProfile: profile, platform: process.platform, base: process.env.PF_UPDATE_BASE || undefined });
  if (!app.isPackaged) {
    log(`updates disabled — dev run (app.isPackaged is false)`);
    return;
  }
  if (!feed) {
    log(`updates disabled — no channel for this build (pfDataProfile=${profile || 'none'}, platform=${process.platform})`);
    return;
  }
  log(`updates enabled — channel=${feed.channel} os=${feed.os} url=${feed.url}`);
  check();
  intervalHandle = setInterval(check, CHECK_INTERVAL_MS);
  if (intervalHandle.unref) intervalHandle.unref();
}

/** Tests only. */
function _resetForTests() {
  autoUpdaterRef = null;
  feed = null;
  state = { phase: 'idle', version: null, progress: null, error: null, deferReasons: null };
  pendingRestart = false;
  if (deferTimer) { clearTimeout(deferTimer); deferTimer = null; }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  stateListeners.clear();
}

module.exports = {
  register, start, check, getState: () => state, onState,
  // electron/tray.js's "Restart to install" click (when phase === 'ready')
  // calls this directly — same function the IPC handler calls, so the
  // renderer's update banner and the tray can never apply two different
  // "is it safe to restart" decisions.
  restartNow: () => tryRestart(),
  checkOrRestart,
  _resetForTests,
};
