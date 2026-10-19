import {
  comparePriorityThenDue, formatDuration, linePriority, minRemaining, normalizePriority,
  priorityLabel, tatDetail, tatInfo, tatLabel, tatStateFor,
} from './lab-priority';

describe('lab-priority — order priority', () => {
  it('only urgent and STAT are Urgent', () => {
    expect(normalizePriority('urgent')).toBe('urgent');
    expect(normalizePriority('Urgent')).toBe('urgent');
    expect(normalizePriority('STAT')).toBe('urgent');
    expect(normalizePriority(' stat ')).toBe('urgent');
  });
  it('routine / normal / empty / unknown are Normal', () => {
    for (const p of ['routine', 'Normal', '', null, undefined, 'high', 'whatever']) {
      expect(normalizePriority(p as string)).toBe('normal');
    }
  });
  it('labels are only ever Urgent or Normal', () => {
    const labels = new Set(['urgent', 'stat', 'routine', 'normal', 'high', '', null].map(p => priorityLabel(p)));
    expect([...labels].sort()).toEqual(['Normal', 'Urgent']);
  });
  it('reads the priority from the line\'s order', () => {
    expect(linePriority({ subOrder: { order: { priority: 'STAT' } } })).toBe('urgent');
    expect(linePriority({ subOrder: { order: { priority: 'routine' } } })).toBe('normal');
    expect(linePriority({})).toBe('normal');
  });
});

describe('lab-priority — TAT', () => {
  const now = new Date(2026, 8, 29, 12, 0, 0).getTime();
  const ago = (min: number) => new Date(now - min * 60000).toISOString();

  it('states: overdue ≤ 0, due soon ≤ 60, else on track', () => {
    expect(tatStateFor(-5)).toBe('overdue');
    expect(tatStateFor(0)).toBe('overdue');
    expect(tatStateFor(30)).toBe('dueSoon');
    expect(tatStateFor(60)).toBe('dueSoon');
    expect(tatStateFor(61)).toBe('onTrack');
    expect(tatStateFor(null)).toBe('onTrack');
  });

  it('computes remaining from lab receipt + budget', () => {
    const i = tatInfo(ago(100), 2, now);
    expect(Math.round(i.remainingMin!)).toBe(20);
    expect(i.state).toBe('dueSoon');
  });

  it('no TAT budget or no receipt → no clock (never "overdue")', () => {
    expect(tatInfo(ago(500), 0, now)).toEqual({ state: 'onTrack', remainingMin: null, dueAt: null });
    expect(tatInfo(null, 4, now)).toEqual({ state: 'onTrack', remainingMin: null, dueAt: null });
  });

  it('chip words: Overdue / Due in … / the due time', () => {
    expect(tatLabel(tatInfo(ago(130), 2, now), now)).toBe('Overdue');
    expect(tatLabel(tatInfo(ago(100), 2, now), now)).toBe('Due in 20m');
    expect(tatLabel({ remainingMin: 60, dueAt: now + 3600000 }, now)).toBe('Due in 1h');
    expect(tatLabel(tatInfo(ago(0), 4, now), now)).toBe('Due 16:00');
    expect(tatLabel(tatInfo(ago(0), 24, now), now)).toBe('Due 30 Sep, 12:00');
    expect(tatLabel({ remainingMin: null, dueAt: null }, now)).toBe('');
  });

  it('durations and details', () => {
    expect(formatDuration(80)).toBe('1h 20m');
    expect(formatDuration(-12)).toBe('12m');
    expect(formatDuration(60 * 27)).toBe('1d 3h');
    expect(tatDetail(-80)).toBe('Overdue by 1h 20m');
    expect(tatDetail(15)).toBe('Due in 15m');
  });

  it('sort: Urgent first, then soonest due (overdue first), no clock last', () => {
    const rows = [
      { id: 'n-late', priority: 'normal' as const, remainingMin: -30 },
      { id: 'u-far', priority: 'urgent' as const, remainingMin: 300 },
      { id: 'n-none', priority: 'normal' as const, remainingMin: null },
      { id: 'u-over', priority: 'urgent' as const, remainingMin: -5 },
      { id: 'n-soon', priority: 'normal' as const, remainingMin: 40 },
    ];
    expect(rows.sort(comparePriorityThenDue).map(r => r.id))
      .toEqual(['u-over', 'u-far', 'n-late', 'n-soon', 'n-none']);
  });

  it('minRemaining ignores missing clocks', () => {
    expect(minRemaining([null, 40, -3])).toBe(-3);
    expect(minRemaining([null, undefined])).toBeNull();
  });
});
