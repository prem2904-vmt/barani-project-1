// Real-Electron smoke for the kiosk full screen: loads the real electron/main.js
// with an ISOLATED userData dir (never the installed app's session), then
// asserts the main window opens full screen and the IPC is wired + guarded.
// Run: npx electron electron/test/fullscreen-smoke.js   (prints SMOKE {...})
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-fs-smoke-'));
process.env.PF_DATA_PROFILE = '';
app.setPath('userData', userData);
require('../main.js');

const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return !!fn();
};

app.whenReady().then(async () => {
  const out = { ok: false };
  try {
    await until(() => BrowserWindow.getAllWindows().length > 0);
    const win = BrowserWindow.getAllWindows()[0];
    const trusted = { sender: win.webContents };
    const h = (ch) => ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(ch);
    out.channels = ['window:isFullScreen', 'window:setFullScreen'].filter((c) => !!h(c));
    out.fullAtLaunch = await until(() => win.isFullScreen());
    out.ipcSaysFull = await h('window:isFullScreen')(trusted);
    try { await h('window:setFullScreen')({ sender: {} }, false); out.untrustedRejected = false; }
    catch (e) { out.untrustedRejected = /forbidden/.test(e.message); }
    await h('window:setFullScreen')(trusted, false);
    out.leftFullScreen = await until(() => !win.isFullScreen());
    await h('window:setFullScreen')(trusted, true);
    out.reentered = await until(() => win.isFullScreen());
    out.ok = out.channels.length === 2 && out.fullAtLaunch && out.ipcSaysFull && out.untrustedRejected && out.leftFullScreen && out.reentered;
  } catch (e) {
    out.error = e.message;
  }
  console.log('SMOKE', JSON.stringify(out));
  fs.rmSync(userData, { recursive: true, force: true });
  app.exit(out.ok ? 0 : 1);
});
