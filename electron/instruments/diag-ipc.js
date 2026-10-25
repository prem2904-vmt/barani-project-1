'use strict';
/**
 * The "Connect an analyzer" IPC handlers that need more than a pass-through
 * (host-electron.js registers them). Plain Node — the Electron dialog and
 * window are injected — so the security rules are unit-tested without
 * launching Electron (test/diag-ipc.test.js).
 *
 *   fixFirewall  the ONE elevated write. The renderer's confirm can be
 *                skipped by anything running in the page, so MAIN asks
 *                again with its own dialog, listing the exact changes, before
 *                Windows' permission prompt. Cancel → nothing changes.
 *   probe        connect-only LAN look-around: ports ≥ 1024, ARP hosts only
 *                (no whole-/24 sweep from the renderer).
 */
const { portList, adapterName } = require('./netdiag');

const bad = (what) => ({ error: `bad_request: ${what}` });
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);

/** Main's own confirm, in plain words. Resolves true only on the Fix button. */
async function confirmFix(plan, { showMessageBox, getWindow }) {
  const opts = {
    type: 'question',
    title: 'Prefrontal',
    message: 'Let analyzers reach Prefrontal?',
    detail: `Prefrontal will make these changes:\n\n${plan.lines.map((l) => `• ${l}`).join('\n')}\n\nWindows asks "Do you want to allow this app to make changes?" — choose Yes.`,
    buttons: ['Cancel', 'Fix with Windows permission'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const w = getWindow && getWindow();
  const r = w && !w.isDestroyed() ? await showMessageBox(w, opts) : await showMessageBox(opts);
  return !!r && r.response === 1;
}

/**
 * @param {object} deps
 * @param {object} deps.diag            NetDiag
 * @param {Function} deps.showMessageBox  Electron dialog.showMessageBox
 * @param {Function} deps.getWindow     () → the main BrowserWindow (dialog parent)
 */
function makeDiagHandlers({ diag, showMessageBox, getWindow }) {
  return {
    /** { ports?: number[], adapter: string } — the card the wizard picked. */
    async fixFirewall(p) {
      const o = obj(p) || {};
      const asked = o.ports == null ? [] : portList(o.ports, 24, 1024);
      const adapter = adapterName(o.adapter);
      if (!asked || !adapter) return bad('fix');
      return diag.fixFirewall({ ports: asked, adapter, confirm: (plan) => confirmFix(plan, { showMessageBox, getWindow }) });
    },
    /** { address: string, ports?: number[] } — `wide` is not accepted from the renderer. */
    probe(p) {
      const o = obj(p) || {};
      const address = str(o.address, 15);
      const ports = o.ports == null ? undefined : portList(o.ports, 8, 1024);
      if (!address || ports === null) return bad('probe');
      return diag.probe({ address, ports });
    },
  };
}

module.exports = { makeDiagHandlers, confirmFix };
