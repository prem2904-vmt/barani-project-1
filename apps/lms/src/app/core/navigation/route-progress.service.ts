import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
  Event as RouterEvent, NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router,
} from '@angular/router';
import { createSpinDelay } from '../../shared/utils/busy';

/**
 * ROUTE PROGRESS — the global "a screen is on its way" signal
 * (docs/ND-PATTERN.md "Loading feedback").
 *
 * A navigation can wait on a lazy chunk download, guards and resolvers before
 * the destination renders ANYTHING — that was the frozen second after
 * "Edit" in Test Master. This service turns every navigation into:
 *
 *   - `pending`  — true from NavigationStart to its end (cancel / error /
 *                  skip included). Raw.
 *   - `shown`    — `pending` through the spin-delay rules (on after 150ms,
 *                  held 300ms): drives the top bar, so an instant navigation
 *                  (query-param changes, cached screens) shows nothing.
 *
 * `markSource(el)` gives the element that STARTED the navigation (a grid's
 * DOM-built "Edit" row action, a tile) instant press feedback: aria-busy +
 * `.pf-nav-pending` until that navigation settles — cleared on cancel too,
 * so a refused guard never leaves a busy button behind.
 */
@Injectable({ providedIn: 'root' })
export class RouteProgressService {
  private readonly router = inject(Router);
  private readonly _pending = signal(false);
  private readonly machine = createSpinDelay();
  private sources = new Set<HTMLElement>();
  private navId = 0;

  /** True from NavigationStart until the navigation settles. */
  readonly pending = this._pending.asReadonly();
  /** True while the top bar should be on screen (delayed + held). */
  readonly shown = this.machine.shown;

  constructor() {
    // `events` is optional so a screen spec's Router double ({ navigate })
    // still builds; the real router always has it.
    const sub = (this.router as Partial<Router>).events?.subscribe(e => this.onEvent(e));
    inject(DestroyRef).onDestroy(() => { sub?.unsubscribe(); this.machine.dispose(); });
  }

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
    if (e instanceof NavigationStart) {
      this.navId = e.id;
      this._pending.set(true);
      this.machine.set(true);
      return;
    }
    if (e instanceof NavigationEnd || e instanceof NavigationCancel
      || e instanceof NavigationError || e instanceof NavigationSkipped) {
      if (e.id !== this.navId) return;           // an older, superseded navigation
      this._pending.set(false);
      this.machine.set(false);
      this.clearSources();
    }
  }

  private clearSources(): void {
    for (const el of this.sources) {
      el.removeAttribute('aria-busy');
      el.classList.remove('pf-nav-pending');
    }
    this.sources = new Set();
  }
}
