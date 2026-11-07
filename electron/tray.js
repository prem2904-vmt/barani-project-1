'use strict';
/**
 * The desktop tray (Windows system tray / macOS menu bar) — the ONE owner
 * of the Tray object: its icon (quiet mono Template on macOS / colour on
 * Windows, or either's pre-baked "attention" variant with the red dot —
 * electron/assets/gen-tray-icons.js), its tooltip, and its context menu.
 * electron/tray-model.js (pure) builds the plain menu template; this file
 * turns it into a real Electron Menu and wires each `action` id.
 *
 * Facts the menu is built from:
 *   - electron/instruments/host-electron.js (manager.status() stream) —
 *     per-instrument connector state, queue, unmatched, server reachability;
 *   - electron/updater.js (onState) — the "Check for updates" label;
 *   - electron/notify.js (isOpenAtLogin / setOpenAtLogin) — the SAME stored
 *     login-item setting the avatar-menu toggle uses (one source of truth);
 *   - electron/notify.js applyBadge() → setUnreadCount() — chat/bell unread
 *     folds into the SAME attention icon/tooltip instead of fighting it for
 *     the last `tray.setImage()`/`setToolTip()` call.
 *
 * macOS keeps its normal dock behaviour — main.js's `app.on('activate', …)`
 * already reopens the window on a dock click; this tray is additive.
 */
const { app, Tray, Menu, nativeImage, clipboard, Notification } = require('electron');
const os = require('os');
const path = require('path');
const model = require('./tray-model');
const diagnostics = require('./diagnostics');
const { InstrumentConnectivityWatcher } = require('./instrument-notify');

const ASSET_DIR = path.join(__dirname, 'assets/tray');
const REBUILD_DEBOUNCE_MS = 250;

let tray = null;
let getMain = () => null;
let instruments = [];       // latest connector.status() per instrumentId
let unreadCount = 0;
let updaterState = null;
let offUpdaterState = null;
let rebuildTimer = null;
let images = null;
let connectivityWatcher = null;

function loadImages() {
  if (images) return images;
  const template = nativeImage.createFromPath(path.join(ASSET_DIR, 'iconTemplate.png'));
  template.setTemplateImage(true); // macOS recolours this itself for light/dark menu bars
  const color = nativeImage.createFromPath(path.join(ASSET_DIR, 'icon.png'));
  const attention = nativeImage.createFromPath(path.join(ASSET_DIR, 'icon-attention.png'));
  images = { template, color, attention };
  return images;
}

function safeNotify() { try { return require('./notify'); } catch { return null; } }
function safeCalls() { try { return require('./calls'); } catch { return null; } }
function safeUpdater() { try { return require('./updater'); } catch { return null; } }
function safeInstruments() { try { return require('./instruments/host-electron'); } catch { return null; } }

function restoreWindow() {
  const win = getMain();
  if (!win || win.isDestroyed()) return;
  const calls = safeCalls();
  if (calls) { try { calls.restore(win); return; } catch { /* fall through */ } }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Restores the window, then asks the renderer to navigate — reuses the
 *  bridge preload.js already reserves for this (`onMenuAction` /
 *  'menu-action'), so no new IPC channel is needed. */
function navigate(routePath) {
  restoreWindow();
  const win = getMain();
  if (win && !win.isDestroyed()) win.webContents.send('menu-action', { action: 'navigate', path: routePath });
}

function refreshIcon() {
  if (!tray) return;
  const imgs = loadImages();
  const attention = unreadCount > 0 || model.hasAttention(instruments);
  const quiet = process.platform === 'darwin' ? imgs.template : imgs.color;
  tray.setImage(attention ? imgs.attention : quiet);
  tray.setToolTip(unreadCount > 0 ? `Prefrontal — ${unreadCount} unread` : model.tooltip(instruments));
}

function handleAction(action) {
  switch (action) {
    case 'open':
      restoreWindow();
      break;
    case 'openInstruments':
      navigate('/admin/instruments');
      break;
    case 'openUnmatched':
      navigate('/lab/analyzer-results');
      break;
    case 'checkUpdates': {
      const updater = safeUpdater();
      if (!updater) break;
      updater.checkOrRestart();
      break;
    }
    case 'toggleLogin': {
      const notify = safeNotify();
      if (notify) notify.setOpenAtLogin(!notify.isOpenAtLogin());
      rebuild();
      break;
    }
    case 'copyDiagnostics':
      clipboard.writeText(buildDiagnosticsText());
      break;
    case 'quit': {
      const calls = safeCalls();
      if (calls) calls.setQuitting();
      app.quit();
      break;
    }
    default:
      break;
  }
}

function buildDiagnosticsText() {
  return diagnostics.formatDiagnostics({
    appVersion: app.getVersion(),
    platform: process.platform,
    osRelease: os.release(),
    hostname: os.hostname(),
    instruments,
    serverStatus: model.serverStatusLine(instruments, Date.now()) || 'unknown',
  });
}

function toElectronTemplate(template) {
  return template.map((item) => {
    if (item.type === 'separator') return { type: 'separator' };
    const out = { label: item.label, enabled: item.enabled !== false };
    if (item.type === 'checkbox') { out.type = 'checkbox'; out.checked = !!item.checked; }
    if (item.action) out.click = () => handleAction(item.action);
    return out;
  });
}

function menuState() {
  const notify = safeNotify();
  return {
    version: app.getVersion(),
    instruments,
    updater: updaterState,
    startAtLogin: notify ? !!notify.isOpenAtLogin() : false,
    loginSupported: notify ? !!notify.loginSupported() : false,
  };
}

function rebuild() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(toElectronTemplate(model.buildMenuModel(menuState()))));
  refreshIcon();
}

