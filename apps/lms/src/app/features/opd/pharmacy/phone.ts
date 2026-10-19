import { DestroyRef, inject, signal, type Signal } from '@angular/core';

/** Phone layout (≤640px — the repo's additive phone breakpoint), reactive to
 *  resizes. Used to swap the side card's footer CTA for the kit's
 *  `.pf-bottombar` so exactly ONE primary is ever in the DOM. */
export function phoneSignal(query = '(max-width: 640px)'): Signal<boolean> {
  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  const s = signal(!!mq?.matches);
  if (mq) {
    const on = (e: MediaQueryListEvent) => s.set(e.matches);
    mq.addEventListener?.('change', on);
    inject(DestroyRef).onDestroy(() => mq.removeEventListener?.('change', on));
  }
  return s.asReadonly();
}
