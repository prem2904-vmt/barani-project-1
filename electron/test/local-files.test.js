// Files on this computer (electron/local-files.js): fake electron + fake fs, never a real window. Run: npm run test:electron
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const handlers = new Map();
const fakeElectron = { ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, dialog: {} };
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? fakeElectron : origLoad.call(this, req, ...rest); };
const lf = require('../local-files');
Module._load = origLoad;

function setup({ open = {}, save = {}, files = {} } = {}) {
  const wc = {}; const win = { webContents: wc, isDestroyed: () => false };
  const written = new Map();
  const fs = {
    stat: async (p) => { if (!(p in files)) throw new Error('ENOENT'); return { size: files[p].length }; },
    readFile: async (p) => Buffer.from(files[p]),
    writeFile: async (p, b) => { written.set(p, Buffer.from(b)); },
  };
  const dialog = { showOpenDialog: async () => open, showSaveDialog: async () => save };
  const h = new Map();
  lf.register(() => win, { dialog, fs, ipcMain: { handle: (ch, fn) => h.set(ch, fn) } });
  return { h, wc, written, ev: { sender: wc } };
}

test('name and byte checks: extension allowlist per kind, no path characters, size cap', () => {
  assert.equal(lf.checkName('sheet', 'Log.xlsx'), null);
  assert.equal(lf.checkName('image', 'Wound.JPG'), null);
  assert.ok(lf.checkName('sheet', 'Log.docx'));
  assert.ok(lf.checkName('doc', 'a.exe'));
  assert.ok(lf.checkName('pdf', '../x.pdf'));
  assert.ok(lf.checkName('pdf', 'a:b.pdf'));
  assert.ok(lf.checkName('pdf', ''));
  assert.ok(lf.checkName('bogus', 'a.pdf'));
  assert.ok(lf.checkName('pdf', 'x'.repeat(130) + '.pdf'));
  assert.equal(lf.checkBytes(new Uint8Array(3)), null);
  assert.ok(lf.checkBytes(new Uint8Array(0)));
  assert.ok(lf.checkBytes('text'));
  assert.ok(lf.checkBytes({ byteLength: lf.MAX_BYTES + 1 }) === 'Nothing to save.');
  assert.ok(lf.checkBytes(new Uint8Array(lf.MAX_BYTES + 1)));
});

test('open: only the main window, returns a token and the bytes, refuses wrong type and oversize', async () => {
  const s = setup({ open: { canceled: false, filePaths: ['/home/u/Log.xlsx'] }, files: { '/home/u/Log.xlsx': 'PKxx' } });
  await assert.rejects(() => s.h.get('files:openLocal')({ sender: {} }, { kind: 'sheet' }), /forbidden/);
  const r = await s.h.get('files:openLocal')(s.ev, { kind: 'sheet' });
  assert.equal(r.name, 'Log.xlsx'); assert.equal(Buffer.from(r.bytes).toString(), 'PKxx'); assert.match(r.token, /^[0-9a-f]{24}$/);
  assert.equal((await s.h.get('files:openLocal')(s.ev, { kind: 'nope' })).error, 'Unknown file type.');
  const wrong = setup({ open: { canceled: false, filePaths: ['/x/a.exe'] }, files: { '/x/a.exe': 'MZ' } });
  assert.match((await wrong.h.get('files:openLocal')(wrong.ev, { kind: 'doc' })).error, /Only \.docx/);
  const big = setup({ open: { canceled: false, filePaths: ['/x/a.pdf'] }, files: { '/x/a.pdf': 'x'.repeat(lf.MAX_BYTES + 1) } });
  assert.match((await big.h.get('files:openLocal')(big.ev, { kind: 'pdf' })).error, /too large/);
  const cancel = setup({ open: { canceled: true, filePaths: [] } });
  assert.equal(await cancel.h.get('files:openLocal')(cancel.ev, { kind: 'pdf' }), null);
});

test('save: first save asks the OS dialog, the next save of the same file is in place by token, a made-up token is not a path', async () => {
  const s = setup({ save: { canceled: false, filePath: '/home/u/New.docx' } });
  const bytes = new Uint8Array([80, 75, 3, 4]);
  await assert.rejects(() => s.h.get('files:saveLocal')({ sender: {} }, { kind: 'doc', name: 'N.docx', bytes }), /forbidden/);
  const first = await s.h.get('files:saveLocal')(s.ev, { kind: 'doc', name: 'N.docx', bytes });
  assert.equal(first.name, 'New.docx'); assert.deepEqual([...s.written.get('/home/u/New.docx')], [80, 75, 3, 4]);
  const again = await s.h.get('files:saveLocal')(s.ev, { token: first.token, kind: 'doc', name: 'ignored.docx', bytes: new Uint8Array([1, 2]) });
  assert.equal(again.token, first.token); assert.deepEqual([...s.written.get('/home/u/New.docx')], [1, 2]);
  // a token the main process never handed out falls back to the dialog (never writes to a renderer-chosen path)
  const forged = await s.h.get('files:saveLocal')(s.ev, { token: '/etc/passwd', kind: 'doc', name: 'N.docx', bytes });
  assert.notEqual(forged.token, '/etc/passwd'); assert.ok(!s.written.has('/etc/passwd'));
});

test('save negatives: wrong extension, unknown kind, empty, oversize, cancelled dialog, dialog picked a wrong extension', async () => {
  const s = setup({ save: { canceled: false, filePath: '/home/u/x.docx' } });
  const ok = new Uint8Array([1]);
  assert.match((await s.h.get('files:saveLocal')(s.ev, { kind: 'sheet', name: 'a.docx', bytes: ok })).error, /Only \.xlsx/);
  assert.equal((await s.h.get('files:saveLocal')(s.ev, { kind: 'zzz', name: 'a.docx', bytes: ok })).error, 'Unknown file type.');
  assert.equal((await s.h.get('files:saveLocal')(s.ev, { kind: 'doc', name: 'a.docx', bytes: new Uint8Array(0) })).error, 'The file is empty.');
  assert.match((await s.h.get('files:saveLocal')(s.ev, { kind: 'doc', name: 'a.docx', bytes: new Uint8Array(lf.MAX_BYTES + 1) })).error, /too large/);
  assert.match((await s.h.get('files:saveLocal')(s.ev, { kind: 'sheet', name: 'a.xlsx', bytes: ok })).error, /Only \.xlsx/);   // dialog returned x.docx
  assert.equal(s.written.size, 0);
  const c = setup({ save: { canceled: true } });
  assert.equal(await c.h.get('files:saveLocal')(c.ev, { kind: 'doc', name: 'a.docx', bytes: ok }), null);
});

test('"any" opens every Files type but can never save; Retina project files are allowed', async () => {
  assert.equal(lf.checkName('any', 'a.docx'), null);
  assert.equal(lf.checkName('any', 'a.pcraft'), null);
  assert.equal(lf.checkName('image', 'p.retina'), null);
  assert.ok(lf.checkName('any', 'a.exe'));
  const s = setup({ open: { canceled: false, filePaths: ['/x/Deck.pptx'] }, files: { '/x/Deck.pptx': 'PK' }, save: { canceled: false, filePath: '/x/o.pptx' } });
  const r = await s.h.get('files:openLocal')(s.ev, { kind: 'any' });
  assert.equal(r.name, 'Deck.pptx');
  assert.equal((await s.h.get('files:saveLocal')(s.ev, { kind: 'any', name: 'a.pptx', bytes: new Uint8Array([1]) })).error, 'Unknown file type.');
});
