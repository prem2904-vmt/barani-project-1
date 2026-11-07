// WhatsApp Chat (desktop): the report PDF goes on OUR OS clipboard; WhatsApp Web is never touched.
// Clipboard writers per OS + dock wiring + source pins. Never launches Electron.
// Run: node --test electron/test/whatsapp-clipboard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');
const clip = require('../whatsapp-clipboard');
const dockLib = require('../whatsapp-dock');

function fakeClip(formats = []) {
  const c = { buffers: [], formats };
  c.writeBuffer = (f, b) => { c.buffers.push([f, b.toString()]); };
  c.availableFormats = () => c.formats;
  return c;
}

test('clipboard macOS: NSFilenamesPboardType plist (escaped); falls back to osascript with the path as argv', async () => {
  const c = fakeClip(['NSFilenamesPboardType']);
  const r = await clip.writeFileToClipboard({ clipboard: c, platform: 'darwin', execFile: () => { throw new Error('unused'); }, pathToFileURL }, '/tmp/a&b/r.pdf');
  assert.deepEqual(r, { ok: true, method: 'pasteboard' });
  assert.equal(c.buffers[0][0], 'NSFilenamesPboardType');
  assert.ok(c.buffers[0][1].includes('/tmp/a&amp;b/r.pdf'));
  const calls = [];
  const r2 = await clip.writeFileToClipboard({ clipboard: fakeClip([]), platform: 'darwin', execFile: (cmd, args, o, cb) => { calls.push([cmd, args]); cb(null); }, pathToFileURL }, '/tmp/r.pdf');
  assert.deepEqual(r2, { ok: true, method: 'osascript' });
  assert.equal(calls[0][1].at(-1), '/tmp/r.pdf');
  assert.ok(!calls[0][1].slice(0, -1).some((a) => a.includes('/tmp/r.pdf')));
});

test('clipboard Windows: real CF_HDROP through PowerShell Set-Clipboard; the path only in the environment', async () => {
  let seen;
  const r = await clip.writeFileToClipboard({ clipboard: fakeClip(), platform: 'win32', pathToFileURL,
    execFile: (cmd, args, o, cb) => { seen = { cmd, args, env: o.env }; cb(null); } }, 'C:\\Users\\o\'brien\\r.pdf');
  assert.deepEqual(r, { ok: true, method: 'powershell' });
  assert.equal(seen.cmd, 'powershell.exe');
  assert.ok(seen.args.includes('-STA'));
  assert.equal(seen.env.PF_WA_FILE, 'C:\\Users\\o\'brien\\r.pdf');
  assert.ok(!seen.args.join(' ').includes('brien'));
});

test('clipboard Linux: gnome-copied-files; unknown platform or a failing tool → { ok:false }, never throws', async () => {
  const c = fakeClip();
  assert.equal((await clip.writeFileToClipboard({ clipboard: c, platform: 'linux', execFile: null, pathToFileURL }, '/tmp/r.pdf')).ok, true);
  assert.equal(c.buffers[0][0], 'x-special/gnome-copied-files');
  assert.ok(c.buffers[0][1].startsWith('copy\nfile:///tmp/r.pdf'));
  assert.equal((await clip.writeFileToClipboard({ clipboard: fakeClip(), platform: 'freebsd', pathToFileURL }, '/x')).ok, false);
  assert.equal((await clip.writeFileToClipboard({ clipboard: fakeClip(), platform: 'win32', pathToFileURL, execFile: (a, b, c2, cb) => cb(new Error('no ps')) }, 'C:\\r.pdf')).ok, false);
});

// ── Dock wiring ─────────────────────────────────────────────────────────

function mkDock(writeClipboard) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-wa-clip-'));
  const win = new EventEmitter();
  const sent = [];
  win.webContents = { send: (ch, v) => sent.push([ch, v]), getZoomFactor: () => 1 };
  win.isDestroyed = () => false;
  win.getContentBounds = () => ({ x: 0, y: 0, width: 1440, height: 900 });
  win.contentView = { addChildView() {}, removeChildView() {} };
  const wcs = [];
  class View {
    constructor() {
      const wc = new EventEmitter();
      wc.session = {}; wc.isDestroyed = () => false; wc.close = () => {}; wc.loadURL = async () => {}; wc.setWindowOpenHandler = () => {};
      // Tripwires: nothing may ever act on, read or message the WhatsApp view.
      for (const m of ['executeJavaScript', 'insertCSS', 'sendInputEvent', 'paste', 'insertText', 'send', 'focus', 'startDrag'])
        wc[m] = () => { throw new Error(`${m} must never be called on the WhatsApp view`); };
      this.webContents = wc; wcs.push(wc);
    }
    setBounds() {}
  }
  const ses = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {} };
  const d = dockLib.createDock({
    WebContentsView: View, session: { fromPartition: () => ses }, shell: { openExternal() {} },
    nativeImage: {}, fs, path, os: { tmpdir: () => tmp }, iconPath: 'i.png', getWindow: () => win, writeClipboard,
  });
  return { d, sent, wcs };
}
const CHAT = 'https://web.whatsapp.com/send?phone=919876543210&text=Dear%20Asha';
const PDF = Buffer.from('%PDF-1.4\nx');
const settle = () => new Promise((r) => setTimeout(r, 5));

