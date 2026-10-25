'use strict';
/**
 * Pure builder for the system-tray menu (Windows/macOS) — no Electron
 * import, so it's covered head-on by `node --test electron/test/*.test.js`.
 * electron/tray.js is the only caller: it turns this plain template into a
 * real `Menu.buildFromTemplate()`, mapping each `action` id to a click
 * handler (open the window, navigate, toggle login, quit, …).
 *
 * Input shape (all optional; see electron/tray.js for how it's assembled):
 *   {
 *     now,                // injectable clock (ms) — tests only
 *     version,             // app.getVersion()
 *     instruments: [{
 *       instrumentId, name, state, link, // connector.status() shape (link = true status)
 *       sessions, errorDetail,
 *       lastMessageAt, queueLength, messagesToday, unmatchedToday,
 *       serverOnline, serverOfflineSince,
 *     }],
 *     updater: { phase, version, progress } | null,
 *     startAtLogin, loginSupported,
 *   }
 */

/**
 * The true link of an instrument: the connector's own `link` when present
 * (connector.js deriveLink), else derived from the bare state — 'listening'
 * is a port with NOBODY on it yet, so it is never "Connected".
 */
function linkOf(state, link) {
  if (link) return link;
  if (state === 'connected') return 'connected';
  if (state === 'listening') return 'waiting';
  if (state === 'error') return 'error';
  if (state === 'starting') return 'starting';
  if (state === 'stopped') return 'stopped';
  return 'not_connected';
}

/** ● only when the analyzer is really connected. */
function dotFor(state, link) { return linkOf(state, link) === 'connected' ? '●' : '○'; }

function statusWord(state, link) {
  switch (linkOf(state, link)) {
    case 'connected': return 'Connected';
    case 'waiting': return 'Waiting for analyzer';
    case 'starting': return 'Starting';
    case 'error': return 'Error';
    default: return 'Not connected';
  }
}

/** "3m ago" / "2h ago" / "just now" — no external i18n, matches the rest of
 *  the tray's plain-English labels. */
function relativeTime(iso, now) {
  if (!iso) return null;
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 45_000) return 'just now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function pad2(n) { return n < 10 ? `0${n}` : String(n); }

/** Local wall-clock "8:04 PM" — the tray lives on the user's own machine
 *  clock, not IST (unlike the lab's business-day rules). */
