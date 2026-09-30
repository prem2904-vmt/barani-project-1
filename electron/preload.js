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
  // Active theme → native title bar + window background (ThemeService).
  theme: {
    set: (t) => ipcRenderer.send('theme:set', { theme: t && t.theme, background: t && t.background })
  },
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
  // Incoming calls while the window is minimised / in the tray / behind other
  // apps: main shows an always-on-top call window + taskbar flash / dock
  // bounce; Answer / Decline come back through onAction.
  calls: {
    incoming: (info) => ipcRenderer.send('call:incoming', info),
    dismiss: (callId) => ipcRenderer.send('call:dismiss', callId),
    onAction: (cb) => {
      const h = (_e, a) => cb(a);
      ipcRenderer.on('call:action', h);
      return () => ipcRenderer.removeListener('call:action', h);
    }
  },
  // Chat notifications with an inline Reply on macOS; Reply / click come
  // back through onAction as { type: 'reply' | 'open', conversationId, text }.
  chatNotify: {
    show: (info) => ipcRenderer.send('chat:notify', info),
    onAction: (cb) => {
      const h = (_e, a) => cb(a);
      ipcRenderer.on('chat:action', h);
      return () => ipcRenderer.removeListener('chat:action', h);
    }
  },
  // Lab analyzer connectors (runs in main, survives the window closing).
  // Pair = store a device key (encrypted by the OS keychain); listen mode =
  // capture what an unknown analyzer sends. No Node objects cross over.
  instruments: {
    list: () => ipcRenderer.invoke('instruments:list'),
    pair: (p) => ipcRenderer.invoke('instruments:pair', p),
    unpair: (instrumentId) => ipcRenderer.invoke('instruments:unpair', instrumentId),
    status: () => ipcRenderer.invoke('instruments:status'),
    onStatus: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('instruments:status', h);
      return () => ipcRenderer.removeListener('instruments:status', h);
    },
    rawLog: (instrumentId, limit) => ipcRenderer.invoke('instruments:rawLog', instrumentId, limit),
    listSerialPorts: () => ipcRenderer.invoke('instruments:listSerialPorts'),
    listenStart: (opts) => ipcRenderer.invoke('instruments:listenStart', opts),
    listenStop: (sessionId) => ipcRenderer.invoke('instruments:listenStop', sessionId),
    onListen: (cb) => {
      const h = (_e, ev) => cb(ev);
      ipcRenderer.on('instruments:listen', h);
      return () => ipcRenderer.removeListener('instruments:listen', h);
    },
    preview: (raw, config) => ipcRenderer.invoke('instruments:preview', raw, config)
  },
  // Document/invoice printers = the OS-installed printers (for A4 output).
  doc: {
    listPrinters: () => ipcRenderer.invoke('doc:listPrinters'),
    print: (opts) => ipcRenderer.invoke('doc:print', opts),
    printPdf: (opts) => ipcRenderer.invoke('doc:printPdf', opts)
  }
});
