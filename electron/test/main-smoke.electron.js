/*
 * Electron main-process smoke (run by main-smoke.test.js through the electron
 * binary): loads the REAL electron/main.js with an isolated userData folder,
 * a hidden start (--pf-hidden) and stubbed OS side effects (login item,
 * notification pop-ups), then checks the notification wiring and prints one
 * JSON line "PF_SMOKE {...}".
 */
const { app, ipcMain, BrowserWindow, Notification, powerMonitor } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-notify-smoke-'));
app.setPath('userData', userData);
const packaged = process.env.PF_SMOKE_PACKAGED === '1';
if (packaged) Object.defineProperty(app, 'isPackaged', { get: () => true, configurable: true });
const loginCalls = [];
app.setLoginItemSettings = (o) => { loginCalls.push(o); };
app.getLoginItemSettings = () => ({ openAtLogin: loginCalls.length ? !!loginCalls[loginCalls.length - 1].openAtLogin : false });
const shown = [];
Notification.prototype.show = function show() { shown.push({ title: this.title, body: this.body, silent: this.silent }); };
process.argv.push('--pf-hidden');

require('../main.js');
const notify = require('../notify');

const out = { platform: process.platform, packaged, errors: [] };
const check = (name, ok) => { out[name] = !!ok; if (!ok) out.errors.push(name); };
const registered = (ch) => { try { ipcMain.handle(ch, () => null); ipcMain.removeHandler(ch); return false; } catch { return true; } };

app.whenReady().then(() => setTimeout(async () => {
  try {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Prefrontal');
    check('mainWindow', !!win);
    await new Promise(r => setTimeout(r, 1200));
    check('startedHidden', win && !win.isVisible());
    // Login launch: no full-screen Space pops up; full screen waits for the first show.
    check('startedNotFullScreen', win && !win.isFullScreen());
    check('backgroundThrottlingOff', win && win.webContents.getBackgroundThrottling() === false);
    for (const ch of ['notify:settings:get', 'notify:settings:set', 'window:state:get', 'printer:status']) {
      check(`handle:${ch}`, registered(ch));
    }
    for (const ch of ['notify:alert', 'notify:badge', 'chat:notify', 'call:incoming', 'call:dismiss']) {
      check(`on:${ch}`, ipcMain.listenerCount(ch) > 0);
    }
    check('notificationSupported', Notification.isSupported());
    check('settingsFile', fs.existsSync(path.join(userData, 'notify-settings.json')));
    out.loginCalls = loginCalls;
    check('loginItemDefault', packaged
      ? loginCalls.length === 1 && loginCalls[0].openAtLogin === true
      : loginCalls.length === 0);

    const sent = [];
    const origSend = win.webContents.send.bind(win.webContents);
    win.webContents.send = (ch, payload) => { sent.push({ ch, payload }); return origSend(ch, payload); };

    notify.showAlert({ kind: 'report_ready', title: 'Report ready', body: 'Order 1', referenceType: 'report', referenceId: 'r1' });
    check('alertShown', shown.some(n => n.title === 'Report ready'));

    // Close = hide + a one-time "still running" hint. The window goes full
    // screen on show (fullscreen.js) and a macOS close first animates out of
    // full screen, so wait for the state instead of a fixed delay.
    const until = async (cond, ms = 5000) => {
      const end = Date.now() + ms;
      while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 50));
      return cond();
    };
    const settled = () => new Promise(r => setTimeout(r, 400));
    win.show();
    check('shownFullScreen', await until(() => win.isVisible() && win.isFullScreen()));
    await settled();
    win.close();
    check('closeHides1', await until(() => !win.isVisible()));
    await settled();
    win.show();
    check('reshownFullScreen', await until(() => win.isVisible() && win.isFullScreen()));
    await settled();
    win.close();
    await until(() => !win.isVisible());
    await settled();
    check('closeKeepsRunning', !win.isDestroyed() && !win.isVisible());
    check('trayHintOnce', shown.filter(n => n.title === 'Prefrontal is still running').length === 1);
    check('windowStatePushed', sent.some(s => s.ch === 'window:state' && s.payload && s.payload.visible === false));

    const total = notify.applyBadge({ chat: 2, bell: 1 });
    check('badgeTotal', total === 3);
    if (process.platform === 'darwin') check('dockBadge', app.getBadgeCount() === 3);
    notify.applyBadge({ chat: 0, bell: 0 });

    powerMonitor.emit('resume');
    powerMonitor.emit('unlock-screen');
    await new Promise(r => setTimeout(r, 1800));
    check('resumeForwardedOnce', sent.filter(s => s.ch === 'app:resume').length === 1);

    // Settings round-trip through the same code the IPC uses.
    const s = notify.getSettings();
    check('settingsDefaults', s.calls && s.messages && s.alerts && s.sound);
  } catch (err) {
    out.errors.push(String(err && err.stack || err));
  }
  console.log('PF_SMOKE ' + JSON.stringify(out));
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* tmp */ }
  app.exit(out.errors.length ? 1 : 0);
}, 500));
