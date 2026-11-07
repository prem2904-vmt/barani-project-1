// "Send on WhatsApp" docked panel (electron/whatsapp-dock.js) — pure rules +
// the panel with fake Electron pieces. Never launches Electron.
// Run: node --test electron/test/whatsapp-dock.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const dock = require('../whatsapp-dock');

const CHAT = 'https://web.whatsapp.com/send?phone=919876543210&text=Dear%20Asha%2C%20your%20report';

// ── Pure rules ────────────────────────────────────────────────────────

test('click-to-chat: only the exact official link passes', () => {
  assert.deepEqual(dock.parseClickToChat(CHAT), { phone: '919876543210', text: 'Dear Asha, your report' });
  const bad = [
    'http://web.whatsapp.com/send?phone=919876543210&text=x',          // not https
    'https://evil.com/send?phone=919876543210&text=x',
    'https://web.whatsapp.com.evil.com/send?phone=919876543210',
    'https://web.whatsapp.com/?phone=919876543210&text=x',             // not /send
    'https://web.whatsapp.com/send?phone=919876543210&text=x&send=1',  // extra param
    'https://web.whatsapp.com/send?phone=919876543210&phone=91999',    // duplicated
    'https://web.whatsapp.com/send?phone=98765&text=x',                // too short
    'https://web.whatsapp.com/send?phone=+919876543210&text=x',        // not digits
    'https://web.whatsapp.com/send?text=x',                            // no phone
    'https://web.whatsapp.com:8443/send?phone=919876543210',
    'https://u:p@web.whatsapp.com/send?phone=919876543210',
    'https://web.whatsapp.com/send?phone=919876543210#x',
    'javascript:alert(1)', 'not a url', '',
  ];
  for (const u of bad) assert.equal(dock.parseClickToChat(u), null, u);
  assert.equal(dock.parseClickToChat(`https://web.whatsapp.com/send?phone=919876543210&text=${'a'.repeat(4001)}`), null);
});

test('the app fallback keeps the same chat and message', () => {
  assert.equal(dock.appDeepLink({ phone: '919876543210', text: 'Hi & bye' }), 'whatsapp://send?phone=919876543210&text=Hi%20%26%20bye');
});

test('navigation stays on *.whatsapp.com / *.whatsapp.net; other links go to the browser', () => {
  for (const u of ['https://web.whatsapp.com/', 'https://static.whatsapp.net/x.js', 'https://whatsapp.com/', 'https://faq.whatsapp.com/1']) {
    assert.deepEqual(dock.decideWaNavigation(u), { allow: true, openExternal: false }, u);
  }
  assert.deepEqual(dock.decideWaNavigation('https://example.com/'), { allow: false, openExternal: true });
  assert.deepEqual(dock.decideWaNavigation('https://notwhatsapp.com/'), { allow: false, openExternal: true });
  assert.deepEqual(dock.decideWaNavigation('https://whatsapp.com.evil.io/'), { allow: false, openExternal: true });
  assert.deepEqual(dock.decideWaNavigation('http://web.whatsapp.com/'), { allow: false, openExternal: true });
  assert.deepEqual(dock.decideWaNavigation('file:///etc/passwd'), { allow: false, openExternal: false });
  assert.deepEqual(dock.decideWaNavigation('app://prefrontal/index.html'), { allow: false, openExternal: false });
  assert.deepEqual(dock.decideWaNavigation('javascript:alert(1)'), { allow: false, openExternal: false });
});

test('own persistent partition, sandboxed, isolated, no Node and NO preload', () => {
  const p = dock.viewWebPreferences();
  assert.equal(dock.PARTITION, 'persist:whatsapp');
  assert.equal(p.partition, 'persist:whatsapp');
  assert.equal(p.contextIsolation, true);
  assert.equal(p.nodeIntegration, false);
  assert.equal(p.nodeIntegrationInSubFrames, false);
  assert.equal(p.sandbox, true);
  assert.equal(p.webSecurity, true);
  assert.equal(p.webviewTag, false);
  assert.equal('preload' in p, false);
  assert.equal('preloadURL' in p, false);
  assert.equal('session' in p, false);   // never the app's session
});

test('permissions: notifications + copying only', () => {
  assert.equal(dock.decidePermission('notifications'), true);
  assert.equal(dock.decidePermission('clipboard-sanitized-write'), true);
  for (const p of ['media', 'geolocation', 'clipboard-read', 'display-capture', 'midi', 'hid', 'serial', 'usb', 'openExternal', 'fullscreen', 'pointerLock']) {
    assert.equal(dock.decidePermission(p), false, p);
  }
});

