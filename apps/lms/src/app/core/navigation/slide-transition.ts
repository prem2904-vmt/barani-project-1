import { inject } from '@angular/core';
import { Router, ViewTransitionInfo } from '@angular/router';
import { ZoomTransitionService, prefersReducedMotion } from './zoom-transition';

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

/** Router `onViewTransitionCreated` hook (runs in an injection context).
 *  Two motions, one rule (docs/ND-PATTERN.md §9):
 *   - step → step SLIDES: tags <html> with the direction for the duration of
 *     the transition so the global ::view-transition CSS can slide;
 *   - list → detail ZOOMS: a tapped [pfZoomSource] morphs into the detail's
 *     [pfZoomTarget], and back reverses it (zoom-transition.ts).
 *  Everything else swaps instantly, and all of it does under reduced motion. */
export function slideTransition(info: ViewTransitionInfo): void {
  const router = inject(Router);
  const zoom = inject(ZoomTransitionService);
  const nav = router.getCurrentNavigation();
  const to = nav ? router.serializeUrl(nav.finalUrl ?? nav.extractedUrl) : '';
  if (prefersReducedMotion()) { zoom.disarm(); info.transition.skipTransition(); return; }
  const dir = slideDirection(router.url, to);
  if (!dir) {
    if (!zoom.onRouterTransition(info, router.url, to)) info.transition.skipTransition();
    return;
  }
  zoom.disarm();
  const root = document.documentElement;
  const cls = dir === 'forward' ? 'pf-vt-forward' : 'pf-vt-back';
  root.classList.add(cls);
  info.transition.finished.finally(() => root.classList.remove(cls));
}
