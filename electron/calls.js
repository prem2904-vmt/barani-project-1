/*
 * Desktop incoming calls while the app is minimised, hidden in the tray or
 * behind other windows — the Electron leg of OFFLINE CALLING.
 *
 * The desktop app has no APNs / FCM / Web Push; it stays reachable by keeping
 * its SignalR socket alive in the background (main.js: backgroundThrottling
 * off, close = hide, tray). When the renderer's IncomingCall arrives and the
 * main window isn't in front, the renderer (electron-call.service.ts) calls
 * electronAPI.calls.incoming(); we then:
 *   • show a small always-on-top call window (bottom-right) with the caller's
 *     name and Answer / Decline,
 *   • flash the taskbar button (Windows/Linux) / bounce the dock (macOS),
 *   • on Answer restore + focus the main window, then hand the choice back to
 *     the renderer, which joins the call (Decline just hands it back).
 * The ringtone is the renderer's own. The call window closes as soon as the
 * ring ends on any path (renderer calls dismiss) or the main window is
 * focused (its in-app ring card takes over).
 */
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let quitting = false;
let callWin = null;
let callInfo = null;          // { callId, callerName, isGroup, groupName }
let bounceId = null;
let mainRef = null;
let tray = null;

const CALL_ID = /^[A-Za-z0-9_-]{6,64}$/;

function isQuitting() { return quitting; }
function setQuitting() { quitting = true; }

/** Bring the main window back from minimised / hidden / behind. */
function restore(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

function inFront(win) {
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
}

function stopAttention() {
  if (mainRef && !mainRef.isDestroyed()) mainRef.flashFrame(false);
  if (process.platform === 'darwin' && bounceId !== null && app.dock) {
    app.dock.cancelBounce(bounceId);
  }
  bounceId = null;
}

function closeCallWindow() {
  callInfo = null;
  stopAttention();
  if (callWin && !callWin.isDestroyed()) callWin.close();
  callWin = null;
}

function showCallWindow(info) {
  callInfo = info;
  const { workArea } = screen.getPrimaryDisplay();
  const width = 360, height = 132, margin = 16;
  if (!callWin || callWin.isDestroyed()) {
    callWin = new BrowserWindow({
      width, height,
      x: workArea.x + workArea.width - width - margin,
      y: workArea.y + workArea.height - height - margin,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#0b1020',
      title: 'Incoming call',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'call-preload.js'),
      },
    });
    // Above full-screen apps and other always-on-top windows.
    callWin.setAlwaysOnTop(true, 'screen-saver');
    callWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    callWin.on('closed', () => { callWin = null; });
    callWin.loadFile(path.join(__dirname, 'call-window.html'));
    callWin.once('ready-to-show', () => {
      if (callWin && !callWin.isDestroyed()) {
        callWin.showInactive();
        callWin.webContents.send('call-window:info', callInfo);
      }
    });
  } else {
    callWin.webContents.send('call-window:info', callInfo);
    callWin.showInactive();
  }

  // Taskbar flash (Windows / Linux) and dock bounce (macOS).
  if (mainRef && !mainRef.isDestroyed()) mainRef.flashFrame(true);
  if (process.platform === 'darwin' && app.dock) bounceId = app.dock.bounce('critical');
}

/** Wire one main window. Called from main.js createWindow(). */
function attach(win) {
  mainRef = win;
  // The in-app ring card takes over once the user brings the window forward.
  win.on('focus', () => { if (callWin) closeCallWindow(); else stopAttention(); });
}

ipcMain.on('call:incoming', (e, info) => {
  if (!mainRef || e.sender !== mainRef.webContents) return; // only the app window may ring
  if (!info || typeof info.callId !== 'string' || !CALL_ID.test(info.callId)) return;
  const clean = {
    callId: info.callId,
    callerName: String(info.callerName || 'A colleague').slice(0, 80),
    isGroup: !!info.isGroup,
    groupName: info.groupName ? String(info.groupName).slice(0, 80) : '',
  };
  if (inFront(mainRef)) return; // the in-app ring card is on screen
  showCallWindow(clean);
});

ipcMain.on('call:dismiss', (e, callId) => {
  if (!mainRef || e.sender !== mainRef.webContents) return;
  if (!callInfo || callInfo.callId === callId) closeCallWindow();
  else stopAttention();
});

ipcMain.on('call-window:action', (e, action) => {
  if (!callWin || e.sender !== callWin.webContents || !callInfo) return;
  if (action !== 'answer' && action !== 'decline') return;
  const callId = callInfo.callId;
  closeCallWindow();
  if (!mainRef || mainRef.isDestroyed()) return;
  if (action === 'answer') restore(mainRef);
  mainRef.webContents.send('call:action', { action, callId });
});

/** Tray icon (Windows / Linux) so a closed window is one click away and the
 *  app can be quit; macOS keeps using the dock. */
function createTray(getMain) {
  if (process.platform === 'darwin' || tray) return;
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('Prefrontal');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Prefrontal', click: () => restore(getMain()) },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', () => restore(getMain()));
  } catch (err) {
    console.warn('[tray] unavailable', err);
  }
}

module.exports = { attach, restore, createTray, isQuitting, setQuitting };
