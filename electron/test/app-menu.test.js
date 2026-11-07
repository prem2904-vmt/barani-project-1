// node --test electron/test/*.test.js — pure application-menu builder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplate, install } = require('../app-menu');

const find = (t, label) => t.find((m) => m.label === label);
const roles = (m) => m.submenu.filter((i) => i.role).map((i) => i.role);
const updateItem = (t) => t.flatMap((m) => m.submenu || []).find((i) => i.click);

test('macOS: app menu has About, then Check for Updates right after it, and the standard roles', () => {
  const t = buildTemplate({ platform: 'darwin', appName: 'Prefrontal' });
  const app = t[0];
  assert.equal(app.label, 'Prefrontal');
  assert.equal(app.submenu[0].role, 'about');
  assert.equal(app.submenu[1].label, 'Check for Updates…');
  for (const r of ['services', 'hide', 'hideOthers', 'unhide', 'quit']) assert.ok(roles(app).includes(r), r);
  assert.deepEqual(t.map((m) => m.label), ['Prefrontal', 'Edit', 'View', 'Window', 'Help']);
  assert.equal(t.flatMap((m) => m.submenu).filter((i) => i.click).length, 1);
});

test('Windows/Linux: the update item lives under Help', () => {
  for (const platform of ['win32', 'linux']) {
    const t = buildTemplate({ platform });
    assert.deepEqual(t.map((m) => m.label), ['File', 'Edit', 'View', 'Window', 'Help']);
    assert.equal(find(t, 'Help').submenu.find((i) => i.click).label, 'Check for Updates…');
    assert.equal(find(t, 'File').submenu.some((i) => i.click), false);
  }
});

test('Edit keeps every clipboard role so copy / paste work', () => {
  for (const platform of ['darwin', 'win32']) {
    const edit = find(buildTemplate({ platform }), 'Edit');
    for (const r of ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']) {
      assert.ok(roles(edit).includes(r), `${platform} ${r}`);
    }
  }
});

test('View keeps reload / forceReload / toggleDevTools parity with the default menu', () => {
  const view = find(buildTemplate({ platform: 'darwin' }), 'View');
  for (const r of ['reload', 'forceReload', 'toggleDevTools', 'togglefullscreen']) assert.ok(roles(view).includes(r), r);
});

test('label follows the updater state (reuses the tray wording)', () => {
  const label = (updater) => updateItem(buildTemplate({ platform: 'darwin', updater })).label;
  assert.equal(label(null), 'Check for Updates…');
  assert.equal(label({ phase: 'idle' }), 'Check for Updates…');
  assert.equal(label({ phase: 'checking' }), 'Checking for updates…');
  assert.equal(label({ phase: 'downloading', progress: 42 }), 'Downloading update… 42%');
  assert.equal(label({ phase: 'ready', version: '1.4.0' }), 'Restart to install v1.4.0');
  assert.match(label({ phase: 'deferred' }), /waiting for instruments/);
});

test('enabled only when a click does something (idle / ready)', () => {
  const en = (phase) => updateItem(buildTemplate({ platform: 'darwin', updater: { phase } })).enabled;
  assert.equal(en('idle'), true);
  assert.equal(en('ready'), true);
  for (const p of ['checking', 'downloading', 'deferred']) assert.equal(en(p), false, p);
});

test('click runs the supplied handler', () => {
  let n = 0;
  updateItem(buildTemplate({ platform: 'darwin', onCheckUpdates: () => n++ })).click();
  assert.equal(n, 1);
});

test('install: sets the menu now, rebuilds on each updater state, click → checkOrRestart', () => {
  const built = [];
  let listener;
  let calls = 0;
  const Menu = { buildFromTemplate: (t) => t, setApplicationMenu: (m) => built.push(m) };
  const updater = { getState: () => ({ phase: 'idle' }), onState: (cb) => { listener = cb; }, checkOrRestart: () => calls++ };
  install({ Menu, app: { name: 'Prefrontal' }, updater, platform: 'darwin' });
  assert.equal(built.length, 1);
  listener({ phase: 'ready', version: '2.0.0' });
  assert.equal(built.length, 2);
  const item = updateItem(built[1]);
  assert.equal(item.label, 'Restart to install v2.0.0');
  item.click();
  assert.equal(calls, 1);
});
