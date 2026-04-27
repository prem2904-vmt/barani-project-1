const { contextBridge, ipcRenderer } = require('electron');

/**
 * Bridge — the ONLY surface the Angular app sees of Electron.
 * contextIsolation is on (per main.js), so the renderer can't
 * touch Node directly; everything has to go through here.
 *
 * window.electronAPI on the Angular side. PlatformService reads
 * `isElectron` to flip layout / API URL / behaviour.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  // Reserved for future menu actions (open / settings / etc.) —
  // wire up new ipcRenderer.on channels here as they're needed.
  onMenuAction: (callback) => ipcRenderer.on('menu-action', callback),
  sendReady: () => ipcRenderer.send('app-ready')
});
