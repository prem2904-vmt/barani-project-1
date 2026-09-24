import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

/** Width of one docked chat window + the gap between windows. */
const WIN_W = 330;
const GAP = 12;
/** Room kept at the right edge for the minimized head rail. */
const RAIL = 72;

/**
 * Floating chat windows — the Facebook Messenger model (owner's
 * reference): several conversations open at once, docked bottom-right
 * above the app bar, with the overflow parked as circular "heads".
 *
 *   capacity = how many 330px windows fit (hard cap 3; iPad ≈ 2;
 *              phones get 0 → the people drawer stays the phone story)
 *   opening at capacity evicts the LEAST-RECENTLY-FOCUSED window into
 *   a head; clicking a head re-opens it (evicting the next LRU).
 */
@Injectable({ providedIn: 'root' })
export class ChatWindowsService {
  private readonly doc = inject(DOCUMENT);
  private readonly win = this.doc.defaultView;

  /** Open windows, left → right. */
  private readonly _open = signal<string[]>([]);
  /** Minimized heads, newest first. */
  private readonly _minimized = signal<string[]>([]);
  readonly open = this._open.asReadonly();
  readonly minimized = this._minimized.asReadonly();

  /** Favourites — pinned people (owner). A favourite keeps its head on
   *  the rail even after its window is CLOSED, so the people you talk to
   *  all day are always one tap away. Persisted per device. */
  private static readonly FAV_KEY = 'pf.chat.favourites';
  private readonly _favourites = signal<string[]>(this.restoreFavourites());
  readonly favourites = this._favourites.asReadonly();

  isFavourite(conversationId: string): boolean {
    return this._favourites().includes(conversationId);
  }

  toggleFavourite(conversationId: string): void {
    this._favourites.update((ids) =>
      ids.includes(conversationId)
        ? ids.filter((i) => i !== conversationId)
        : [...ids, conversationId]);
    try {
      localStorage.setItem(ChatWindowsService.FAV_KEY, JSON.stringify(this._favourites()));
    } catch { /* private mode — favourites just won't survive the session */ }
  }

  private restoreFavourites(): string[] {
    try {
      const raw = localStorage.getItem(ChatWindowsService.FAV_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch { return []; }
  }

  /** Focus clock — lowest value = least recently used. */
  private readonly focusSeq = new Map<string, number>();
  private seq = 0;

  private readonly _width = signal(this.win?.innerWidth ?? 1280);

  /** Phones don't get floating windows at all: there, a conversation opens
   *  as a full PAGE, WhatsApp-style (owner). iPad and web keep the docked
   *  windows. 768px matches the component's own breakpoint. */
  readonly isPhone = computed(() => this._width() < 768);

  readonly capacity = computed(() => {
    const w = this._width();
    if (w < 768) return 0;
    return Math.max(1, Math.min(3, Math.floor((w - RAIL) / (WIN_W + GAP))));
  });

  constructor() {
    this.win?.addEventListener('resize', () => {
      this._width.set(this.win?.innerWidth ?? 1280);
      this.enforceCapacity();
    });
  }

  openWindow(conversationId: string): void {
    if (this.isPhone()) return;   // phones navigate to /messages instead
    this.touch(conversationId);
    this._minimized.update(ids => ids.filter(i => i !== conversationId));
    if (this._open().includes(conversationId)) return;
    const cap = this.capacity();
    if (this._open().length >= cap) this.evictLru();
    this._open.update(ids => [...ids, conversationId]);
  }

  minimize(conversationId: string): void {
    this._open.update(ids => ids.filter(i => i !== conversationId));
    this._minimized.update(ids => [conversationId, ...ids.filter(i => i !== conversationId)]);
  }

  close(conversationId: string): void {
    this._open.update(ids => ids.filter(i => i !== conversationId));
    this._minimized.update(ids => ids.filter(i => i !== conversationId));
    this.focusSeq.delete(conversationId);
  }

  /** Mark a window as the most recently used (typing / clicking in it). */
  focus(conversationId: string): void { this.touch(conversationId); }

  private touch(id: string): void { this.focusSeq.set(id, ++this.seq); }

  /** Park the least-recently-focused open window as a head. */
  private evictLru(): void {
    const ids = this._open();
    if (!ids.length) return;
    let lru = ids[0];
    for (const id of ids) {
      if ((this.focusSeq.get(id) ?? 0) < (this.focusSeq.get(lru) ?? 0)) lru = id;
    }
    this.minimize(lru);
  }

  /** After a resize, park anything that no longer fits. */
  private enforceCapacity(): void {
    const cap = this.capacity();
    while (this._open().length > cap) this.evictLru();
  }
}
