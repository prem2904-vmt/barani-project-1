import { RANGE_BOUND_OPTIONS, boundLabel, boundOf, boundUses, withBound } from './range-bound';
import { flagAgainst, formatRange } from './reference-range';

describe('range-bound — per-band comparator (≤ / ≥ / < / > / low – high)', () => {
  it('reads a band exactly as the resolver does (no op = the old defaults)', () => {
    expect(boundOf({ min: 1, max: 2 })).toBe('between');
    expect(boundOf({ min: null, max: null })).toBe('between');
    expect(boundOf({ max: 0.89 })).toBe('lt');
    expect(boundOf({ max: 0.89, maxOp: 'lte' })).toBe('lte');
    expect(boundOf({ min: 60 })).toBe('gt');
    expect(boundOf({ min: 60, minOp: 'gte' })).toBe('gte');
    expect(boundOf(null)).toBe('between');
  });

  it('withBound moves the value to the side the operator uses and writes only inclusive ops', () => {
    expect(withBound({ segment: 's', min: null, max: 0.89 }, 'lte')).toEqual({ segment: 's', min: null, max: 0.89, maxOp: 'lte' });
    expect(withBound({ min: null, max: 0.89, maxOp: 'lte' as const }, 'lt')).toEqual({ min: null, max: 0.89 });
    expect(withBound({ min: null, max: 5 }, 'gte')).toEqual({ min: 5, max: null, minOp: 'gte' });
    expect(withBound({ min: 60, max: 90 }, 'gt')).toEqual({ min: 60, max: null });
    expect(withBound({ min: 60, max: 90 }, 'lte')).toEqual({ min: null, max: 90, maxOp: 'lte' });
    expect(withBound({ min: 4, minOp: 'gte' as const, criticalLow: 1 }, 'between')).toEqual({ min: 4, max: null, criticalLow: 1 });
  });

  it('a switched band prints the right symbol and flags the limit the right way', () => {
    const lte = withBound({ min: null, max: 0.89 }, 'lte');
    expect(formatRange(lte)).toBe('≤ 0.89');
    expect(flagAgainst(lte, 0.89)).toBe('N');
    const lt = withBound(lte, 'lt');
    expect(formatRange(lt)).toBe('< 0.89');
    expect(flagAgainst(lt, 0.89)).toBe('H');
    const gte = withBound({ min: 60, max: null }, 'gte');
    expect(formatRange(gte)).toBe('≥ 60');
    expect(flagAgainst(gte, 60)).toBe('N');
    expect(flagAgainst(withBound(gte, 'gt'), 60)).toBe('L');
  });

  it('value cells and labels', () => {
    expect(boundUses('between', 'min') && boundUses('between', 'max')).toBe(true);
    expect(boundUses('lte', 'min')).toBe(false);
    expect(boundUses('gte', 'max')).toBe(false);
    expect(boundLabel('lte')).toBe('≤ At or below');
    expect(boundLabel('nonsense')).toBe('Low – high');
    expect(RANGE_BOUND_OPTIONS.map(o => o.value)).toEqual(['between', 'lt', 'lte', 'gt', 'gte']);
  });
});
