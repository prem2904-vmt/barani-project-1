/*
 * Desktop notifications, badge, launch-at-login and wake-up for the Electron
 * app (Windows + macOS). Calls live in calls.js and chat in chat-notify.js;
 * this module owns what they share:
 *
 *   • settings  — <userData>/notify-settings.json (calls / messages / alerts /
 *                 sound / openAtLogin), read + written by the renderer's
 *                 avatar-menu toggles through IPC;
 *   • window state → renderer ('window:state'): with backgroundThrottling off
 *                 the page ALWAYS reports document.visibilityState 'visible'
 *                 (even minimised / hidden in the tray), so the renderer
 *                 learns "is the user looking" from here instead;
 *   • bell alerts (NotificationCatalog events) as native notifications, one
 *                 per event tag (repeats replace), click → focus + open target;
 *   • unread badge: macOS dock count, Windows taskbar overlay dot, tray dot +
 *                 tooltip;
 *   • launch at login (on by default in the installed app), hidden in the
 *                 tray; a one-time "still running" hint on first close;
 *   • sleep / wake / unlock → 'app:resume' so the renderer revives its
 *                 SignalR sockets at once instead of waiting for a retry.
 *
 * The app cannot be notified while it is fully quit (no APNs / FCM / Web Push
 * on desktop) — hence start-at-login + close-to-tray + an explicit Quit.
 */
const { app, Notification, ipcMain, nativeImage, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const core = require('./notify-core');

let getMain = () => null;
let settings = null;          // sanitized settings (lazy)
let firstRun = false;
let state = { trayHintShown: false };
let lastCounts = { chat: 0, bell: 0 };
let overlayImg = null;
let resumeTimer = null;
const live = new Map();       // tag → Notification (kept referenced so clicks fire)

function profileName() {
  let p = process.env.PF_DATA_PROFILE;
  if (!p) { try { p = require('../package.json').pfDataProfile; } catch { p = undefined; } }
  return typeof p === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(p) ? p : null;
}

/** Launch-at-login is only offered by the installed app (an unpackaged
 *  `electron .` would register the bare Electron binary). */
function loginSupported() { return app.isPackaged; }

/** Side-by-side test builds (pfDataProfile) default to NOT starting at login
 *  so they never pile up next to the real app. */
function defaults() {
  return { ...core.DEFAULTS, openAtLogin: loginSupported() && !profileName() };
}

function file() { return path.join(app.getPath('userData'), 'notify-settings.json'); }

function load() {
  if (settings) return settings;
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { raw = null; }
  firstRun = !raw;
  settings = core.sanitizeSettings(raw && raw.settings, defaults());
  state = { trayHintShown: !!(raw && raw.trayHintShown) };
  return settings;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ settings, trayHintShown: state.trayHintShown }, null, 2));
  } catch (err) { console.warn('[notify] settings not saved', err && err.message); }
}

function getSettings() { return { ...load() }; }

function applyLoginItem(open) {
  if (!loginSupported()) return;
  try { app.setLoginItemSettings(core.loginItemOptions(process.platform, open)); }
  catch (err) { console.warn('[notify] login item', err && err.message); }
}

/** Shared by the IPC handler (any patch from the avatar menu) and
 *  setOpenAtLogin() (the tray's "Start at login" checkbox) — ONE place that
 *  merges + persists + (for openAtLogin) syncs the OS, so the two surfaces
 *  can never drift onto two different stored values. */
function applyPatch(patch) {
  const p = core.sanitizePatch(patch);
  settings = core.sanitizeSettings({ ...load(), ...p }, defaults());
  save();
  if ('openAtLogin' in p) applyLoginItem(settings.openAtLogin);
  return settingsForRenderer();
}

/** What the OS actually has (the user may have removed it in System
 *  Settings / Task Manager → Startup) wins over our stored flag. */
function osOpenAtLogin() {
  if (!loginSupported()) return false;
  try {
    const o = core.loginItemOptions(process.platform, true);
    return !!app.getLoginItemSettings(o.args ? { args: o.args } : undefined).openAtLogin;
  } catch { return load().openAtLogin; }
}

function settingsForRenderer() {
  const s = getSettings();
  if (loginSupported()) s.openAtLogin = osOpenAtLogin();
  return { settings: s, platform: process.platform, loginSupported: loginSupported() };
}

function launchedHidden() {
  let loginSettings = null;
  if (process.platform === 'darwin' && loginSupported()) {
    try { loginSettings = app.getLoginItemSettings(); } catch { loginSettings = null; }
  }
  return core.launchedHidden({ argv: process.argv, platform: process.platform, loginSettings });
}

function mainWin() {
  const w = getMain();
  return w && !w.isDestroyed() ? w : null;
}

function send(channel, payload) {
  const w = mainWin();
  if (w) w.webContents.send(channel, payload);
}

