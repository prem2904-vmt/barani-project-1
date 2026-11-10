/**
 * Undo / redo for the canvas: a stack of immutable snapshots. Every finished
 * action (a stroke, an erase, a pin, a label, a region tap) is one step.
 * Snapshots share structure (unchanged strokes are the same objects), so
 * 100 steps of a busy drawing cost little.
 */
export class CanvasHistory<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    private current: T,
    private readonly limit = 100,
  ) {}

  get value(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Record a new state; the redo stack is cleared. Same object = no step. */
  push(next: T): T {
    if (next === this.current) return next;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    return next;
  }

  undo(): T {
    const prev = this.past.pop();
    if (prev === undefined) return this.current;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): T {
    const next = this.future.pop();
    if (next === undefined) return this.current;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  /** Adopt an outside value (a reload, the other side of a conflict) without a step; history restarts. */
  reset(value: T): void {
    this.current = value;
    this.past = [];
    this.future = [];
  }
}
