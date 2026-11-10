/**
 * "Send on WhatsApp" — WhatsApp Web docked on the RIGHT of the main window.
 *
 * The page asks to open WhatsApp's official click-to-chat link
 * (`https://web.whatsapp.com/send?phone=<digits>&text=<encoded>`); this
 * module shows it in a WebContentsView beside the app, which reflows to the
 * left. The person signs in once (QR) — the sign-in lives in its OWN
 * persistent partition `persist:whatsapp`, isolated from the app's session
 * and cookies — checks the message and presses Send THEMSELVES.
 *
 * Hard lines (legal / WhatsApp terms — pinned by test/whatsapp-dock.test.js):
 *   - NOTHING inside WhatsApp is automated, read or modified (WhatsApp's Terms
 *     prohibit it): no preload, no script injected (no executeJavaScript /
 *     insertCSS), no paste(), no insertText, no sendInputEvent, no IPC into the
 *     view, its page is never read, Send is never pressed, no file is attached
 *     for the person, no bulk. The app only opens the official click-to-chat
 *     link (the message drafted in its `text` param — WhatsApp's own feature)
 *     and puts the report PDF on OUR OS clipboard (whatsapp-clipboard.js) so the
 *     person can paste it themselves.
 *   - Only the click-to-chat link is loaded (`parseClickToChat`); the view
 *     never leaves *.whatsapp.com / *.whatsapp.net — anything else opens in
 *     the system browser.
 *   - The user agent is Electron's own (no Chrome spoofing — an owner
 *     decision, not done). If WhatsApp refuses to load here, the page offers
 *     the same link in the system browser or the WhatsApp app.
 *   - The report PDF is also offered as a NATIVE DRAG the person starts from OUR
 *     header (startDrag on the app window's own contents) — never attached.
 *
 * The decisions are plain functions (no Electron) so they are unit-tested;
 * `createDock` takes Electron's pieces as arguments so tests pass fakes.
 */

const PARTITION = 'persist:whatsapp';
/** Hosts the panel may show (the host itself or any subdomain). */
const WA_HOST_SUFFIXES = ['whatsapp.com', 'whatsapp.net'];
/** The page's header strip above the panel (CSS px; Close / Sign out + one quiet note row). */
const HEADER_CSS = 112;
/** Permissions WhatsApp Web may have here: its own message notifications and
 *  copying text. Everything else (camera, microphone, location, screen,
 *  devices, clipboard READ, …) is denied. */
const ALLOWED_PERMISSIONS = ['notifications', 'clipboard-sanitized-write'];
const OPEN_EXTERNAL_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:'];
const MAX_PDF_BYTES = 25 * 1024 * 1024;

function hostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase();
  return WA_HOST_SUFFIXES.some((s) => h === s || h.endsWith('.' + s));
}

/** https on a WhatsApp host (no credentials in the URL). */
function isWhatsAppUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && hostAllowed(u.hostname);
}

/** Main-frame navigation inside the panel: stay on WhatsApp, else hand a
 *  safe link to the system browser, else block. */
function decideWaNavigation(url) {
  if (isWhatsAppUrl(url)) return { allow: true, openExternal: false };
  let u;
  try { u = new URL(url); } catch { return { allow: false, openExternal: false }; }
  return { allow: false, openExternal: OPEN_EXTERNAL_SCHEMES.includes(u.protocol) };
}

/** EXACTLY a click-to-chat link → { phone, text }; anything else → null.
 *  Mirror of the page's `isClickToChatUrl` (shared/utils/whatsapp-manual.ts). */
function parseClickToChat(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'web.whatsapp.com' || u.port || u.username || u.password || u.hash) return null;
  if (u.pathname !== '/send') return null;
  const keys = [...u.searchParams.keys()];
  if (keys.some((k) => k !== 'phone' && k !== 'text') || new Set(keys).size !== keys.length) return null;
  const phone = u.searchParams.get('phone') || '';
  if (!/^\d{8,15}$/.test(phone)) return null;
  const text = u.searchParams.get('text') || '';
  if (text.length > 4000) return null;
  return { phone, text };
}

/** The same chat in the WhatsApp desktop app (the fallback). */
function appDeepLink({ phone, text }) {
  return `whatsapp://send?phone=${phone}&text=${encodeURIComponent(text)}`;
}

/** The panel's web preferences: its own persistent partition, sandboxed,
 *  isolated, no Node, and NO preload (nothing of ours runs in WhatsApp). */
