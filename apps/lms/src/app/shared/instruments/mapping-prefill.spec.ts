import { describe, expect, it } from 'vitest';
import type { Test } from '../models/test.model';
import { emptyCodeMapRow } from './instrument-config';
import { applyMappingPrefill, isMappingPrefill, resolvePrefillTest } from './mapping-prefill';

const tests = [
  { id: 't1', name: 'Fasting Blood Sugar', testCode: 'BIO010', code: 'FBS', catalogKey: 'MW-FBS', type: 'individual', unit: 'mg/dL' },
  { id: 'p1', name: 'Lipid Profile', testCode: 'BIO200', catalogKey: 'MW-LIPID', type: 'profile' },
  { id: 't2', name: 'Glucose PP', testCode: 'BIO011', catalogKey: 'MW-PPBS', type: 'individual', derivedUnit: 'mg/dL' },
] as unknown as Test[];

const p = { analyzerCode: 'GLU', unit: 'mg/dL', testId: 't1', testCode: 'BIO010', testName: 'Fasting Blood Sugar' };

describe('mapping prefill (assistant → Code mapping, never saved)', () => {
  it('resolves the test by id, then by code; only individual tests with a catalogue key', () => {
    expect(resolvePrefillTest(tests, p)?.catalogKey).toBe('MW-FBS');
    expect(resolvePrefillTest(tests, { analyzerCode: 'GLU', testId: 'zz', testCode: 'bio011' })?.catalogKey).toBe('MW-PPBS');
    expect(resolvePrefillTest(tests, { analyzerCode: 'L', testId: 'p1' })).toBeNull();
  });

  it('adds a new row with code, unit, test', () => {
    const r = applyMappingPrefill([], p, tests);
    expect(r.outcome).toBe('added');
    expect(r.index).toBe(0);
    expect(r.rows[0]).toEqual({ ...emptyCodeMapRow('GLU'), unit: 'mg/dL', testCatalogKey: 'MW-FBS', testName: 'Fasting Blood Sugar' });
  });

  it('fills a row with the same code and no test yet (keeps its unit)', () => {
    const rows = [{ ...emptyCodeMapRow('WBC'), testCatalogKey: 'MW-WBC' }, { ...emptyCodeMapRow('glu'), unit: 'mmol/L' }];
    const r = applyMappingPrefill(rows, p, tests);
    expect(r).toMatchObject({ outcome: 'filled', index: 1 });
    expect(r.rows[1]).toMatchObject({ analyzerCode: 'glu', testCatalogKey: 'MW-FBS', unit: 'mmol/L' });
    expect(rows[1].testCatalogKey).toBe('');               // input untouched
  });

  it('same code already on the same test → nothing changes', () => {
    const rows = [{ ...emptyCodeMapRow('GLU'), testCatalogKey: 'MW-FBS' }];
    const r = applyMappingPrefill(rows, p, tests);
    expect(r).toMatchObject({ outcome: 'exists', index: 0, testFound: true });
    expect(r.rows).toEqual(rows);
  });

  it('same code on ANOTHER test → a second row (one code may feed several tests)', () => {
    const rows = [{ ...emptyCodeMapRow('GLU'), testCatalogKey: 'MW-PPBS' }];
    const r = applyMappingPrefill(rows, p, tests);
    expect(r).toMatchObject({ outcome: 'added', index: 1 });
    expect(r.rows).toHaveLength(2);
  });

  it('test not in this lab → the row keeps code + unit, the person picks the test', () => {
    const r = applyMappingPrefill([], { analyzerCode: 'HBA1C', unit: '%', testId: 'nope', testName: 'HbA1c' }, tests);
    expect(r).toMatchObject({ outcome: 'added', testFound: false });
    expect(r.rows[0]).toMatchObject({ analyzerCode: 'HBA1C', unit: '%', testCatalogKey: '', testName: null });
    // again → points at that row instead of duplicating it
    expect(applyMappingPrefill(r.rows, { analyzerCode: 'HBA1C', testId: 'nope' }, tests)).toMatchObject({ outcome: 'exists', index: 0 });
  });

  it('isMappingPrefill guards the navigation hand-off', () => {
    expect(isMappingPrefill(p)).toBe(true);
    expect(isMappingPrefill({ analyzerCode: '  ' })).toBe(false);
    expect(isMappingPrefill(null)).toBe(false);
    expect(isMappingPrefill('GLU')).toBe(false);
  });
});
