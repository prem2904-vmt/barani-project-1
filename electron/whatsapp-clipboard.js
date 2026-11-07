/**
 * WhatsApp Chat on the desktop: put the report PDF on OUR OS clipboard as a file, so the person can
 * press Ctrl+V (Cmd+V) in the chat to attach it, then Send. This is the app's own clipboard — nothing
 * here touches, reads or scripts WhatsApp Web (WhatsApp's Terms prohibit automating or modifying the
 * Service). It has no access to the WhatsApp view at all: no webContents, no scripts, no paste, no typing.
 * Pinned by test/whatsapp-dock.test.js (source pins).
 */

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


module.exports = { macFilenamesPlist, gnomeCopiedFiles, writeFileToClipboard };
