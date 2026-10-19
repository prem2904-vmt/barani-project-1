import {
  CODE_AUTO_TEXT, CODE_RANGE_EXHAUSTED_ERROR, CODE_READONLY_ERROR, DEPARTMENT_REQUIRED_ERROR,
  codeDisplay, compareTestCodes, compareTestsByCode, parseTestCode,
} from './test-code';

/** 9-series test codes: server-assigned, read-only, natural sort. */
describe('test code', () => {
  it('shows "Assigned automatically" before the first save, the code after', () => {
    expect(codeDisplay('', false)).toBe(CODE_AUTO_TEXT);
    expect(codeDisplay(null, false)).toBe('Assigned automatically');
    expect(codeDisplay(' BIO901 ', true)).toBe('BIO901');
    expect(codeDisplay('', true)).toBe('—');
  });

  it('parses 3 letters + digits only', () => {
    expect(parseTestCode('bio019')).toEqual({ prefix: 'BIO', n: 19 });
    expect(parseTestCode('HEM1000')).toEqual({ prefix: 'HEM', n: 1000 });
    expect(parseTestCode('MW-0001')).toBeNull();
    expect(parseTestCode('CBC')).toBeNull();
    expect(parseTestCode(null)).toBeNull();
  });

  it('sorts naturally: prefix, then number; other shapes after; blanks last', () => {
    const codes = ['BIO1000', 'HEM001', 'BIO901', 'CBC', '', 'BIO010', 'BIO002', 'BIO9000', null];
    expect([...codes].sort(compareTestCodes)).toEqual(
      ['BIO002', 'BIO010', 'BIO901', 'BIO1000', 'BIO9000', 'HEM001', 'CBC', '', null]);
  });

  it('orders older/shorter codes by number too (BIO2 < BIO10), not by characters', () => {
    const codes = ['BIO10', 'BIO2', 'BIO019', 'MW-0010', 'MW-0002'];
    expect([...codes].sort(compareTestCodes)).toEqual(['BIO2', 'BIO10', 'BIO019', 'MW-0002', 'MW-0010']);
  });

  it('arranges tests code-wise, name breaking ties and codeless tests last', () => {
    const tests = [
      { testCode: 'BIO010', name: 'Urea' },
      { testCode: null, name: 'Alpha' },
      { testCode: 'BIO002', name: 'Glucose' },
      { testCode: 'BIO002', name: 'Albumin' },
      { testCode: 'HEM001', name: 'Hb' },
    ];
    expect([...tests].sort(compareTestsByCode).map(t => t.name))
      .toEqual(['Albumin', 'Glucose', 'Urea', 'Hb', 'Alpha']);
  });

  it('mirrors the server error codes', () => {
    expect(CODE_READONLY_ERROR).toBe('code_readonly');
    expect(DEPARTMENT_REQUIRED_ERROR).toBe('department_required');
    expect(CODE_RANGE_EXHAUSTED_ERROR).toBe('code_range_exhausted');
  });
});
