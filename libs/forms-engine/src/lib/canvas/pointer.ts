/**
 * Who does what on the drawing surface (pointer events only: mouse, finger
 * and Apple Pencil all arrive as PointerEvents, so nothing fires twice).
 *
 *  - Pen (Apple Pencil) always draws, with its real pressure.
 *  - Once a pen has been seen, a finger NEVER draws: one finger pans, two
 *    pinch-zoom (palm rejection, the way Notes and Freeform behave). A pen
 *    touching down cancels whatever the palm started.
 *  - Before any pen, one finger draws; a second finger arriving turns it into
 *    a pinch (a tiny started stroke is thrown away, never committed).
 *  - A very large contact (the side of a hand) is ignored.
 *  - Mouse: the main button draws; the wheel / two-finger trackpad zooms.
 *
 * Pure state machine (no DOM), so it is tested with synthetic events.
 */

export interface PtrEvent {
  pointerId: number;
  pointerType: string;
  /** Surface coordinates in CSS px. */
  x: number;
  y: number;
  pressure: number;
  button?: number;
  width?: number;
  height?: number;
  timeStamp?: number;
  /** Coalesced samples since the last event (smooth Pencil lines); surface coordinates. */
  samples?: { x: number; y: number; pressure: number }[];
}

export interface PtrHandlers {
  strokeStart(x: number, y: number, pressure: number, pen: boolean): void;
  strokeMove(points: { x: number; y: number; pressure: number }[]): void;
  /** `keep` false = the gesture became a pinch: throw the stroke away. */
  strokeEnd(keep: boolean): void;
  pan(dx: number, dy: number): void;
  /** Scale factor relative to the last step, around a centre, plus how far the centre moved. */
  pinch(factor: number, cx: number, cy: number, dx: number, dy: number): void;
}

/** A contact wider than this (CSS px) is a palm or the side of a hand. */
export const PALM_SIZE = 44;
/** A stroke shorter than this (CSS px) when a second finger lands was the start of a pinch. */
export const PINCH_SLOP = 24;

type Mode =
  | { kind: 'idle' }
  | { kind: 'stroke'; id: number; pen: boolean; travelled: number; lx: number; ly: number }
  | { kind: 'pan'; id: number }
  | { kind: 'pinch'; a: number; b: number; dist: number; cx: number; cy: number };

export class PointerRouter {
  private mode: Mode = { kind: 'idle' };
  private readonly touches = new Map<number, { x: number; y: number }>();
  /** A pen has drawn on this surface: fingers navigate from now on. */
  penSeen = false;
  /** The tool is a tap tool (mark, pin, text): a finger still taps after a pen was seen. */
  fingerTaps = false;

  constructor(private readonly h: PtrHandlers) {}

  get drawing(): boolean {
    return this.mode.kind === 'stroke';
  }

  get gesture(): Mode['kind'] {
    return this.mode.kind;
  }

  down(e: PtrEvent): void {
    if (e.pointerType === 'pen') {
      this.penSeen = true;
      this.cancelTouchGesture();
      if (this.mode.kind === 'stroke') return; // a second pen? keep the first
      this.mode = { kind: 'stroke', id: e.pointerId, pen: true, travelled: 0, lx: e.x, ly: e.y };
      this.h.strokeStart(e.x, e.y, e.pressure || 0.5, true);
      return;
    }
    if (e.pointerType === 'mouse') {
      if ((e.button ?? 0) !== 0 || this.mode.kind !== 'idle') return;
      this.mode = { kind: 'stroke', id: e.pointerId, pen: false, travelled: 0, lx: e.x, ly: e.y };
      this.h.strokeStart(e.x, e.y, 0.5, false);
      return;
    }
    // touch
    if (isPalm(e)) return;
    if (this.mode.kind === 'stroke' && this.mode.pen) return; // palm while the pen writes
    this.touches.set(e.pointerId, { x: e.x, y: e.y });
    if (this.touches.size >= 2) {
      if (this.mode.kind === 'stroke') {
        // a second finger: this was a pinch, not a line (keep it only if it was clearly a line already)
        this.h.strokeEnd(this.mode.travelled > PINCH_SLOP);
      }
      this.startPinch();
      return;
    }
    if (this.penSeen && !this.fingerTaps) {
      this.mode = { kind: 'pan', id: e.pointerId };
      return;
    }
    this.mode = { kind: 'stroke', id: e.pointerId, pen: false, travelled: 0, lx: e.x, ly: e.y };
    this.h.strokeStart(e.x, e.y, 0.5, false);
  }

