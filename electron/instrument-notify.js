'use strict';
/**
 * Decides when an instrument's connect/disconnect state change is worth a
 * native notification — debounced so a flaky serial cable or a noisy
 * heartbeat tick doesn't spam the user, and fired at most once per real
 * change (not repeated while the state just sits there).
 *
 * Pure decision logic (classify) plus a small stateful debouncer with
 * injectable timers, so `node --test electron/test/*.test.js` can drive it
 * without real delays. electron/tray.js is the only Electron-side caller:
 * it feeds every `manager.on('status', …)` tick through `report()` and
 * shows a Notification from `onFire`.
 */

const UP = new Set(['connected', 'listening']);
const DOWN = new Set(['disconnected', 'error']);

/** 'starting' / 'stopped' / anything unrecognised is a transient, not a
 *  notify-worthy connectivity class — it never flips `notified`. */
function classify(state) {
  if (UP.has(state)) return 'up';
  if (DOWN.has(state)) return 'down';
  return null;
}

class InstrumentConnectivityWatcher {
  /**
   * @param {object} o
   * @param {(info:{instrumentId:string,name:string,cls:'up'|'down'}) => void} o.onFire
   * @param {number} [o.debounceMs]
   * @param {(fn:Function, ms:number) => any} [o.setTimer]
   * @param {(h:any) => void} [o.clearTimer]
   */
  constructor({ onFire, debounceMs = 30_000, setTimer, clearTimer } = {}) {
    if (typeof onFire !== 'function') throw new Error('InstrumentConnectivityWatcher: onFire is required');
    this.onFire = onFire;
    this.debounceMs = debounceMs;
    this.setTimer = setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = clearTimer || ((h) => clearTimeout(h));
    this.known = new Map(); // instrumentId → { notified, pending, timer, name }
  }

  /** Feed one connector status tick. No-op for a neutral state. */
  report(instrumentId, name, state) {
    const cls = classify(state);
    if (!cls || !instrumentId) return;
    let e = this.known.get(instrumentId);
    if (!e) { e = { notified: null, pending: null, timer: null }; this.known.set(instrumentId, e); }
    e.name = name || e.name || instrumentId;

    // First sighting of this instrument (app just started, or it was just
    // paired): record silently. A fresh connector coming up "connected"
    // must never announce itself as a "reconnect".
    if (e.notified === null) { e.notified = cls; return; }

    if (cls === e.notified) {
      // Back to the already-announced state before the debounce fired —
      // a flap, not a real change. Cancel the pending flip.
      e.pending = null;
      if (e.timer) { this.clearTimer(e.timer); e.timer = null; }
      return;
    }

    e.pending = cls;
    if (e.timer) this.clearTimer(e.timer);
    e.timer = this.setTimer(() => {
      e.timer = null;
      if (e.pending && e.pending !== e.notified) {
        e.notified = e.pending;
        e.pending = null;
        this.onFire({ instrumentId, name: e.name, cls: e.notified });
      }
    }, this.debounceMs);
  }

  /** Drop a watched instrument (unpaired) — no pending timer leaks. */
  forget(instrumentId) {
    const e = this.known.get(instrumentId);
    if (e && e.timer) this.clearTimer(e.timer);
    this.known.delete(instrumentId);
  }

  /** Tests / app shutdown: cancel every pending timer. */
  clear() {
    for (const e of this.known.values()) if (e.timer) this.clearTimer(e.timer);
    this.known.clear();
  }
}

module.exports = { classify, InstrumentConnectivityWatcher };
