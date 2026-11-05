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
  // Kiosk full screen (fullscreen.js). The app opens full screen; the
  // renderer leaves it on an Esc nothing else used, re-enters from the
  // avatar menu, and follows every change (incl. F11 / the green button).
  window: {
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    setFullScreen: (on) => ipcRenderer.invoke('window:setFullScreen', on === true),
    onFullScreenChange: (cb) => {
      const h = (_e, on) => cb(on === true);
      ipcRenderer.on('window:fullscreen', h);
      return () => ipcRenderer.removeListener('window:fullscreen', h);
    }
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
  // Desktop notifications (notify.js): per-user settings (avatar menu), bell
  // alerts as native notifications, the unread badge, the main window's
  // real state (the page always reports "visible" because background
  // throttling is off) and sleep / wake so sockets revive at once.
  notify: {
    getSettings: () => ipcRenderer.invoke('notify:settings:get'),
    setSettings: (patch) => ipcRenderer.invoke('notify:settings:set', patch),
    alert: (info) => ipcRenderer.send('notify:alert', info),
    badge: (counts) => ipcRenderer.send('notify:badge', counts),
    getWindowState: () => ipcRenderer.invoke('window:state:get'),
    onWindowState: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('window:state', h);
      return () => ipcRenderer.removeListener('window:state', h);
    },
    onResume: (cb) => {
      const h = (_e, r) => cb(r);
      ipcRenderer.on('app:resume', h);
      return () => ipcRenderer.removeListener('app:resume', h);
    },
    onAction: (cb) => {
      const h = (_e, a) => cb(a);
      ipcRenderer.on('notify:action', h);
      return () => ipcRenderer.removeListener('notify:action', h);
    }
  },
  // Lab analyzer connectors (runs in main, survives the window closing).
  // Pair = store a device key (encrypted by the OS keychain); listen mode =
  // capture what an unknown analyzer sends. No Node objects cross over.
  instruments: {
    list: () => ipcRenderer.invoke('instruments:list'),
    pair: (p) => ipcRenderer.invoke('instruments:pair', p),
    unpair: (instrumentId) => ipcRenderer.invoke('instruments:unpair', instrumentId),
    reload: (instrumentId) => ipcRenderer.invoke('instruments:reload', instrumentId),
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
    preview: (raw, config) => ipcRenderer.invoke('instruments:preview', raw, config),
    // "Connect an analyzer" (netdiag.js): this PC's network, who holds a
    // port, the firewall (fixFirewall = one Windows permission prompt, only
    // after the user confirmed), the ARP table, an opt-in connect-only probe
    // and a multi-port "find the analyzer" listen. Validated again in main.
    diag: {
      snapshot: () => ipcRenderer.invoke('instruments:diagSnapshot'),
      ports: (ports) => ipcRenderer.invoke('instruments:diagPorts', ports),
      nextPort: () => ipcRenderer.invoke('instruments:diagNextPort'),
      fixFirewall: (p) => ipcRenderer.invoke('instruments:diagFixFirewall', p),
      arp: () => ipcRenderer.invoke('instruments:diagArp'),
      probe: (p) => ipcRenderer.invoke('instruments:diagProbe', p),
      scanStart: (p) => ipcRenderer.invoke('instruments:diagScanStart', p),
      scanStop: (scanId) => ipcRenderer.invoke('instruments:diagScanStop', scanId),
      onScan: (cb) => {
        const h = (_e, ev) => cb(ev);
        ipcRenderer.on('instruments:diag', h);
        return () => ipcRenderer.removeListener('instruments:diag', h);
      }
    },
    // "Allow Prefrontal support" (beta, support-session.js): the lab starts a
    // session (code + expiry), main keeps one hub connection to our server only while it is
    // active and asks its OWN dialog before every change. Validated in main.
    // start({minutes, token, apiUrl, branchId?}) — main holds the hub link.
    support: {
      start: (p) => ipcRenderer.invoke('instruments:supportStart', p),
      stop: () => ipcRenderer.invoke('instruments:supportStop'),
      status: () => ipcRenderer.invoke('instruments:supportStatus'),
      setToken: (token) => ipcRenderer.invoke('instruments:supportToken', token),
      onChange: (cb) => {
        const h = (_e, st) => cb(st);
        ipcRenderer.on('instruments:support', h);
        return () => ipcRenderer.removeListener('instruments:support', h);
      }
    }
  },
  // Prefrontal Bridges on this network (bridge-api v1, B.3/B.5): mDNS
  // discovery + HTTPS to a Bridge's local API with its pinned certificate.
  // Main validates every request (private IPv4, /local/v1/ only) and the
  // sender. No hotspot join on the desktop.
  bridges: {
    discoverStart: () => ipcRenderer.invoke('bridges:discoverStart'),
    discoverStop: () => ipcRenderer.invoke('bridges:discoverStop'),
    onFound: (cb) => {
      const h = (_e, ev) => cb(ev);
      ipcRenderer.on('bridges:found', h);
      return () => ipcRenderer.removeListener('bridges:found', h);
    },
    onLost: (cb) => {
      const h = (_e, ev) => cb(ev);
      ipcRenderer.on('bridges:lost', h);
      return () => ipcRenderer.removeListener('bridges:lost', h);
    },
    localRequest: (req) => ipcRenderer.invoke('bridges:localRequest', req)
  },
  // Document/invoice printers = the OS-installed printers (for A4 output).
  doc: {
    listPrinters: () => ipcRenderer.invoke('doc:listPrinters'),
    print: (opts) => ipcRenderer.invoke('doc:print', opts),
    printPdf: (opts) => ipcRenderer.invoke('doc:printPdf', opts)
  },
  // "Send on WhatsApp" (whatsapp-dock.js): WhatsApp Web docked on the right.
  // open() takes ONLY a click-to-chat link (main re-checks it); the person
  // presses Send in WhatsApp. setPdf + startDrag = the "drag the PDF into
  // the chat" helper (a native drag THEY start — never an attachment).
  whatsapp: {
    open: (url) => ipcRenderer.invoke('whatsapp:open', String(url || '')),
    close: () => ipcRenderer.invoke('whatsapp:close'),
    signOut: () => ipcRenderer.invoke('whatsapp:signOut'),
    state: () => ipcRenderer.invoke('whatsapp:state'),
    onState: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('whatsapp:state', h);
      return () => ipcRenderer.removeListener('whatsapp:state', h);
    },
    openElsewhere: (kind) => ipcRenderer.invoke('whatsapp:openElsewhere', kind === 'app' ? 'app' : 'browser'),
    setPdf: (p) => ipcRenderer.invoke('whatsapp:setPdf', { name: String((p && p.name) || 'report.pdf'), bytes: p && p.bytes }),
    startDrag: () => ipcRenderer.send('whatsapp:startDrag')
  },
  // Desktop self-update (electron/updater.js). The renderer owns the
  // banner; main owns checking, background download and the "is it safe
  // to restart" call. restartNow() can come back { deferred: true } if an
  // analyzer looks busy — main itself retries once it isn't.
  updater: {
    getState: () => ipcRenderer.invoke('updater:getState'),
    restartNow: () => ipcRenderer.invoke('updater:restartNow'),
    onState: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('updater:state', h);
      return () => ipcRenderer.removeListener('updater:state', h);
    }
  }
});
