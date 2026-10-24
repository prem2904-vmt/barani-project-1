/*
 * One-time carry-over of localStorage from the old file:// origin to
 * app://prefrontal (a different origin = a different storage partition, so
 * without this every desktop user would be signed out and lose local drafts,
 * theme, printer config, etc.). Keys already present at the new origin are
 * never overwritten. IndexedDB (chat cache, rebuilt from the server) is NOT
 * carried over. Runs once; a marker in userData records completion.
 */
const fs = require('fs');
const path = require('path');
const { APP_ORIGIN, MIGRATE_PATH } = require('./app-protocol');

const MARKER = 'app-origin-migrated.json';

/** Pure merge: legacy entries that the target does not already have. */
function mergeMissing(legacy, existingKeys) {
  const have = new Set(existingKeys);
  const out = {};
  for (const [k, v] of Object.entries(legacy || {})) {
    if (typeof v === 'string' && !have.has(k)) out[k] = v;
  }
  return out;
}

async function run({ BrowserWindow, app }) {
  const marker = path.join(app.getPath('userData'), MARKER);
  if (fs.existsSync(marker)) return { skipped: true };
  const mk = () => new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  let legacyWin; let targetWin; let copied = 0;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  try {
    legacyWin = mk();
    await withTimeout(legacyWin.loadFile(path.join(__dirname, 'legacy-origin.html')), 8000);
    const dump = await legacyWin.webContents.executeJavaScript(
      '(() => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } } catch (e) {} return JSON.stringify(o); })()');
    const legacy = JSON.parse(dump || '{}');
    if (Object.keys(legacy).length) {
      targetWin = mk();
      await withTimeout(targetWin.loadURL(`${APP_ORIGIN}${MIGRATE_PATH}`), 8000);
      const existing = JSON.parse(await targetWin.webContents.executeJavaScript('JSON.stringify(Object.keys(localStorage))'));
      const add = mergeMissing(legacy, existing);
      copied = Object.keys(add).length;
      await targetWin.webContents.executeJavaScript(
        `(() => { const o = JSON.parse(${JSON.stringify(JSON.stringify(add))}); for (const k of Object.keys(o)) { try { localStorage.setItem(k, o[k]); } catch (e) {} } })()`);
    }
    fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), copied }));
    return { copied };
  } catch (e) {
    // No marker: retried next launch. Never blocks startup.
    return { error: String((e && e.message) || e) };
  } finally {
    for (const w of [legacyWin, targetWin]) { try { if (w && !w.isDestroyed()) w.destroy(); } catch { /* noop */ } }
  }
}

module.exports = { MARKER, mergeMissing, run };
