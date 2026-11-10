import { CanvasHistory } from './history';

describe('canvas undo / redo', () => {
  it('undo, redo, a new step clears redo, same value is no step', () => {
    const h = new CanvasHistory<number[]>([]);
    const a = h.push([1]);
    h.push([1, 2]);
    expect(h.undo()).toBe(a);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toEqual([1, 2]);
    h.undo();
    h.push([1, 3]);
    expect(h.canRedo).toBe(false);
    const now = h.value;
    h.push(now);
    h.undo();
    expect(h.value).toEqual([1]);
    expect(h.undo()).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toEqual([]);
  });

  it('keeps at most the limit; reset forgets', () => {
    const h = new CanvasHistory(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    h.undo();
    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.value).toBe(7);
    h.reset(42);
    expect(h.canRedo).toBe(false);
    expect(h.value).toBe(42);
  });
});
