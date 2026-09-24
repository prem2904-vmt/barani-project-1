import { paramToField, tidyParametersJson, writeParameters } from './test-parameters';
import { effectiveMethodology, stripRedundantMethodology } from './methodology';
import {
  flagTone, liveFlag, parseResultSnapshot, rangeWithUnit, savedFlagOf, savedValueRows,
} from './result-flag';
import type { TestParameter } from '../models/test.model';

/** Test Master single source — Phase 0 shared helpers (flags, methodology, specimen). */

describe('saved flags — the flag mw stored is the flag every screen shows', () => {
  const params = JSON.stringify({ parameters: [
    { name: 'hb', title: 'Hb', unit: 'g/dL', criticalLow: 7, referenceRanges: [{ min: 13, max: 17, sex: 'M' }, { min: 12, max: 15, sex: 'F' }] },
    { name: 'urine', title: 'Colour', type: 'select' },
    { name: 'k', title: 'K' },
  ] });
  const snap = (flagged: Record<string, unknown> | undefined, values: Record<string, unknown> = { hb: '6', urine: 'Red', k: '4' }) =>
    JSON.stringify({ values, ...(flagged ? { flagged } : {}) });

  it('maps mw codes to tones: C → critical, H/L/A → abnormal, N/"" → normal', () => {
    expect(flagTone('C')).toBe('critical');
    expect(flagTone('h')).toBe('abnormal');
    expect(flagTone('L')).toBe('abnormal');
    expect(flagTone('A')).toBe('abnormal');
    expect(flagTone('N')).toBe('normal');
    expect(flagTone('')).toBe('normal');
    expect(flagTone(undefined)).toBe('normal');
  });

  it('rows read flag + range from the snapshot, never recompute (a saved N on 6 stays normal)', () => {
    const rows = savedValueRows(snap({ hb: { value: '6', flag: 'N', range: '12–15', unit: 'g/dL' }, urine: { flag: 'A' } }), params);
    expect(rows.map(r => r.flag)).toEqual(['normal', 'abnormal', 'normal']);
    expect(rows[0].range).toBe('12–15 g/dL');
    expect(rows[0].saved).toBe(true);
    expect(rows[2].saved).toBe(false);
  });

  it('legacy snapshot without a flagged map: unflagged, every band listed (no [0] band)', () => {
    const [hb] = savedValueRows(snap(undefined), params);
    expect(hb.flag).toBe('normal');
    expect(hb.range).toContain('13–17');
    expect(hb.range).toContain('12–15');
  });

  it('saved flag lookup falls back to a case-insensitive name', () => {
    const s = parseResultSnapshot(JSON.stringify({ values: {}, flagged: { HB: { flag: 'C' } } }));
    expect(savedFlagOf(s, 'hb')?.flag).toBe('C');
    expect(savedFlagOf(null, 'hb')).toBeUndefined();
  });

  it('rangeWithUnit never doubles the unit', () => {
    expect(rangeWithUnit('12–15', 'g/dL')).toBe('12–15 g/dL');
    expect(rangeWithUnit('12–15 g/dL', 'g/dL')).toBe('12–15 g/dL');
    expect(rangeWithUnit('', 'g/dL')).toBeUndefined();
  });
});

describe('liveFlag — pre-save hint mirrors mw FlagOne', () => {
  const k = { criticalLow: 2, criticalHigh: 8, referenceRanges: [{ segment: '', min: 3.5, max: 5, criticalLow: 2.5, criticalHigh: 6.5 }] };
  it('band criticals win over the parameter pair; strict limits', () => {
    expect(liveFlag(k, 6.6, null, null)).toMatchObject({ code: 'C', critical: 'high', limit: 6.5 });
    expect(liveFlag(k, 6.5, null, null)?.code).toBe('H');
    expect(liveFlag({ ...k, referenceRanges: [{ segment: '', min: 3.5, max: 5 }] }, 7, null, null)?.code).toBe('H');
    expect(liveFlag({ ...k, referenceRanges: [{ segment: '', min: 3.5, max: 5 }] }, 8.1, null, null)?.code).toBe('C');
  });
  it('picks the band for the patient sex (not the first band)', () => {
    const hb = { referenceRanges: [{ segment: '', min: 13, max: 17, sex: 'M' as const }, { segment: '', min: 12, max: 15, sex: 'F' as const }] };
    expect(liveFlag(hb, 12.5, 'F', 30)?.code).toBe('N');
    expect(liveFlag(hb, 12.5, 'M', 30)?.code).toBe('L');
  });
  it('profile-scoped bands apply under their profile', () => {
    const p = { referenceRanges: [{ segment: '', min: 0, max: 5 }, { segment: '', min: 40, max: 70, profileCode: 'CSF' }] };
    expect(liveFlag(p, 50, null, null, 'CSF')?.code).toBe('N');
    expect(liveFlag(p, 50, null, null)?.code).toBe('H');
  });
  it('nothing to judge → null', () => {
    expect(liveFlag({}, 5, null, null)).toBeNull();
  });
});

describe('methodology — hybrid (value ?? test)', () => {
  it('effective = own override, else the test-level default, else empty', () => {
    expect(effectiveMethodology({ methodology: 'ISE' }, { methodology: 'Photometry' })).toBe('ISE');
    expect(effectiveMethodology({}, { methodology: 'Photometry' })).toBe('Photometry');
    expect(effectiveMethodology({ methodology: '  ' }, { methodology: 'Photometry' })).toBe('Photometry');
    expect(effectiveMethodology({}, {})).toBe('');
  });
  it('strips copies equal to the test-level one (case/space-insensitive), keeps real overrides', () => {
    const ps = [{ name: 'a', methodology: 'ise ' }, { name: 'b', methodology: 'Flame' }, { name: 'c' }];
    const out = stripRedundantMethodology(ps, 'ISE');
    expect(out[0]).toEqual({ name: 'a' });
    expect(out[1].methodology).toBe('Flame');
    expect(stripRedundantMethodology([{ name: 'b', methodology: 'Flame' }], 'ISE')).toHaveLength(1);
  });
});

describe('specimen — the sampleType column is the only home', () => {
  it('writeParameters drops the wrapper sampleType', () => {
    const f = paramToField({ id: 'p', name: 'x', title: 'X', type: 'numeric' } as TestParameter, 0);
    const out = JSON.parse(writeParameters(JSON.stringify({ sampleType: 'Plasma', microFormat: 'm', parameters: [] }), [f]));
    expect(out.sampleType).toBeUndefined();
    expect(out.microFormat).toBe('m');
  });
  it('tidyParametersJson drops wrapper sampleType + redundant methodology; untouched when already tidy', () => {
    const raw = JSON.stringify({ sampleType: 'Plasma', parameters: [{ name: 'a', methodology: 'ISE' }] });
    expect(JSON.parse(tidyParametersJson(raw, 'ISE')!)).toEqual({ parameters: [{ name: 'a' }] });
    const tidy = JSON.stringify({ parameters: [{ name: 'a', methodology: 'Flame' }] });
    expect(tidyParametersJson(tidy, 'ISE')).toBe(tidy);
    expect(tidyParametersJson('', 'ISE')).toBe('');
  });
});
