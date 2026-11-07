/**
 * WhatsApp Chat on the desktop: attach the report PDF to the open chat, the way
 * the person would — put the file on the OS clipboard and paste it into the
 * docked WhatsApp Web view (`webContents.paste()` = their Ctrl/Cmd+V), so
 * WhatsApp opens ITS OWN attachment preview. The person always presses Send.
 *
 * Owner decision 2026-11-07 (replaces the old "never attach" line in
 * whatsapp-dock.js). The hard lines that remain, pinned by
 * test/whatsapp-attach.test.js:
 *   - Send is NEVER pressed and Enter is never sent: no sendInputEvent, no click(),
 *     no selector for the Send button, no keyboard events. The only input is
 *     paste() (and, only if paste fails, one synthetic drop of the PDF) and, once
 *     WhatsApp's attachment preview is open, the message text drafted into ITS
 *     caption box with `webContents.insertText(text)` (only if the caption is empty).
 *   - The page script is limited to the fixed constants below: read-only
 *     probes (is the composer there / is the attachment preview open), one
 *     composer focus(), and the fallback drop. Nothing the renderer sends is
 *     ever put into a script except the PDF's bytes + a sanitised name.
 *   - One attempt per chat opened by OUR button, for a PDF the page handed
 *     over (validated in whatsapp-dock.js), never after the chat changed.
 *   - Listeners / timers: none are left behind — the run is a single async
 *     function with a deadline and a cancel flag.
 *
 * UNTESTED LIVE: the selectors below follow WhatsApp Web's current markup and
 * WILL drift; every miss degrades to the next step (paste → drop → "press
 * Ctrl+V" hint), never to anything unsafe.
 */

/** Read-only DOM probes (WhatsApp Web markup; first match wins). */
const SELECTORS = {
  composer: 'footer div[contenteditable="true"][role="textbox"], footer div[contenteditable="true"][data-tab], #main footer div[contenteditable="true"]',
  qr: 'canvas[aria-label*="QR" i], [data-testid="qrcode"], div[data-ref][aria-label*="QR" i]',
  // The attachment preview WhatsApp opens after a paste / drop.
  preview: '[data-testid="media-editor-container"], [data-animate-media-viewer], [data-testid="document-preview"], div[role="dialog"] [contenteditable="true"]',
  dialog: 'div[role="dialog"]',
  // The caption box of the attachment preview (the message is drafted here; never the Send button).
  caption: '[data-testid="media-caption"] [contenteditable="true"], div[role="dialog"] [contenteditable="true"], [data-animate-media-viewer] [contenteditable="true"]',
  dropTarget: '#main',
};

const TIMEOUTS = {
  readyMs: 20000,     // the chat (composer) has to appear
  readyPollMs: 400,
  verifyMs: 4000,     // the attachment preview has to appear after paste / drop
  verifyPollMs: 250,
  captionMs: 3000,    // the preview's caption box has to appear
  settleMs: 150,      // after focus, before paste
  restoreAfterMs: 1500,
};
/** The synthetic drop ships the bytes through executeJavaScript: keep it small. */
const MAX_DROP_BYTES = 8 * 1024 * 1024;

const STEP = Object.freeze({
  idle: 'idle', preparing: 'preparing', waiting: 'working', attached: 'attached', manual: 'manual',
});

// ── Page scripts (constants + JSON-quoted data only) ─────────────────────────

const q = (sel) => JSON.stringify(sel);

/** Read-only: { qr, composer, dialog, preview }. */
function probeScript() {
  return `(() => { const has = (s) => !!document.querySelector(s); return { qr: has(${q(SELECTORS.qr)}), composer: has(${q(SELECTORS.composer)}), dialog: has(${q(SELECTORS.dialog)}), preview: has(${q(SELECTORS.preview)}) }; })()`;
}

/** Read-only: does the preview's caption box exist, and is it empty? { caption: bool, captionText: string } */
function captionProbeScript() {
  return `(() => { const el = document.querySelector(${q(SELECTORS.caption)}); return { caption: !!el, captionText: el ? (el.innerText || el.textContent || '') : '' }; })()`;
}

/** Focus the caption box (no typing here — main inserts the text). */
function captionFocusScript() {
  return `(() => { const el = document.querySelector(${q(SELECTORS.caption)}); if (!el) return false; el.focus(); return true; })()`;
}

/** The caption needs the message unless WhatsApp already carried it over (never duplicate). */
function captionNeedsText(p, text) {
  if (!p || p.caption !== true || !text) return false;
  return String(p.captionText || '').trim().length === 0;
}

/** Focus the composer (no typing). */
function focusScript() {
  return `(() => { const el = document.querySelector(${q(SELECTORS.composer)}); if (!el) return false; el.focus(); return true; })()`;
}

