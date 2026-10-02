import { previousAnalyticsPeriod, resolveAnalyticsPeriod } from './analytics-period';

describe('resolveAnalyticsPeriod', () => {
  // 2026-10-01 20:00 UTC = 2026-10-02 01:30 IST.
  const nowUtc = new Date('2026-10-01T20:00:00.000Z');

  it('resolves "today" to the IST calendar day, not the UTC day', () => {
    const p = resolveAnalyticsPeriod('today', undefined, undefined, nowUtc);
    expect(p.fromYmd).toBe('2026-10-02');
    expect(p.toYmd).toBe('2026-10-02');
    expect(p.fromUtc).toBe(new Date('2026-10-01T18:30:00.000Z').toISOString());
    expect(p.toUtc).toBe(new Date('2026-10-02T18:30:00.000Z').toISOString());
  });

  it('"today" just before IST midnight is still the earlier IST day', () => {
    const p = resolveAnalyticsPeriod('today', undefined, undefined, new Date('2026-10-01T18:00:00.000Z'));
    expect(p.fromYmd).toBe('2026-10-01');
  });

  it('resolves "7d" to 7 IST days inclusive of today', () => {
    const p = resolveAnalyticsPeriod('7d', undefined, undefined, nowUtc);
    expect(p.fromYmd).toBe('2026-09-26');
    expect(p.toYmd).toBe('2026-10-02');
  });

  it('resolves "month" to the 1st of the IST month', () => {
    const p = resolveAnalyticsPeriod('month', undefined, undefined, nowUtc);
    expect(p.fromYmd).toBe('2026-10-01');
    expect(p.toYmd).toBe('2026-10-02');
  });

  it('resolves "lastMonth" to the full previous calendar month', () => {
    const p = resolveAnalyticsPeriod('lastMonth', undefined, undefined, nowUtc);
    expect(p.fromYmd).toBe('2026-09-01');
    expect(p.toYmd).toBe('2026-09-30');
  });

  it('"lastMonth" crosses a year boundary', () => {
    const p = resolveAnalyticsPeriod('lastMonth', undefined, undefined, new Date('2027-01-14T20:00:00.000Z')); // 15 Jan IST
    expect(p.fromYmd).toBe('2026-12-01');
    expect(p.toYmd).toBe('2026-12-31');
  });

  it('resolves "quarter" to the calendar quarter start', () => {
    const p = resolveAnalyticsPeriod('quarter', undefined, undefined, nowUtc);
    expect(p.fromYmd).toBe('2026-10-01');

    const p2 = resolveAnalyticsPeriod('quarter', undefined, undefined, new Date('2026-08-14T20:00:00.000Z')); // 15 Aug IST
    expect(p2.fromYmd).toBe('2026-07-01');
  });

  it('resolves "custom" verbatim', () => {
    const p = resolveAnalyticsPeriod('custom', '2026-06-01', '2026-06-10', nowUtc);
    expect(p.fromYmd).toBe('2026-06-01');
    expect(p.toYmd).toBe('2026-06-10');
  });

  it('rejects an incomplete or inverted custom range', () => {
    expect(() => resolveAnalyticsPeriod('custom', undefined, undefined, nowUtc)).toThrow();
    expect(() => resolveAnalyticsPeriod('custom', '2026-06-10', '2026-06-01', nowUtc)).toThrow();
  });

  it('rejects an unknown preset', () => {
    expect(() => resolveAnalyticsPeriod('not-a-preset' as never, undefined, undefined, nowUtc)).toThrow();
  });
});

describe('previousAnalyticsPeriod', () => {
  it('is the same day-count immediately before (server PrevStart/PrevEnd mirror)', () => {
    expect(previousAnalyticsPeriod('2026-10-01', '2026-10-02')).toEqual({ fromYmd: '2026-09-29', toYmd: '2026-09-30' });
    expect(previousAnalyticsPeriod('2026-10-02', '2026-10-02')).toEqual({ fromYmd: '2026-10-01', toYmd: '2026-10-01' });
    expect(previousAnalyticsPeriod('2026-09-01', '2026-09-30')).toEqual({ fromYmd: '2026-08-02', toYmd: '2026-08-31' });
  });
});
