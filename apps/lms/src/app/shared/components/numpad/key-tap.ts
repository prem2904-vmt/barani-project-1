/**
 * KeyTap — how an on-screen key registers a press, shared by PF Keys and the
 * result numpad (no Angular; one instance per panel).
 *
 * Why not `(click)`: a click only arrives after the finger LIFTS, and a
 * touch browser drops the clicks of overlapping taps altogether (iPad /
 * Android: finger 2 lands before finger 1 lifts — normal fast typing —
 * and neither click fires). Keys that were typed with `(click)` lost
 * characters exactly when people typed fast.
 *
 * So:
 *  - TYPING keys (letters, digits, space, ⌫, ↑/↓) act on `pointerdown` —
 *    immediately, once per pointer (a per-pointerId map, so rolled-over
 *    multi-finger taps each register exactly once);
 *  - COMMIT keys (Enter, layout switch, hide, system keyboard, prefixes in
 *    their scrollable grid) act on `pointerup` of the same pointer on the
 *    same key (never lost to overlapping fingers; a scroll that the browser
 *    takes over sends `pointercancel` instead, so nothing fires);
 *  - the click that follows a pointer press is a GHOST and is swallowed
 *    (document capture phase, matched by position and time) — nothing is
 *    doubled, and a key that closes / swaps the panel never "clicks through"
 *    to whatever lies underneath;
 *  - a click with NO pointer press before it (Enter / Space on a focused
 *    key, a screen reader's activate: `detail === 0` or no ghost nearby)
 *    still acts — that is the keyboard / assistive path.
 */

/** A pointer press's own click arrives within this long of the lift. */
export const GHOST_CLICK_MS = 800;
/** …and within this distance of where the finger lifted. */
export const GHOST_RADIUS_PX = 48;
/** A pointer that never reported its lift is forgotten after this long. */
const STUCK_MS = 10_000;
/** A commit key only fires if the finger lifts this close to the key. */
const RELEASE_SLOP_PX = 12;

interface Press {
  readonly id: number;
  readonly el: EventTarget | null;
  x: number;
  y: number;
  /** Swallow a click matching this press until then. */
  until: number;
  /** Still down (no pointerup / pointercancel yet). */
  down: boolean;
}

export class KeyTap {
  /** Pointers currently down, by pointerId (rollover-safe). */
  private readonly live = new Map<number, Press>();
  /** Presses whose click may still arrive (oldest first). */
  private ghosts: Press[] = [];
  private readonly onDocClick = (e: MouseEvent) => this.bust(e);

  constructor(private readonly doc: Document | null, private readonly now: () => number = () => Date.now()) {
    doc?.addEventListener('click', this.onDocClick, true);
  }

  destroy(): void {
    this.doc?.removeEventListener('click', this.onDocClick, true);
    this.live.clear();
    this.ghosts = [];
  }

  /**
   * `pointerdown` on a key. Records the press and returns true when a
   * TYPING key should act now (primary button / touch / pen only).
   */
  down(e: PointerEvent): boolean {
    if (e.pointerType === 'mouse' && e.button !== 0) return false;
    const t = this.now();
    this.prune(t);
    const p: Press = { id: e.pointerId, el: e.currentTarget, x: e.clientX, y: e.clientY, until: t + STUCK_MS, down: true };
    // A new press on a pointerId that never reported its lift replaces it.
    const stale = this.live.get(e.pointerId);
    if (stale) stale.down = false;
    this.live.set(e.pointerId, p);
    this.ghosts.push(p);
    return true;
  }

  /** `pointerdown` on a COMMIT key: record only (it acts on release). */
  arm(e: PointerEvent): void { this.down(e); }

  /**
   * `pointerup` on a COMMIT key: true when this same pointer went down on
   * this same key and lifted on it (not slid away).
   */
  release(e: PointerEvent): boolean {
    const p = this.live.get(e.pointerId);
    const ok = !!p && p.down && p.el === e.currentTarget && this.within(e);
    this.up(e);
    return ok;
  }

  /** `pointerup` / `pointercancel` anywhere on the panel (bookkeeping). */
  up(e: PointerEvent): void {
    const p = this.live.get(e.pointerId);
    if (!p) return;
    this.live.delete(e.pointerId);
    p.down = false;
    p.x = e.clientX;
    p.y = e.clientY;
    p.until = this.now() + GHOST_CLICK_MS;
  }

  /** Pending ghost count (specs). */
  get pending(): number { this.prune(this.now()); return this.ghosts.length; }

  private bust(e: MouseEvent): void {
    // Keyboard-generated activation (Enter / Space on a focused button).
    if (e.detail === 0) return;
    const t = this.now();
    this.prune(t);
    const i = this.ghosts.findIndex(p => Math.hypot(e.clientX - p.x, e.clientY - p.y) <= GHOST_RADIUS_PX);
    if (i < 0) return;
    this.ghosts.splice(i, 1);
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
  }

  private prune(t: number): void {
    if (this.ghosts.length) this.ghosts = this.ghosts.filter(p => p.until > t);
    for (const [id, p] of this.live) if (p.until <= t) this.live.delete(id);
  }

  private within(e: PointerEvent): boolean {
    const el = e.currentTarget as Element | null;
    const r = el?.getBoundingClientRect?.();
    if (!r || (!r.width && !r.height)) return true;   // not laid out (specs)
    const s = RELEASE_SLOP_PX;
    return e.clientX >= r.left - s && e.clientX <= r.right + s && e.clientY >= r.top - s && e.clientY <= r.bottom + s;
  }
}
