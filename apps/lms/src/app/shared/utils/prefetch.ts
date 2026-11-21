/**
 * PREFETCH a lazy screen's code before the user asks for it, so the tap that
 * opens it doesn't wait on a chunk download (docs/PF-PATTERN.md "Loading
 * feedback"). Used by list screens for the editor they open — Test Master
 * warms the test editor while the grid sits idle and again on hover / focus
 * of an "Edit" action.
 *
 *   prefetch(key, loader)          start now (deduped by key; a failure can retry)
 *   prefetchWhenIdle(key, loader)  start when the browser is idle; returns cancel()
 *
 * The loader is the SAME dynamic import the route uses, so the router finds
 * the module already evaluated and renders on the next frame. Data-saver
 * connections skip the idle warm-up (hover / focus still prefetches: that is
 * a strong signal of intent).
 */

const inflight = new Map<string, Promise<unknown>>();
/** Test seam: unit tests never start a real background import (apps/lms/src/test-setup.ts turns loads off) — a chunk
 *  still loading when a spec file's environment is torn down fails the run ("EnvironmentTeardownError"). */
let loadsOn = true;
export function setPrefetchLoadsForTests(on: boolean): void { loadsOn = on; }

/** Start loading now; repeated calls with the same key share one load. */
export function prefetch(key: string, loader: () => Promise<unknown>): Promise<unknown> {
  let p = inflight.get(key);
  if (!p && !loadsOn) { p = Promise.resolve(); inflight.set(key, p); return p; }   // tests: remembered, never loaded
  if (!p) {
    p = loader().catch(err => {
      inflight.delete(key);            // a network blip may retry on the next hover
      return err;
    });
    inflight.set(key, p);
  }
  return p;
}

/** Has `key` been asked for already (loaded or loading)? */
export function isPrefetched(key: string): boolean {
  return inflight.has(key);
}

/** Test seam: forget every prefetch. */
export function resetPrefetchForTests(): void {
  inflight.clear();
}

function saveData(): boolean {
  try {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return !!c?.saveData;
  } catch {
    return false;
  }
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * Warm `key` once the main thread is idle (fallback: after `fallbackMs`).
 * Returns a cancel function for the caller's DestroyRef.
 */
export function prefetchWhenIdle(key: string, loader: () => Promise<unknown>, fallbackMs = 600): () => void {
  if (!loadsOn || inflight.has(key) || typeof window === 'undefined' || saveData()) return () => { /* nothing scheduled */ };
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(() => { void prefetch(key, loader); }, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(() => { void prefetch(key, loader); }, fallbackMs);
  return () => clearTimeout(t);
}
