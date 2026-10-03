const { app, BrowserWindow, shell, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const labelPrinter = require('./printer');
const calls = require('./calls');
const chatNotify = require('./chat-notify');
// Kiosk-style full screen: opens full screen, Esc (renderer-decided) leaves,
// F11 / Ctrl+Cmd+F / avatar menu re-enter. See fullscreen.js.
const fullscreen = require('./fullscreen');
// Desktop notifications: settings, bell alerts, badge, login item, wake-up.
const notify = require('./notify');
// Lab analyzer connector (serial / TCP / folder → LMS). Core is plain Node
// under ./instruments/core; this host just wires it to IPC + app lifecycle.
const instruments = require('./instruments/host-electron');
// Desktop self-update (electron-updater, generic provider). See
// docs/DESKTOP-RELEASES.md. Channel comes from the build's own
// pfDataProfile; a dev run (unpackaged) or a build with none disables it.
const updater = require('./updater');
// Menu bar (macOS) / system tray (Windows): instruments, updates, quit.
// Close hides to here instead of quitting — see mainWindow.on('close', …)
// below. electron/tray.js is the single owner of the Tray/icon/menu.
const tray = require('./tray');
// Don't pull in electron-is-dev — it isn't bundled into the packaged
// app and falsely reports dev mode, which auto-opens DevTools. Use
// Electron's canonical app.isPackaged instead.
const isDev = !app.isPackaged;

// Override the macOS app menu / About / dock title. In dev mode
// electron falls back to package.json `name` which is the npm slug;
// this forces the human-friendly name everywhere regardless of host.
app.setName('Prefrontal');
// Optional isolated data profile for side-by-side test builds: a build made
// with `-c.extraMetadata.pfDataProfile=<name>` (or PF_DATA_PROFILE=<name> at
// launch) keeps its session, connector pairing and single-instance lock in
// "<appData>/Prefrontal (<name>)" instead of the real app's folder. Absent in
// the normal build → userData is untouched. Must run before the lock / ready.
{
  let profile = process.env.PF_DATA_PROFILE;
  if (!profile) { try { profile = require('../package.json').pfDataProfile; } catch { profile = undefined; } }
  // 'prod' is the real shipped app's own channel tag (electron/updater.js
  // reads this same field to pick its update channel) — NOT a side-by-side
  // test profile. Today's real build sets no pfDataProfile at all and uses
  // the default userData folder; isolating it under "Prefrontal (prod)"
  // the day this field starts being set would silently orphan every real
  // customer's existing local data on their next update. Only dev/stage
  // (genuine side-by-side test builds) get an isolated folder.
  if (typeof profile === 'string' && profile !== 'prod' && /^[A-Za-z0-9-]{1,40}$/.test(profile)) {
    app.setPath('userData', path.join(app.getPath('appData'), `Prefrontal (${profile})`));
  }
}
// Windows toasts are attributed by AppUserModelID and are silently DROPPED
// when it doesn't match the installed app's identity. Must equal
// electron-builder's build.appId in package.json. No-op on macOS/Linux.
app.setAppUserModelId('in.prefrontal.app');
app.setAboutPanelOptions({
  applicationName: 'Prefrontal',
  applicationVersion: app.getVersion(),
  version: '',
  copyright: '© 2026 Prefrontal Inc',
  credits: 'Prefrontal Lab Management System',
  authors: ['Prefrontal Inc'],
  website: 'https://prefrontal.in'
});

// Incoming calls must ring with no prior click in the window (the ringtone
// plays from the renderer while the app is minimised / hidden in the tray).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// One resident instance: the app lives on in the tray / dock after its window
// is closed (so calls still ring), and launching it again just brings it back.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

let mainWindow;
// Latest pending Web-Bluetooth chooser callback (see select-bluetooth-device).
let bluetoothCallback = null;
// Only the FIRST window of a login-item launch starts hidden in the tray; a
// window re-created later (macOS dock click) is always shown.
let firstWindow = true;

function createWindow() {
  // Auto-started at login → stay in the tray / dock, and do NOT go full screen
  // yet (macOS would pop a full-screen Space). It enters full screen on its
  // first show instead (tray / dock / notification click) — see fullscreen.js.
  const startHidden = firstWindow && notify.launchedHidden();
  firstWindow = false;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 768,
    minHeight: 600,
    // Opens full screen on every launch (owner) — see fullscreen.js.
    ...fullscreen.windowOptions({ hidden: startHidden }),
    webPreferences: {
      // Sandbox the renderer — Angular code never gets Node access.
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Keep timers + the SignalR socket at full speed while the window is
      // minimised / hidden in the tray. Chromium otherwise throttles hidden
      // pages (intensive throttling after 5 min aligns timers to 1/min), the
      // hub's keep-alive starves, the server drops the connection and the
      // desktop user silently stops receiving calls.
      backgroundThrottling: false
    },
    // Default native macOS titlebar (with title centered + traffic
    // lights). The renderer's <html> doesn't extend under it, so
    // there's no overlap to work around.
    title: 'Prefrontal',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    backgroundColor: '#04061a'
  });
  // Lock the title even after the renderer loads — file:// pages
  // can override the window title via document.title; this resets
  // it on every navigation so the OS chrome stays "Prefrontal".
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle('Prefrontal');
  });

  // ── Web Bluetooth: in-app device picker ──────────────────────────────
  // Electron ships no BLE chooser UI, so we intercept the pick event, forward
  // the discovered devices to the renderer (our own list), and resolve with the
  // deviceId the user taps. The event re-fires as devices appear; we keep the
  // latest callback. Grant device permission so the connection isn't blocked.
  mainWindow.webContents.session.setDevicePermissionHandler(() => true);
  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    bluetoothCallback = callback;
    mainWindow.webContents.send('ble:devices',
      deviceList.map((d) => ({ deviceId: d.deviceId, deviceName: d.deviceName || 'Unknown device' })));
  });

  // In dev: load the Nx serve URL (live reload).
  // In prod: load the built bundle off disk via file://. The
  // HashLocationStrategy on the Angular side handles deep links
  // since file:// can't do server-side route resolution.
  const url = isDev
    ? 'http://localhost:4200'
    : `file://${path.join(__dirname, '../dist/apps/lms/browser/index.html')}`;

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    // Auto-started at login → stay in the tray / dock until opened.
    if (!startHidden) mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });
  fullscreen.attach(mainWindow, { hidden: startHidden });

  // External links open in the user's default browser, not in
  // the Electron window — keeps OAuth / docs / nudges out of
  // the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Close = hide (every platform): the app stays resident — socket connected,
  // calls and messages still arrive — until the user quits from the tray /
  // dock / Cmd+Q. Closing the window used to quit on Windows (and kill the
  // socket on macOS), which made a desktop user unreachable.
  mainWindow.on('close', (e) => {
    if (calls.isQuitting()) return;
    e.preventDefault();
    // macOS: leaves native full screen first (no black Space left behind).
    fullscreen.hide(mainWindow);
  });

  calls.attach(mainWindow);
  notify.attach(mainWindow);
}

