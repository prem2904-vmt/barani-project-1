import { describe, expect, it } from 'vitest';
import { entryRangeText } from './result-flag';

const BANDS = [
  { sex: 'M' as const, minAge: 18, maxAge: 120, ageUnit: 'years' as const, min: 13, max: 17 },
  { sex: 'F' as const, minAge: 18, maxAge: 120, ageUnit: 'years' as const, min: 12, max: 15 },
  { minAge: 1, maxAge: 17, ageUnit: 'years' as const, min: 11, max: 14 },
];

describe('entryRangeText — entry screens show only the patient\'s band (as the report prints)', () => {
  it('an adult woman sees only the F band', () => {
    const t = entryRangeText(BANDS, 'g/dL', 'F', 34);
    expect(t).toBe('12–15 g/dL');
    expect(t).not.toContain('13');
  });
  it('an adult man sees only the M band', () => {
    expect(entryRangeText(BANDS, 'g/dL', 'M', 40)).toBe('13–17 g/dL');
  });
  it('a child sees the child band, not the adult ones', () => {
    expect(entryRangeText(BANDS, 'g/dL', 'M', 8)).toBe('11–14 g/dL');
  });
  it('no band matching on merit lists every band, as the report does', () => {
    const t = entryRangeText(BANDS, 'g/dL', null, null);
    expect(t).toContain('12');
    expect(t).toContain('13');
    expect(t).toContain('11');
  });
  it('a typed report text prints exactly as typed for the matched band', () => {
    const b = [{ ...BANDS[1], reportText: 'Normal: 12–15 {u}' }, BANDS[0]];
    expect(entryRangeText(b, 'g/dL', 'F', 30)).toBe('Normal: 12–15 g/dL');
  });
  it('nothing to show is an empty string', () => {
    expect(entryRangeText([], 'g/dL', 'F', 30)).toBe('');
    expect(entryRangeText(null, null, 'F', 30)).toBe('');
  });
});
