/*
 * Pure decision helpers for desktop notifications (no Electron import, so
 * `node --test electron/test/*.test.js` covers them). notify.js wires them to
 * Electron; the renderer has its own mirror of the "is the user looking"
 * rules in desktop-notify.policy.ts.
 */

/** Per-user desktop notification settings. Stored in
 *  <userData>/notify-settings.json; every key is a plain boolean. */
const DEFAULTS = Object.freeze({
  calls: true,        // call pop-up (+ native notification) over other apps
  messages: true,     // native chat notifications
  alerts: true,       // native bell (NotificationCatalog) notifications
  sound: true,        // message ping / alert sound (calls always ring)
  openAtLogin: true,  // start with the computer, hidden in the tray
});
const KEYS = Object.keys(DEFAULTS);

/** Keep only known boolean keys; fill the rest from `base` (defaults). */
function sanitizeSettings(raw, base = DEFAULTS) {
  const out = { ...DEFAULTS, ...base };
  if (raw && typeof raw === 'object') {
    for (const k of KEYS) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
  return out;
}

/** A patch from the renderer: only known boolean keys survive. */
function sanitizePatch(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of KEYS) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  return out;
}

function count(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 9999) : 0;
}

/** Dock / taskbar badge = unread chats (not muted) + unread bell rows. */
function badgeTotal(counts) {
  if (!counts || typeof counts !== 'object') return 0;
  return Math.min(9999, count(counts.chat) + count(counts.bell));
}

function badgeLabel(n) {
  const v = count(n);
  return v === 0 ? '' : v > 99 ? '99+' : String(v);
}

function trayTooltip(n) {
  const v = count(n);
  return v === 0 ? 'Prefrontal' : `Prefrontal — ${badgeLabel(v)} unread`;
}

/** Launch-at-login flag the OS sees. Windows gets an argument so the
 *  auto-start opens hidden in the tray; macOS uses openAsHidden (honoured up
 *  to macOS 12; on 13+ the window simply opens — Apple dropped the option). */
const HIDDEN_ARG = '--pf-hidden';
function loginItemOptions(platform, open) {
  const o = { openAtLogin: !!open };
  if (platform === 'darwin') o.openAsHidden = true;
  if (platform === 'win32') o.args = [HIDDEN_ARG];
  return o;
}

/** Was this launch the auto-start at login (→ stay in the tray)? */
function launchedHidden({ argv = [], platform, loginSettings } = {}) {
  if (Array.isArray(argv) && argv.includes(HIDDEN_ARG)) return true;
  if (platform === 'darwin' && loginSettings) {
    return !!(loginSettings.wasOpenedAsHidden || loginSettings.wasOpenedAtLogin);
  }
  return false;
}

/** Window state the renderer uses for "is the user looking at the app". */
function windowState(win) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
    return { focused: false, visible: false, minimized: false };
  }
  return { focused: !!win.isFocused(), visible: !!win.isVisible(), minimized: !!win.isMinimized() };
}

function inFront(s) { return !!s && s.visible && !s.minimized && s.focused; }

const REF = /^[A-Za-z0-9_.:-]{1,64}$/;
/** A bell alert from the renderer → clean fields for a native notification.
 *  Title / body are the same text the in-app bell shows (the catalog decides
 *  what may be said; nothing else is added here). */
function sanitizeAlert(info) {
  if (!info || typeof info !== 'object') return null;
  const title = String(info.title || '').trim().slice(0, 120);
  if (!title) return null;
  const body = String(info.body || '').trim();
  const kind = REF.test(String(info.kind || '')) ? String(info.kind) : 'notification';
  const referenceType = REF.test(String(info.referenceType || '')) ? String(info.referenceType) : null;
  const referenceId = REF.test(String(info.referenceId || '')) ? String(info.referenceId) : null;
  return {
    kind,
    title,
    body: body.length > 180 ? body.slice(0, 180) + '…' : body,
    referenceType,
    referenceId,
    critical: !!info.critical,
    // Repeats of the same event replace each other instead of stacking.
    tag: `${kind}:${referenceId || title}`.slice(0, 160),
  };
}

/** Should a kind show while the app is NOT in front? */
function allows(settings, kind) {
  const s = sanitizeSettings(settings);
  if (kind === 'call') return s.calls;
  if (kind === 'message') return s.messages;
  if (kind === 'alert') return s.alerts;
  return false;
}

/** BGRA bitmap of an anti-aliased filled circle — the Windows taskbar
 *  overlay ("unread" dot) and the tray-icon dot, drawn at runtime so no extra
 *  image asset has to ship. */
function dotBitmap(size, rgb = [220, 38, 38]) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      const a = Math.max(0, Math.min(1, r - d));
      const i = (y * size + x) * 4;
      // Premultiplied BGRA (what nativeImage.createFromBitmap expects).
      buf[i] = Math.round(rgb[2] * a);
      buf[i + 1] = Math.round(rgb[1] * a);
      buf[i + 2] = Math.round(rgb[0] * a);
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return buf;
}

/** Paint the unread dot into the top-right corner of a BGRA icon bitmap. */
function withDot(bitmap, size, dotSize = Math.max(6, Math.round(size * 0.45))) {
  const out = Buffer.from(bitmap);
  const dot = dotBitmap(dotSize);
  const ox = size - dotSize;
  for (let y = 0; y < dotSize; y++) {
    for (let x = 0; x < dotSize; x++) {
      const s = (y * dotSize + x) * 4;
      const a = dot[s + 3] / 255;
      if (a === 0) continue;
      const d = (y * size + (ox + x)) * 4;
      for (let c = 0; c < 4; c++) out[d + c] = Math.round(dot[s + c] + out[d + c] * (1 - a));
    }
  }
  return out;
}

module.exports = {
  DEFAULTS, KEYS, HIDDEN_ARG,
  sanitizeSettings, sanitizePatch, badgeTotal, badgeLabel, trayTooltip,
  loginItemOptions, launchedHidden, windowState, inFront, sanitizeAlert, allows,
  dotBitmap, withDot,
};
