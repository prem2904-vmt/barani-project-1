import { Injectable, signal } from '@angular/core';

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

/**
 * Draft shelf — the bottom bar's "work you left unfinished" section
 * (owner idea: pages | divider | drafts, one click back into a draft).
 *
 * PUBLISHER model: the shelf never fetches. The ACTIVE work screen
 * pushes its own drafts (frontdesk → parked order drafts, lab → tubes
 * with saved-but-unsubmitted results) and clears them on destroy, so
 * the shelf is contextual by construction and can never drift from
 * what the page itself shows. No publisher on screen → no shelf.
 */
@Injectable({ providedIn: 'root' })
export class DraftShelfService {
  private readonly _items = signal<DraftChip[]>([]);
  readonly items = this._items.asReadonly();
  private owner: object | null = null;

  /** Replace the shelf with `items`; `owner` claims it (last writer wins). */
  publish(owner: object, items: DraftChip[]): void {
    this.owner = owner;
    this._items.set(items);
  }

  /** Clear the shelf — but only if `owner` still holds it (a screen being
   *  destroyed must not wipe the next screen's freshly published list). */
  clear(owner: object): void {
    if (this.owner === owner) {
      this.owner = null;
      this._items.set([]);
    }
  }
}
