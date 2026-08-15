import {
  countdownLabel,
  dueClockLabel,
  offsetLabel,
  seriesState,
  sortForCollection,
  type SeriesSampleLike
} from './series-schedule';

const T0 = Date.parse('2026-08-15T08:00:00.000Z');
const MIN = 60_000;

function s(over: Partial<SeriesSampleLike> & { id: string }): SeriesSampleLike {
  return { status: 'pending', ...over };
}

/** OGTT-style series: anchor + 60 + 120, plus one normal tube. */
function ogtt(anchorCollected: boolean): SeriesSampleLike[] {
  return [
    s({ id: 'cbc' }), // normal tube, no offsets
    s({
      id: 'a0', repeatOffsetMin: 0, repeatProfileTestId: 'ogtt',
      status: anchorCollected ? 'collected' : 'pending',
      collectedAt: anchorCollected ? new Date(T0).toISOString() : undefined
    }),
    s({ id: 'a60', repeatOffsetMin: 60, repeatProfileTestId: 'ogtt' }),
    s({ id: 'a120', repeatOffsetMin: 120, repeatProfileTestId: 'ogtt' })
  ];
}

describe('seriesState', () => {
  it('returns normal for non-series samples', () => {
    const sib = ogtt(false);
    expect(seriesState(sib[0], sib, T0).kind).toBe('normal');
  });

  it('passes non-pending series samples through as normal (existing rendering)', () => {
    const sib = ogtt(true);
    expect(seriesState(sib[1], sib, T0).kind).toBe('normal'); // collected anchor
    const dispatched = { ...sib[2], status: 'dispatched' };
    expect(seriesState(dispatched, sib, T0).kind).toBe('normal');
  });

  it('pending offset-0 is the anchor', () => {
    const sib = ogtt(false);
    expect(seriesState(sib[1], sib, T0).kind).toBe('anchor');
  });

  it('locks offset>0 while the anchor is uncollected', () => {
    const sib = ogtt(false);
    const st = seriesState(sib[2], sib, T0);
    expect(st).toMatchObject({ kind: 'locked', reason: 'awaiting-anchor' });
  });

  it('locks not-due before anchor.collectedAt + offset, exposing dueAt + msUntilDue', () => {
    const sib = ogtt(true);
    const st = seriesState(sib[2], sib, T0 + 30 * MIN);
    expect(st.kind).toBe('locked');
    expect(st.reason).toBe('not-due');
    expect(st.dueAt).toBe(T0 + 60 * MIN);
    expect(st.msUntilDue).toBe(30 * MIN);
  });

  it('is due between its own due time and the next offset due time', () => {
    const sib = ogtt(true);
    expect(seriesState(sib[2], sib, T0 + 60 * MIN).kind).toBe('due');
    expect(seriesState(sib[2], sib, T0 + 119 * MIN).kind).toBe('due');
  });

  it('goes missed once the next offset comes due (visual only)', () => {
    const sib = ogtt(true);
    const st = seriesState(sib[2], sib, T0 + 120 * MIN);
    expect(st.kind).toBe('missed');
    expect(st.dueAt).toBe(T0 + 60 * MIN);
    expect(st.nextDueAt).toBe(T0 + 120 * MIN);
  });

  it('the LAST offset never goes missed — stays due forever', () => {
    const sib = ogtt(true);
    expect(seriesState(sib[3], sib, T0 + 120 * MIN).kind).toBe('due');
    expect(seriesState(sib[3], sib, T0 + 100 * 60 * MIN).kind).toBe('due');
  });

  it('keeps two series on one order independent (grouped by repeatProfileTestId)', () => {
    const sib: SeriesSampleLike[] = [
      s({ id: 'x0', repeatOffsetMin: 0, repeatProfileTestId: 'x', status: 'collected', collectedAt: new Date(T0).toISOString() }),
      s({ id: 'x30', repeatOffsetMin: 30, repeatProfileTestId: 'x' }),
      s({ id: 'y0', repeatOffsetMin: 0, repeatProfileTestId: 'y' }),
      s({ id: 'y30', repeatOffsetMin: 30, repeatProfileTestId: 'y' })
    ];
    expect(seriesState(sib[1], sib, T0 + 30 * MIN).kind).toBe('due');
    expect(seriesState(sib[3], sib, T0 + 30 * MIN)).toMatchObject({ kind: 'locked', reason: 'awaiting-anchor' });
  });

  it('degrades an orphan offset (no offset-0 sibling) to due instead of locking forever', () => {
    const orphan = s({ id: 'o60', repeatOffsetMin: 60, repeatProfileTestId: 'o' });
    expect(seriesState(orphan, [orphan], T0).kind).toBe('due');
  });
});

describe('sortForCollection', () => {
  it('keeps normal tubes first in their existing order, then series by (series, offset)', () => {
    const sib = [
      s({ id: 'b60', repeatOffsetMin: 60, repeatProfileTestId: 'b' }),
      s({ id: 'n1' }),
      s({ id: 'a120', repeatOffsetMin: 120, repeatProfileTestId: 'a' }),
      s({ id: 'n2' }),
      s({ id: 'a0', repeatOffsetMin: 0, repeatProfileTestId: 'a' }),
      s({ id: 'b0', repeatOffsetMin: 0, repeatProfileTestId: 'b' })
    ];
    expect(sortForCollection(sib).map(x => x.id)).toEqual(['n1', 'n2', 'a0', 'a120', 'b0', 'b60']);
  });
});

describe('labels', () => {
  it('formats offsets', () => {
    expect(offsetLabel(0)).toBe('First draw');
    expect(offsetLabel(30)).toBe('+30 min');
    expect(offsetLabel(90)).toBe('+90 min');
    expect(offsetLabel(120)).toBe('+2 h');
  });

  it('formats countdowns, clamped at zero', () => {
    expect(countdownLabel(0)).toBe('0:00');
    expect(countdownLabel(-500)).toBe('0:00');
    expect(countdownLabel(61_000)).toBe('1:01');
    expect(countdownLabel(3_600_000)).toBe('1:00:00');
  });

  it('formats the due wall clock as HH:mm', () => {
    expect(dueClockLabel(new Date(2026, 7, 15, 9, 5).getTime())).toBe('09:05');
  });
});