test('layout: phone-width panel on the right, the app keeps the rest', () => {
  const l = dock.dockLayout({ width: 1440, height: 900 }, 1);
  assert.equal(l.bounds.width, 380);
  assert.equal(l.bounds.x, 1440 - 380);
  assert.equal(l.bounds.y, dock.HEADER_CSS);
  assert.equal(l.bounds.height, 900 - dock.HEADER_CSS);
  assert.equal(l.cssWidth, 380);
  assert.equal(dock.dockLayout({ width: 1920, height: 1080 }).bounds.width, 461);   // ~24%
  assert.equal(dock.dockLayout({ width: 2560, height: 1440 }).bounds.width, 480);   // capped
  assert.equal(dock.dockLayout({ width: 900, height: 700 }).bounds.width, 340);     // app keeps 560
  // A zoomed page: DIP bounds, CSS width for the page's reflow.
  const z = dock.dockLayout({ width: 1440, height: 900 }, 1.25);
  assert.equal(z.bounds.y, 140);
  assert.equal(z.cssWidth, 304);
  assert.equal(z.cssTop, dock.HEADER_CSS);
});

test('PDF helper: safe names, real PDFs only', () => {
  assert.equal(dock.safePdfName('Report ../../etc/x'), 'Report -etc-x.pdf');
  assert.equal(dock.safePdfName('report-1A2B.pdf'), 'report-1A2B.pdf');
  assert.equal(dock.safePdfName(''), 'report.pdf');
  assert.equal(dock.isPdfBytes(Buffer.from('%PDF-1.7\n')), true);
  assert.equal(dock.isPdfBytes(Buffer.from('<html>')), false);
  assert.equal(dock.isPdfBytes(null), false);
});

// ── The panel with fake Electron ──────────────────────────────────────

