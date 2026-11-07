import { describe, it, expect } from 'vitest';
import { applyLabSort, isLabSortKey, LAB_SORT_OPTIONS } from './lab-sort';

interface R { p: string | null; s: string | null; at: string | number | null }
const acc = { patient: (r: R) => r.p, sample: (r: R) => r.s, at: (r: R) => r.at };
const rows: R[] = [
  { p: 'Zed', s: '26200', at: '2026-11-02T10:00:00Z' },
  { p: 'amy', s: '26120', at: '2026-11-01T10:00:00Z' },
  { p: null, s: null, at: null },
  { p: 'Bob', s: '9', at: Date.parse('2026-11-03T10:00:00Z') },
];

describe('OPS-52 lab sort', () => {
  it('default returns the SAME array (caller order untouched)', () => {
    expect(applyLabSort(rows, 'default', acc)).toBe(rows);
  });
  it('oldest / newest by time, missing last either way', () => {
    expect(applyLabSort(rows, 'oldest', acc).map(r => r.s)).toEqual(['26120', '26200', '9', null]);
    expect(applyLabSort(rows, 'newest', acc).map(r => r.s)).toEqual(['9', '26200', '26120', null]);
  });
  it('patient name is case-insensitive, blanks last', () => {
    expect(applyLabSort(rows, 'patient', acc).map(r => r.p)).toEqual(['amy', 'Bob', 'Zed', null]);
  });
  it('sample ID compares numerically', () => {
    expect(applyLabSort(rows, 'sample', acc).map(r => r.s)).toEqual(['9', '26120', '26200', null]);
  });
  it('does not mutate the input', () => {
    const copy = JSON.stringify(rows);
    applyLabSort(rows, 'patient', acc);
    expect(JSON.stringify(rows)).toBe(copy);
  });
  it('option lists: every scope starts with the default and validates keys', () => {
    for (const scope of ['work', 'completed', 'intake'] as const) {
      expect(LAB_SORT_OPTIONS[scope][0].value).toBe('default');
      expect(isLabSortKey(scope, 'patient')).toBe(true);
      expect(isLabSortKey(scope, 'bogus')).toBe(false);
    }
    expect(isLabSortKey('completed', 'newest')).toBe(false);
  });
});
