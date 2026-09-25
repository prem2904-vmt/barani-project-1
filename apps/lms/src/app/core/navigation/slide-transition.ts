import { inject } from '@angular/core';
import { Router, ViewTransitionInfo } from '@angular/router';
import { runZoom, zoomDirection } from './zoom-transition';

/** Which step-to-step navigations slide, and in which direction. A flow
 *  moves FORWARD (current screen exits left, next enters from the right)
 *  and BACK reverses it. Anything not listed keeps the instant swap. */
export function slideDirection(from: string, to: string): 'forward' | 'back' | null {
  const path = (u: string) => (u || '').split(/[?#]/)[0];
  const f = path(from), t = path(to);
  const isCollect = (u: string) => u.startsWith('/lab/collect');
  const isFrontdesk = (u: string) => u === '/frontdesk' || u.startsWith('/frontdesk/');
  if (isFrontdesk(f) && isCollect(t)) return 'forward';
  if (isCollect(f) && isFrontdesk(t)) return 'back';
  return null;
}

/** Router `onViewTransitionCreated` hook (runs in an injection context):
 *  tags <html> with the direction for the duration of the transition so the
 *  global ::view-transition CSS can slide; My Work ⇄ result entry zooms
 *  instead (zoom-transition.ts); skips everything else (and all of it under
 *  reduced motion). */
export function slideTransition(info: ViewTransitionInfo): void {
  const router = inject(Router);
  const nav = router.getCurrentNavigation();
  const to = nav ? router.serializeUrl(nav.finalUrl ?? nav.extractedUrl) : '';
  const dir = slideDirection(router.url, to);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { info.transition.skipTransition(); return; }
  if (!dir) {
    const zoom = zoomDirection(router.url, to);
    if (!zoom || !runZoom(info, zoom)) info.transition.skipTransition();
    return;
  }
  const root = document.documentElement;
  const cls = dir === 'forward' ? 'pf-vt-forward' : 'pf-vt-back';
  root.classList.add(cls);
  info.transition.finished.finally(() => root.classList.remove(cls));
}
