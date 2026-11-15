const { ipcMain, dialog } = require('electron');
const nodeFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Files on THIS computer (Files app: Neuron / Synapse / Axon / Myelin / Retina), beside the lab's own storage.
 *   files:openLocal {kind}                       -> native Open dialog -> { token, name, bytes } | null
 *   files:saveLocal {token?, kind, name, bytes}  -> in place for a file this session opened/saved, else native Save dialog
 *                                                   -> { token, name } | null
 * The renderer never names a path: it only ever holds an opaque TOKEN main handed out, so a compromised page cannot write
 * anywhere it was not first allowed. Arguments are strictly validated: the kind decides the extensions (allowlist), the
 * bytes are capped, and only the main window may ask. The dialogs are the OS's own; nothing is written without one
 * (or without a token from a file the person picked).
 */
const KINDS = {
  sheet: { exts: ['xlsx'], label: 'Spreadsheet' },
  doc: { exts: ['docx'], label: 'Document' },
  slides: { exts: ['pptx'], label: 'Slides' },
  pdf: { exts: ['pdf'], label: 'PDF' },
  image: { exts: ['png', 'jpg', 'jpeg', 'webp', 'retina', 'pcraft'], label: 'Image' },
  // "Open from this device" on the Files screen: any of the above; the page picks the app by the extension. Never used for saving.
  any: { exts: ['xlsx', 'docx', 'pptx', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'retina', 'pcraft'], label: 'Files' },
};
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_NAME = 120;

const extOf = (name) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };

/** Null when fine, else a plain reason. Pure. */
function checkName(kind, name) {
  const k = KINDS[kind];
  if (!k) return 'Unknown file type.';
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME) return 'That file name is not allowed.';
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return 'That file name is not allowed.';
  if (!k.exts.includes(extOf(name))) return `Only .${k.exts.join(', .')} files can be used here.`;
  return null;
}
function checkBytes(bytes) {
  if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes) && !(bytes instanceof ArrayBuffer)) return 'Nothing to save.';
  const n = bytes.byteLength;
  if (!n) return 'The file is empty.';
  if (n > MAX_BYTES) return 'That file is too large (the limit is 25 MB).';
  return null;
}

function register(getWindow, deps = {}) {
  const dlg = deps.dialog || dialog;
  const fs = deps.fs || nodeFs.promises;
  const ipc = deps.ipcMain || ipcMain;
  /** token -> absolute path, only for files THIS session picked in a native dialog. */
  const granted = new Map();

  const live = (w) => !!(w && !w.isDestroyed());
  const trusted = (e) => { const w = getWindow(); return live(w) && !!e && e.sender === w.webContents; };
  const grant = (p) => { const t = crypto.randomBytes(12).toString('hex'); granted.set(t, p); if (granted.size > 200) granted.delete(granted.keys().next().value); return t; };
  const filters = (kind) => [{ name: KINDS[kind].label, extensions: KINDS[kind].exts }];

  ipc.handle('files:openLocal', async (e, arg) => {
    if (!trusted(e)) throw new Error('forbidden');
    const kind = arg && arg.kind;
    if (!KINDS[kind]) return { error: 'Unknown file type.' };
    const r = await dlg.showOpenDialog(getWindow(), { properties: ['openFile'], filters: filters(kind) });
    if (!r || r.canceled || !r.filePaths || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    const name = path.basename(p);
    const bad = checkName(kind, name);
    if (bad) return { error: bad };
    const st = await fs.stat(p);
    if (st.size > MAX_BYTES) return { error: 'That file is too large (the limit is 25 MB).' };
    const buf = await fs.readFile(p);
    return { token: grant(p), name, bytes: new Uint8Array(buf) };
  });

  ipc.handle('files:saveLocal', async (e, arg) => {
    if (!trusted(e)) throw new Error('forbidden');
    const a = arg || {};
    if (!KINDS[a.kind] || a.kind === 'any') return { error: 'Unknown file type.' };
    const badBytes = checkBytes(a.bytes);
    if (badBytes) return { error: badBytes };
    const badName = checkName(a.kind, a.name);
    let target = typeof a.token === 'string' ? granted.get(a.token) : undefined;
    let token = a.token;
    if (target) {
      // In place: the extension the person originally picked must still be one of the kind's.
      if (checkName(a.kind, path.basename(target))) return { error: 'Only the right kind of file can be saved here.' };
    } else {
      if (badName) return { error: badName };
      const r = await dlg.showSaveDialog(getWindow(), { defaultPath: a.name, filters: filters(a.kind) });
      if (!r || r.canceled || !r.filePath) return null;
      if (checkName(a.kind, path.basename(r.filePath))) return { error: `Only .${KINDS[a.kind].exts.join(', .')} files can be saved here.` };
      target = r.filePath;
      token = grant(target);
    }
    await fs.writeFile(target, Buffer.from(a.bytes instanceof ArrayBuffer ? new Uint8Array(a.bytes) : a.bytes));
    return { token, name: path.basename(target) };
  });
}

module.exports = { register, checkName, checkBytes, KINDS, MAX_BYTES };
