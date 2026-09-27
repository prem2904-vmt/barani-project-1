import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Params, Router, UrlTree } from '@angular/router';
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
  /** The settled URL — every NavigationEnd, however the user got there
   *  (chip, queue row, scan, deep link, back button). */
  private readonly _url = signal<string>(this.router.url);

  /** Drafts for the work area the user is currently inside. */
  readonly items = computed<DraftChip[]>(() => {
    const area = this._area();
    return area ? (this._byArea()[area] ?? []) : [];
  });

  /** The draft whose screen is on stage right now (null = none). A chip is
   *  active when its target's PATH equals the current path AND every query
   *  param the chip carries matches (extra params on the URL — returnTo,
   *  discount… — don't break the match). Recomputes on every navigation. */
  readonly activeId = computed<string | null>(() => {
    const url = this._url();
    const hit = this.items().find(d => this.matches(d, url));
    return hit ? hit.id : null;
  });

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => {
        const url = e.urlAfterRedirects || e.url;
        this._area.set(DraftShelfService.areaOf(url));
        this._url.set(url);
      });
  }

  /** Is `chip`'s screen the one showing? (Signal-backed — reactive in templates.) */
  isActive(chip: DraftChip): boolean {
    return this.activeId() === chip.id;
  }

  /** Router state for a chip's link: tags a draft → draft hop with the
   *  slide direction (shelf order: later chip = forward) so the app's
   *  step-to-step slide plays (core/navigation/slide-transition.ts).
   *  Undefined when no draft is on stage — arriving from a list stays an
   *  instant swap (or the list → detail zoom). */
  swapState(chip: DraftChip): { pfDraftSwap: 'forward' | 'back' } | undefined {
    const list = this.items();
    const from = list.findIndex(d => d.id === this.activeId());
    const to = list.findIndex(d => d.id === chip.id);
    if (from < 0 || to < 0 || from === to) return undefined;
    return { pfDraftSwap: to > from ? 'forward' : 'back' };
  }

  /** Path + identifying-query match of a chip's target against `url`. */
  matches(chip: DraftChip, url: string): boolean {
    let target: UrlTree, current: UrlTree;
    try {
      const cmds = typeof chip.link === 'string' ? [chip.link] : [...chip.link];
      target = this.router.createUrlTree(cmds, { queryParams: chip.queryParams ?? {} });
      current = this.router.parseUrl(url);
    } catch {
      return false;
    }
    if (DraftShelfService.pathOf(this.router.serializeUrl(target)) !== DraftShelfService.pathOf(url)) return false;
    return DraftShelfService.subset(target.queryParams, current.queryParams);
  }

  private static pathOf(url: string): string {
    const p = (url || '').split(/[?#]/)[0].replace(/\/+$/, '');
    return p || '/';
  }

  private static subset(want: Params, have: Params): boolean {
    return Object.keys(want).every(k => String(have[k] ?? '') === String(want[k] ?? ''));
  }

  /** Replace `area`'s draft list (last writer wins). */
  publish(area: DraftArea, items: DraftChip[]): void {
    this._byArea.update(m => ({ ...m, [area]: items }));
  }

  /** Take chips off `area`'s shelf at once (e.g. tubes just submitted) —
   *  the publisher screen re-publishes the truth on its next visit. */
  drop(area: DraftArea, ids: readonly string[]): void {
    if (!ids.length) return;
    const gone = new Set(ids);
    this._byArea.update(m => {
      const cur = m[area];
      if (!cur || !cur.some(d => gone.has(d.id))) return m;
      return { ...m, [area]: cur.filter(d => !gone.has(d.id)) };
    });
  }

  /** Forget every area's drafts (branch switch: the chips point at the old
   *  branch's records). Each publisher re-publishes on its next visit. */
  clearAll(): void {
    this._byArea.set({});
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