test('dock: the PDF is copied to OUR clipboard once per chat, only when asked; state says copied', async () => {
  const files = [];
  const { d, sent } = mkDock(async (f) => { files.push(f); return { ok: true }; });
  d.open(CHAT);
  d.setPdf({ name: 'a', bytes: PDF });                                 // no flag: drag only
  await settle();
  assert.deepEqual(files, []);
  d.setPdf({ name: 'a', bytes: PDF, copyToClipboard: true });
  d.setPdf({ name: 'a', bytes: PDF, copyToClipboard: true });         // a second hand-over: no second copy
  await settle();
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('a.pdf'));
  assert.equal(d.state().clipboard, 'copied');
  assert.equal(sent.at(-1)[1].clipboard, 'copied');
  d.setPdf({ name: 'bad', bytes: Buffer.from('<html>'), copyToClipboard: true });   // not a PDF: nothing
  assert.equal(files.length, 1);
  d.open('https://web.whatsapp.com/send?phone=919812345678&text=y'); // a new chat: reset, a new copy is allowed
  assert.equal(d.state().clipboard, 'idle');
  d.setPdf({ name: 'b', bytes: PDF, copyToClipboard: true });
  await settle();
  assert.equal(files.length, 2);
  d.close();
  assert.equal(d.state().clipboard, 'idle');
});

test('dock: a failed clipboard write says so (the person drags instead); a throwing writer never breaks the panel', async () => {
  const a = mkDock(async () => ({ ok: false }));
  a.d.open(CHAT);
  a.d.setPdf({ name: 'a', bytes: PDF, copyToClipboard: true });
  await settle();
  assert.equal(a.d.state().clipboard, 'failed');
  const b = mkDock(async () => { throw new Error('boom'); });
  b.d.open(CHAT);
  assert.equal(b.d.setPdf({ name: 'a', bytes: PDF, copyToClipboard: true }).ok, true);
  await settle();
  assert.equal(b.d.state().clipboard, 'failed');
});

test('dock: nothing is ever run on / sent to the WhatsApp view (tripwires throw)', async () => {
  const { d } = mkDock(async () => ({ ok: true }));
  d.open(CHAT);
  d.setPdf({ name: 'a', bytes: PDF, copyToClipboard: true });
  await settle();
  d.relayout();
  d.close();
});

// ── Source pins (WhatsApp's Terms: no automating, reading or modifying the Service) ──

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('source pin: the dock never acts on the WhatsApp view; no preload; no ipc into it', () => {
  const src = strip(fs.readFileSync(path.join(__dirname, '..', 'whatsapp-dock.js'), 'utf8'));
  for (const banned of ['executeJavaScript', 'insertCSS', 'sendInputEvent', '.paste(', 'insertText', 'setUserAgent', 'userAgent',
    'preload:', 'debugger', 'ipcRenderer', 'webFrame', 'setPreloads', 'registerPreloadScript', 'wc.send(', 'view.webContents.send', 'wc.focus(', 'view.webContents.focus']) {
    assert.equal(src.includes(banned), false, `whatsapp-dock.js must not use ${banned}`);
  }
  assert.equal(dockLib.viewWebPreferences().preload, undefined);
  // the only startDrag is on the app window's own contents (our header), never the view
  assert.equal(/view\.webContents\.startDrag|wc\.startDrag/.test(src), false);
});

test('source pin: the clipboard module has no access to any web contents at all', () => {
  const src = strip(fs.readFileSync(path.join(__dirname, '..', 'whatsapp-clipboard.js'), 'utf8'));
  for (const banned of ['webContents', 'executeJavaScript', 'paste(', 'insertText', 'sendInputEvent', 'WebContentsView', 'BrowserWindow']) {
    assert.equal(src.includes(banned), false, `whatsapp-clipboard.js must not use ${banned}`);
  }
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'whatsapp-attach.js')), false);
});

test('source pin: preload exposes no way to script WhatsApp (open / close / state / setPdf / startDrag only)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const block = src.slice(src.indexOf('whatsapp: {'), src.indexOf('// Desktop self-update'));
  for (const m of ['open', 'close', 'signOut', 'state', 'onState', 'openElsewhere', 'setPdf', 'startDrag']) assert.ok(block.includes(`${m}:`), m);
  assert.equal(/copyPdf|executeJavaScript|paste|insertText|caption/.test(block.replace(/\/\/.*$/gm, '')), false);
});
