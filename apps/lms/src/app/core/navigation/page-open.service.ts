import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
  Event as RouterEvent, NavigationCancel, NavigationCancellationCode, NavigationEnd, NavigationError,
  NavigationSkipped, NavigationStart, Router,
} from '@angular/router';
import { PageSkeleton, pagePath, pageSkeletonFor } from './page-skeleton';
import { draftSwapDirection, slideDirection } from './slide-direction';
import { ZoomTransitionService, prefersReducedMotion } from './zoom-transition';

/**
 * PAGE OPEN — how every navigation looks (owner, 2026-09-30: "that is not
 * animation, it's a loading bar. I need a page-OPEN animation and
 * SKELETONS"). It replaces the old top progress bar. Three parts:
 *
 *  1. The FRAME. A navigation still on its way after {@link FRAME_AFTER_MS}
 *     (lazy chunk, guards) draws the destination's frame in the shell — its
 *     band + a skeleton of its body in that screen's layout (page-skeleton.ts)
 *     — easing in over the page you are leaving. The screen opens at the tap,
 *     not when its code has arrived. A fast navigation draws no frame.
 *  2. The OPEN. When the screen lands, the router's view transition eases it
 *     in (fade + a small rise) and the old one out (slide-transition.ts,
 *     `pf-vt-page`); after a frame it is a pure cross-fade (`pf-vt-settle`),
 *     so nothing rises twice. Where view transitions are missing (older
 *     WebKit in the native iOS shell) the shell plays the same entrance with
 *     CSS ({@link entering}).
 *  3. The SOURCE. `markSource(el)` gives the element that started the
 *     navigation (a DOM-built grid row action, a tile) instant press
 *     feedback: aria-busy + `.pf-nav-pending` until that navigation settles —
 *     cleared on cancel too, so a refused guard never leaves a busy button.
 *
 * Paired motions keep theirs: list → detail zooms and step → step slides
 * (zoom-transition.ts / slide-transition.ts) only get a frame when their
 * navigation is slow ({@link FRAME_AFTER_PAIRED_MS}). Reduced motion: the
 * frame simply appears and the screen swaps instantly.
 */

/** A navigation that lands faster than this draws no frame (no flicker). */
export const FRAME_AFTER_MS = 90;
/** Zoom / slide navigations have their own motion: a frame only when slow. */
export const FRAME_AFTER_PAIRED_MS = 400;
/** The CSS fallback entrance (no View Transitions API). */
export const ENTER_MS = 280;

export type PageEnter = 'rise' | 'settle';

@Injectable({ providedIn: 'root' })
export class PageOpenService {
  private readonly router = inject(Router);
  private readonly zoom = inject(ZoomTransitionService, { optional: true });
  private readonly _pending = signal(false);
  private readonly _frame = signal<PageSkeleton | null>(null);
  private readonly _entering = signal<PageEnter | null>(null);
  private sources = new Set<HTMLElement>();
  private navId = 0;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  /** The frame drawn for the navigation that just ended (the fallback
   *  entrance settles instead of rising a second time). */
  private framedLast = false;

  /** True from NavigationStart until the navigation settles. */
  readonly pending = this._pending.asReadonly();
  /** The destination frame the shell draws, or null. */
  readonly frame = this._frame.asReadonly();
  /** CSS-fallback entrance for the screen that just landed (null = none). */
  readonly entering = this._entering.asReadonly();

  /** Test seam: does this browser run router view transitions? */
  viewTransitions: () => boolean = () =>
    typeof document !== 'undefined' && typeof (document as { startViewTransition?: unknown }).startViewTransition === 'function';

  constructor() {
    // `events` is optional so a screen spec's Router double ({ navigate })
    // still builds; the real router always has it.
    const sub = (this.router as Partial<Router>).events?.subscribe(e => this.onEvent(e));
    inject(DestroyRef).onDestroy(() => { sub?.unsubscribe(); this.clearFrameTimer(); this.clearEnterTimer(); });
  }

