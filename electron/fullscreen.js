/*
 * Kiosk-style full screen for the main window (owner: the desktop app behaves
 * like a Windows kiosk app).
 *
 *   • The main window OPENS full screen on every launch — Windows, macOS and
 *     Linux. Nothing is remembered: leaving full screen lasts until the next
 *     launch (owner's default; the app has no window-state preference store).
 *   • Esc leaves full screen — decided in the RENDERER (desktop-window
 *     .service.ts), because only the page knows whether the Esc closed a
 *     dialog / popover / pf-select / keypad first. It asks us through the
 *     validated 'window:setFullScreen' IPC below.
 *   • Back in: F11 (Windows / Linux), Ctrl+Cmd+F or the green button (macOS),
 *     or the "Full screen" item in the avatar menu (same IPC).
 *   • Every change (any path, incl. the OS green button) is pushed to the
 *     renderer on 'window:fullscreen' so the top-strip clock follows it.
 *
 * Only the main window's own webContents may drive this (same sender check as
 * calls.js / instruments) — the call window and anything else are refused.
 */
const { ipcMain } = require('electron');

let getWindow = () => null;

/** BrowserWindow constructor options for the main window. */
function windowOptions() {
  return { fullscreen: true, fullscreenable: true };
}

function live(w) {
  return !!(w && !w.isDestroyed());
}

/** Only our own window may ask. */
function trusted(e) {
  const w = getWindow();
  return live(w) && !!e && e.sender === w.webContents;
}

function send(w, on) {
  if (live(w) && w.webContents && !w.webContents.isDestroyed()) w.webContents.send('window:fullscreen', !!on);
}

/** The platform's "enter / toggle full screen" key: F11 on Windows / Linux,
 *  Ctrl+Cmd+F on macOS. `input` is Electron's before-input-event Input. */
function isToggleKey(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return false;
  if (platform === 'darwin') {
    return !!(input.meta && input.control && !input.alt && !input.shift && String(input.key).toLowerCase() === 'f');
  }
  return input.key === 'F11' && !input.meta && !input.control && !input.alt && !input.shift;
}

// The main window was hidden while full screen on macOS (see hide()): it
// re-enters full screen when it is shown again (tray / dock / second launch).
let reenterOnShow = false;

/** Wire one main window. Call from createWindow(), right after the window is
 *  created (before ready-to-show). */
function attach(win) {
  win.on('enter-full-screen', () => send(win, true));
  win.on('leave-full-screen', () => send(win, false));
  // A reload / first load subscribes after the window already went full
  // screen: hand it the current state.
  win.webContents.on('did-finish-load', () => send(win, win.isFullScreen()));
  // F11 / Ctrl+Cmd+F handled here (not by the default menu) so the key works
  // with or without a menu bar and can't double-toggle.
  win.webContents.on('before-input-event', (event, input) => {
    if (!isToggleKey(input)) return;
    event.preventDefault();
    win.setFullScreen(!win.isFullScreen());
  });
  win.on('show', () => {
    if (!reenterOnShow) return;
    reenterOnShow = false;
    if (!win.isFullScreen()) win.setFullScreen(true);
  });
  // Launch: the constructor option opens it full screen; macOS can drop the
  // flag for a window created hidden (show:false), so assert it on first show.
  win.once('ready-to-show', () => {
    setImmediate(() => { if (live(win) && !win.isFullScreen()) win.setFullScreen(true); });
  });
}

/** Close = hide. On macOS a window hidden while in native full screen leaves an
 *  empty black Space behind, so leave full screen first, hide once the
 *  animation ends, and re-enter on the next show. Elsewhere hide directly. */
function hide(win, platform = process.platform) {
  if (!live(win)) return;
  if (platform === 'darwin' && win.isFullScreen()) {
    reenterOnShow = true;
    win.once('leave-full-screen', () => { if (live(win)) win.hide(); });
    win.setFullScreen(false);
    return;
  }
  win.hide();
}

/**
 * Register the IPC handlers. Call once, before the window loads.
 * @param {() => Electron.BrowserWindow|null} windowGetter
 */
function register(windowGetter) {
  getWindow = windowGetter;
  ipcMain.handle('window:isFullScreen', (e) => {
    if (!trusted(e)) throw new Error('forbidden');
    return getWindow().isFullScreen();
  });
  ipcMain.handle('window:setFullScreen', (e, on) => {
    if (!trusted(e)) throw new Error('forbidden');
    if (typeof on !== 'boolean') throw new Error('invalid');
    const w = getWindow();
    if (w.isFullScreen() !== on) w.setFullScreen(on);
    return on;
  });
}

module.exports = { windowOptions, attach, register, hide, isToggleKey };
