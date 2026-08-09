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
  sendReady: () => ipcRenderer.send('app-ready'),
  // USB label printer (Detonger/Dothantech). The renderer builds a packed
  // 1-bpp bitmap and hands it here; main encodes + streams it over USB.
  printer: {
    status: () => ipcRenderer.invoke('printer:status'),
    print: (payload) => ipcRenderer.invoke('printer:print', payload)
  },
  // Web-Bluetooth in-app device picker. Main forwards discovered BLE devices
  // via 'ble:devices'; the renderer shows its own list and resolves the choice.
  ble: {
    onDevices: (cb) => {
      const h = (_e, devices) => cb(devices);
      ipcRenderer.on('ble:devices', h);
      return () => ipcRenderer.removeListener('ble:devices', h);
    },
    choose: (deviceId) => ipcRenderer.send('ble:choose', deviceId),
    cancel: () => ipcRenderer.send('ble:cancel')
  },
  // Document/invoice printers = the OS-installed printers (for A4 output).
  doc: {
    listPrinters: () => ipcRenderer.invoke('doc:listPrinters'),
    print: (opts) => ipcRenderer.invoke('doc:print', opts),
    printPdf: (opts) => ipcRenderer.invoke('doc:printPdf', opts)
  }
});
