import { PALM_SIZE, PointerRouter, PtrEvent, PtrHandlers } from './pointer';

function rig() {
  const log: string[] = [];
  const h: PtrHandlers = {
    strokeStart: (x, y, p, pen) => log.push(`start ${x},${y} p${p} ${pen ? 'pen' : 'finger'}`),
    strokeMove: (pts) => log.push(`move ${pts.map((q) => `${q.x},${q.y},${q.pressure}`).join(' ')}`),
    strokeEnd: (keep) => log.push(`end ${keep ? 'keep' : 'drop'}`),
    pan: (dx, dy) => log.push(`pan ${dx},${dy}`),
    pinch: (k) => log.push(`pinch ${k.toFixed(2)}`),
  };
  return { r: new PointerRouter(h), log };
}
const ev = (pointerId: number, pointerType: string, x: number, y: number, extra: Partial<PtrEvent> = {}): PtrEvent => ({
  pointerId,
  pointerType,
  x,
  y,
  pressure: 0.5,
  ...extra,
});

describe('pointer router (pen, palm, fingers, mouse)', () => {
  it('Apple Pencil draws with its real pressure and coalesced samples', () => {
    const { r, log } = rig();
    r.down(ev(1, 'pen', 0, 0, { pressure: 0.2 }));
    r.move(ev(1, 'pen', 5, 5, { samples: [{ x: 2, y: 2, pressure: 0.4 }, { x: 5, y: 5, pressure: 0.9 }] }));
    r.up(ev(1, 'pen', 5, 5));
    expect(log).toEqual(['start 0,0 p0.2 pen', 'move 2,2,0.4 5,5,0.9', 'end keep']);
  });

  it('palm rejection: a finger while the pen writes is ignored; after a pen, a finger pans', () => {
    const { r, log } = rig();
    r.down(ev(1, 'pen', 0, 0));
    r.down(ev(2, 'touch', 50, 50));
    r.move(ev(2, 'touch', 60, 60));
    r.up(ev(2, 'touch', 60, 60));
    r.up(ev(1, 'pen', 0, 0));
    expect(log.filter((l) => l.startsWith('start'))).toHaveLength(1);
    log.length = 0;
    r.down(ev(3, 'touch', 10, 10));
    r.move(ev(3, 'touch', 20, 15));
    r.up(ev(3, 'touch', 20, 15));
    expect(log).toEqual(['pan 10,5']);
  });

  it('a pen landing cancels a palm-started finger stroke (never committed)', () => {
    const { r, log } = rig();
    r.down(ev(1, 'touch', 0, 0));
    r.down(ev(2, 'pen', 10, 10));
    expect(log).toEqual(['start 0,0 p0.5 finger', 'end drop', 'start 10,10 p0.5 pen']);
  });

  it('the side of a hand is ignored', () => {
    const { r, log } = rig();
    r.down(ev(1, 'touch', 0, 0, { width: PALM_SIZE + 10, height: PALM_SIZE + 10 }));
    expect(log).toEqual([]);
  });

  it('a second finger turns a short stroke into a pinch (the stroke is thrown away)', () => {
    const { r, log } = rig();
    r.down(ev(1, 'touch', 100, 100));
    r.move(ev(1, 'touch', 104, 100));
    r.down(ev(2, 'touch', 200, 100));
    r.move(ev(2, 'touch', 300, 100));
    expect(log).toContain('end drop');
    expect(log[log.length - 1]).toBe('pinch 2.04');
    r.up(ev(2, 'touch', 300, 100));
    r.move(ev(1, 'touch', 110, 100));
    expect(log[log.length - 1]).toBe('pan 6,0'); // the remaining finger pans, never draws
  });

  it('tap tools still take a finger after a pen was seen', () => {
    const { r, log } = rig();
    r.down(ev(1, 'pen', 0, 0));
    r.up(ev(1, 'pen', 0, 0));
    r.fingerTaps = true;
    log.length = 0;
    r.down(ev(2, 'touch', 5, 5));
    expect(log).toEqual(['start 5,5 p0.5 finger']);
  });

  it('mouse: the main button draws, others do nothing', () => {
    const { r, log } = rig();
    r.down(ev(1, 'mouse', 0, 0, { button: 2 }));
    expect(log).toEqual([]);
    r.down(ev(1, 'mouse', 0, 0, { button: 0, pressure: 0 }));
    r.move(ev(1, 'mouse', 3, 4, { pressure: 0 }));
    r.up(ev(1, 'mouse', 3, 4));
    expect(log).toEqual(['start 0,0 p0.5 finger', 'move 3,4,0.5', 'end keep']);
  });
});
