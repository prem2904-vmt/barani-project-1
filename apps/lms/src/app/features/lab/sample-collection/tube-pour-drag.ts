/**
 * Drag a tube onto another to pour it in (owner 2026-10-25: "the test tube
 * comes and if I put it there [it pours]" — touch AND mouse).
 *
 * Pointer events only — never HTML5 native drag (dead on iOS Safari). One
 * gesture model for every device:
 *
 *   touch / pen  press → hold POUR_HOLD_MS still → LIFT (haptic, tube rises)
 *                → move past the slop → DRAG. Moving before the hold ends is a
 *                scroll: the gesture is dropped and the page scrolls as today.
 *   mouse        press → move past POUR_MOUSE_PX → LIFT + DRAG at once.
 *
 * A release before any drag is a plain tap: nothing is swallowed, the tile's
 * click collects exactly as before. A release while dragging is a DROP: the
 * click that may follow it is swallowed (briefly — never a later real tap).
 *
 * This class is DOM-free (hit testing, timers and the clock are hooks) so the
 * gesture rules are pinned by plain specs (tube-pour-drag.spec.ts).
 */
import type { MergeCandidate } from '../../../shared/utils/tube-merge';
import { mergeShortReason } from '../../../shared/utils/tube-merge';

/** Touch hold before a tube lifts (long enough for a scroll flick to win). */
export const POUR_HOLD_MS = 260;   // owner-approved mock tube-pour-v1
/** Touch: finger travel that counts as a scroll (before lift) / a drag (after). */
export const POUR_TOUCH_SLOP_PX = 10;
/** Mouse: travel before the drag starts (a jittery click stays a click). */
export const POUR_MOUSE_PX = 8;   // owner-approved mock tube-pour-v1
/** A drop swallows only the click that arrives right after it. */
export const POUR_CLICK_SWALLOW_MS = 600;

export interface PourPointer {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button?: number;
}

export interface PourDragHooks {
  /** The pourable tube (data-pour-id) under the point, or null. */
  hitTest(x: number, y: number): string | null;
  /** The tube lifted (touch: after the hold; mouse: past the threshold). */
  onLift(sourceId: string): void;
  /** The ghost moved; `overId` is the tube under it (never the source). */
  onDrag(sourceId: string, x: number, y: number, overId: string | null): void;
  /** Released while dragging; `targetId` null = dropped outside any tube. */
  onDrop(sourceId: string, targetId: string | null): void;
  /** The gesture ended with no drop (scroll, cancel, release before moving). */
  onEnd(): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  now?(): number;
}

export type PourPhase = 'idle' | 'pressing' | 'lifted' | 'dragging';

export class TubePourDrag {
  private _phase: PourPhase = 'idle';
  private _source: string | null = null;
  private _pointerId = -1;
  private _touch = false;
  private _x0 = 0;
  private _y0 = 0;
  private _timer: unknown = null;
  private _swallowUntil = 0;

  constructor(private readonly hooks: PourDragHooks) {}

  get phase(): PourPhase { return this._phase; }
  get sourceId(): string | null { return this._source; }

  /** A press on a pourable tube. Only the primary button / a finger / a pen. */
  down(sourceId: string, p: PourPointer): void {
    if (p.button != null && p.button !== 0) return;
    if (this._phase !== 'idle') this.reset(true);
    this._phase = 'pressing';
    this._source = sourceId;
    this._pointerId = p.pointerId;
    this._touch = p.pointerType === 'touch' || p.pointerType === 'pen';
    this._x0 = p.clientX;
    this._y0 = p.clientY;
    if (this._touch) {
      this._timer = this.set(() => {
        this._timer = null;
        if (this._phase !== 'pressing' || !this._source) return;
        this._phase = 'lifted';
        this.hooks.onLift(this._source);
      }, POUR_HOLD_MS);
    }
  }

  move(p: PourPointer): void {
    if (this._phase === 'idle' || p.pointerId !== this._pointerId || !this._source) return;
    const d = Math.hypot(p.clientX - this._x0, p.clientY - this._y0);
    if (this._phase === 'pressing') {
      if (this._touch) {
        // Moved before the hold finished: that's a scroll — let it be.
        if (d > POUR_TOUCH_SLOP_PX) this.reset(false);
        return;
      }
      if (d <= POUR_MOUSE_PX) return;
      this._phase = 'dragging';
      this.hooks.onLift(this._source);
      this.drag(p);
      return;
    }
    if (this._phase === 'lifted') {
      if (d <= POUR_TOUCH_SLOP_PX) return;
      this._phase = 'dragging';
    }
    this.drag(p);
  }