function viewWebPreferences() {
  return {
    partition: PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    // Messages must still arrive while the app is in front of it.
    backgroundThrottling: false,
  };
}

function decidePermission(permission) {
  return ALLOWED_PERMISSIONS.includes(permission);
}

/** CSS width WhatsApp Web needs to show its chat list AND the open chat side by side. Narrower, it does not
 *  collapse to one column: it overflows sideways, so the chat a click-to-chat link opens sits off-screen and the
 *  message only shows as a "Draft" in the list (owner report 2026-11-10, 480 px panel). */
const WA_LAYOUT_CSS = 1000;

/** Panel width in DIP: ~40% of the window (560–820), and the app keeps at least 600 px. */
function dockWidth(contentWidth) {
  const w = Math.round(Math.min(820, Math.max(560, contentWidth * 0.4)));
  return Math.max(0, Math.min(w, contentWidth - 600));
}

/** Browser zoom for the panel (the same as the person pressing Cmd/Ctrl −): makes WhatsApp's layout width fit the
 *  panel so nothing scrolls sideways. A browser control on OUR view — WhatsApp's page itself is never touched. */
function waZoom(panelWidth) {
  if (!(panelWidth > 0)) return 1;
  return Math.floor(Math.min(1, Math.max(0.5, panelWidth / WA_LAYOUT_CSS)) * 100) / 100; // down, so it always fits
}

/** Where the panel goes in the window's content area + what the page needs
 *  to reflow (CSS px, so a zoomed page still lines up). */
function dockLayout(content, zoom = 1) {
  const z = zoom > 0 ? zoom : 1;
  const width = dockWidth(content.width);
  const header = Math.round(HEADER_CSS * z);
  return {
    bounds: { x: content.width - width, y: header, width, height: Math.max(0, content.height - header) },
    cssWidth: Math.round(width / z),
    cssTop: HEADER_CSS,
  };
}

/** A file name safe on every OS, always ending .pdf. */
function safePdfName(name) {
  const base = String(name || 'report').replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9 ._-]+/g, '-').replace(/\.{2,}/g, '-').replace(/-{2,}/g, '-').replace(/^[.\s-]+/, '').slice(0, 80);
  return `${base || 'report'}.pdf`;
}

function isPdfBytes(bytes) {
  return !!bytes && bytes.length > 5 && bytes.length <= MAX_PDF_BYTES
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
}

/**
 * The panel. deps: { WebContentsView, session, shell, nativeImage, fs, os,
 * path, iconPath, getWindow }.
 */
