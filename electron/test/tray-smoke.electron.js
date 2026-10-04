/*
 * Electron main-process smoke for the tray (run by tray-smoke.test.js
 * through the electron binary): loads the REAL electron/main.js with an
 * isolated userData folder, patches the Tray prototype to RECORD what the
 * running app asks it to render (Electron's Tray has no getters for its own
 * context menu / tooltip), drives electron/tray.js's exported actions, and
 * prints one JSON line "PF_TRAY_SMOKE {...}".
 */
const { app, Tray, Notification, clipboard, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tray-smoke-'));
app.setPath('userData', userData);

const setImageCalls = [];
const setToolTipCalls = [];
const setContextMenuCalls = [];
Tray.prototype.setImage = function setImage(img) { setImageCalls.push(img); };
Tray.prototype.setToolTip = function setToolTip(t) { setToolTipCalls.push(t); };
Tray.prototype.setContextMenu = function setContextMenu(m) { setContextMenuCalls.push(m); };

const shown = [];
Notification.prototype.show = function show() { shown.push({ title: this.title, body: this.body }); };

process.argv.push('--pf-hidden'); // start hidden like a login-item launch (no full-screen pop)

require('../main.js');
const tray = require('../tray');
const calls = require('../calls');

const out = { platform: process.platform, errors: [] };
const check = (name, ok) => { out[name] = !!ok; if (!ok) out.errors.push(name); };

app.whenReady().then(() => setTimeout(async () => {
  try {
    const t = tray.getTray();
    check('trayCreated', !!t && !t.isDestroyed());
    check('contextMenuSet', setContextMenuCalls.length > 0);
    check('iconSet', setImageCalls.length > 0);
    check('tooltipMentionsInstruments', setToolTipCalls.some((s) => /instrument/i.test(s)));

    const beforeTooltipCalls = setToolTipCalls.length;
    tray.setUnreadCount(3);
    check('unreadBadgeUpdatesTooltip', setToolTipCalls.length > beforeTooltipCalls && /3 unread/.test(setToolTipCalls[setToolTipCalls.length - 1]));
    tray.setUnreadCount(0);

    // "Open Prefrontal" restores/shows the window.
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Prefrontal');
    check('mainWindowFound', !!win);
    check('startedHidden', win && !win.isVisible());
    tray.handleAction('open');
    const until = async (cond, ms = 4000) => {
      const end = Date.now() + ms;
      while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
      return cond();
    };
    check('openActionShowsWindow', await until(() => win.isVisible()));

    // Menu-action navigation reuses the preload's existing bridge.
    const navSent = [];
    const origSend = win.webContents.send.bind(win.webContents);
    win.webContents.send = (ch, payload) => { navSent.push({ ch, payload }); return origSend(ch, payload); };
    tray.handleAction('openInstruments');
    check('openInstrumentsNavigates', navSent.some((s) => s.ch === 'menu-action' && s.payload.path === '/admin/instruments'));

    // Diagnostics: plain text, mentions the app, never a secret-shaped string.
    // No instrument is paired in this smoke run, so this only exercises the
    // wiring (clipboard write + the expected shape) — redact()'s actual
    // behaviour is covered head-on by electron/test/diagnostics.test.js.
    tray.handleAction('copyDiagnostics');
    const text = clipboard.readText();
    check('diagnosticsOnClipboard', /Prefrontal/.test(text) && /Instruments: none configured/.test(text));

    // Quit action marks the app as quitting (so main.js's close handler
    // doesn't fight it) WITHOUT this smoke process actually calling app.quit().
    check('notQuittingYet', !calls.isQuitting());
    const origQuit = app.quit;
    let quitCalled = false;
    app.quit = () => { quitCalled = true; };
    tray.handleAction('quit');
    check('quitActionMarksQuitting', calls.isQuitting());
    check('quitActionCallsAppQuit', quitCalled);
    app.quit = origQuit;

    check('nativeNotificationsNeverTriggeredBySmoke', shown.length === 0);
  } catch (err) {
    out.errors.push(String((err && err.stack) || err));
  }
  console.log('PF_TRAY_SMOKE ' + JSON.stringify(out));
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* tmp */ }
  app.exit(out.errors.length ? 1 : 0);
}, 700));
