import { signal } from '@angular/core';

/**
 * Touch-first reorder for a vertical list (pages, questions, choices): press
 * the ≥48px grip and drag; the row follows the finger, the others make room,
 * and on release `onMove(from, to)` is called once. Pointer events, so a
 * finger, a Pencil and a mouse all work; the keyboard path is the grip's
 * ArrowUp / ArrowDown (see `keyMove`). Rows are found by
 * `[data-drag-list="<list>"] > [data-drag-index]`.
 */
export interface DragState {
  list: string;
  from: number;
  to: number;
  dy: number;
  /** A question dragged over a page in the PAGES list (desktop): dropping it there moves it to that page. */
  overPage?: string | null;
}

export class DragReorder {
  readonly state = signal<DragState | null>(null);
  private rects: DOMRect[] = [];
  private startY = 0;
  private el: HTMLElement | null = null;

  constructor(
    private readonly onMove: (list: string, from: number, to: number) => void,
    private readonly onDropPage?: (list: string, from: number, pageKey: string) => void,
  ) {}

  start(e: PointerEvent, list: string, index: number): void {
    if (e.button !== undefined && e.button > 0) return;
    const grip = e.currentTarget as HTMLElement;
    const host = grip.closest(`[data-drag-list="${list}"]`) as HTMLElement | null;
    if (!host) return;
    const rows = [...host.querySelectorAll<HTMLElement>(':scope > [data-drag-index]')];
    this.rects = rows.map((r) => r.getBoundingClientRect());
    this.startY = e.clientY;
    this.el = grip;
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests */
    }
    e.preventDefault();
    this.state.set({ list, from: index, to: index, dy: 0 });
  }

  move(e: PointerEvent): void {
    const s = this.state();
    if (!s) return;
    const dy = e.clientY - this.startY;
    const r = this.rects[s.from];
    const centre = r ? r.top + r.height / 2 + dy : e.clientY;
    // the new place = how many of the OTHER rows now sit above the dragged row's centre
    const to = this.rects.filter((x, i) => i !== s.from && x.top + x.height / 2 < centre).length;
    const overPage = this.onDropPage && s.list === 'page' ? this.pageAt(e.clientX, e.clientY) : null;
    this.state.set({ ...s, dy, to, overPage });
  }

  end(): void {
    const s = this.state();
    this.state.set(null);
    this.el = null;
    if (s?.overPage && this.onDropPage) this.onDropPage(s.list, s.from, s.overPage);
    else if (s && s.to !== s.from) this.onMove(s.list, s.from, s.to);
  }

  /** The page row under the pointer (`[data-drop-page]`), other than the one being shown. */
  private pageAt(x: number, y: number): string | null {
    if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
    const hit = document.elementsFromPoint(x, y).find((el) => (el as HTMLElement).dataset?.['dropPage']) as HTMLElement | undefined;
    const key = hit?.dataset['dropPage'] ?? null;
    return key && hit?.getAttribute('aria-current') !== 'page' ? key : null;
  }

  /** The page a question is being dragged onto (to highlight it). */
  overPage(): string | null {
    return this.state()?.overPage ?? null;
  }

  /** How far a row should shift to make room for the dragged one. */
  offset(list: string, index: number): number {
    const s = this.state();
    if (!s || s.list !== list) return 0;
    if (s.overPage && index !== s.from) return 0;
    if (index === s.from) return s.dy;
    const h = this.rects[s.from]?.height ?? 0;
    const gap = 10;
    if (s.from < s.to && index > s.from && index <= s.to) return -(h + gap);
    if (s.from > s.to && index < s.from && index >= s.to) return h + gap;
    return 0;
  }

  dragging(list: string, index: number): boolean {
    const s = this.state();
    return !!s && s.list === list && s.from === index;
  }

  /** Keyboard: ArrowUp / ArrowDown on the grip moves the row one place. */
  keyMove(e: KeyboardEvent, list: string, index: number, count: number): void {
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      this.onMove(list, index, index - 1);
    } else if (e.key === 'ArrowDown' && index < count - 1) {
      e.preventDefault();
      this.onMove(list, index, index + 1);
    }
  }
}

/** A long press (touch) opens the row's menu; a quick tap does not. */
export class LongPress {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private x = 0;
  private y = 0;
  fired = false;
  constructor(private readonly ms = 550) {}

  down(e: PointerEvent, fire: () => void): void {
    this.cancel();
    this.fired = false;
    if (e.pointerType === 'mouse') return;
    this.x = e.clientX;
    this.y = e.clientY;
    this.timer = setTimeout(() => {
      this.fired = true;
      fire();
    }, this.ms);
  }

  move(e: PointerEvent): void {
    if (this.timer && Math.hypot(e.clientX - this.x, e.clientY - this.y) > 10) this.cancel();
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