function fakes() {
  const calls = { external: [], added: [], removed: [], loaded: [], cleared: [], drags: [], views: [] };
  const ses = {
    perm: null, check: null, device: null,
    setPermissionRequestHandler(fn) { this.perm = fn; },
    setPermissionCheckHandler(fn) { this.check = fn; },
    setDevicePermissionHandler(fn) { this.device = fn; },
    clearStorageData: async () => calls.cleared.push('storage'),
    clearCache: async () => calls.cleared.push('cache'),
    clearAuthCache: async () => calls.cleared.push('auth'),
  };
  const appSession = { name: 'app' };
  const partitions = [];
  class WebContentsView {
    constructor(opts) {
      this.opts = opts;
      const wc = new EventEmitter();
      wc.session = ses;
      wc.destroyed = false;
      wc.isDestroyed = () => wc.destroyed;
      wc.close = () => { wc.destroyed = true; };
      wc.loadURL = async (u) => { calls.loaded.push(u); };
      wc.setWindowOpenHandler = (fn) => { wc.openHandler = fn; };
      // Tripwires: nothing may ever be run inside WhatsApp.
      wc.executeJavaScript = () => { throw new Error('executeJavaScript must never be called on WhatsApp'); };
      wc.insertCSS = () => { throw new Error('insertCSS must never be called on WhatsApp'); };
      wc.sendInputEvent = () => { throw new Error('sendInputEvent must never be called on WhatsApp'); };
      wc.send = () => { throw new Error('nothing is sent into WhatsApp'); };
      wc.paste = () => { throw new Error('paste must never be called on WhatsApp'); };
      wc.insertText = () => { throw new Error('insertText must never be called on WhatsApp'); };
      wc.focus = () => { throw new Error('the WhatsApp view is never focused or driven by us'); };
      this.webContents = wc;
      calls.views.push(this);
    }
    setBounds(b) { this.bounds = b; }
  }
  const win = new EventEmitter();
  const mainWc = new EventEmitter();
  mainWc.sent = [];
  mainWc.send = (ch, v) => mainWc.sent.push([ch, v]);
  mainWc.getZoomFactor = () => 1;
  mainWc.session = appSession;
  win.webContents = mainWc;
  win.isDestroyed = () => false;
  win.getContentBounds = () => ({ x: 0, y: 0, width: 1440, height: 900 });
  win.contentView = {
    addChildView: (v) => calls.added.push(v),
    removeChildView: (v) => calls.removed.push(v),
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-wa-test-'));
  const d = dock.createDock({
    WebContentsView,
    session: { fromPartition: (p) => { partitions.push(p); return p === dock.PARTITION ? ses : appSession; } },
    shell: { openExternal: (u) => calls.external.push(u) },
    nativeImage: { createFromPath: () => ({ resize: () => 'icon' }) },
    fs, path, os: { tmpdir: () => tmp }, iconPath: 'icon.png',
    getWindow: () => win,
  });
  return { d, calls, ses, win, mainWc, partitions, appSession, tmp };
}

test('open: rejects anything but click-to-chat (nothing created)', () => {
  const { d, calls } = fakes();
  assert.deepEqual(d.open('https://example.com/'), { ok: false, error: 'not_click_to_chat' });
  assert.deepEqual(d.open('https://web.whatsapp.com/send?phone=919876543210&text=x&auto=1'), { ok: false, error: 'not_click_to_chat' });
  assert.equal(calls.views.length, 0);
  assert.equal(calls.loaded.length, 0);
});

test('open: docks on the right in the whatsapp partition, loads only the link, tells the page', () => {
  const { d, calls, mainWc, partitions, ses } = fakes();
  assert.deepEqual(d.open(CHAT), { ok: true });
  const v = calls.views[0];
  assert.equal(v.opts.webPreferences.partition, 'persist:whatsapp');
  assert.equal('preload' in v.opts.webPreferences, false);
  assert.equal(v.webContents.session, ses);
  assert.ok(partitions.every((p) => p === 'persist:whatsapp'));
  assert.deepEqual(calls.added, [v]);
  assert.deepEqual(calls.loaded, [CHAT]);
  assert.deepEqual(v.bounds, { x: 1060, y: 112, width: 380, height: 788 });
  const last = mainWc.sent.at(-1);
  assert.equal(last[0], 'whatsapp:state');
  assert.equal(last[1].open, true);
  assert.equal(last[1].width, 380);
  assert.equal(last[1].top, 112);
  // A second click reuses the same panel (same view, not re-added).
  d.open('https://web.whatsapp.com/send?phone=919812345678&text=y');
  assert.equal(calls.views.length, 1);
  assert.equal(calls.added.length, 1);
  assert.equal(calls.loaded.length, 2);
});

test('the panel is hardened: permissions, new windows, navigation', () => {
  const { d, calls, ses } = fakes();
  d.open(CHAT);
  const wc = calls.views[0].webContents;
  let granted = null;
  ses.perm(wc, 'media', (ok) => { granted = ok; });
  assert.equal(granted, false);
  ses.perm(wc, 'notifications', (ok) => { granted = ok; });
  assert.equal(granted, true);
  assert.equal(ses.check(wc, 'geolocation'), false);
  assert.equal(ses.device(), false);
  // window.open from WhatsApp: never in-app, web links to the system browser.
  assert.deepEqual(wc.openHandler({ url: 'https://example.com/a' }), { action: 'deny' });
  assert.deepEqual(wc.openHandler({ url: 'file:///x' }), { action: 'deny' });
  assert.deepEqual(calls.external, ['https://example.com/a']);
  // Leaving WhatsApp is blocked (and opened outside when safe).
  let prevented = false;
  wc.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://evil.example/');
  assert.equal(prevented, true);
  assert.equal(calls.external.at(-1), 'https://evil.example/');
  prevented = false;
  wc.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://web.whatsapp.com/');
  assert.equal(prevented, false);
  prevented = false;
  wc.emit('will-redirect', { preventDefault: () => { prevented = true; } }, 'https://tracker.example/');
  assert.equal(prevented, true);
});

test('owns(): only the whatsapp partition, never the app window', () => {
  const { d, calls, mainWc } = fakes();
  d.open(CHAT);
  assert.equal(d.owns(calls.views[0].webContents), true);
  assert.equal(d.owns(mainWc), false);
  assert.equal(d.owns(null), false);
});

test('a failed load offers the fallback; browser / app get the SAME chat', () => {
  const { d, calls, mainWc } = fakes();
  d.open(CHAT);
  const wc = calls.views[0].webContents;
  wc.emit('did-fail-load', {}, -3, 'aborted', CHAT, true);          // aborted: not a failure
  assert.equal(mainWc.sent.at(-1)[1].failed, false);
  wc.emit('did-fail-load', {}, -105, 'name not resolved', CHAT, false);   // a sub-frame: ignored
  assert.equal(d.state().failed, false);
  wc.emit('did-fail-load', {}, -105, 'name not resolved', CHAT, true);
  assert.equal(mainWc.sent.at(-1)[1].failed, true);
  d.openElsewhere('browser');
  d.openElsewhere('app');
  assert.deepEqual(calls.external, [CHAT, 'whatsapp://send?phone=919876543210&text=Dear%20Asha%2C%20your%20report']);
});

test('close removes the panel; sign out also wipes the whatsapp partition', async () => {
  const { d, calls, mainWc } = fakes();
  d.open(CHAT);
  d.close();
  assert.equal(calls.removed.length, 1);
  assert.equal(calls.views[0].webContents.destroyed, true);
  assert.equal(mainWc.sent.at(-1)[1].open, false);
  d.open(CHAT);
  await d.signOut();
  assert.deepEqual(calls.cleared, ['storage', 'cache', 'auth']);
  assert.equal(d.state().open, false);
  assert.equal(d.openElsewhere('browser').ok, true);   // the last chat is still known
});

test('PDF drag: only a real PDF, written privately, dragged only from the person’s gesture', () => {
  const { d, mainWc, tmp } = fakes();
  assert.equal(d.setPdf({ name: 'x.pdf', bytes: Buffer.from('%PDF-1.4') }).ok, false);   // panel closed
  d.open(CHAT);
  assert.equal(d.setPdf({ name: 'x.pdf', bytes: Buffer.from('<html>') }).ok, false);
  assert.equal(d.setPdf({ name: 'report-AB12', bytes: new Uint8Array(Buffer.from('%PDF-1.4\nhello')) }).ok, true);
  const file = path.join(tmp, 'prefrontal-whatsapp', 'report-AB12.pdf');
  assert.equal(fs.readFileSync(file, 'utf8').startsWith('%PDF-'), true);
  assert.equal(mainWc.sent.at(-1)[1].pdfName, 'report-AB12.pdf');
  const drags = [];
  d.startDrag({ startDrag: (o) => drags.push(o) });
  assert.deepEqual(drags, [{ file, icon: 'icon' }]);
  // A new chat drops the old PDF.
  d.open('https://web.whatsapp.com/send?phone=919812345678&text=y');
  assert.equal(fs.existsSync(file), false);
  assert.equal(d.state().pdfName, null);
  d.startDrag({ startDrag: (o) => drags.push(o) });
  assert.equal(drags.length, 1);
});

test('IPC: only the main window may drive the panel', async () => {
  const handlers = new Map();
  const ons = new Map();
  const fake = fakes();
  const electron = {
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on: (ch, fn) => ons.set(ch, fn) },
    WebContentsView: function () { throw new Error('not in this test'); },
    session: { fromPartition: () => ({}) },
    shell: { openExternal: () => {} },
    nativeImage: {},
  };
  dock.register(() => fake.win, electron);
  assert.deepEqual([...handlers.keys()].sort(), ['whatsapp:close', 'whatsapp:open', 'whatsapp:openElsewhere', 'whatsapp:setPdf', 'whatsapp:signOut', 'whatsapp:state']);
  assert.ok(ons.has('whatsapp:startDrag'));
  const stranger = { sender: {} };
  assert.deepEqual(await handlers.get('whatsapp:open')(stranger, CHAT), { ok: false });
  assert.equal(await handlers.get('whatsapp:state')(stranger), null);
  assert.deepEqual(await handlers.get('whatsapp:open')({ sender: fake.mainWc }, 'https://example.com'), { ok: false, error: 'not_click_to_chat' });
});

