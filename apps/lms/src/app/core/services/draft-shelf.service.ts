import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/** One resumable draft rendered as a chip on the bottom bar's shelf. */
export interface DraftChip {
  /** Stable identity for track-by. */
  id: string;
  /** Primary text — patient short name or tube barcode. */
  label: string;
  /** Quiet secondary text ("3 tests", patient name…). */
  sub?: string;
  /** Router commands that resume the draft. */
  link: string | ReadonlyArray<string>;
  queryParams?: Record<string, string>;
}

/** Work areas that can own a draft list. */
export type DraftArea = 'frontdesk' | 'lab' | 'collect' | 'validate' | 'results';

/**
 * Draft shelf — the bottom bar's "work you left unfinished" section
 * (owner idea: pages | divider | drafts, one click back into a draft).
 *
 * AREA-scoped (owner): the shelf sticks for the whole WORK AREA, not one
 * component — opening a test from Lab keeps you in /lab/*, so the lab
 * drafts stay on the bar; they disappear only when you leave the area
 * entirely (e.g. jump to Frontdesk, whose own drafts then take over).
 *
 * PUBLISHER model: the shelf never fetches. Each area's landing screen
 * pushes its own drafts (frontdesk → parked order drafts, lab → tubes
 * with saved-but-unsubmitted results); the list persists in the map and
 * refreshes whenever the publisher screen is next visited.
 */
@Injectable({ providedIn: 'root' })
export class DraftShelfService {
  private readonly router = inject(Router);

  private readonly _byArea = signal<Partial<Record<DraftArea, DraftChip[]>>>({});
  private readonly _area = signal<DraftArea | null>(DraftShelfService.areaOf(this.router.url));

  /** Drafts for the work area the user is currently inside. */
  readonly items = computed<DraftChip[]>(() => {
    const area = this._area();
    return area ? (this._byArea()[area] ?? []) : [];
  });

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => this._area.set(DraftShelfService.areaOf(e.urlAfterRedirects || e.url)));
  }

  /** Replace `area`'s draft list (last writer wins). */
  publish(area: DraftArea, items: DraftChip[]): void {
    this._byArea.update(m => ({ ...m, [area]: items }));
  }

  private static areaOf(url: string): DraftArea | null {
    if (url.startsWith('/frontdesk')) return 'frontdesk';
    if (url.startsWith('/lab')) return 'lab';
    if (url.startsWith('/sample-collection')) return 'collect';
    if (url.startsWith('/pathologist')) return 'validate';
    if (url.startsWith('/reports')) return 'results';
    return null;
  }
}
