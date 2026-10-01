import { Signal, effect } from '@angular/core';
import { WorkBounds, WorkStatusFilter, inWorkWindow } from './work-status-filter';
import { OutsourcedTube } from '../outsourced/outsourced-view';

/** The slice of OutsourcingService this loader needs — kept narrow so a test
 *  can fake it directly, without pulling in HttpClient / the real service. */
export interface MergedOutsourcedLoaderDeps {
  dateWindow: { set(w: ((t: OutsourcedTube) => boolean) | null): void };
  loadAllFor(status: 'all', days: number): Promise<void>;
}

/** The default/minimum server window (OutsourcingService.windowDays) — the
 *  computed days below never shrinks below this, only widens it for a
 *  custom range further back (P2-11). Mirrors the service's own default so
 *  this file doesn't need to import it just to duplicate the number. */
const MIN_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 365; // the server's own clamp (OutsourcingService.cs)

/** How many days back the server window needs to be to cover the work
 *  card's date range (P2-11): a custom range further back than the default
 *  90-day window must not be silently cut. Never shrinks below the default
 *  (a narrow "Today" range doesn't need a narrower window — 90 days is
 *  already cheap and avoids a resize on every "Today"↔"Yesterday" flip). */
export function windowDaysFor(bounds: WorkBounds, now: number = Date.now()): number {
  const spanDays = Math.ceil((now - bounds.start) / 86_400_000) + 1; // +1: rounding/timezone safety margin
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, spanDays));
}

/**
 * Keeps OutsourcingService's date window — AND, while the merged ("no chip")
 * work list is showing, its full load — in sync with the frontdesk work
 * card (owner, 2026-10-01). The merged list needs EVERY outsourced row in
 * the window, not just whichever page/status the dedicated Outsourced tab
 * happens to have loaded: an order that is ONLY outsourced gets a row there
 * purely from this data (work-merge.ts's `synthesize`), and nothing else
 * ever asks the service to fetch on the frontdesk's behalf — the tab only
 * loads once it's actually mounted.
 *
 * Call once, from an injection context (a component's constructor/field
 * initializer). Runs once immediately, then again on:
 *   - `workBounds()` changing (the work card's date range);
 *   - `feedIds()` changing (a NEW Set reference every time `refresh()`
 *     refetches `_orders()` — covers "on refresh", incl. live work events);
 *   - `rightTab()` changing (a chip toggled on/off).
 * `loadAllFor('all', days)` is itself a no-op once already current
 * (OutsourcingService.matchesLoaded), so switching between the merged view
 * and the Outsourced chip never double-fetches the same page — and it OWNS
 * the status/window transition atomically (never races the service's
 * generic filter-change effect — see loadAllFor's own doc, P2-12).
 */
export function wireMergedOutsourcedLoader(
  rightTab: Signal<WorkStatusFilter>,
  workBounds: Signal<WorkBounds>,
  feedIds: Signal<ReadonlySet<string>>,
  outsourcing: MergedOutsourcedLoaderDeps,
) {
  return effect(() => {
    const bounds = workBounds();
    const feed = feedIds();
    outsourcing.dateWindow.set(t => inWorkWindow(t.createdAt, bounds, feed.has(t.orderId)));
    if (rightTab() === null) {
      void outsourcing.loadAllFor('all', windowDaysFor(bounds));
    }
  });
}
