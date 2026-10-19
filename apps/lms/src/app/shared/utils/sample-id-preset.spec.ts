import {
  SampleSearchPresetConfig, formatDatePart, labDate, nextLabMonth, sampleIdHead, samplePreset,
} from './sample-id-preset';

const cfg = (over: Partial<SampleSearchPresetConfig> = {}): SampleSearchPresetConfig => ({
  enabled: true, setting: null, defaultEnabled: true, prefix: '', prefixSource: 'lab',
  datePrefix: 'yymm', separator: '', padding: 5, serialMode: 'numeric', timeZone: 'Asia/Kolkata',
  ...over,
});

describe('labDate — the lab (IST) calendar, not UTC or the device', () => {
  it('00:30 IST on 1 Oct is October although UTC is still 30 Sep', () => {
    expect(labDate(new Date('2026-09-30T19:00:00Z'))).toEqual({ yy: '26', mm: '10', dd: '01' });
  });
  it('23:59 IST on 30 Sep is still September', () => {
    expect(labDate(new Date('2026-09-30T18:29:00Z'))).toEqual({ yy: '26', mm: '09', dd: '30' });
  });
  it('an unknown zone falls back to IST', () => {
    expect(labDate(new Date('2026-12-31T18:45:00Z'), 'Not/AZone')).toEqual({ yy: '27', mm: '01', dd: '01' });
  });
});

describe('formatDatePart / sampleIdHead — mirror the server composition', () => {
  const d = { yy: '26', mm: '09', dd: '28' };
  it('every date format', () => {
    expect(formatDatePart('yymm', d)).toBe('2609');
    expect(formatDatePart('mmyy', d)).toBe('0926');
    expect(formatDatePart('yymmdd', d)).toBe('260928');
    expect(formatDatePart('ddmmyy', d)).toBe('280926');
    expect(formatDatePart('mmdd', d)).toBe('0928');
    expect(formatDatePart('yy', d)).toBe('26');
    expect(formatDatePart('dd', d)).toBe('28');
    expect(formatDatePart('none', d)).toBe('');
  });
  it('prefix + date, joined and followed by the separator', () => {
    expect(sampleIdHead('', 'yymm', '', d)).toBe('2609');
    expect(sampleIdHead('hem', 'yy', '', d)).toBe('HEM26');
    expect(sampleIdHead('MIC', 'yymm', '-', d)).toBe('MIC-2609-');
    expect(sampleIdHead('', 'yymm', '-', d)).toBe('2609-');
    expect(sampleIdHead('', 'none', '', d)).toBe('');
  });
});

describe('samplePreset — computed from the format and the month', () => {
  it('Sep → Oct: 2609 becomes 2610 at the IST month start', () => {
    expect(samplePreset(cfg(), new Date('2026-09-30T18:00:00Z'))).toBe('2609');
    expect(samplePreset(cfg(), new Date('2026-09-30T19:00:00Z'))).toBe('2610');
  });
  it('Dec → Jan: 2612 becomes 2701', () => {
    expect(samplePreset(cfg(), new Date('2026-12-31T18:00:00Z'))).toBe('2612');
    expect(samplePreset(cfg(), new Date('2026-12-31T18:45:00Z'))).toBe('2701');
  });
  it('a one-department user gets the department / space code too', () => {
    expect(samplePreset(cfg({ prefix: 'HEM', prefixSource: 'department' }), new Date('2026-09-28T06:00:00Z'))).toBe('HEM2609');
    expect(samplePreset(cfg({ prefix: 'MIC', separator: '-', prefixSource: 'space' }), new Date('2026-09-28T06:00:00Z'))).toBe('MIC-2609-');
  });
  it('setting OFF → no preset (config or live tenant value)', () => {
    expect(samplePreset(cfg({ setting: false }), new Date('2026-09-28T06:00:00Z'))).toBeNull();
    expect(samplePreset(cfg(), new Date('2026-09-28T06:00:00Z'), false)).toBeNull();
  });
  it('automatic follows the format default (yy is off unless turned on)', () => {
    const yy = cfg({ datePrefix: 'yy', defaultEnabled: false });
    expect(samplePreset(yy, new Date('2026-09-28T06:00:00Z'))).toBeNull();
    expect(samplePreset(yy, new Date('2026-09-28T06:00:00Z'), true)).toBe('26');
  });
  it('no config, or a format with nothing before the number → no preset', () => {
    expect(samplePreset(null)).toBeNull();
    expect(samplePreset(cfg({ datePrefix: 'none' }))).toBeNull();
  });
  it('nextLabMonth rolls December into January', () => {
    expect(nextLabMonth({ yy: '26', mm: '09', dd: '28' })).toEqual({ yy: '26', mm: '10', dd: '01' });
    expect(nextLabMonth({ yy: '26', mm: '12', dd: '31' })).toEqual({ yy: '27', mm: '01', dd: '01' });
  });
});
