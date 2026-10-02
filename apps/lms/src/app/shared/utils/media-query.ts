import { DestroyRef, Signal, inject, signal } from '@angular/core';

/** A reactive `matchMedia` signal: the current match, updated on change and
 *  unsubscribed with the owner. Call in an injection context. Falls back to
 *  `fallback` where matchMedia is missing (SSR / old test environments). */
export function mediaSignal(query: string, fallback = false): Signal<boolean> {
  const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query) : null;
  const s = signal(mql ? !!mql.matches : fallback);
  if (mql && typeof mql.addEventListener === 'function') {
    const on = (e: MediaQueryListEvent) => s.set(e.matches);
    mql.addEventListener('change', on);
    try { inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', on)); } catch { /* no owner */ }
  }
  return s.asReadonly();
}