// ── Label printer (USB) IPC — the desktop counterpart to the iPad's BLE
//    plugin. The renderer sends a packed 1-bpp bitmap; main streams it to the
//    Detonger/Dothantech printer over USB. ────────────────────────────────
// Chat notifications with inline Reply (macOS) — see chat-notify.js.
chatNotify.register(() => mainWindow);
notify.register(() => mainWindow);
// Analyzer connectors: IPC for the Instruments page (pair / status / listen).
instruments.register(() => mainWindow);
// Desktop self-update: IPC for the renderer's update banner. The restart
// guard reads the SAME instrument manager this registers against, so it
// never restarts mid-run.
updater.register(() => mainWindow, instruments.statusSnapshot);
// Full screen: query / set from the main window only; changes pushed back.
fullscreen.register(() => mainWindow);

ipcMain.handle('printer:status', async () => labelPrinter.status());
ipcMain.handle('printer:print', async (_e, payload) => labelPrinter.print(payload));

// Theme sync (ThemeService → system-bars.ts): the native title bar follows the
// app's ACTIVE theme (not just the OS appearance) and the window background
// behind the page matches, so a resize / reload never flashes the other one.
const THEME_BG = /^#[0-9a-f]{6}$/i;
ipcMain.on('theme:set', (_e, t) => {
  const theme = t && t.theme;
  if (theme !== 'light' && theme !== 'dark') return;
  nativeTheme.themeSource = theme;
  const bg = t && typeof t.background === 'string' && THEME_BG.test(t.background)
    ? t.background
    : theme === 'dark' ? '#0a0a15' : '#ede8f6';
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(bg);
});

