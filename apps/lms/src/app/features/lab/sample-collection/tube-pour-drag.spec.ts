import {
  POUR_CLICK_SWALLOW_MS,
  POUR_HOLD_MS,
  TubePourDrag,
  edgeScrollSpeed,
  pourDropOpensSheet,
  pourDropState,
} from './tube-pour-drag';
import { mergeShortReason } from '../../../shared/utils/tube-merge';

/**
 * The drag-to-pour gesture rules (owner 2026-10-25: "the test tube comes and
 * if I put it there [it pours]" — touch and mouse). DOM-free: hit testing,
 * timers and the clock are hooks, so every rule is pinned here.
 */
function rig(hit: (x: number, y: number) => string | null = () => null) {
  let now = 1000;
  const timers: { fn: () => void; at: number }[] = [];
  const log: string[] = [];
  const d = new TubePourDrag({
    hitTest: hit,
    onLift: id => log.push(`lift:${id}`),
    onDrag: (_id, x, y, over) => log.push(`drag:${x},${y}:${over}`),
    onDrop: (id, t) => log.push(`drop:${id}->${t}`),
    onEnd: () => log.push('end'),
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: h => { const i = timers.indexOf(h as any); if (i >= 0) timers.splice(i, 1); },
    now: () => now,
  });
  const advance = (ms: number) => {
    now += ms;
    for (const t of [...timers]) if (t.at <= now) { timers.splice(timers.indexOf(t), 1); t.fn(); }
  };
  return { d, log, advance };
}
const touch = (x: number, y: number) => ({ pointerId: 7, pointerType: 'touch', clientX: x, clientY: y });
const mouse = (x: number, y: number, button = 0) => ({ pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, button });

describe('TubePourDrag — touch', () => {
  it('a plain tap lifts nothing and swallows no click (the tile still collects)', () => {
    const { d, log, advance } = rig();
    d.down('red', touch(100, 100));
    advance(120);
    d.up(touch(100, 100));
    expect(log).toEqual([]);
    expect(d.consumeClick()).toBe(false);
    expect(d.phase).toBe('idle');
  });

  it('moving before the hold ends is a scroll: no lift, scrolling never blocked', () => {
    const { d, log, advance } = rig();
    d.down('red', touch(100, 100));
    advance(100);
    expect(d.blocksTouchScroll()).toBe(false);
    d.move(touch(100, 140)); // a flick
    advance(POUR_HOLD_MS);
    expect(log).toEqual([]);
    expect(d.phase).toBe('idle');
    expect(d.blocksTouchScroll()).toBe(false);
  });

  it(`holding ${POUR_HOLD_MS} ms lifts the tube and then blocks the page scroll`, () => {
    const { d, log, advance } = rig();
    d.down('red', touch(100, 100));
    advance(POUR_HOLD_MS - 1);
    expect(log).toEqual([]);
    advance(1);
    expect(log).toEqual(['lift:red']);
    expect(d.blocksTouchScroll()).toBe(true);
  });

  it('a still hold released (no drag) ends quietly and the click still collects', () => {
    const { d, log, advance } = rig();
    d.down('red', touch(100, 100));
    advance(POUR_HOLD_MS + 50);
    d.up(touch(102, 101));
    expect(log).toEqual(['lift:red', 'end']);
    expect(d.consumeClick()).toBe(false);
  });

  it('hold → drag → release over a tube drops onto it (never onto itself)', () => {
    const { d, log, advance } = rig((x) => (x > 200 ? 'grey' : 'red'));
    d.down('red', touch(100, 100));
    advance(POUR_HOLD_MS);
    d.move(touch(104, 100)); // within the slop: still just lifted
    expect(log).toEqual(['lift:red']);
    d.move(touch(150, 100)); // over its own card
    d.move(touch(250, 120));
    d.up(touch(250, 120));
    expect(log).toEqual(['lift:red', 'drag:150,100:null', 'drag:250,120:grey', 'drop:red->grey']);
    expect(d.blocksTouchScroll()).toBe(false);
  });

  it('a drop outside every tube reports null (the screen snaps back)', () => {
    const { d, log, advance } = rig(() => null);
    d.down('red', touch(100, 100));
    advance(POUR_HOLD_MS);
    d.move(touch(160, 300));
    d.up(touch(160, 300));
    expect(log.at(-1)).toBe('drop:red->null');
  });

  it('the click right after a drop is swallowed once; a later tap is not', () => {
    const { d, advance } = rig(() => 'grey');
    d.down('red', touch(100, 100));
    advance(POUR_HOLD_MS);
    d.move(touch(200, 100));
    d.up(touch(200, 100));
    expect(d.consumeClick()).toBe(true);
    expect(d.consumeClick()).toBe(false);
    // A drop whose click never came must not eat a real tap much later.
    d.down('red', touch(100, 100));
    advance(POUR_HOLD_MS);
    d.move(touch(200, 100));
    d.up(touch(200, 100));
    advance(POUR_CLICK_SWALLOW_MS + 1);
    expect(d.consumeClick()).toBe(false);
  });

  it('pointercancel while dragging ends it with no drop', () => {
    const { d, log, advance } = rig(() => 'grey');
    d.down('red', touch(100, 100));
    advance(POUR_HOLD_MS);
    d.move(touch(200, 100));
    d.cancel();
    expect(log).toEqual(['lift:red', 'drag:200,100:grey', 'end']);
    expect(d.phase).toBe('idle');
  });

  it('a second finger is ignored', () => {
    const { d, log, advance } = rig(() => 'grey');
    d.down('red', touch(100, 100));
    advance(POUR_HOLD_MS);
    d.move({ ...touch(300, 100), pointerId: 9 });
    d.up({ ...touch(300, 100), pointerId: 9 });
    expect(log).toEqual(['lift:red']);
  });
});

