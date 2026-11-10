import { DragReorder } from './drag-reorder';

function list(n: number, h = 100): HTMLElement {
  const host = document.createElement('div');
  host.dataset['dragList'] = 'page';
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.dataset['dragIndex'] = String(i);
    row.getBoundingClientRect = () => ({ top: i * (h + 10), height: h, bottom: i * (h + 10) + h, left: 0, right: 100, width: 100, x: 0, y: i * (h + 10), toJSON: () => ({}) }) as DOMRect;
    const grip = document.createElement('button');
    row.appendChild(grip);
    host.appendChild(row);
  }
  document.body.appendChild(host);
  return host;
}

const ev = (target: Element, y: number) => ({ currentTarget: target, clientY: y, button: 0, pointerId: 1, preventDefault: () => undefined }) as unknown as PointerEvent;

describe('touch reorder', () => {
  it('drag the first row below the third → one move 0 → 2; the others make room', () => {
    const host = list(4);
    const moves: [number, number][] = [];
    const d = new DragReorder((_l, f, t) => moves.push([f, t]));
    const grip = host.querySelectorAll('button')[0];
    d.start(ev(grip, 50), 'page', 0);
    d.move(ev(grip, 50 + 240));
    expect(d.state()?.to).toBe(2);
    expect(d.offset('page', 1)).toBe(-110);
    expect(d.offset('page', 3)).toBe(0);
    expect(d.dragging('page', 0)).toBe(true);
    d.end();
    expect(moves).toEqual([[0, 2]]);
    host.remove();
  });

  it('a drag that ends where it began moves nothing; arrow keys move one place', () => {
    const host = list(3);
    const moves: [number, number][] = [];
    const d = new DragReorder((_l, f, t) => moves.push([f, t]));
    const grip = host.querySelectorAll('button')[1];
    d.start(ev(grip, 150), 'page', 1);
    d.move(ev(grip, 160));
    d.end();
    expect(moves).toEqual([]);
    const key = (k: string) => ({ key: k, preventDefault: () => undefined }) as KeyboardEvent;
    d.keyMove(key('ArrowUp'), 'page', 1, 3);
    d.keyMove(key('ArrowDown'), 'page', 2, 3); // already last: nothing
    expect(moves).toEqual([[1, 0]]);
    host.remove();
  });

  it('desktop: a question dropped on another page in the PAGES list moves there, not within the list', () => {
    const host = list(3);
    const page = document.createElement('li');
    page.dataset['dropPage'] = 'exam';
    document.body.appendChild(page);
    const orig = document.elementsFromPoint;
    document.elementsFromPoint = ((x: number) => (x < 0 ? [page] : [])) as typeof document.elementsFromPoint;
    const moves: unknown[] = [];
    const drops: unknown[] = [];
    const d = new DragReorder(
      (_l, f, t) => moves.push([f, t]),
      (l, f, p) => drops.push([l, f, p]),
    );
    const grip = host.querySelectorAll('button')[1];
    d.start(ev(grip, 150), 'page', 1);
    d.move({ ...ev(grip, 400), clientX: -5 } as PointerEvent);
    expect(d.overPage()).toBe('exam');
    expect(d.offset('page', 2)).toBe(0); // the others don't make room while it hovers a page
    d.end();
    expect(drops).toEqual([['page', 1, 'exam']]);
    expect(moves).toEqual([]);
    document.elementsFromPoint = orig;
    page.remove();
    host.remove();
  });
});