function restore() {
  const w = mainWin();
  if (!w) return;
  try { require('./calls').restore(w); } catch { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
}

// ── Native bell notification ─────────────────────────────────────────────
function show(tag, opts, onClick) {
  if (!Notification.isSupported()) return null;
  const prev = live.get(tag);
  if (prev) { try { prev.close(); } catch { /* gone */ } live.delete(tag); }
  const n = new Notification(opts);
  n.on('click', () => { restore(); if (onClick) onClick(); });
  n.on('close', () => { if (live.get(tag) === n) live.delete(tag); });
  live.set(tag, n);
  // Bounded: the oldest reference is dropped (the OS keeps showing it).
  if (live.size > 50) live.delete(live.keys().next().value);
  n.show();
  return n;
}

function showAlert(info) {
  const a = core.sanitizeAlert(info);
  if (!a) return null;
  const s = load();
  if (!s.alerts) return null;
  const critical = a.critical;
  return show(`alert:${a.tag}`, {
    title: a.title,
    body: a.body,
    silent: !s.sound,
    urgency: critical ? 'critical' : 'normal',          // Linux / Windows
    timeoutType: critical ? 'never' : 'default',        // Windows / Linux
  }, () => send('notify:action', {
    type: 'alert', kind: a.kind, referenceType: a.referenceType, referenceId: a.referenceId,
  }));
}

// ── Badge ────────────────────────────────────────────────────────────────
function overlay() {
  if (!overlayImg) overlayImg = nativeImage.createFromBitmap(core.dotBitmap(16), { width: 16, height: 16 });
  return overlayImg;
}

function applyBadge(counts = lastCounts) {
  lastCounts = { chat: counts.chat || 0, bell: counts.bell || 0 };
  const total = core.badgeTotal(lastCounts);
  try {
    if (process.platform === 'darwin') {
      app.setBadgeCount(total);                                   // dock number
    } else if (process.platform === 'win32') {
      const w = mainWin();
      if (w) w.setOverlayIcon(total ? overlay() : null, total ? `${core.badgeLabel(total)} unread` : '');
    } else {
      app.setBadgeCount(total);                                   // Unity launchers
    }
  } catch (err) { console.warn('[notify] badge', err && err.message); }
  // The tray ICON itself (instruments + chat/bell unread, one attention dot,
  // one tooltip) is owned entirely by electron/tray.js — this just hands it
  // the unread count rather than touching the Tray object directly, so the
  // two causes of "needs attention" can never fight over the last setImage.
  try { require('./tray').setUnreadCount(total); } catch { /* tray not created yet (very early boot) */ }
  return total;
}

// ── Wiring ───────────────────────────────────────────────────────────────
function fromMain(e) {
  const w = mainWin();
  return !!w && e.sender === w.webContents;
}

function register(getWindow) {
  getMain = getWindow;
  load();
  ipcMain.handle('notify:settings:get', (e) => (fromMain(e) ? settingsForRenderer() : null));
  ipcMain.handle('notify:settings:set', (e, patch) => (fromMain(e) ? applyPatch(patch) : null));
  ipcMain.handle('window:state:get', (e) => (fromMain(e) ? core.windowState(mainWin()) : null));
  ipcMain.on('notify:alert', (e, info) => { if (fromMain(e)) showAlert(info); });
  ipcMain.on('notify:badge', (e, counts) => {
    if (!fromMain(e) || !counts || typeof counts !== 'object') return;
    applyBadge({ chat: counts.chat, bell: counts.bell });
  });
}

/** Wire one main window (called from createWindow). */
function attach(win) {
  const push = () => send('window:state', core.windowState(win));
  for (const ev of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) win.on(ev, push);
  win.webContents.on('did-finish-load', () => { push(); applyBadge(); });
  // First time the window is closed to the tray: say so once, so nobody
  // thinks they quit (and wonders why calls still ring).
  win.on('close', () => {
    let quitting = false;
    try { quitting = require('./calls').isQuitting(); } catch { quitting = false; }
    if (quitting || state.trayHintShown) return;
    state.trayHintShown = true;
    save();
    const how = process.platform === 'darwin'
      ? 'To quit, choose Prefrontal → Quit (⌘Q) or use the menu bar icon.'
      : 'To quit, right-click the Prefrontal icon in the system tray and choose Quit.';
    show('tray-hint', {
      title: 'Prefrontal is still running',
      body: `Instruments keep sending results. Find it in the menu bar/system tray. ${how}`,
      silent: true,
    });
  });
}

function onResume() {
  if (resumeTimer) return;
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    send('app:resume', { at: Date.now() });
  }, 1500);   // let the network come back first
}

/** After app ready + window created. */
function start() {
  load();
  // Launch-at-login is ON by default: applied once on the first run of the
  // installed app; afterwards the avatar-menu toggle (or the OS) decides.
  if (firstRun) {
    save();
    if (settings.openAtLogin) applyLoginItem(true);
  }
  for (const ev of ['resume', 'unlock-screen', 'user-did-become-active']) {
    try { powerMonitor.on(ev, onResume); } catch { /* not on this OS */ }
  }
  // The dev / side-by-side build can fire sample notifications to check the
  // OS side without a server (never in the production app: needs a profile
  // or an unpackaged run AND the env flag).
  if (process.env.PF_NOTIFY_DEBUG === '1' && (!app.isPackaged || profileName())) {
    setTimeout(debugFire, 2500);
  }
}

function debugFire() {
  const out = { supported: Notification.isSupported(), settings: getSettings(), platform: process.platform };
  out.alert = !!showAlert({
    kind: 'report_ready', title: 'Report ready', body: 'A report is ready to review (debug sample).',
    referenceType: 'report', referenceId: 'debug-1', critical: false,
  });
  try {
    const calls = require('./calls');
    out.call = calls.debugNativeCall ? !!calls.debugNativeCall() : false;
  } catch { out.call = false; }
  out.badge = applyBadge({ chat: 3, bell: 2 });
  console.log('[notify-debug]', JSON.stringify(out));
}

module.exports = {
  register, attach, start, launchedHidden, getSettings, applyBadge, showAlert,
  // electron/tray.js "Start at login" checkbox: the SAME stored setting +
  // OS sync the avatar-menu toggle uses (applyPatch), so the two surfaces
  // can never disagree about whether login-item is on.
  isOpenAtLogin: osOpenAtLogin,
  setOpenAtLogin: (open) => applyPatch({ openAtLogin: !!open }),
  loginSupported,
  // for tests
  _reset: () => { settings = null; firstRun = false; live.clear(); lastCounts = { chat: 0, bell: 0 }; },
};
