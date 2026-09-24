import { flagChipTitle, flagMeaning } from './result-flag';

describe('result-flag — H / L spelled out (QA 2026-09-24)', () => {
  it('flagMeaning names each code', () => {
    expect(flagMeaning('H')).toBe('H = High — above the reference range');
    expect(flagMeaning('l')).toBe('L = Low — below the reference range');
    expect(flagMeaning('C')).toContain('Critical');
    expect(flagMeaning('A')).toContain('Abnormal');
    expect(flagMeaning('')).toBe('');
    expect(flagMeaning(null)).toBe('');
  });

  it('flagChipTitle explains the entry-screen chips, with the direction of a critical', () => {
    expect(flagChipTitle({ tone: 'high', label: 'High' })).toContain('H = High');
    expect(flagChipTitle({ tone: 'low', label: 'Low' })).toContain('L = Low');
    expect(flagChipTitle({ tone: 'high', label: 'Abnormal' })).toContain('Abnormal');
    expect(flagChipTitle({ tone: 'critical', label: 'Critical low · below 2.5' })).toBe('Critical low — below the critical (panic) limit');
    expect(flagChipTitle({ tone: 'critical', label: 'Critical high · above 7' })).toBe('Critical high — above the critical (panic) limit');
    expect(flagChipTitle({ tone: 'critical', label: 'Critical' })).toContain('C = Critical');
    expect(flagChipTitle(null)).toBe('');
  });
});
