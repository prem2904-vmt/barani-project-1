import { DestroyRef, Signal, inject, signal } from '@angular/core';

/** ONE interaction mode per device type (owner) — the same query Order &
 *  Payments uses for its search mode: a mouse + hover device is "web",
 *  everything else (iPad, phone, touch laptop without hover) is "touch". */
export const WEB_POINTER_MQ = '(hover: hover) and (pointer: fine)';

/** Reactive `true` on web (fine pointer + hover), `false` on touch. Call in
 *  an injection context; the listener is removed with the owner. Defaults to
 *  web where matchMedia is unavailable (SSR / old test envs). */
export function webPointerSignal(): Signal<boolean> {
  const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WEB_POINTER_MQ) : null;
  const s = signal(mql ? !!mql.matches : true);
  if (mql && typeof mql.addEventListener === 'function') {
    const on = (e: MediaQueryListEvent) => s.set(e.matches);
    mql.addEventListener('change', on);
    try { inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', on)); } catch { /* no owner */ }
  }
  return s.asReadonly();
}
