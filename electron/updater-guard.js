'use strict';
/**
 * Decide whether it's safe to restart-to-install a downloaded update right
 * now. Pure function over the instrument connectors' own status snapshots
 * (electron/instruments/core/connector.js `status()`) — no Electron, no IO —
 * so it's unit tested head-on (electron/test/updater-guard.test.js).
 *
 * "Busy" is intentionally narrower than "connected": a paired analyzer sits
 * in state 'connected' for its whole plugged-in lifetime (idle between
 * runs), so treating that alone as busy would mean updates almost never
 * install in a working lab. We hold the restart back only for genuine
 * in-flight activity:
 *   - 'listening' with no `link` — an explicit listen / "find the analyzer"
 *     capture (host-electron guardSnapshot()). A paired TCP-server connector
 *     also reports state 'listening' while it WAITS for its analyzer; it
 *     carries `link` ('waiting') and is idle, never busy — or every lab with
 *     a listening analyzer would never install an update.
 *   - queueLength > 0 — a parsed result hasn't reached the server yet
 *     (an "upload queued").
 *   - a message arrived very recently — a run is actively streaming in,
 *     even though the connector's steady state never changes.
 */
const ACTIVE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes since the last message

function isConnectorBusy(status, now) {
  if (!status) return false;
  if (status.state === 'listening' && !status.link) return true;
  if (Number(status.queueLength) > 0) return true;
  const last = status.lastMessageAt ? new Date(status.lastMessageAt).getTime() : NaN;
  if (Number.isFinite(last) && now - last < ACTIVE_WINDOW_MS) return true;
  return false;
}

/**
 * @param {Array<object>|null|undefined} statuses connector.status() snapshots
 * @param {number} [now] injectable clock for tests
 * @returns {{ safe: boolean, reasons: string[] }}
 */
function canRestartNow(statuses, now = Date.now()) {
  const list = Array.isArray(statuses) ? statuses : [];
  const busy = list.filter((s) => isConnectorBusy(s, now));
  return {
    safe: busy.length === 0,
    reasons: busy.map((s) => s.name || s.instrumentId || 'instrument'),
  };
}

module.exports = { canRestartNow, isConnectorBusy, ACTIVE_WINDOW_MS };
