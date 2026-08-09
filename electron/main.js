const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const labelPrinter = require('./printer');
// Don't pull in electron-is-dev — it isn't bundled into the packaged
// app and falsely reports dev mode, which auto-opens DevTools. Use
// Electron's canonical app.isPackaged instead.
const isDev = !app.isPackaged;

// Override the macOS app menu / About / dock title. In dev mode
// electron falls back to package.json `name` which is the npm slug;
// this forces the human-friendly name everywhere regardless of host.
app.setName('Prefrontal');
app.setAboutPanelOptions({
  applicationName: 'Prefrontal',
  applicationVersion: app.getVersion(),
  version: '',
  copyright: '© 2026 Prefrontal Inc',
  credits: 'Prefrontal Lab Management System',
  authors: ['Prefrontal Inc'],
  website: 'https://prefrontal.in'
});

let mainWindow;
// Latest pending Web-Bluetooth chooser callback (see select-bluetooth-device).
let bluetoothCallback = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 768,
    minHeight: 600,
    webPreferences: {
      // Sandbox the renderer — Angular code never gets Node access.
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
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
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

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
}

// ── Label printer (USB) IPC — the desktop counterpart to the iPad's BLE
//    plugin. The renderer sends a packed 1-bpp bitmap; main streams it to the
//    Detonger/Dothantech printer over USB. ────────────────────────────────
ipcMain.handle('printer:status', async () => labelPrinter.status());
ipcMain.handle('printer:print', async (_e, payload) => labelPrinter.print(payload));

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
  createWindow();

  // macOS: re-open a window when the dock icon is clicked.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Standard macOS behaviour: keep the app alive until Cmd+Q.
  // Windows / Linux quit when the last window closes.
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
