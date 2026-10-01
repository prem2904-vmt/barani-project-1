import { Signal, effect } from '@angular/core';
import { WorkBounds, WorkStatusFilter, inWorkWindow } from './work-status-filter';
import { OutsourcedStatusFilter, OutsourcedTube } from '../outsourced/outsourced-view';

/** The slice of OutsourcingService this loader needs — kept narrow so a test
 *  can fake it directly, without pulling in HttpClient / the real service. */
export interface MergedOutsourcedLoaderDeps {
  dateWindow: { set(w: ((t: OutsourcedTube) => boolean) | null): void };
  status: { set(s: OutsourcedStatusFilter): void };
  loadAll(): Promise<void>;
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
 * `status.set('all')` and `loadAll()` are themselves no-ops once already
 * current (OutsourcingService.matchesLoaded), so switching between the
 * merged view and the Outsourced chip never double-fetches the same page.
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
      outsourcing.status.set('all');
      void outsourcing.loadAll();
    }
  });
}
