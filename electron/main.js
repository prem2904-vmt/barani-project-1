const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
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