describe('TubePourDrag — mouse', () => {
  it('starts after a small movement, no hold needed', () => {
    const { d, log } = rig(() => 'grey');
    d.down('red', mouse(100, 100));
    d.move(mouse(104, 100)); // jitter: still a click
    expect(log).toEqual([]);
    d.move(mouse(120, 100));
    expect(log).toEqual(['lift:red', 'drag:120,100:grey']);
  });

  it('a click (no movement) stays a click', () => {
    const { d, log } = rig();
    d.down('red', mouse(100, 100));
    d.up(mouse(101, 100));
    expect(log).toEqual([]);
    expect(d.consumeClick()).toBe(false);
  });

  it('the right button never drags', () => {
    const { d, log } = rig(() => 'grey');
    d.down('red', mouse(100, 100, 2));
    d.move(mouse(200, 100, 2));
    expect(log).toEqual([]);
    expect(d.phase).toBe('idle');
  });
});

describe('pourDropState — the server verdict in plain words', () => {
  const ok = { id: 'red', eligible: true, warnings: [] };
  it('still loading → checking (droppable; the sheet decides)', () => {
    expect(pourDropState('red', undefined)).toEqual({ kind: 'checking' });
    expect(pourDropOpensSheet({ kind: 'checking' })).toBe(true);
  });
  it('eligible → ok (warn when the server named a warning)', () => {
    expect(pourDropState('red', [ok])).toEqual({ kind: 'ok', warn: false });
    expect(pourDropState('red', [{ ...ok, warnings: [{ code: 'additive_mismatch', message: 'x' }] }]))
      .toEqual({ kind: 'ok', warn: true });
  });
  it('ineligible → no + short plain reason; a drop there snaps back', () => {
    const st = pourDropState('red', [{ id: 'red', eligible: false, reason: 'merge_already_received' }]);
    expect(st).toEqual({ kind: 'no', reason: 'Already received' });
    expect(pourDropOpensSheet(st)).toBe(false);
    expect(pourDropState('red', [{ id: 'red', eligible: false, reason: 'merge_outsourced' }]))
      .toEqual({ kind: 'no', reason: 'Outsourced tube' });
  });
  it('the source missing from the candidates, or a local block → no', () => {
    expect(pourDropState('red', [])).toEqual({ kind: 'no', reason: mergeShortReason(null) });
    expect(pourDropState('red', [ok], 'Not collected')).toEqual({ kind: 'no', reason: 'Not collected' });
  });
  it('no drop state (no drag / the source itself) never opens the sheet', () => {
    expect(pourDropOpensSheet(null)).toBe(false);
  });
});

describe('edgeScrollSpeed — auto-scroll near the edges', () => {
  it('0 in the middle, up near the top, down near the bottom', () => {
    expect(edgeScrollSpeed(400, 0, 800)).toBe(0);
    expect(edgeScrollSpeed(5, 0, 800)).toBeLessThan(0);
    expect(edgeScrollSpeed(795, 0, 800)).toBeGreaterThan(0);
    expect(edgeScrollSpeed(-50, 0, 800)).toBe(-14); // capped
  });
});

describe('mergeShortReason', () => {
  it('maps every refusal code to a few plain words', () => {
    for (const c of ['merge_different_order', 'merge_outsourced', 'merge_micro_container', 'merge_timed_series',
      'merge_has_results', 'merge_already_received', 'merge_dead_tube', 'merge_self']) {
      const t = mergeShortReason(c);
      expect(t).not.toMatch(/merge_/);
      expect(t.length).toBeLessThan(26);
    }
  });
});