/** Fallback only: ONE drop of the PDF onto the open chat. */
function dropScript(b64, name) {
  return `(async () => {
    const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const file = new File([u], ${JSON.stringify(name)}, { type: 'application/pdf' });
    const dt = new DataTransfer(); dt.items.add(file);
    const t = document.querySelector(${q(SELECTORS.dropTarget)}); if (!t) return false;
    for (const type of ['dragenter', 'dragover', 'drop']) t.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`;
}

// ── Pure decisions ───────────────────────────────────────────────────────────

/** Is the chat ready for a paste? (signed in = no QR; composer present) */
function chatReady(p) { return !!p && p.composer === true && p.qr !== true; }

/** Did a paste / drop open WhatsApp's attachment preview? The preview markup
 *  is the clear sign; any dialog, or the composer gone, also counts — this
 *  keeps a selector that drifted from causing a SECOND attachment. */
function previewOpen(p) { return !!p && (p.preview === true || p.dialog === true || p.composer === false); }

/** XML plist for macOS NSFilenamesPboardType. */
function macFilenamesPlist(file) {
  const esc = String(file).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + `<plist version="1.0"><array><string>${esc}</string></array></plist>`;
}

/** Linux (GNOME / KDE file managers + Chromium) clipboard file list. */
function gnomeCopiedFiles(file, pathToFileURL) {
  return `copy\n${pathToFileURL(file).href}`;
}

/**
 * Put ONE file on the OS clipboard as a FILE (so Ctrl/Cmd+V pastes it as an
 * attachment). Electron's `clipboard` can write custom formats (`writeBuffer`)
 * but a single call replaces the clipboard, and it cannot register Windows'
 * CF_HDROP (a custom name is registered instead of format 15) — so:
 *   macOS    NSFilenamesPboardType via writeBuffer (verified by availableFormats),
 *            else osascript `set the clipboard to (POSIX file …)`.
 *   Windows  PowerShell `Set-Clipboard -LiteralPath` (real CF_HDROP); the path goes
 *            through an environment variable, never into the command text.
 *   Linux    `x-special/gnome-copied-files` via writeBuffer.
 * Resolves { ok, method }. Never throws.
 */
async function writeFileToClipboard({ clipboard, platform, execFile, pathToFileURL }, file) {
  try {
    if (platform === 'darwin') {
      clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(macFilenamesPlist(file)));
      if (clipboard.availableFormats().some((f) => /NSFilenamesPboardType|file-url/i.test(f))) return { ok: true, method: 'pasteboard' };
      await run(execFile, 'osascript', ['-e', 'on run argv', '-e', 'set the clipboard to (POSIX file (item 1 of argv))', '-e', 'end run', file]);
      return { ok: true, method: 'osascript' };
    }
    if (platform === 'win32') {
      await run(execFile, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', 'Set-Clipboard -LiteralPath $env:PF_WA_FILE'],
        { PF_WA_FILE: file });
      return { ok: true, method: 'powershell' };
    }
    if (platform === 'linux') {
      clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from(gnomeCopiedFiles(file, pathToFileURL)));
      return { ok: true, method: 'gnome-copied-files' };
    }
  } catch { /* fall through */ }
  return { ok: false, method: null };
}

function run(execFile, cmd, args, env) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true, env: { ...process.env, ...(env || {}) } }, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * The attach state machine. All effects are injected so it is unit-tested:
 *   deps.probe()      → page probe object (read-only) | null
 *   deps.focus()      → focus composer
 *   deps.paste()      → webContents.paste()
 *   deps.drop()       → synthetic drop (only called if paste failed); may be null
 *   deps.sleep(ms), deps.now(), deps.cancelled()  → () => boolean
 * Resolves 'attached' | 'attached-drop' | 'manual' | 'cancelled' | 'not-signed-in'.
 */
async function runAttach(deps, t = TIMEOUTS) {
  const { probe, focus, paste, drop, sleep, now, cancelled } = deps;
  /** Draft the message into the preview's caption (empty caption only). Never throws. */
  const caption = async () => {
    if (!deps.caption) return;
    try {
      const end = now() + (t.captionMs ?? 3000);
      for (;;) {
        if (cancelled()) return;
        const p = await deps.captionProbe();
        if (p && p.caption === true) { if (captionNeedsText(p, deps.captionText)) await deps.caption(); return; }
        if (now() >= end) return;
        await sleep(t.verifyPollMs);
      }
    } catch { /* the PDF is attached; the text stays wherever WhatsApp put it */ }
  };
  const poll = async (okFn, totalMs, stepMs) => {
    const end = now() + totalMs;
    let last = null;
    for (;;) {
      if (cancelled()) return { cancelled: true };
      try { last = await probe(); } catch { last = null; }
      if (okFn(last)) return { ok: true, last };
      if (now() >= end) return { ok: false, last };
      await sleep(stepMs);
    }
  };

  const ready = await poll(chatReady, t.readyMs, t.readyPollMs);
  if (ready.cancelled) return 'cancelled';
  if (!ready.ok) return ready.last && ready.last.qr ? 'not-signed-in' : 'manual';

  try { await focus(); await sleep(t.settleMs); } catch { return 'manual'; }
  if (cancelled()) return 'cancelled';
  try { paste(); } catch { /* fall to the drop */ }
  const v1 = await poll(previewOpen, t.verifyMs, t.verifyPollMs);
  if (v1.cancelled) return 'cancelled';
  if (v1.ok) { await caption(); return 'attached'; }

  if (drop) {
    try { await drop(); } catch { return 'manual'; }
    const v2 = await poll(previewOpen, t.verifyMs, t.verifyPollMs);
    if (v2.cancelled) return 'cancelled';
    if (v2.ok) { await caption(); return 'attached-drop'; }
  }
  return 'manual';
}