// Renderer's in-app BLE picker resolves the pending chooser callback.
ipcMain.on('ble:choose', (_e, deviceId) => {
  if (bluetoothCallback) { bluetoothCallback(deviceId); bluetoothCallback = null; }
});
ipcMain.on('ble:cancel', () => {
  if (bluetoothCallback) { bluetoothCallback(''); bluetoothCallback = null; }
});

// Document/invoice printers = the OS-installed printers. List them, and print
// the current page silently to a chosen one (the renderer applies its own
// print CSS to isolate the invoice before calling this).
ipcMain.handle('doc:listPrinters', async () => {
  try { return await mainWindow.webContents.getPrintersAsync(); }
  catch { return []; }
});
ipcMain.handle('doc:print', async (_e, opts = {}) => {
  return new Promise((resolve) => {
    mainWindow.webContents.print(
      { silent: true, deviceName: opts.deviceName || undefined, printBackground: true },
      (success, failureReason) => resolve({ ok: success, error: success ? undefined : failureReason })
    );
  });
});

// Silently print a PDF (e.g. an invoice) to a chosen OS printer: write it to a
// temp file, render it in a hidden window (Chromium's PDF viewer), print, clean
// up. Used when a document printer is selected in Printing settings.
ipcMain.handle('doc:printPdf', async (_e, opts = {}) => {
  const os = require('os');
  const fs = require('fs');
  const tmp = path.join(os.tmpdir(), `pf-doc-${Date.now()}.pdf`);
  return new Promise((resolve) => {
    let win;
    const done = (result) => {
      try { if (win && !win.isDestroyed()) win.close(); } catch (e) { /* noop */ }
      try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
      resolve(result);
    };
    try {
      fs.writeFileSync(tmp, Buffer.from(opts.base64 || '', 'base64'));
      win = new BrowserWindow({ show: false, webPreferences: { plugins: true } });
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          win.webContents.print(
            { silent: true, deviceName: opts.deviceName || undefined, printBackground: true },
            (success, failureReason) => done({ ok: success, error: success ? undefined : failureReason })
          );
        }, 600);
      });
      win.loadFile(tmp).catch((e) => done({ ok: false, error: e.message }));
    } catch (e) {
      done({ ok: false, error: e.message });
    }
  });
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  createWindow();
  notify.start();
  // Paired analyzers start with the app and keep running in the tray.
  instruments.start();
  // Check at launch, then every 4h (updater.js); no-op outside a packaged,
  // channel-tagged build.
  updater.start();
  // Built AFTER instruments.start() so its first menu/icon already reflects
  // whichever analyzers are paired (status() is empty before load() runs).
  tray.create(() => mainWindow);

  // macOS: re-open / re-show the window when the dock icon is clicked.
  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else calls.restore(mainWindow);
  });
});

// A second launch (Start menu / dock / desktop shortcut) → bring back the
// resident window instead of starting another copy.
app.on('second-instance', () => {
  if (mainWindow) calls.restore(mainWindow);
});

app.on('before-quit', () => {
  calls.setQuitting();
  instruments.stop();
});

app.on('window-all-closed', () => {
  // Only reached on a real quit (close hides the window). macOS keeps the app
  // alive until Cmd+Q as usual.
  if (process.platform !== 'darwin') app.quit();
});

// Defence-in-depth: block any in-app navigation that isn't to
// the dev server, the local file:// bundle, or our API. Anything
// else gets opened in the user's browser instead.
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (
      !url.startsWith('http://localhost') &&
      !url.startsWith('file://')
    ) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
});