  move(e: PtrEvent): void {
    const m = this.mode;
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const prev = this.touches.get(e.pointerId)!;
      this.touches.set(e.pointerId, { x: e.x, y: e.y });
      if (m.kind === 'pan' && m.id === e.pointerId) {
        this.h.pan(e.x - prev.x, e.y - prev.y);
        return;
      }
      if (m.kind === 'pinch') {
        this.stepPinch();
        return;
      }
    }
    if (m.kind === 'stroke' && m.id === e.pointerId) {
      const samples = e.samples?.length ? e.samples : [{ x: e.x, y: e.y, pressure: e.pressure }];
      const pts = samples.map((s) => ({ x: s.x, y: s.y, pressure: m.pen ? s.pressure || 0.5 : 0.5 }));
      for (const p of pts) {
        m.travelled += Math.hypot(p.x - m.lx, p.y - m.ly);
        m.lx = p.x;
        m.ly = p.y;
      }
      this.h.strokeMove(pts);
    }
  }

  up(e: PtrEvent): void {
    this.touches.delete(e.pointerId);
    const m = this.mode;
    if (m.kind === 'stroke' && m.id === e.pointerId) {
      this.mode = { kind: 'idle' };
      this.h.strokeEnd(true);
      return;
    }
    if (m.kind === 'pan' && m.id === e.pointerId) this.mode = { kind: 'idle' };
    if (m.kind === 'pinch' && (m.a === e.pointerId || m.b === e.pointerId)) {
      // one finger left: carry on panning with the other (never draw mid-gesture)
      const rest = [...this.touches.keys()][0];
      this.mode = rest !== undefined ? { kind: 'pan', id: rest } : { kind: 'idle' };
    }
  }

  /** The browser took the pointer away (a system gesture): a stroke in progress is kept as drawn so far. */
  cancel(e: PtrEvent): void {
    this.up(e);
  }

  private startPinch(): void {
    const [a, b] = [...this.touches.keys()];
    const pa = this.touches.get(a)!;
    const pb = this.touches.get(b)!;
    this.mode = {
      kind: 'pinch',
      a,
      b,
      dist: Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y)),
      cx: (pa.x + pb.x) / 2,
      cy: (pa.y + pb.y) / 2,
    };
  }

  private stepPinch(): void {
    const m = this.mode;
    if (m.kind !== 'pinch') return;
    const pa = this.touches.get(m.a);
    const pb = this.touches.get(m.b);
    if (!pa || !pb) return;
    const dist = Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y));
    const cx = (pa.x + pb.x) / 2;
    const cy = (pa.y + pb.y) / 2;
    this.h.pinch(dist / m.dist, cx, cy, cx - m.cx, cy - m.cy);
    m.dist = dist;
    m.cx = cx;
    m.cy = cy;
  }

  private cancelTouchGesture(): void {
    if (this.mode.kind === 'stroke' && !this.mode.pen) {
      this.h.strokeEnd(false);
      this.mode = { kind: 'idle' };
    }
    if (this.mode.kind !== 'stroke') this.mode = { kind: 'idle' };
    this.touches.clear();
  }
}

function isPalm(e: PtrEvent): boolean {
  return (e.width ?? 0) > PALM_SIZE && (e.height ?? 0) > PALM_SIZE;
}

/** A PointerEvent → the router's shape, in coordinates relative to `rect`. */
export function readPointer(ev: PointerEvent, rect: { left: number; top: number }): PtrEvent {
  const coalesced = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
  return {
    pointerId: ev.pointerId,
    pointerType: ev.pointerType || 'mouse',
    x: ev.clientX - rect.left,
    y: ev.clientY - rect.top,
    pressure: ev.pressure,
    button: ev.button,
    width: ev.width,
    height: ev.height,
    timeStamp: ev.timeStamp,
    samples: coalesced.length
      ? coalesced.map((c) => ({ x: c.clientX - rect.left, y: c.clientY - rect.top, pressure: c.pressure }))
      : undefined,
  };
}

/** Keep a pointer's moves coming to `el` even outside it; never fails a gesture (a pointer the browser no longer tracks throws). */
export function capturePointer(el: Element | null | undefined, pointerId: number): void {
  try {
    el?.setPointerCapture?.(pointerId);
  } catch {
    /* not an active pointer (synthetic or already released): moves still arrive while over the element */
  }
}
