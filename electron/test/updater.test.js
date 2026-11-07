// electron/updater.js — main-process wiring with a fake `electron` +
// `electron-updater` module: IPC is handled, restartNow() refuses to fire
// while an instrument connector looks busy (electron/updater-guard.js) and
// retries once it doesn't, a safe restart calls quitAndInstall() exactly
// once. Run: npm run test:electron
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const handlers = new Map();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-updater-smoke-'));

// updater.js resolves its channel from the REAL process.platform — pin it to
// a supported OS so this suite passes on any CI host (e.g. a Linux box),
// not just a Mac. Restored in test.after below.
const origPlatform = process.platform;
Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

const fakeApp = { isPackaged: true, getPath: () => userData };
const fakeIpcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
const fakeElectron = { app: fakeApp, ipcMain: fakeIpcMain };

const fakeAutoUpdater = Object.assign(new EventEmitter(), {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowDowngrade: true,
  logger: null,
  feedURL: null,
  checkCalls: 0,
  quitAndInstallCalls: [],
  setFeedURL(o) { this.feedURL = o; },
  checkForUpdates() { this.checkCalls++; },
  quitAndInstall(isSilent, isForceRunAfter) { this.quitAndInstallCalls.push({ isSilent, isForceRunAfter }); },
});

// Stays patched for the whole file: updater.js requires 'electron-updater'
// LAZILY (only once a channel is resolved — see ensureAutoUpdater()), so the
// fake has to be in place whenever a test's first check() runs, not just
// while '../updater' itself loads.
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return fakeElectron;
  if (req === 'electron-updater') return { autoUpdater: fakeAutoUpdater };
  return origLoad.call(this, req, ...rest);
};
const updater = require('../updater');
test.after(() => {
  Module._load = origLoad;
  Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
});

const tick = () => new Promise((r) => setImmediate(r));

function fakeWindow() {
  const win = new EventEmitter();
  const wc = new EventEmitter();
  wc.sent = [];
  wc.send = (ch, v) => wc.sent.push([ch, v]);
  wc.isDestroyed = () => false;
  win.webContents = wc;
  win.isDestroyed = () => false;
  return win;
}

test.beforeEach(() => {
  updater._resetForTests();
  fakeAutoUpdater.checkCalls = 0;
  fakeAutoUpdater.quitAndInstallCalls = [];
  fakeAutoUpdater.removeAllListeners();
  delete process.env.PF_DATA_PROFILE;
});

test('no channel for this build (no pfDataProfile) → never touches electron-updater', () => {
  updater.start();
  assert.equal(fakeAutoUpdater.checkCalls, 0);
});

test('channel resolved (dev) in a packaged build → checks immediately, feed URL set, sha512 verification left on default', () => {
  process.env.PF_DATA_PROFILE = 'dev';
  updater.start();
  assert.equal(fakeAutoUpdater.checkCalls, 1);
  assert.equal(fakeAutoUpdater.autoDownload, true);
  assert.equal(fakeAutoUpdater.autoInstallOnAppQuit, true);
  assert.equal(fakeAutoUpdater.allowDowngrade, false);
  assert.ok(fakeAutoUpdater.feedURL.url.endsWith('/dev/mac') || fakeAutoUpdater.feedURL.url.endsWith('/dev/windows'));
  assert.equal(fakeAutoUpdater.feedURL.provider, 'generic');
  // No `channel` override — the manifest stays "latest(-mac).yml"; our
  // channel lives in the URL path, not the filename.
  assert.equal(fakeAutoUpdater.feedURL.channel, undefined);
});

test('IPC: restartNow before anything is downloaded is refused, no quitAndInstall', async () => {
  const win = fakeWindow();
  updater.register(() => win, () => []);
  const restartNow = handlers.get('updater:restartNow');
  const result = await restartNow();
  assert.deepEqual(result, { ok: false, reason: 'not-ready' });
  assert.equal(fakeAutoUpdater.quitAndInstallCalls.length, 0);
});