/** Snapshot of the user's clipboard (text / html / image) to put back. */
function snapshotClipboard(clipboard) {
  try {
    return {
      sig: clipboard.availableFormats().join('|'),
      text: clipboard.readText(), html: clipboard.readHTML(), image: clipboard.readImage(),
    };
  } catch { return null; }
}

/** Put it back — only when the clipboard still holds OUR file (the user copied
 *  something else meanwhile → leave it alone). */
function restoreClipboard(clipboard, snap, ourSig) {
  if (!snap) return false;
  try {
    if (clipboard.availableFormats().join('|') !== ourSig) return false;
    const data = {};
    if (snap.text) data.text = snap.text;
    if (snap.html) data.html = snap.html;
    if (snap.image && !snap.image.isEmpty()) data.image = snap.image;
    if (Object.keys(data).length === 0) clipboard.clear(); else clipboard.write(data);
    return true;
  } catch { return false; }
}

/**
 * One attacher per dock. `start` runs ONE attempt (a newer start / cancel
 * supersedes it); `copyAgain` just re-puts the file on the clipboard.
 * deps: { getContents, clipboard, platform, execFile, pathToFileURL, hostOk,
 *         sleep?, now?, onStep(step), timeouts? }
 */
function createAttacher(deps) {
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now || Date.now;
  let run = 0;   // generation: bumping it cancels the running attempt

  const wcOk = () => {
    const wc = deps.getContents();
    if (!wc || wc.isDestroyed()) return null;
    let host = '';
    try { host = new URL(wc.getURL()).hostname; } catch { return null; }
    return deps.hostOk(host) ? wc : null;   // never script anything but WhatsApp's own page
  };

  async function copyAgain(file) {
    return writeFileToClipboard(deps, file);
  }

  async function start({ file, name, bytes, caption }) {
    const mine = ++run;
    const cancelled = () => mine !== run;
    const step = (s) => { if (!cancelled()) deps.onStep(s); };
    step(STEP.preparing);
    const snap = snapshotClipboard(deps.clipboard);
    const wrote = await writeFileToClipboard(deps, file);
    if (cancelled()) return 'cancelled';
    const ourSig = (() => { try { return deps.clipboard.availableFormats().join('|'); } catch { return ''; } })();
    step(STEP.waiting);
    const exec = (code) => { const wc = wcOk(); if (!wc) throw new Error('gone'); return wc.executeJavaScript(code, false); };
    const result = await runAttach({
      probe: () => exec(probeScript()),
      focus: async () => { const wc = wcOk(); if (!wc) throw new Error('gone'); wc.focus(); await exec(focusScript()); },
      paste: () => {
        // No file on the clipboard → paste would paste nothing useful.
        const wc = wcOk(); if (!wc || !wrote.ok) throw new Error('no clipboard file');
        wc.paste();
      },
      drop: bytes && bytes.length <= MAX_DROP_BYTES
        ? () => exec(dropScript(Buffer.from(bytes).toString('base64'), name)) : null,
      captionText: caption || '',
      captionProbe: () => exec(captionProbeScript()),
      caption: caption ? async () => {
        const wc = wcOk(); if (!wc) throw new Error('gone');
        wc.focus();
        if (!(await exec(captionFocusScript()))) return;
        wc.insertText(caption);   // drafts the text; Enter / Send are never pressed
      } : null,
      sleep, now, cancelled,
    }, deps.timeouts || TIMEOUTS);
    if (cancelled()) return 'cancelled';
    const attached = result === 'attached' || result === 'attached-drop';
    if (attached) {
      await sleep((deps.timeouts || TIMEOUTS).restoreAfterMs);
      restoreClipboard(deps.clipboard, snap, ourSig);
    }
    step(attached ? STEP.attached : STEP.manual);
    return result;
  }

  return { start, copyAgain, cancel: () => { run++; } };
}

module.exports = {
  createAttacher,
  SELECTORS, TIMEOUTS, MAX_DROP_BYTES, STEP,
  probeScript, focusScript, dropScript, chatReady, previewOpen, captionProbeScript, captionFocusScript, captionNeedsText,
  macFilenamesPlist, gnomeCopiedFiles, writeFileToClipboard, runAttach, snapshotClipboard, restoreClipboard,
};