  up(p: PourPointer): void {
    if (this._phase === 'idle' || p.pointerId !== this._pointerId) return;
    if (this._phase !== 'dragging' || !this._source) {
      // A tap (or a still hold): the tile's click does what it always did.
      const lifted = this._phase === 'lifted';
      this.reset(false);
      if (lifted) this.hooks.onEnd();
      return;
    }
    const src = this._source;
    const target = this.over(p.clientX, p.clientY);
    this._swallowUntil = this.now() + POUR_CLICK_SWALLOW_MS;
    this.reset(false);
    this.hooks.onDrop(src, target);
  }

  /** pointercancel, the hold-to-peek taking over, or the screen going away. */
  cancel(): void {
    if (this._phase === 'idle') return;
    const visible = this._phase === 'lifted' || this._phase === 'dragging';
    if (this._phase === 'dragging') this._swallowUntil = this.now() + POUR_CLICK_SWALLOW_MS;
    this.reset(false);
    if (visible) this.hooks.onEnd();
  }

  /** While a tube is lifted the page must not scroll under the finger
   *  (the document's non-passive touchmove asks this). */
  blocksTouchScroll(): boolean {
    return this._phase === 'lifted' || this._phase === 'dragging';
  }

  /** The tile's click asks: was I the tail of a drop? (true once, briefly). */
  consumeClick(): boolean {
    if (!this._swallowUntil) return false;
    const hit = this.now() <= this._swallowUntil;
    this._swallowUntil = 0;
    return hit;
  }

  private drag(p: PourPointer): void {
    if (!this._source) return;
    this.hooks.onDrag(this._source, p.clientX, p.clientY, this.over(p.clientX, p.clientY));
  }

  private over(x: number, y: number): string | null {
    const id = this.hooks.hitTest(x, y);
    return id && id !== this._source ? id : null;
  }

  private reset(silent: boolean): void {
    if (this._timer != null) this.clear(this._timer);
    this._timer = null;
    const wasVisible = this._phase === 'lifted' || this._phase === 'dragging';
    this._phase = 'idle';
    this._source = null;
    this._pointerId = -1;
    if (silent && wasVisible) this.hooks.onEnd();
  }

  private set(fn: () => void, ms: number): unknown {
    return this.hooks.setTimer ? this.hooks.setTimer(fn, ms) : setTimeout(fn, ms);
  }
  private clear(h: unknown): void {
    if (this.hooks.clearTimer) this.hooks.clearTimer(h);
    else clearTimeout(h as ReturnType<typeof setTimeout>);
  }
  private now(): number { return this.hooks.now ? this.hooks.now() : Date.now(); }
}

/** How a tube reads as a drop target while another is dragged. */
export type PourDropState =
  | { kind: 'ok'; warn: boolean }
  | { kind: 'checking' }
  | { kind: 'no'; reason: string };

/**
 * The verdict for dropping `sourceId` onto a target, from the TARGET's
 * merge-candidates (the server's answer; `undefined` = still loading,
 * `null` = the call failed — still droppable, the sheet shows the error).
 * `localBlock` is a reason the screen already knows (e.g. "Not collected").
 */
export function pourDropState(
  sourceId: string,
  candidates: readonly MergeCandidate[] | null | undefined,
  localBlock?: string | null,
): PourDropState {
  if (localBlock) return { kind: 'no', reason: localBlock };
  if (candidates === undefined || candidates === null) return { kind: 'checking' };
  const row = candidates.find(c => c.id === sourceId);
  if (!row) return { kind: 'no', reason: mergeShortReason(null) };
  if (!row.eligible) return { kind: 'no', reason: mergeShortReason(row.reason ?? null) };
  return { kind: 'ok', warn: (row.warnings ?? []).length > 0 };
}

/** May a drop on this state open the sheet? (An ineligible tube snaps back.) */
export function pourDropOpensSheet(st: PourDropState | null | undefined): boolean {
  return !!st && st.kind !== 'no';
}

/** Auto-scroll speed (px / frame) near a scroll container's top or bottom
 *  edge: 0 in the middle, up to `max` at the very edge. */
export function edgeScrollSpeed(y: number, top: number, bottom: number, edge = 56, max = 14): number {
  if (bottom - top < edge * 2) edge = Math.max(16, (bottom - top) / 4);
  if (y < top + edge) return -Math.ceil(max * Math.min(1, (top + edge - y) / edge));
  if (y > bottom - edge) return Math.ceil(max * Math.min(1, (y - (bottom - edge)) / edge));
  return 0;
}