/** Status ticks arrive one instrument at a time, often in a burst (every
 *  paired connector heartbeats close together) — coalesce into one rebuild. */
function scheduleRebuild() {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuild(); }, REBUILD_DEBOUNCE_MS);
  if (rebuildTimer.unref) rebuildTimer.unref();
}

function showConnectivityNotification({ name, cls }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: cls === 'up' ? 'Instrument reconnected' : 'Instrument disconnected',
    body: name,
    silent: true,
  });
  n.on('click', () => restoreWindow());
  n.show();
}

function onInstrumentStatus(status) {
  if (!status || !status.instrumentId) return;
  const idx = instruments.findIndex((i) => i.instrumentId === status.instrumentId);
  if (idx >= 0) instruments[idx] = status; else instruments.push(status);
  if (connectivityWatcher) connectivityWatcher.report(status.instrumentId, status.name, status.state, status.link);
  scheduleRebuild();
}

/**
 * Create the tray. Call once from main.js, after instruments.start() (so
 * the initial snapshot isn't empty) and instruments.register() (always true
 * by then — register() runs at module load, before app.whenReady).
 * @param {() => Electron.BrowserWindow|null} windowGetter
 */
function create(windowGetter) {
  if (tray) return tray;
  getMain = windowGetter || (() => null);
  const imgs = loadImages();
  tray = new Tray(process.platform === 'darwin' ? imgs.template : imgs.color);
  // Windows: a single click opens the window (spec). macOS: a click opens
  // the menu — Electron does that natively once setContextMenu() is called,
  // so no handler is wired there (one would just fight the native open).
  if (process.platform !== 'darwin') tray.on('click', () => restoreWindow());

  const inst = safeInstruments();
  instruments = inst ? inst.statusSnapshot() : [];
  connectivityWatcher = new InstrumentConnectivityWatcher({ onFire: showConnectivityNotification });
  // Seed today's already-paired instruments as "first sightings" — app
  // launch finding an instrument already connected must never read as a
  // "reconnect" notification.
  for (const s of instruments) connectivityWatcher.report(s.instrumentId, s.name, s.state, s.link);
  if (inst) inst.onStatus(onInstrumentStatus);

  const updater = safeUpdater();
  if (updater) {
    updaterState = updater.getState();
    offUpdaterState = updater.onState((s) => { updaterState = s; scheduleRebuild(); });
  }

  rebuild();
  return tray;
}

/** notify.js applyBadge() → the one place unread chat/bell count reaches
 *  the tray icon (folds into the SAME attention/tooltip rendering as the
 *  instrument state, rather than racing it for the icon). */
function setUnreadCount(n) {
  unreadCount = Math.max(0, Number(n) || 0);
  refreshIcon();
}

function getTray() { return tray; }

/** Tests / app shutdown — not called in the running app (Electron tears
 *  down the Tray on exit); exported so tests don't leak timers/listeners
 *  across runs. */
function destroy() {
  if (connectivityWatcher) { connectivityWatcher.clear(); connectivityWatcher = null; }
  if (offUpdaterState) { offUpdaterState(); offUpdaterState = null; }
  if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
  if (tray) { try { tray.destroy(); } catch { /* already gone */ } }
  tray = null;
  images = null;
  instruments = [];
  unreadCount = 0;
  updaterState = null;
}

module.exports = { create, getTray, setUnreadCount, destroy, handleAction, buildDiagnosticsText };