test('IPC: updater:check is refused for a foreign sender and starts a check for our own window', async () => {
  process.env.PF_DATA_PROFILE = 'dev';
  const win = fakeWindow();
  updater.register(() => win, () => []);
  updater.start();
  const before = fakeAutoUpdater.checkCalls;
  const check = handlers.get('updater:check');
  assert.throws(() => check({ sender: {} }), /forbidden/);
  assert.throws(() => check(), /forbidden/);
  assert.equal(fakeAutoUpdater.checkCalls, before);
  const st = check({ sender: win.webContents });
  assert.equal(fakeAutoUpdater.checkCalls, before + 1);
  assert.ok(st && st.phase);
});

test('checkOrRestart: idle → check; ready → restart (no extra check)', async () => {
  process.env.PF_DATA_PROFILE = 'dev';
  const win = fakeWindow();
  updater.register(() => win, () => []);
  updater.start();
  const before = fakeAutoUpdater.checkCalls;
  updater.checkOrRestart();
  assert.equal(fakeAutoUpdater.checkCalls, before + 1);
  fakeAutoUpdater.emit('update-downloaded', { version: '1.2.3' });
  await tick();
  updater.checkOrRestart();
  await tick();
  assert.equal(fakeAutoUpdater.checkCalls, before + 1);
  assert.equal(fakeAutoUpdater.quitAndInstallCalls.length, 1);
});

test('a ready update restarts immediately when no instrument looks busy', async () => {
  process.env.PF_DATA_PROFILE = 'dev';
  const win = fakeWindow();
  updater.register(() => win, () => []); // no connectors paired
  updater.start();
  fakeAutoUpdater.emit('update-downloaded', { version: '1.2.3' });
  await tick();
  assert.equal(updater.getState().phase, 'ready');

  const restartNow = handlers.get('updater:restartNow');
  const result = await restartNow();
  await tick();
  assert.deepEqual(result, { ok: true });
  assert.equal(fakeAutoUpdater.quitAndInstallCalls.length, 1);
  assert.deepEqual(fakeAutoUpdater.quitAndInstallCalls[0], { isSilent: false, isForceRunAfter: true });
});

test('a ready update with a busy analyzer defers — never calls quitAndInstall, and the banner gets told why', async () => {
  process.env.PF_DATA_PROFILE = 'dev';
  const win = fakeWindow();
  const busyStatus = [{ instrumentId: 'i1', name: 'Sysmex XN', state: 'listening', queueLength: 0, lastMessageAt: null }];
  updater.register(() => win, () => busyStatus);
  updater.start();
  fakeAutoUpdater.emit('update-downloaded', { version: '1.2.3' });
  await tick();

  const restartNow = handlers.get('updater:restartNow');
  const result = await restartNow();
  assert.deepEqual(result, { ok: false, deferred: true, reasons: ['Sysmex XN'] });
  assert.equal(fakeAutoUpdater.quitAndInstallCalls.length, 0);
  assert.equal(updater.getState().phase, 'deferred');
  assert.deepEqual(updater.getState().deferReasons, ['Sysmex XN']);
  const pushed = win.webContents.sent.filter(([ch]) => ch === 'updater:state');
  assert.ok(pushed.some(([, s]) => s.phase === 'deferred'), 'renderer was pushed the deferred state, not just told via the IPC reply');
});

test('getState() reflects download-progress and errors never throw into the caller', async () => {
  process.env.PF_DATA_PROFILE = 'dev';
  updater.start();
  fakeAutoUpdater.emit('update-available', { version: '9.9.9' });
  fakeAutoUpdater.emit('download-progress', { percent: 42.9 });
  assert.equal(updater.getState().phase, 'downloading');
  assert.equal(updater.getState().progress, 43);

  assert.doesNotThrow(() => fakeAutoUpdater.emit('error', new Error('offline')));
  assert.equal(updater.getState().error, 'offline');
});
