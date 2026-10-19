import { reportFlag } from './report-flag';
import {
  criticalBadge, flagBand, flagChipTitle, flagCodeOf, flagMeaning, flagTone, isCriticalFlag, savedValueRows,
} from './result-flag';

/**
 * Owner 2026-09-27 — critical direction. mw stores CL (critical low) / CH
 * (critical high) instead of the direction-less C. Lab screens badge CL / CH
 * (legacy C stays "C", still critical); the patient report keeps printing
 * H / L only — CL → L and CH → H straight from the stored code, the range
 * guess survives only for legacy C.
 */
describe('critical direction — lab badges CL / CH, legacy C', () => {
  it('flagCodeOf keeps CL / CH / C', () => {
    expect([flagCodeOf('cl'), flagCodeOf(' CH '), flagCodeOf('C'), flagCodeOf('X')]).toEqual(['CL', 'CH', 'C', '']);
  });

  it('CL, CH and legacy C are all critical (tone critical, badge = the code)', () => {
    for (const f of ['CL', 'CH', 'C']) {
      expect(isCriticalFlag(f)).toBe(true);
      expect(flagTone(f)).toBe('critical');
      expect(criticalBadge(f)).toBe(f);
    }
    for (const f of ['H', 'L', 'A', 'N', '', null]) {
      expect(isCriticalFlag(f)).toBe(false);
      expect(criticalBadge(f)).toBe('');
    }
  });

  it('meanings + chip titles name the direction', () => {
    expect(flagMeaning('CL')).toContain('Critical low');
    expect(flagMeaning('CH')).toContain('Critical high');
    expect(flagMeaning('C')).toContain('C = Critical');
    expect(flagChipTitle({ tone: 'critical', label: 'CL' })).toContain('Critical low');
    expect(flagChipTitle({ tone: 'critical', label: 'CH · above 7' })).toContain('Critical high');
    expect(flagChipTitle({ tone: 'critical', label: 'C' })).toContain('C = Critical');
  });

  it('the live hint mirrors mw: CL below the critical low, CH above the critical high', () => {
    const band = { min: 3.5, max: 5, criticalLow: 2.5, criticalHigh: 6.5 };
    expect(flagBand(band, 2.4)).toEqual({ code: 'CL', critical: 'low', limit: 2.5 });
    expect(flagBand(band, 6.6)).toEqual({ code: 'CH', critical: 'high', limit: 6.5 });
  });

  it('savedValueRows carries the saved code for the badge', () => {
    const rows = savedValueRows(
      JSON.stringify({ values: { a: '1', b: '99', c: '50' }, flagged: { a: { flag: 'CL' }, b: { flag: 'CH' }, c: { flag: 'C' } } }),
      JSON.stringify({ parameters: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }));
    expect(rows.map(r => [r.flag, r.code])).toEqual([['critical', 'CL'], ['critical', 'CH'], ['critical', 'C']]);
  });
});

describe('report — CL → L, CH → H from the stored direction; legacy C by range', () => {
  it('CL / CH never guess from the range (even a contradicting one)', () => {
    expect(reportFlag('CL', '600', '70 - 140')).toEqual({ flag: 'L', isLow: true, abnormal: true });
    expect(reportFlag('CH', '1', '70 - 140')).toEqual({ flag: 'H', isLow: false, abnormal: true });
    expect(reportFlag('CL', 'x', null).flag).toBe('L');
    expect(reportFlag('CH', 'x', null).flag).toBe('H');
  });

  it('legacy C keeps the range-based fallback, never prints C', () => {
    expect(reportFlag('C', '600', '70 - 140').flag).toBe('H');
    expect(reportFlag('C', '1', '70 - 140').flag).toBe('L');
    expect(reportFlag('C', '600', null).flag).toBe('');
  });
});
