const { contextBridge, ipcRenderer } = require('electron');

/**
 * Bridge for the small always-on-top incoming-call window (call-window.html).
 * It can only learn who is calling and answer / decline THAT call.
 */
contextBridge.exposeInMainWorld('pfCallWindow', {
  onInfo: (cb) => ipcRenderer.on('call-window:info', (_e, info) => cb(info)),
  act: (action) => ipcRenderer.send('call-window:action', action),
});