  /** True while the frame is on screen (the view transition then settles). */
  framed(): boolean { return this._frame() !== null; }

  /** Instant press feedback on the element that started a navigation. */
  markSource(el: HTMLElement | null | undefined): void {
    if (!el) return;
    el.setAttribute('aria-busy', 'true');
    el.classList.add('pf-nav-pending');
    this.sources.add(el);
    // A tap that never produced a navigation (a no-op navigate to the same
    // URL) must not stay busy: clear shortly after if nothing started.
    // (Callers may start the navigation after a paint — afterNextPaint — so
    // allow a couple of frames before deciding nothing started.)
    const id = this.navId;
    setTimeout(() => { if (!this._pending() && this.navId === id) this.clearSources(); }, 250);
  }

  private onEvent(e: RouterEvent): void {
    if (e instanceof NavigationStart) { this.onStart(e); return; }
    if (e instanceof NavigationCancel
        && (e.code === NavigationCancellationCode.Redirect || e.code === NavigationCancellationCode.SupersededByNewNavigation)) {
      // A guard redirect / a newer navigation continues the same intent: its
      // own NavigationStart takes the frame over.
      return;
    }
    if (e instanceof NavigationEnd || e instanceof NavigationCancel
      || e instanceof NavigationError || e instanceof NavigationSkipped) {
      if (e.id !== this.navId) return;           // an older, superseded navigation
      this._pending.set(false);
      this.clearFrameTimer();
      this.framedLast = this._frame() !== null;
      this._frame.set(null);
      this.clearSources();
      if (e instanceof NavigationEnd) this.afterEnd();
    }
  }

  private onStart(e: NavigationStart): void {
    const from = this.router.url;
    this.navId = e.id;
    this._pending.set(true);
    this.clearFrameTimer();
    const frame = this.frameFor(from, e.url);
    // Already showing a frame (guard redirect, a newer tap): follow the new
    // destination at once instead of flashing the old page back.
    if (this._frame() !== null) { this._frame.set(frame); return; }
    if (!frame) return;
    const nav = this.router.getCurrentNavigation?.();
    const paired = !!slideDirection(from, e.url)
      || !!draftSwapDirection(nav?.extras?.state)
      || !!this.zoom?.armed();
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null;
      if (this.navId === e.id && this._pending()) this._frame.set(frame);
    }, paired ? FRAME_AFTER_PAIRED_MS : FRAME_AFTER_MS);
  }

  /** The frame a navigation from → to draws, or null (same screen with new
   *  query params, the branch-switch hop, destinations with no frame). */
  private frameFor(from: string, to: string): PageSkeleton | null {
    const f = pagePath(from), t = pagePath(to);
    if (f === t || f === '/_branch') return null;
    return pageSkeletonFor(t);
  }

  /** No View Transitions API: play the same page-open with CSS. */
  private afterEnd(): void {
    if (this.viewTransitions() || prefersReducedMotion()) return;
    const kind: PageEnter = this.framedLast ? 'settle' : 'rise';
    this.clearEnterTimer();
    this._entering.set(null);
    // Next frame, so the new screen's first paint is the start of the motion.
    queueMicrotask(() => {
      this._entering.set(kind);
      this.enterTimer = setTimeout(() => { this.enterTimer = null; this._entering.set(null); }, ENTER_MS);
    });
  }

  private clearFrameTimer(): void {
    if (this.frameTimer !== null) { clearTimeout(this.frameTimer); this.frameTimer = null; }
  }
  private clearEnterTimer(): void {
    if (this.enterTimer !== null) { clearTimeout(this.enterTimer); this.enterTimer = null; }
  }

  private clearSources(): void {
    for (const el of this.sources) {
      el.removeAttribute('aria-busy');
      el.classList.remove('pf-nav-pending');
    }
    this.sources = new Set();
  }
}
