'use strict';
/**
 * Application menu (macOS menu bar; File/Edit/View/Window/Help menu bar on
 * Windows + Linux). Electron's default menu, written out explicitly so we can
 * add "Check for Updates…" — right after "About" on macOS, under Help
 * elsewhere. `buildTemplate` is pure (no Electron import) and covered by
 * `node --test`; `install` turns it into the real menu and rebuilds it on
 * every updater state change so the label follows the update.
 */
const { updaterLabel } = require('./tray-model');

const BUSY = new Set(['checking', 'downloading', 'deferred']);

/** The label + whether it can be clicked, from the updater state. Idle keeps
 *  the menu-bar wording ("Check for Updates…"); every other phase reuses the
 *  tray's label so the two never drift. */
function updateItem(updater, onCheck) {
  const phase = updater && updater.phase;
  const known = phase === 'checking' || phase === 'downloading' || phase === 'ready' || phase === 'deferred';
  return {
    label: known ? updaterLabel(updater) : 'Check for Updates…',
    enabled: !BUSY.has(phase),
    click: onCheck || (() => {}),
  };
}

/**
 * @param {{platform?: string, appName?: string, updater?: object|null,
 *          onCheckUpdates?: Function}} o
 */
function buildTemplate(o = {}) {
  const platform = o.platform || process.platform;
  const appName = o.appName || 'Prefrontal';
  const mac = platform === 'darwin';
  const update = updateItem(o.updater, o.onCheckUpdates);

  const edit = {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' },
    ],
  };
  const view = {
    label: 'View',
    submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };
  const windowMenu = {
    label: 'Window',
    submenu: mac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }, { role: 'window' }]
      : [{ role: 'minimize' }, { role: 'close' }],
  };

  if (mac) {
    return [
      {
        label: appName,
        submenu: [
          { role: 'about', label: `About ${appName}` },
          update,
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      edit, view, windowMenu,
      { label: 'Help', role: 'help', submenu: [] },
    ];
  }
  return [
    { label: 'File', submenu: [{ role: 'quit' }] },
    edit, view, windowMenu,
    { label: 'Help', role: 'help', submenu: [{ role: 'about', label: `About ${appName}` }, update] },
  ];
}

/** Build + set the menu now and on every updater state change. */
function install({ Menu, app, updater, platform = process.platform }) {
  let state = updater.getState();
  const rebuild = () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate({
      platform, appName: app.name || 'Prefrontal', updater: state,
      onCheckUpdates: () => updater.checkOrRestart(),
    })));
  };
  updater.onState((s) => { state = s; rebuild(); });
  rebuild();
}

module.exports = { buildTemplate, install };