function formatClock(date) {
  let h = date.getHours();
  const m = pad2(date.getMinutes());
  const ampm = h >= 12 ? 'PM' : 'AM';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function instrumentLine(inst, now) {
  const rel = relativeTime(inst.lastMessageAt, now);
  const suffix = rel ? ` · last result ${rel}` : '';
  return `${dotFor(inst.state, inst.link)} ${inst.name} — ${statusWord(inst.state, inst.link)}${suffix}`;
}

/** "Port 5600 is used by CBC LIS M51 (PID 7412)…" under an instrument in error. */
function problemLine(inst) {
  if (linkOf(inst.state, inst.link) !== 'error' || !inst.errorDetail) return null;
  const t = String(inst.errorDetail);
  return `    ${t.length > 90 ? `${t.slice(0, 89)}…` : t}`;
}

function sum(list, pick) {
  return list.reduce((n, i) => n + (Number(pick(i)) || 0), 0);
}

/** "Connected to Prefrontal" / "Offline since 8:04 PM" — unknown (no
 *  instrument has reported a heartbeat yet) renders nothing (null): the
 *  server-status line simply doesn't show until there's something to say. */
function serverStatusLine(instruments, now) {
  const known = instruments.filter((i) => i.serverOnline === true || i.serverOnline === false);
  if (!known.length) return null;
  const offline = known.filter((i) => i.serverOnline === false);
  if (!offline.length) return 'Connected to Prefrontal';
  const earliest = offline.reduce((min, i) => {
    const t = i.serverOfflineSince ? new Date(i.serverOfflineSince).getTime() : now;
    return Number.isFinite(t) && t < min ? t : min;
  }, Infinity);
  return `Offline since ${formatClock(new Date(Number.isFinite(earliest) ? earliest : now))}`;
}

function connectedCount(instruments) {
  return instruments.filter((i) => linkOf(i.state, i.link) === 'connected').length;
}

/** Tray tooltip — only instrument-driven; electron/tray.js swaps in the
 *  unread chat/bell tooltip itself when that count is the more pressing one. */
function tooltip(instruments) {
  const n = connectedCount(instruments);
  return `Prefrontal — ${n} instrument${n === 1 ? '' : 's'} connected`;
}

/** Does the tray icon need the attention dot? Any instrument down, anything
 *  queued or unmatched, or the server looking unreachable. */
function hasAttention(instruments) {
  // A listening port with nobody on it ('waiting') is the normal idle state
  // of analyzers that connect per run — not an attention case.
  return instruments.some((i) => (
    (i.state !== 'stopped' && i.state !== 'starting' && ['error', 'not_connected'].includes(linkOf(i.state, i.link)))
    || Number(i.queueLength) > 0
    || Number(i.unmatchedToday) > 0
    || i.serverOnline === false
  ));
}

function updaterLabel(updater) {
  if (!updater) return 'Check for updates';
  switch (updater.phase) {
    case 'checking': return 'Checking for updates…';
    case 'downloading': return `Downloading update… ${updater.progress || 0}%`;
    case 'ready': return `Restart to install${updater.version ? ` v${updater.version}` : ''}`;
    case 'deferred': return 'Update ready — waiting for instruments to finish';
    default: return 'Check for updates';
  }
}

function buildMenuModel(state = {}) {
  const now = typeof state.now === 'number' ? state.now : Date.now();
  const instruments = Array.isArray(state.instruments) ? state.instruments : [];
  const t = [];

  t.push({ action: 'open', label: 'Open Prefrontal' });
  t.push({ type: 'separator' });

  if (!instruments.length) {
    t.push({ label: 'No instruments connected', enabled: false });
  } else {
    for (const inst of instruments) {
      t.push({ label: instrumentLine(inst, now), enabled: false });
      const p = problemLine(inst);
      if (p) t.push({ label: p, enabled: false });
    }
  }

  if (instruments.length) {
    t.push({ label: `Results received today: ${sum(instruments, (i) => i.messagesToday)}`, enabled: false });
  }

  const queued = sum(instruments, (i) => i.queueLength);
  if (queued > 0) {
    t.push({ label: `Results waiting to send: ${queued} — will send when back online`, enabled: false });
  }

  const unmatched = sum(instruments, (i) => i.unmatchedToday);
  if (unmatched > 0) {
    t.push({ action: 'openUnmatched', label: `Unmatched results today: ${unmatched}` });
  }

  const server = serverStatusLine(instruments, now);
  if (server) t.push({ label: server, enabled: false });

  t.push({ type: 'separator' });
  t.push({ action: 'openInstruments', label: 'Open Instruments' });
  t.push({ action: 'checkUpdates', label: updaterLabel(state.updater) });
  t.push({ label: `Version ${state.version || ''}`.trim(), enabled: false });

  t.push({ type: 'separator' });
  t.push({
    action: 'toggleLogin',
    label: 'Start at login',
    type: 'checkbox',
    checked: !!state.startAtLogin,
    enabled: state.loginSupported !== false,
  });
  t.push({ action: 'copyDiagnostics', label: 'Copy diagnostic info' });

  t.push({ type: 'separator' });
  t.push({ action: 'quit', label: 'Quit Prefrontal' });

  return t;
}

module.exports = {
  buildMenuModel, tooltip, hasAttention, connectedCount,
  instrumentLine, serverStatusLine, relativeTime, formatClock,
  dotFor, statusWord, updaterLabel, linkOf, problemLine,
};