test('source pin: no injection, no preload, no automation APIs; the only UA change is the plain-Chrome one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'whatsapp-dock.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of ['executeJavaScript', 'insertCSS', 'sendInputEvent', 'preload:', 'debugger', 'ipcRenderer', 'webFrame', 'executeJavaScriptInIsolatedWorld', 'setPreloads', 'registerPreloadScript']) {
    assert.equal(src.includes(banned), false, `whatsapp-dock.js must not use ${banned}`);
  }
  const uaCalls = src.match(/setUserAgent\(/g) || [];
  assert.equal(uaCalls.length, 1, 'exactly one setUserAgent call');
  assert.ok(src.includes('ses.setUserAgent(plainChromeUserAgent(ses.getUserAgent()))'), 'UA is only ever the plain-Chrome form of the real one');
});

test('main.js: the app-wide navigation guard skips the panel (it has its own)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /if \(waDock\.owns\(contents\)\) return;/);
  assert.match(main, /whatsappDock\.register\(\(\) => mainWindow\)/);
});

test('plainChromeUserAgent strips Electron and app tokens, keeps a real Chrome string', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Prefrontal/1.2.0 Chrome/140.0.7339.41 Electron/45.2.3 Safari/537.36';
  assert.equal(dock.plainChromeUserAgent(ua),
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.41 Safari/537.36');
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) prefrontal-lms/1.1.1 Chrome/140.0.0.0 Electron/45.0.0 Safari/537.36';
  assert.equal(dock.plainChromeUserAgent(win),
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  assert.equal(dock.plainChromeUserAgent(''), '');
  assert.equal(dock.plainChromeUserAgent('curl/8'), 'curl/8');
});
