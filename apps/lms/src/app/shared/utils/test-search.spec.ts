import { spellingVariants, matchTestSearch, filterTestList } from './test-search';
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
