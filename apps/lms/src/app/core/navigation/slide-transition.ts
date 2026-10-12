import { inject } from '@angular/core';
import { Router, ViewTransitionInfo } from '@angular/router';
import { ZoomTransitionService, guardTransition, prefersReducedMotion } from './zoom-transition';
import { draftSwapDirection, slideDirection } from './slide-direction';
import { PageOpenService } from './page-open.service';
import { pagePath } from './page-skeleton';

export { draftSwapDirection, slideDirection } from './slide-direction';

/** <html> classes for the page-open transition (styles.scss). */
export const PAGE_CLASS = 'pf-vt-page';
/** …plus this one when the destination frame was already up: the screen
 *  then cross-fades from its frame instead of rising a second time. */
export const PAGE_SETTLE_CLASS = 'pf-vt-settle';

/** What a router view transition does. `none` = instant swap. */
export type PageMotion = 'slide-forward' | 'slide-back' | 'zoom' | 'page' | 'none';

/**
 * The page-open decision for navigations that neither slide nor zoom: every
 * move to a DIFFERENT screen opens as a page; the same screen with new query
 * params and the branch-switch hop (its own veil) swap instantly.
 */
export function opensAsPage(from: string, to: string): boolean {
  const f = pagePath(from), t = pagePath(to);
  if (f === t) return false;
  if (f === '/_branch' || t === '/_branch') return false;
  return true;
}

/** Router `onViewTransitionCreated` hook (runs in an injection context).
 *  Three motions, one rule (docs/PF-PATTERN.md §9):
 *   - step → step SLIDES: tags <html> with the direction for the duration of
 *     the transition so the global ::view-transition CSS can slide;
 *   - list → detail ZOOMS: a tapped [pfZoomSource] morphs into the detail's
 *     [pfZoomTarget], and back reverses it (zoom-transition.ts);
 *   - everything else OPENS AS A PAGE: the old screen eases out, the new one
 *     eases in with a small rise (page-open.service.ts).
 *  All of it swaps instantly under reduced motion. */
export function slideTransition(info: ViewTransitionInfo): void {
  const router = inject(Router);
  const zoom = inject(ZoomTransitionService);
  const page = inject(PageOpenService);
  const nav = router.getCurrentNavigation();
  const to = nav ? router.serializeUrl(nav.finalUrl ?? nav.extractedUrl) : '';
  // Whatever happens below, this transition can't hang the screen.
  guardTransition(info.transition);
  if (prefersReducedMotion()) { zoom.disarm(); info.transition.skipTransition(); return; }
  // Draft → draft hop from the app bar's draft shelf: the chip tags the
  // navigation with its direction (DraftShelfService.swapState), so the
  // screen you leave slides out and the other draft's screen slides in.
  const dir = draftSwapDirection(nav?.extras?.state) ?? slideDirection(router.url, to);
  if (!dir) {
    if (zoom.onRouterTransition(info, router.url, to)) return;
    if (!opensAsPage(router.url, to)) { info.transition.skipTransition(); return; }
    tagRoot(info, page.framed() ? [PAGE_CLASS, PAGE_SETTLE_CLASS] : [PAGE_CLASS]);
    return;
  }
  zoom.disarm();
  tagRoot(info, [dir === 'forward' ? 'pf-vt-forward' : 'pf-vt-back']);
}

/** Tag <html> for the length of the transition (the old state is captured
 *  after this hook, so the classes are in place for both snapshots). */
let tagGen = 0;
function tagRoot(info: ViewTransitionInfo, classes: string[]): void {
  const root = document.documentElement;
  const gen = ++tagGen;
  root.classList.remove('pf-vt-forward', 'pf-vt-back', PAGE_CLASS, PAGE_SETTLE_CLASS);
  root.classList.add(...classes);
  // Only the newest transition cleans up: an older one finishing late must
  // not strip a newer one's classes mid-animation.
  const done = () => { if (gen === tagGen) root.classList.remove(...classes); };
  info.transition.finished.then(done, done);
}
