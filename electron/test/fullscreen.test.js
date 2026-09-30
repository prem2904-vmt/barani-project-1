// Kiosk full screen (electron/fullscreen.js) — main-process wiring with a
// fake `electron` module: opens full screen, IPC is main-window-only and
// validated, changes are pushed to the renderer, F11 / Ctrl+Cmd+F toggle,
// macOS close-to-hide leaves full screen first. Run: npm run test:electron
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { EventEmitter } = require('events');

const handlers = new Map();
const fakeElectron = { ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) } };
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? fakeElectron : origLoad.call(this, req, ...rest); };
const fullscreen = require('../fullscreen');
Module._load = origLoad;

const tick = () => new Promise((r) => setImmediate(r));

function fakeWindow(full = false) {
  const win = new EventEmitter();
  const wc = new EventEmitter();
  wc.sent = [];
  wc.send = (ch, v) => wc.sent.push([ch, v]);
  wc.isDestroyed = () => false;
  win.webContents = wc;
  win.full = full;
  win.hidden = false;
  win.isDestroyed = () => false;
  win.isFullScreen = () => win.full;
  win.setFullScreen = (on) => {
    if (win.full === on) return;
    win.full = on;
    win.emit(on ? 'enter-full-screen' : 'leave-full-screen');
  };
  win.hide = () => { win.hidden = true; };
  win.isVisible = () => !win.hidden;
  return win;
}

test('main window opens full screen (constructor options)', () => {
  assert.deepEqual(fullscreen.windowOptions(), { fullscreen: true, fullscreenable: true });
  assert.deepEqual(fullscreen.windowOptions({ hidden: false }), { fullscreen: true, fullscreenable: true });
});

test('started hidden at login: created windowed, no full-screen pop, full screen on first show', async () => {
  assert.deepEqual(fullscreen.windowOptions({ hidden: true }), { fullscreen: false, fullscreenable: true });
  const win = fakeWindow(false);
  fullscreen.attach(win, { hidden: true });
  win.emit('ready-to-show');
  await new Promise((r) => setImmediate(r));
  assert.equal(win.full, false, 'stays windowed (and hidden) in the tray');
  win.emit('show');
  await tick();
  assert.equal(win.full, true, 'opened from tray / dock / a notification → full screen');
  win.setFullScreen(false);           // user pressed Esc
  win.emit('show');                   // a later notification click re-shows / focuses
  await tick();
  assert.equal(win.full, false, 'a later restore does not override the user\'s Esc');
});

test('IPC: only the main window may query / set; payload must be a boolean', async () => {
  const win = fakeWindow(true);
  fullscreen.register(() => win);
  const isFs = handlers.get('window:isFullScreen');
  const setFs = handlers.get('window:setFullScreen');
  assert.ok(isFs && setFs, 'handlers registered');
  assert.equal(await isFs({ sender: win.webContents }), true);
  await assert.rejects(async () => isFs({ sender: {} }), /forbidden/);
  await assert.rejects(async () => setFs({ sender: {} }, false), /forbidden/);
  await assert.rejects(async () => setFs({ sender: win.webContents }, 'false'), /invalid/);
  assert.equal(win.full, true, 'refused calls change nothing');
  assert.equal(await setFs({ sender: win.webContents }, false), false);
  assert.equal(win.full, false);
});

test('attach: every change is pushed to the renderer; reload gets the current state', () => {
  const win = fakeWindow(true);
  fullscreen.attach(win);
  win.setFullScreen(false);
  win.setFullScreen(true);
  win.webContents.emit('did-finish-load');
  assert.deepEqual(win.webContents.sent, [['window:fullscreen', false], ['window:fullscreen', true], ['window:fullscreen', true]]);
});

test('attach: first show asserts full screen if the platform dropped the flag', async () => {
  const win = fakeWindow(false);
  fullscreen.attach(win);
  win.emit('ready-to-show');
  await new Promise((r) => setImmediate(r));
  assert.equal(win.full, true);
});

test('F11 (Windows / Linux) and Ctrl+Cmd+F (macOS) toggle; nothing else does', () => {
  const k = (key, mods = {}) => ({ type: 'keyDown', key, isAutoRepeat: false, meta: false, control: false, alt: false, shift: false, ...mods });
  assert.equal(fullscreen.isToggleKey(k('F11'), 'win32'), true);
  assert.equal(fullscreen.isToggleKey(k('F11'), 'linux'), true);
  assert.equal(fullscreen.isToggleKey(k('F11', { control: true }), 'win32'), false);
  assert.equal(fullscreen.isToggleKey({ ...k('F11'), type: 'keyUp' }, 'win32'), false);
  assert.equal(fullscreen.isToggleKey({ ...k('F11'), isAutoRepeat: true }, 'win32'), false);
  assert.equal(fullscreen.isToggleKey(k('f', { meta: true, control: true }), 'darwin'), true);
  assert.equal(fullscreen.isToggleKey(k('F11'), 'darwin'), false);
  assert.equal(fullscreen.isToggleKey(k('Escape'), 'win32'), false, 'Esc is the renderer\'s call');

  const win = fakeWindow(false);
  fullscreen.attach(win);
  let prevented = 0;
  const key = process.platform === 'darwin' ? k('f', { meta: true, control: true }) : k('F11');
  win.webContents.emit('before-input-event', { preventDefault: () => prevented++ }, key);
  assert.equal(win.full, true);
  win.webContents.emit('before-input-event', { preventDefault: () => prevented++ }, key);
  assert.equal(win.full, false);
  win.webContents.emit('before-input-event', { preventDefault: () => prevented++ }, k('Escape'));
  assert.equal(prevented, 2, 'only the toggle key is swallowed');
});

test('close-to-hide: macOS leaves full screen first and re-enters on the next show', async () => {
  const win = fakeWindow(true);
  fullscreen.attach(win);
  fullscreen.hide(win, 'darwin');
  assert.equal(win.full, false);
  win.emit('show');                   // macOS fires 'show' inside the transition
  await tick();
  assert.equal(win.full, false, 'transition show ignored while the close is pending');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(win.hidden, true);
  win.emit('show');                   // spurious show while still hidden
  await tick();
  assert.equal(win.full, false, 'not re-entered while the window is hidden');
  win.hidden = false;                 // real restore (tray / dock / notification)
  win.emit('show');
  await tick();
  assert.equal(win.full, true, 'restored from tray / dock → full screen again');

  const w2 = fakeWindow(true);
  fullscreen.attach(w2);
  fullscreen.hide(w2, 'win32');
  assert.equal(w2.hidden, true);
  assert.equal(w2.full, true, 'Windows hides in place');
});