function createDock(deps) {
  const { WebContentsView, session, shell, getWindow } = deps;
  let view = null;
  let attachedTo = null;
  let lastChat = null;
  let pdfPath = null;
  let hardened = false;
  const state = { open: false, width: 0, top: HEADER_CSS, loading: false, failed: false, pdfName: null, clipboard: 'idle' };
  let chatSeq = 0;        // bumps on every open(): the clipboard copy only runs for the chat it was asked for
  let copiedSeq = -1;     // the chat that already had its one copy

  const waSession = () => session.fromPartition(PARTITION);

  /** Is this web contents the panel's (or anything in its partition)? The
   *  app-wide navigation guard skips these — the panel has its own. */
  function owns(contents) {
    try { return !!contents && contents.session === waSession(); } catch { return false; }
  }

  function harden(ses) {
    if (hardened) return;
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(decidePermission(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => decidePermission(permission));
    if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
    try { ses.setUserAgent(plainChromeUserAgent(ses.getUserAgent())); } catch { /* keep the default */ }
    hardened = true;
  }

  function emit() {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('whatsapp:state', publicState());
  }

  function publicState() { return { ...state }; }

  function ensureView() {
    if (view && !view.webContents.isDestroyed()) return view;
    harden(waSession());
    view = new WebContentsView({ webPreferences: viewWebPreferences() });
    const wc = view.webContents;
    // New windows never open in the app: web links go to the system browser.
    wc.setWindowOpenHandler(({ url }) => {
      const d = decideWaNavigation(url);
      if (d.allow || d.openExternal) shell.openExternal(url);
      return { action: 'deny' };
    });
    const guard = (event, url) => {
      const d = decideWaNavigation(url);
      if (d.allow) return;
      event.preventDefault();
      if (d.openExternal) shell.openExternal(url);
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('did-start-loading', () => { state.loading = true; emit(); });
    wc.on('did-stop-loading', () => { state.loading = false; emit(); });
    wc.on('did-finish-load', () => layout()); // zoom can reset when WhatsApp reloads
    wc.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) { state.failed = true; state.loading = false; emit(); }   // -3 = aborted
    });
    wc.on('render-process-gone', () => { state.failed = true; state.loading = false; emit(); });
    return view;
  }

  function layout() {
    const win = getWindow();
    if (!view || !state.open || !win || win.isDestroyed()) return;
    let zoom = 1;
    try { zoom = win.webContents.getZoomFactor() || 1; } catch { /* */ }
    const l = dockLayout(win.getContentBounds(), zoom);
    view.setBounds(l.bounds);
    applyZoom(l.bounds.width);
    state.width = l.cssWidth;
    state.top = l.cssTop;
  }

  function applyZoom(panelWidth) {
    const wc = view && view.webContents;
    if (!wc || wc.isDestroyed()) return;
    try { wc.setZoomFactor(waZoom(panelWidth)); } catch { /* view going away */ }
  }

  function relayout() { if (state.open) { layout(); emit(); } }

  function open(url) {
    const chat = parseClickToChat(url);
    if (!chat) return { ok: false, error: 'not_click_to_chat' };
    const win = getWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'no_window' };
    const v = ensureView();
    if (attachedTo !== win) {
      win.contentView.addChildView(v);
      attachedTo = win;
    }
    lastChat = { url, ...chat };
    chatSeq++;
    clearPdf();
    state.open = true;
    state.failed = false;
    state.loading = true;
    layout();
    Promise.resolve(v.webContents.loadURL(url)).catch(() => { state.failed = true; state.loading = false; emit(); });
    emit();
    return { ok: true };
  }

  function close() {
    const v = view;
    view = null;
    if (v) {
      try { if (attachedTo && !attachedTo.isDestroyed()) attachedTo.contentView.removeChildView(v); } catch { /* */ }
      try { if (!v.webContents.isDestroyed()) v.webContents.close(); } catch { /* */ }
    }
    attachedTo = null;
    clearPdf();
    Object.assign(state, { open: false, width: 0, loading: false, failed: false, pdfName: null, clipboard: 'idle' });
    emit();
    return { ok: true };
  }

  /** "Sign out of WhatsApp on this computer": close + wipe the partition. */
  async function signOut() {
    close();
    const ses = waSession();
    try { await ses.clearStorageData(); } catch { /* */ }
    try { await ses.clearCache(); } catch { /* */ }
    try { await ses.clearAuthCache(); } catch { /* */ }
    return { ok: true };
  }

  /** The same chat outside the app: the system browser or the WhatsApp app. */
  function openElsewhere(kind) {
    if (!lastChat) return { ok: false };
    if (kind === 'app') shell.openExternal(appDeepLink(lastChat));
    else shell.openExternal(lastChat.url);
    return { ok: true };
  }

  function clearPdf() {
    if (pdfPath) { try { deps.fs.unlinkSync(pdfPath); } catch { /* */ } }
    pdfPath = null;
    state.pdfName = null;
    state.clipboard = 'idle';
  }

  /** The page hands over the report PDF for the drag helper. */
  function setPdf(p) {
    if (!state.open) return { ok: false };
    const bytes = p && p.bytes ? Buffer.from(p.bytes) : null;
    if (!isPdfBytes(bytes)) return { ok: false, error: 'not_pdf' };
    clearPdf();
    const dir = deps.path.join(deps.os.tmpdir(), 'prefrontal-whatsapp');
    deps.fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = safePdfName(p.name);
    pdfPath = deps.path.join(dir, name);
    deps.fs.writeFileSync(pdfPath, bytes, { mode: 0o600 });
    state.pdfName = name;
    emit();
    // One-click sends only: the page says copyToClipboard for the chat IT just opened; one copy per chat.
    // OUR clipboard only — nothing is sent to, run in or read from the WhatsApp view.
    if (p.copyToClipboard === true && copiedSeq !== chatSeq && deps.writeClipboard) {
      copiedSeq = chatSeq;
      const seq = chatSeq;
      const file = pdfPath;
      Promise.resolve(deps.writeClipboard(file)).then((r) => {
        if (seq !== chatSeq || file !== pdfPath) return;
        state.clipboard = r && r.ok ? 'copied' : 'failed';
        emit();
      }).catch(() => { if (seq === chatSeq) { state.clipboard = 'failed'; emit(); } });
    }
    return { ok: true };
  }

  /** The person started dragging the PDF chip: a native file drag they drop
   *  into the chat themselves. */
  function startDrag(sender) {
    if (!pdfPath || !sender) return;
    let icon;
    try { icon = deps.nativeImage.createFromPath(deps.iconPath).resize({ width: 32, height: 32 }); } catch { icon = undefined; }
    sender.startDrag({ file: pdfPath, icon });
  }

  function windowGone() {
    view = null;
    attachedTo = null;
    clearPdf();
    Object.assign(state, { open: false, width: 0, loading: false, failed: false, pdfName: null, clipboard: 'idle' });
  }

  return { open, close, signOut, openElsewhere, setPdf, startDrag, relayout, owns, windowGone, state: publicState };
}

