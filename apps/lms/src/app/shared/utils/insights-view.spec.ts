import { allZero, bucketAxisLabel, bucketRange, deltaView, formatMinutes, formatRupee, rangeLabel } from './insights-view';

describe('deltaView — how a KPI Δ reads (owner 2026-10-02)', () => {
  it('nothing now and nothing before: "—", neutral, never a red −100%', () => {
    const v = deltaView(0, null);
    expect(v.text).toBe('—');
    expect(v.tone).toBe('neutral');
    expect(v.kind).toBe('none');
  });

  it('something now, nothing before: "New", neutral', () => {
    const v = deltaView(12, null);
    expect(v.text).toBe('New');
    expect(v.tone).toBe('neutral');
  });

  it('nothing now but something before: shows −100% but neutral', () => {
    const v = deltaView(0, -100);
    expect(v.text).toBe('−100%');
    expect(v.tone).toBe('neutral');
  });

  it('a real rise is green, a real fall is red', () => {
    expect(deltaView(20, 12.5)).toMatchObject({ text: '+12.5%', tone: 'good', dir: 'up' });
    expect(deltaView(8, -20)).toMatchObject({ text: '−20%', tone: 'bad', dir: 'down' });
  });

  it('lower-is-better metrics invert the colour (TAT)', () => {
    expect(deltaView(40, -10, { lowerIsBetter: true }).tone).toBe('good');
    expect(deltaView(40, 10, { lowerIsBetter: true }).tone).toBe('bad');
  });

  it('noise under 2% and mix metrics stay neutral', () => {
    expect(deltaView(100, 1.2).tone).toBe('neutral');
    expect(deltaView(30, 25, { neutral: true }).tone).toBe('neutral');
    expect(deltaView(5, 0)).toMatchObject({ text: '0%', kind: 'flat', tone: 'neutral' });
  });
});

describe('trend buckets', () => {
  it('labels day / week / month buckets', () => {
    expect(bucketAxisLabel('2026-10-02', 'day')).toBe('2 Oct');
    expect(bucketAxisLabel('2026-09-28', 'week')).toBe('w/c 28 Sep');
    expect(bucketAxisLabel('2026-10', 'month')).toBe('Oct 2026');
  });

  it('drills a bucket to its IST day range, clipped to the period', () => {
    expect(bucketRange('2026-10-02', 'day', '2026-10-01', '2026-10-02')).toEqual({ fromYmd: '2026-10-02', toYmd: '2026-10-02' });
    expect(bucketRange('2026-09-28', 'week', '2026-09-30', '2026-12-31')).toEqual({ fromYmd: '2026-09-30', toYmd: '2026-10-04' });
    expect(bucketRange('2026-02', 'month', '2026-01-15', '2026-12-31')).toEqual({ fromYmd: '2026-02-01', toYmd: '2026-02-28' });
  });
});

describe('formatting', () => {
  it('reads minutes humanly', () => {
    expect(formatMinutes(42)).toBe('42 min');
    expect(formatMinutes(95)).toBe('1h 35m');
    expect(formatMinutes(60 * 27)).toBe('1d 3h');
    expect(formatMinutes(null)).toBe('—');
  });

  it('rupees: Indian grouping, compact lakh / crore', () => {
    expect(formatRupee(1234567)).toBe('₹12,34,567');
    expect(formatRupee(1234567, true)).toBe('₹12L');
    expect(formatRupee(150000, true)).toBe('₹1.5L');
    expect(formatRupee(undefined)).toBe('—');
  });

  it('range labels', () => {
    expect(rangeLabel('2026-10-01', '2026-10-02')).toBe('1 – 2 Oct 2026');
    expect(rangeLabel('2026-09-28', '2026-10-02')).toBe('28 Sep – 2 Oct 2026');
    expect(rangeLabel('2026-10-02', '2026-10-02')).toBe('2 Oct 2026');
  });

  it('allZero', () => {
    expect(allZero([])).toBe(true);
    expect(allZero([0, 0])).toBe(true);
    expect(allZero([0, 3])).toBe(false);
  });
});
