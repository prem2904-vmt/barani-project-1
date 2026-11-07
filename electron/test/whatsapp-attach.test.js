// WhatsApp Chat PDF attach (electron/whatsapp-attach.js + its wiring in whatsapp-dock.js).
// Pure helpers + state machine + dock wiring with fakes. Never launches Electron.
// UNTESTED LIVE against the real WhatsApp Web — selectors are constants that may drift.
// Run: node --test electron/test/whatsapp-attach.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const att = require('../whatsapp-attach');
const dockLib = require('../whatsapp-dock');

const T = { captionMs: 500, readyMs: 1000, readyPollMs: 100, verifyMs: 500, verifyPollMs: 100, settleMs: 0, restoreAfterMs: 0 };

/** Virtual clock: sleep advances it, so timeouts run instantly. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

function machine(probes, extra = {}) {
  const c = clock();
  const log = [];
  let i = 0;
  const deps = {
    probe: async () => { const p = probes[Math.min(i, probes.length - 1)]; i++; return typeof p === 'function' ? p(log) : p; },
    focus: async () => { log.push('focus'); },
    paste: () => { log.push('paste'); },
    drop: extra.noDrop ? null : async () => { log.push('drop'); },
    sleep: c.sleep, now: c.now, cancelled: extra.cancelled || (() => false),
  };
  return { deps, log };
}

const READY = { qr: false, composer: true, dialog: false, preview: false };
const PREVIEW = { qr: false, composer: true, dialog: true, preview: true };
const QR = { qr: true, composer: false, dialog: false, preview: false };
const NOTHING = { qr: false, composer: false, dialog: false, preview: false };

test('pure decisions: ready needs the composer and no QR; preview is generous so a drifted selector never double-attaches', () => {
  assert.equal(att.chatReady(READY), true);
  assert.equal(att.chatReady(QR), false);
  assert.equal(att.chatReady(null), false);
  assert.equal(att.previewOpen(READY), false);
  assert.equal(att.previewOpen(PREVIEW), true);
  assert.equal(att.previewOpen({ ...READY, dialog: true }), true);          // any dialog
  assert.equal(att.previewOpen({ ...READY, composer: false }), true);       // composer gone
  assert.equal(att.previewOpen(null), false);
});

test('state machine: chat ready → focus → paste → preview = attached (no drop)', async () => {
  const m = machine([NOTHING, READY, READY, PREVIEW]);
  assert.equal(await att.runAttach(m.deps, T), 'attached');
  assert.deepEqual(m.log, ['focus', 'paste']);
});

test('state machine: paste shows no preview → ONE drop → attached-drop', async () => {
  const m = machine([(log) => (log.includes('drop') ? PREVIEW : READY)]);
  assert.equal(await att.runAttach(m.deps, T), 'attached-drop');
  assert.equal(m.log.filter((x) => x === 'drop').length, 1);
  assert.equal(m.log.filter((x) => x === 'paste').length, 1);
});

test('state machine: paste and drop both fail → manual (hint), nothing else tried', async () => {
  const m = machine([READY]);
  assert.equal(await att.runAttach(m.deps, T), 'manual');
  assert.deepEqual(m.log, ['focus', 'paste', 'drop']);
});

test('state machine: no drop available (too big) → manual after paste', async () => {
  const m = machine([READY], { noDrop: true });
  assert.equal(await att.runAttach(m.deps, T), 'manual');
  assert.deepEqual(m.log, ['focus', 'paste']);
});

test('state machine: QR (not signed in) → not-signed-in, no paste; chat never loads → manual, no paste', async () => {
  const a = machine([QR]);
  assert.equal(await att.runAttach(a.deps, T), 'not-signed-in');
  assert.deepEqual(a.log, []);
  const b = machine([NOTHING]);
  assert.equal(await att.runAttach(b.deps, T), 'manual');
  assert.deepEqual(b.log, []);
});

test('state machine: a throwing probe is a miss, not a crash; a throwing paste still verifies / falls back', async () => {
  const m = machine([() => { throw new Error('x'); }, READY, READY]);
  m.deps.paste = () => { throw new Error('no clipboard file'); };
  assert.equal(await att.runAttach(m.deps, T), 'manual');
});

test('state machine: cancelled (chat changed / closed) stops at once', async () => {
  let cancelled = false;
  const m = machine([NOTHING, NOTHING, NOTHING], { cancelled: () => cancelled });
  const p = att.runAttach({ ...m.deps, probe: async () => { cancelled = true; return NOTHING; } }, T);
  assert.equal(await p, 'cancelled');
  assert.deepEqual(m.log, []);
});

test('timeouts: ~20 s to load the chat, a few seconds to see the preview', () => {
  assert.equal(att.TIMEOUTS.readyMs, 20000);
  assert.ok(att.TIMEOUTS.verifyMs >= 3000 && att.TIMEOUTS.verifyMs <= 6000);
});

// ── Page scripts ────────────────────────────────────────────────────────

test('scripts: constants + JSON-quoted data only; the drop carries the bytes and a quoted name', () => {
  const evil = 'a");alert(1);//.pdf';
  const s = att.dropScript('QUJD', evil);
  assert.ok(s.includes(JSON.stringify(evil)));
  assert.ok(!s.includes('a");alert(1)'));
  assert.ok(att.probeScript().includes(JSON.stringify(att.SELECTORS.composer)));
  assert.ok(att.focusScript().includes('.focus()'));
  assert.ok(att.MAX_DROP_BYTES <= 10 * 1024 * 1024);
});

// ── Clipboard (per OS) ──────────────────────────────────────────────────

function clip(formats = []) {
  const c = { buffers: [], formats, cleared: 0, written: null };
  c.writeBuffer = (f, b) => { c.buffers.push([f, b.toString()]); };
  c.availableFormats = () => c.formats;
  c.readText = () => 'old text'; c.readHTML = () => ''; c.readImage = () => ({ isEmpty: () => true });
  c.clear = () => { c.cleared++; };
  c.write = (d) => { c.written = d; };
  return c;
}

test('clipboard macOS: NSFilenamesPboardType plist (escaped); falls back to osascript with the path as argv', async () => {
  const c = clip(['NSFilenamesPboardType']);
  const r = await att.writeFileToClipboard({ clipboard: c, platform: 'darwin', execFile: () => { throw new Error('unused'); }, pathToFileURL }, '/tmp/a&b/r.pdf');
  assert.deepEqual(r, { ok: true, method: 'pasteboard' });
  assert.equal(c.buffers[0][0], 'NSFilenamesPboardType');
  assert.ok(c.buffers[0][1].includes('/tmp/a&amp;b/r.pdf'));

  const c2 = clip([]);
  const calls = [];
  const r2 = await att.writeFileToClipboard({ clipboard: c2, platform: 'darwin', execFile: (cmd, args, o, cb) => { calls.push([cmd, args]); cb(null); }, pathToFileURL }, '/tmp/r.pdf');
  assert.deepEqual(r2, { ok: true, method: 'osascript' });
  assert.equal(calls[0][0], 'osascript');
  assert.equal(calls[0][1].at(-1), '/tmp/r.pdf');
  assert.ok(!calls[0][1].slice(0, -1).some((a) => a.includes('/tmp/r.pdf')));   // never inside the script text
});

test('clipboard Windows: real CF_HDROP through PowerShell Set-Clipboard; the path only in the environment', async () => {
  let seen;
  const r = await att.writeFileToClipboard({ clipboard: clip(), platform: 'win32', pathToFileURL,
    execFile: (cmd, args, o, cb) => { seen = { cmd, args, env: o.env }; cb(null); } }, 'C:\\Users\\o\'brien\\r.pdf');
  assert.deepEqual(r, { ok: true, method: 'powershell' });
  assert.equal(seen.cmd, 'powershell.exe');
  assert.ok(seen.args.includes('-STA'));
  assert.equal(seen.env.PF_WA_FILE, 'C:\\Users\\o\'brien\\r.pdf');
  assert.ok(!seen.args.join(' ').includes('brien'));
});

test('clipboard Linux: gnome-copied-files; unknown platform or a failing tool → { ok:false }, never throws', async () => {
  const c = clip();
  const r = await att.writeFileToClipboard({ clipboard: c, platform: 'linux', execFile: null, pathToFileURL }, '/tmp/r.pdf');
  assert.equal(r.ok, true);
  assert.equal(c.buffers[0][0], 'x-special/gnome-copied-files');
  assert.ok(c.buffers[0][1].startsWith('copy\nfile:///tmp/r.pdf'));
  assert.equal((await att.writeFileToClipboard({ clipboard: clip(), platform: 'freebsd', pathToFileURL }, '/x')).ok, false);
  const bad = await att.writeFileToClipboard({ clipboard: clip(), platform: 'win32', pathToFileURL, execFile: (a, b, c2, cb) => cb(new Error('no ps')) }, 'C:\\r.pdf');
  assert.equal(bad.ok, false);
});

test('clipboard restore: only while it still holds OUR file', () => {
  const c = clip(['NSFilenamesPboardType']);
  const snap = att.snapshotClipboard(c);
  assert.equal(att.restoreClipboard(c, snap, 'NSFilenamesPboardType'), true);
  assert.deepEqual(c.written, { text: 'old text' });
  const c2 = clip(['text/plain']);                              // the user copied something else meanwhile
  assert.equal(att.restoreClipboard(c2, att.snapshotClipboard(c2), 'NSFilenamesPboardType'), false);
  assert.equal(att.restoreClipboard(c2, null, 'x'), false);
});

// ── The attacher: scripts only on WhatsApp's own page, one attempt, cancel ─

function attacher(over = {}) {
  const c = clock();
  const calls = { exec: [], paste: 0, focus: 0, steps: [] };
  const state = { host: 'web.whatsapp.com', probes: [READY, PREVIEW], i: 0 };
  const wc = {
    isDestroyed: () => false,
    getURL: () => `https://${state.host}/send?phone=1`,
    focus: () => { calls.focus++; },
    paste: () => { calls.paste++; },
    executeJavaScript: async (code) => {
      calls.exec.push(code);
      if (code.includes('qr:')) return state.probes[Math.min(state.i++, state.probes.length - 1)];
      return true;
    },
  };
  const a = att.createAttacher({
    getContents: () => wc, clipboard: clip(['NSFilenamesPboardType']), platform: 'darwin', execFile: null, pathToFileURL,
    hostOk: dockLib.PARTITION && ((h) => h === 'web.whatsapp.com' || h.endsWith('.whatsapp.com')),
    sleep: c.sleep, now: c.now, onStep: (s) => calls.steps.push(s), timeouts: T, ...over,
  });
  return { a, calls, state, wc };
}

test('attacher: happy path steps preparing → working → attached; one paste; no Send anywhere', async () => {
  const { a, calls } = attacher();
  const r = await a.start({ file: '/tmp/r.pdf', name: 'r.pdf', bytes: Buffer.from('%PDF-1.4') });
  assert.equal(r, 'attached');
  assert.deepEqual(calls.steps, ['preparing', 'working', 'attached']);
  assert.equal(calls.paste, 1);
  assert.equal(calls.exec.some((c) => /\.click\(|keydown|keypress|sendInputEvent/.test(c)), false);
});

test('attacher: never scripts a page that left WhatsApp', async () => {
  const { a, calls, state } = attacher();
  state.host = 'evil.example';
  const r = await a.start({ file: '/tmp/r.pdf', name: 'r.pdf', bytes: Buffer.from('%PDF-1.4') });
  assert.equal(r, 'manual');
  assert.equal(calls.exec.length, 0);
  assert.equal(calls.paste, 0);
});

test('attacher: no clipboard file → no paste (drop is the next step); cancel supersedes a running attempt', async () => {
  const { a, calls, state } = attacher({ platform: 'plan9', clipboard: clip() });
  state.probes = [READY];
  const r = await a.start({ file: '/tmp/r.pdf', name: 'r.pdf', bytes: Buffer.from('%PDF-1.4') });
  assert.equal(calls.paste, 0);
  assert.ok(['attached-drop', 'manual'].includes(r));

  const b = attacher();
  b.state.probes = [NOTHING];
  const p = b.a.start({ file: '/tmp/r.pdf', name: 'r.pdf', bytes: Buffer.from('%PDF-1.4') });
  b.a.cancel();
  assert.equal(await p, 'cancelled');
  assert.equal(b.calls.steps.includes('manual'), false);
});


// ── Caption: the message drafted into the preview (never Send / Enter) ────────

function withCaption(probes, caption, captionProbes) {
  const m = machine(probes);
  let i = 0;
  m.deps.captionText = caption;
  m.deps.captionProbe = async () => captionProbes[Math.min(i++, captionProbes.length - 1)];
  m.deps.caption = async () => { m.log.push('caption'); };
  return m;
}

test('caption: preview open + empty caption box → the message is drafted once', async () => {
  const m = withCaption([READY, READY, PREVIEW], 'Dear Asha', [{ caption: false, captionText: '' }, { caption: true, captionText: '' }]);
  assert.equal(await att.runAttach(m.deps, T), 'attached');
  assert.deepEqual(m.log, ['focus', 'paste', 'caption']);
});

test('caption: WhatsApp already carried the text over → no duplicate', async () => {
  const m = withCaption([READY, PREVIEW], 'Dear Asha', [{ caption: true, captionText: 'Dear Asha, your report' }]);
  assert.equal(await att.runAttach(m.deps, T), 'attached');
  assert.deepEqual(m.log, ['focus', 'paste']);
});

test('caption: no caption box found → still attached, nothing typed; also after a drop', async () => {
  const a = withCaption([READY, PREVIEW], 'x', [{ caption: false, captionText: '' }]);
  assert.equal(await att.runAttach(a.deps, T), 'attached');
  assert.deepEqual(a.log, ['focus', 'paste']);
  const b = withCaption([(log) => (log.includes('drop') ? PREVIEW : READY)], 'x', [{ caption: true, captionText: '' }]);
  assert.equal(await att.runAttach(b.deps, T), 'attached-drop');
  assert.ok(b.log.includes('caption'));
});

test('caption: a throwing caption step never undoes the attach', async () => {
  const m = withCaption([READY, PREVIEW], 'x', [{ caption: true, captionText: '' }]);
  m.deps.caption = async () => { throw new Error('boom'); };
  assert.equal(await att.runAttach(m.deps, T), 'attached');
});

test('caption pure rule + scripts', () => {
  assert.equal(att.captionNeedsText({ caption: true, captionText: '  ' }, 'hi'), true);
  assert.equal(att.captionNeedsText({ caption: true, captionText: 'hi' }, 'hi'), false);
  assert.equal(att.captionNeedsText({ caption: false, captionText: '' }, 'hi'), false);
  assert.equal(att.captionNeedsText({ caption: true, captionText: '' }, ''), false);
  assert.ok(att.captionProbeScript().includes(JSON.stringify(att.SELECTORS.caption)));
  assert.ok(!/send/i.test(att.SELECTORS.caption));
});

test('attacher: drafts the caption with insertText after focusing it; never when text is already there', async () => {
  const a = attacher();
  const typed = [];
  let captionText = '';
  a.wc.insertText = (t) => typed.push(t);
  const orig = a.wc.executeJavaScript;
  a.wc.executeJavaScript = async (code) => (code.includes('captionText') ? { caption: true, captionText } : orig(code));
  assert.equal(await a.a.start({ file: '/tmp/r.pdf', name: 'r.pdf', bytes: Buffer.from('%PDF-1.4'), caption: 'Dear Asha, link' }), 'attached');
  assert.deepEqual(typed, ['Dear Asha, link']);
  const b = attacher();
  const typed2 = [];
  b.wc.insertText = (t) => typed2.push(t);
  const orig2 = b.wc.executeJavaScript;
  b.wc.executeJavaScript = async (code) => (code.includes('captionText') ? { caption: true, captionText: 'Dear Asha, link' } : orig2(code));
  await b.a.start({ file: '/tmp/r.pdf', name: 'r.pdf', bytes: Buffer.from('%PDF-1.4'), caption: 'Dear Asha, link' });
  assert.deepEqual(typed2, []);
});

// ── Dock wiring ─────────────────────────────────────────────────────────

test('dock: autoAttach runs once per chat opened by our button; never without the flag; cancelled on close/new chat', async () => {
  const started = [];
  let cancels = 0;
  const events = require('events');
  const fakeAttacher = { start: async (a) => { started.push(a.name); return 'attached'; }, copyAgain: async () => ({ ok: true }), cancel: () => { cancels++; } };
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-wa-att-'));
  const win = new events.EventEmitter();
  win.webContents = { send() {}, getZoomFactor: () => 1 };
  win.isDestroyed = () => false;
  win.getContentBounds = () => ({ x: 0, y: 0, width: 1440, height: 900 });
  win.contentView = { addChildView() {}, removeChildView() {} };
  class View {
    constructor() {
      const wc = new events.EventEmitter();
      wc.session = {}; wc.isDestroyed = () => false; wc.close = () => {}; wc.loadURL = async () => {}; wc.setWindowOpenHandler = () => {};
      this.webContents = wc;
    }
    setBounds() {}
  }
  const ses = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {} };
  const d = dockLib.createDock({
    WebContentsView: View, session: { fromPartition: () => ses }, shell: { openExternal() {} },
    nativeImage: {}, fs, path, os: { tmpdir: () => tmp }, iconPath: 'i.png', getWindow: () => win,
    createAttacher: () => fakeAttacher,
  });
  const CHAT = 'https://web.whatsapp.com/send?phone=919876543210&text=x';
  const PDF = Buffer.from('%PDF-1.4\nx');
  d.open(CHAT);
  d.setPdf({ name: 'a', bytes: PDF });                               // no flag: drag/hint only
  assert.deepEqual(started, []);
  d.setPdf({ name: 'a', bytes: PDF, autoAttach: true });
  d.setPdf({ name: 'a', bytes: PDF, autoAttach: true });             // a second hand-over: no second attempt
  assert.deepEqual(started, ['a.pdf']);
  d.setPdf({ name: 'bad', bytes: Buffer.from('<html>'), autoAttach: true });
  assert.deepEqual(started, ['a.pdf']);                              // not a PDF: nothing
  const c0 = cancels;
  d.open('https://web.whatsapp.com/send?phone=919812345678&text=y'); // a new chat cancels the old attempt
  assert.ok(cancels > c0);
  d.setPdf({ name: 'b', bytes: PDF, autoAttach: true });
  assert.deepEqual(started, ['a.pdf', 'b.pdf']);
  assert.deepEqual(await d.copyPdf(), { ok: true });
  d.close();
  assert.equal(d.state().attach, 'idle');
});

// ── Source pins ─────────────────────────────────────────────────────────

test('source pin: the attach module can paste/focus/drop — and nothing that could press Send or type', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'whatsapp-attach.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of ['sendInputEvent', '.click(', 'execCommand', 'KeyboardEvent', 'keydown', 'keypress', 'data-icon="send"',
    'setUserAgent', 'userAgent', 'preload:', 'debugger', 'insertCSS', 'executeJavaScriptInIsolatedWorld', 'webFrame']) {
    assert.equal(src.includes(banned), false, `whatsapp-attach.js must not use ${banned}`);
  }
  assert.equal((src.match(/\.paste\(\)/g) || []).length, 1);
  // The ONLY text input: the message into the preview's caption, once.
  assert.equal((src.match(/insertText/g) || []).length, 1);
  assert.match(src, /wc\.insertText\(caption\)/);
  assert.equal(/Enter|\\r|\\n'/.test(src.replace(/`copy\\n[^`]*`/, '')) , false);
});

test('source pin: whatsapp-dock.js itself stays script-free; the IPC trusts only the main window', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'whatsapp-dock.js'), 'utf8');
  assert.equal(/executeJavaScript\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), false);
  assert.match(src, /ipcMain\.handle\('whatsapp:copyPdf', \(e\) => \(fromApp\(e\)/);
});