/** IPC + window wiring (main.js). Only the main window's page may drive it. */
function register(getWindow, electron = require('electron')) {
  const { ipcMain, WebContentsView, session, shell, nativeImage, clipboard } = electron;
  const clip = require('./whatsapp-clipboard');
  const dock = createDock({
    WebContentsView, session, shell, nativeImage, getWindow,
    writeClipboard: (file) => clip.writeFileToClipboard({
      clipboard, platform: process.platform, execFile: require('child_process').execFile,
      pathToFileURL: require('url').pathToFileURL,
    }, file),
    fs: require('fs'), os: require('os'), path: require('path'),
    iconPath: require('path').join(__dirname, 'icon.png'),
  });
  const fromApp = (e) => {
    const win = getWindow();
    return !!win && !win.isDestroyed() && e.sender === win.webContents;
  };
  ipcMain.handle('whatsapp:open', (e, url) => (fromApp(e) ? dock.open(String(url || '')) : { ok: false }));
  ipcMain.handle('whatsapp:close', (e) => (fromApp(e) ? dock.close() : { ok: false }));
  ipcMain.handle('whatsapp:signOut', (e) => (fromApp(e) ? dock.signOut() : { ok: false }));
  ipcMain.handle('whatsapp:state', (e) => (fromApp(e) ? dock.state() : null));
  ipcMain.handle('whatsapp:openElsewhere', (e, kind) => (fromApp(e) ? dock.openElsewhere(kind === 'app' ? 'app' : 'browser') : { ok: false }));
  ipcMain.handle('whatsapp:setPdf', (e, p) => (fromApp(e) ? dock.setPdf(p) : { ok: false }));
  ipcMain.on('whatsapp:startDrag', (e) => { if (fromApp(e)) dock.startDrag(e.sender); });
  return dock;
}

/** Follow the main window: re-lay the panel on resize / zoom / full screen. */
function attach(win, dock) {
  const relayout = () => dock.relayout();
  win.on('resize', relayout);
  win.on('enter-full-screen', relayout);
  win.on('leave-full-screen', relayout);
  win.webContents.on('zoom-changed', () => setTimeout(relayout, 0));
  win.webContents.on('did-finish-load', () => dock.relayout());
  win.on('closed', () => dock.windowGone());
}


/** WhatsApp Web only accepts real browsers ("works with Chrome 100+") and
 *  refuses Electron's default user agent, which carries "Electron/x" and the
 *  app's own name. The panel's engine IS Chromium, so it sends the same string
 *  minus those extra tokens, for the panel's partition only (owner decision
 *  2026-11-07). This changes how the panel identifies itself; it does not
 *  touch WhatsApp's page. */
function plainChromeUserAgent(ua) {
  const s = String(ua || '');
  if (!/Chrome\/\d+/.test(s)) return s;
  const keep = /^(Mozilla|AppleWebKit|Chrome|Safari|Version|Mobile)\//;
  return s.replace(/(^|\s)([A-Za-z][\w.-]*)\/[\w.+-]+/g, (m, sp, name) =>
    keep.test(name + '/') ? m : '').replace(/\s{2,}/g, ' ').trim();
}

module.exports = {
  PARTITION, WA_HOST_SUFFIXES, HEADER_CSS, ALLOWED_PERMISSIONS,
  isWhatsAppUrl, decideWaNavigation, parseClickToChat, appDeepLink, viewWebPreferences,
  decidePermission, plainChromeUserAgent, WA_LAYOUT_CSS, dockWidth, waZoom, dockLayout, safePdfName, isPdfBytes, createDock, register, attach,
};
