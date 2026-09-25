import { spellingVariants, matchTestSearch, filterTestList, scoreTestSearch } from './test-search';
import { Test } from '../models/test.model';

const testOf = (overrides: Partial<Test> = {}): Test => ({
  id: 'test-1',
  tenantId: 'tenant-1',
  name: 'Test Name',
  code: 'TST001',
  type: 'individual',
  flow: 'direct',
  price: 100,
  discount: 0,
  taxSlab: 18,
  tatHours: 24,
  isActive: true,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('spellingVariants', () => {
  it('returns the original query in the set', () => {
    const variants = spellingVariants('hematology');
    expect(variants).toContain('hematology');
  });

  it('generates US → UK spelling for hema/haema', () => {
    const variants = spellingVariants('hematology');
    expect(variants).toContain('haematology');
  });

  it('generates UK → US spelling for haema/hema', () => {
    const variants = spellingVariants('haematology');
    expect(variants).toContain('hematology');
  });

  it('generates variants for pediatric/paediatric', () => {
    const variants = spellingVariants('pediatric');
    expect(variants).toContain('paediatric');
  });

  it('generates variants for anesthesia/anaesthesia', () => {
    const variants = spellingVariants('anesthesia');
    expect(variants).toContain('anaesthesia');
  });

  it('generates variants for fetal/foetal', () => {
    const variants = spellingVariants('fetal');
    expect(variants).toContain('foetal');
  });

  it('generates variants for leukocyte/leucocyte', () => {
    const variants = spellingVariants('leukocyte');
    expect(variants).toContain('leucocyte');
  });

  it('returns unique variants (no duplicates)', () => {
    const variants = spellingVariants('test');
    const set = new Set(variants);
    expect(variants.length).toBe(set.size);
  });

  it('handles no matching swaps by returning just the original', () => {
    const variants = spellingVariants('xyz');
    expect(variants).toEqual(['xyz']);
  });
});

describe('matchTestSearch', () => {
  it('returns true for empty query', () => {
    const test = testOf({ name: 'Glucose' });
    expect(matchTestSearch(test, '')).toBe(true);
  });

  it('returns true for whitespace-only query', () => {
    const test = testOf({ name: 'Glucose' });
    expect(matchTestSearch(test, '   ')).toBe(true);
  });

  it('matches substring in test name (case-insensitive)', () => {
    const test = testOf({ name: 'Serum Glucose' });
    expect(matchTestSearch(test, 'glucose')).toBe(true);
    expect(matchTestSearch(test, 'GLUCOSE')).toBe(true);
    expect(matchTestSearch(test, 'SeRuM')).toBe(true);
  });

  it('matches substring in code', () => {
    const test = testOf({ code: 'BIO123' });
    expect(matchTestSearch(test, 'bio123')).toBe(true);
  });

  it('matches substring in testCode', () => {
    const test = testOf({ testCode: 'GLU-001' });
    expect(matchTestSearch(test, 'glu')).toBe(true);
  });

  it('matches substring in shortName', () => {
    const test = testOf({ shortName: 'Gluc' });
    expect(matchTestSearch(test, 'gluc')).toBe(true);
  });

  it('matches substring in profile', () => {
    const test = testOf({ profile: 'Lipid Profile' });
    expect(matchTestSearch(test, 'lipid')).toBe(true);
  });

  it('matches substring in hsnSacCode', () => {
    const test = testOf({ hsnSacCode: 'HSN-9999' });
    expect(matchTestSearch(test, 'hsn')).toBe(true);
  });

  it('matches substring in department.name', () => {
    const test = testOf({
      department: { id: 'dept-1', name: 'Biochemistry', code: 'BIO' }
    });
    expect(matchTestSearch(test, 'biochemistry')).toBe(true);
  });

  it('returns false when query does not match any field', () => {
    const test = testOf({
      name: 'Glucose',
      code: 'GLU001',
      profile: 'Metabolic'
    });
    expect(matchTestSearch(test, 'xyz')).toBe(false);
  });

  it('matches query with US spelling variant (hemato)', () => {
    const test = testOf({ name: 'Hematology Panel' });
    expect(matchTestSearch(test, 'haematology')).toBe(true);
  });

  it('matches query with UK spelling variant (haemato)', () => {
    const test = testOf({ name: 'Haematology Panel' });
    expect(matchTestSearch(test, 'hematology')).toBe(true);
  });

  it('combines multiple fields for matching', () => {
    const test = testOf({
      name: 'Test A',
      code: 'GLU',
      profile: 'Metabolic',
      department: { id: 'd1', name: 'Biochemistry', code: 'BIO' }
    });
    // Query matches profile field
    expect(matchTestSearch(test, 'metabolic')).toBe(true);
    // Query matches department field
    expect(matchTestSearch(test, 'biochemistry')).toBe(true);
  });

  it('handles null/undefined fields gracefully', () => {
    const test = testOf({
      shortName: null,
      profile: undefined,
      hsnSacCode: undefined,
      department: undefined
    });
    expect(matchTestSearch(test, 'test')).toBe(true);
  });

  it('matches partial code', () => {
    const test = testOf({ code: 'BIO12345' });
    expect(matchTestSearch(test, 'bio12')).toBe(true);
  });

  it('does not match partial word outside the field', () => {
    const test = testOf({ name: 'Serum Glucose' });
    expect(matchTestSearch(test, 'xgluc')).toBe(false);
  });

  // OPS-67: acronym search — "LFT" should surface "Liver Function Test".
  it('matches an acronym of the name (LFT → Liver Function Test)', () => {
    const test = testOf({ name: 'Liver Function Test' });
    expect(matchTestSearch(test, 'lft')).toBe(true);
    expect(matchTestSearch(test, 'LFT')).toBe(true);
  });

  it('matches an acronym of a profile name (CBC → Complete Blood Count)', () => {
    const test = testOf({ name: 'Whole blood panel', profile: 'Complete Blood Count' });
    expect(matchTestSearch(test, 'cbc')).toBe(true);
  });

  it('matches an acronym prefix (LF → Liver Function Test)', () => {
    const test = testOf({ name: 'Liver Function Test' });
    expect(matchTestSearch(test, 'lf')).toBe(true);
  });

  it('does not treat a non-matching short query as an acronym', () => {
    const test = testOf({ name: 'Liver Function Test', code: 'LFT01', profile: null });
    expect(matchTestSearch(test, 'zzz')).toBe(false);
  });

  it('leaves normal substring typing unaffected by acronym logic', () => {
    const test = testOf({ name: 'Liver Function Test' });
    expect(matchTestSearch(test, 'liver')).toBe(true);
    expect(matchTestSearch(test, 'function')).toBe(true);
  });

  // OPS-67 follow-up: fuzzy nearest-match for typos / near-miss codes.
  it('fuzzy-matches a 1-letter-off acronym (NFT → LFT)', () => {
    const test = testOf({ name: 'Liver Function Test' });
    expect(matchTestSearch(test, 'nft')).toBe(true);
  });

  it('fuzzy-matches a mistyped short name (CBCC → CBC)', () => {
    const test = testOf({ name: 'Whole blood panel', shortName: 'CBC' });
    expect(matchTestSearch(test, 'cbcc')).toBe(true);
  });

  it('fuzzy-matches a typo in a name word (hemoglobn → Hemoglobin)', () => {
    const test = testOf({ name: 'Hemoglobin' });
    expect(matchTestSearch(test, 'hemoglobn')).toBe(true);
  });

  it('does not fuzzy-match something far off', () => {
    const test = testOf({ name: 'Glucose', code: 'GLU001', profile: null });
    expect(matchTestSearch(test, 'qwerty')).toBe(false);
  });
});

describe('scoreTestSearch ranking', () => {
  it('scores exact/prefix above substring above fuzzy', () => {
    const exact = testOf({ shortName: 'LFT' });
    const substr = testOf({ name: 'Delft glass panel' }); // contains "lft"
    const fuzzy = testOf({ name: 'Liver Function Test' }); // acronym lft, "nft" is 1 off
    expect(scoreTestSearch(exact, 'lft')).toBeGreaterThan(scoreTestSearch(substr, 'lft'));
    expect(scoreTestSearch(fuzzy, 'nft')).toBeGreaterThan(0);
    expect(scoreTestSearch(exact, 'lft')).toBeGreaterThan(scoreTestSearch(fuzzy, 'nft'));
  });

  it('ranks the exact match first in filterTestList', () => {
    const tests = [
      testOf({ id: 'fuzzy', name: 'Liver Function Test' }), // matches "lft" via acronym
      testOf({ id: 'exact', shortName: 'LFT', name: 'Some panel' }),
    ];
    const result = filterTestList(tests, 'lft');
    expect(result[0].id).toBe('exact');
  });
});

describe('filterTestList', () => {
  it('returns all tests when query is empty', () => {
    const tests = [
      testOf({ name: 'Test A' }),
      testOf({ name: 'Test B' }),
      testOf({ name: 'Test C' })
    ];
    expect(filterTestList(tests, '')).toEqual(tests);
  });

  it('returns all tests when query is whitespace-only', () => {
    const tests = [
      testOf({ name: 'Test A' }),
      testOf({ name: 'Test B' })
    ];
    expect(filterTestList(tests, '   ')).toEqual(tests);
  });

  it('filters tests by name', () => {
    const tests = [
      testOf({ id: '1', name: 'Glucose' }),
      testOf({ id: '2', name: 'Creatinine' }),
      testOf({ id: '3', name: 'Potassium' })
    ];
    const result = filterTestList(tests, 'glucose');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters tests by code', () => {
    const tests = [
      testOf({ id: '1', code: 'BIO001' }),
      testOf({ id: '2', code: 'BIO002' }),
      testOf({ id: '3', code: 'HEM001' })
    ];
    const result = filterTestList(tests, 'bio');
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no tests match', () => {
    const tests = [
      testOf({ name: 'Glucose' }),
      testOf({ name: 'Creatinine' })
    ];
    const result = filterTestList(tests, 'xyz');
    expect(result).toHaveLength(0);
  });

  it('preserves test order in filtered results', () => {
    const tests = [
      testOf({ id: '1', name: 'Alanine' }),
      testOf({ id: '2', name: 'Aspartate' }),
      testOf({ id: '3', name: 'Albumin' })
    ];
    const result = filterTestList(tests, 'a');
    expect(result.map(t => t.id)).toEqual(['1', '2', '3']);
  });

  it('handles case-insensitive filtering', () => {
    const tests = [
      testOf({ id: '1', name: 'GLUCOSE' }),
      testOf({ id: '2', name: 'Creatinine' })
    ];
    const result = filterTestList(tests, 'glucose');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters using spelling variants', () => {
    const tests = [
      testOf({ id: '1', name: 'Haematology' }),
      testOf({ id: '2', name: 'Biochemistry' })
    ];
    const result = filterTestList(tests, 'hematology');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters across multiple fields', () => {
    const tests = [
      testOf({ id: '1', name: 'Test A', code: 'TST001' }),
      testOf({ id: '2', name: 'Test B', code: 'TST002' }),
      testOf({ id: '3', name: 'Test C', code: 'GLU001' })
    ];
    const result = filterTestList(tests, 'glu');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  it('filters with partial match in department name', () => {
    const tests = [
      testOf({ id: '1', department: { id: 'd1', name: 'Biochemistry', code: 'BIO' } }),
      testOf({ id: '2', department: { id: 'd2', name: 'Hematology', code: 'HEM' } })
    ];
    const result = filterTestList(tests, 'biochem');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('works with generic type T extends Test', () => {
    interface CustomTest extends Test {
      customField?: string;
    }
    const tests: CustomTest[] = [
      { ...testOf({ id: '1', name: 'Glucose' }), customField: 'extra' },
      { ...testOf({ id: '2', name: 'Creatinine' }), customField: 'other' }
    ];
    const result = filterTestList<CustomTest>(tests, 'glucose');
    expect(result).toHaveLength(1);
    expect(result[0].customField).toBe('extra');
  });
});

import { filterTestListStrict, scoreTestSearchStrict } from './test-search';

describe('filterTestListStrict (order search dropdown)', () => {
  const T = (id: string, name: string, testCode: string, extra: any = {}) => ({ id, name, testCode, type: 'individual', ...extra });
  const cat = [
    T('abc', 'Absolute Basophil Count', 'HEM021'),
    T('jak', 'JAK2 Mutation Detection', 'MOL014'),
    T('jap', 'Japanese Encephalitis IgM', 'IMS088'),
    T('naja', 'Ninja Marker', 'BIO900'),
    T('sgot', 'SGOT (AST)', 'BIO101'),
    T('lft', 'Liver Function Test', 'PRO010', { type: 'profile', shortName: 'LFT',
      parameters: JSON.stringify({ items: [{ testId: 'sgot' }] }) }),
    T('hb', 'Haemoglobin', 'HEM011', { shortName: 'Hb' }),
    T('hba', 'HbA1c', 'BIO012', { shortName: 'HBA1C' }),
    T('hem', 'Hematocrit', 'HEM010'),
  ];
  const ids = (q: string) => filterTestListStrict(cat, q).map((t: any) => t.id);

  it('"ja" finds JAK2 (and Japanese) but not Absolute Basophil Count', () => {
    const r = ids('ja');
    expect(r).toContain('jak');
    expect(r).toContain('jap');
    expect(r).not.toContain('abc');
    expect(r.indexOf('jak')).toBeLessThan(r.indexOf('naja'));   // word-prefix before substring
  });

  it('"LFT" matches the liver profile by short name, and its members by profile label', () => {
    const r = ids('LFT');
    expect(r[0]).toBe('lft');
    expect(r).toContain('sgot');
  });

  it('ranking: exact code › code prefix › short-name prefix › name word-prefix › name substring', () => {
    expect(ids('HEM011')[0]).toBe('hb');
    const r = ids('hb');
    // exact short name "Hb" › short-name prefix "HBA1C"
    expect(r.slice(0, 2)).toEqual(['hb', 'hba']);
    const s = ['HEM011', 'hem', 'hema'].map(q => ids(q));
    expect(s[1][0]).toMatch(/^(hem|hb|abc)$/);          // code prefix hits first
    expect(scoreTestSearchStrict(cat[1], 'mol0')).toBeGreaterThan(scoreTestSearchStrict(cat[1], 'mutation'));
    expect(scoreTestSearchStrict(cat[1], 'mutation')).toBeGreaterThan(scoreTestSearchStrict(cat[3], 'nja'));
  });

  it('1-character queries only match prefixes; no fuzzy near-misses', () => {
    expect(ids('j')).toEqual(expect.arrayContaining(['jak', 'jap']));
    expect(ids('j')).not.toContain('naja');                 // "j" inside "Ninja" is not a prefix
    expect(ids('hemoglobn')).toEqual([]);                    // no edit-distance matching
    expect(ids('lfx')).toEqual([]);
  });
});
