import { buildReportPdf } from './report-pdf';
import { reportDisplayName } from './report-name';
import { CALCULATED_METHODOLOGY, methodologyChoices, STANDARD_METHODOLOGIES } from './methodology';

/**
 * Owner 2026-09-27: calculated values print like any other value — no
 * automatic "Calculated" marker. A lab that wants it picks "Calculated" as
 * the METHODOLOGY, which then prints where methodology prints.
 */
function renderText(tests: unknown[], resolvedLayouts: Record<string, unknown> = {}): string {
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-27T00:00:00Z', data: JSON.stringify({
      patient: { displayName: 'Test Patient', age: 45, sex: 'M' },
      order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-27T00:00:00Z' },
      type: 'final',
      tests,
    }) },
    resolvedLayouts,
    template: { showMethod: true } as never, // these checks read the panel Method line
  } as never);
  // PDF string literals escape parentheses: "\(" → "(".
  return Buffer.from(doc.output('arraybuffer')).toString('latin1').replace(/\\([()\\])/g, '$1');
}

const ldl = (over: Record<string, unknown> = {}) => ({
  testId: 'ldl', name: 'LDL Cholesterol (Calculated)', department: 'Biochemistry',
  result: { values: { 'LDL Cholesterol (Calculated)': { value: '128', unit: 'mg/dL', range: '<100' } } },
  ...over,
});

describe('reportDisplayName', () => {
  it('drops the "(Calculated)" marker in any case / bracket, keeps everything else', () => {
    expect(reportDisplayName('LDL Cholesterol (Calculated)')).toBe('LDL Cholesterol');
    expect(reportDisplayName('Globulin (calculated)')).toBe('Globulin');
    expect(reportDisplayName('VLDL [Calc.]')).toBe('VLDL');
    expect(reportDisplayName('Bilirubin, Indirect (Calculated)')).toBe('Bilirubin, Indirect');
    expect(reportDisplayName('Calcium')).toBe('Calcium');
    expect(reportDisplayName('Procalcitonin')).toBe('Procalcitonin');
    expect(reportDisplayName('(Calculated)')).toBe('(Calculated)');
    expect(reportDisplayName(null)).toBeNull();
  });
});

describe('report prints calculated values with no "Calculated" marker', () => {
  it('a calculated value prints its name and value, and no "Calculated" text', () => {
    const text = renderText([ldl()]);
    expect(text).toContain('LDL Cholesterol');
    expect(text).toContain('128');
    expect(text).not.toMatch(/calculated/i);
  });

  it('the marker is dropped from a profile name and a layout row title too', () => {
    const inProfile = { packageTestId: 'lipid', packageType: 'profile', packageName: 'Lipid Profile (Calculated)' };
    const text = renderText([
      ldl(inProfile),
      { testId: 'hdl', name: 'HDL Cholesterol', department: 'Biochemistry', ...inProfile,
        result: { values: { 'HDL Cholesterol': { value: '45', unit: 'mg/dL', range: '>40' } } } },
    ], {
      ldl: {
        testId: 'ldl', testName: 'LDL Cholesterol (Calculated)',
        columns: [
          { id: 'n', name: 'name', label: 'Investigation', order: 1, width: 40, type: 'name' },
          { id: 'r', name: 'result', label: 'Result', order: 2, width: 20, type: 'result' },
          { id: 'u', name: 'unit', label: 'Unit', order: 3, width: 15, type: 'unit' },
          { id: 'g', name: 'range', label: 'Reference Range', order: 4, width: 25, type: 'range' },
        ],
        sections: [{ id: 's', type: 'grid', isVisible: true, rows: [{
          id: 'row1', parameterName: 'LDL Cholesterol (Calculated)', title: 'LDL Cholesterol (Calculated)',
          cells: { result: '128', unit: 'mg/dL', range: '<100' },
        }] }],
      },
    });
    expect(text).toContain('LIPID PROFILE');   // the profile band (upper-cased)
    expect(text).toContain('LDL Cholesterol');
    expect(text).toContain('128');
    expect(text).not.toMatch(/calculated/i);
  });

  it('methodology "Calculated" (the lab\'s own choice) prints on the panel Method line', () => {
    const text = renderText([{
      testId: 'lipid', name: 'Lipid Profile', department: 'Biochemistry', method: CALCULATED_METHODOLOGY,
      result: { values: {
        'LDL Cholesterol': { value: '128', unit: 'mg/dL', range: '<100' },
        'VLDL Cholesterol': { value: '30', unit: 'mg/dL', range: '<30' },
      } },
    }]);
    expect(text).toContain('Method: Calculated');
  });

  it('methodology "Calculated" prints in a Methodology column for a single-value test', () => {
    const text = renderText([ldl({ name: 'LDL Cholesterol', method: CALCULATED_METHODOLOGY,
      result: { values: { 'LDL Cholesterol': { value: '128', unit: 'mg/dL', range: '<100' } } } })], {
      ldl: {
        testId: 'ldl', testName: 'LDL Cholesterol',
        columns: [
          { id: 'n', name: 'name', label: 'Investigation', order: 1, width: 35, type: 'name' },
          { id: 'r', name: 'result', label: 'Result', order: 2, width: 15, type: 'result' },
          { id: 'u', name: 'unit', label: 'Unit', order: 3, width: 10, type: 'unit' },
          { id: 'g', name: 'range', label: 'Reference Range', order: 4, width: 20, type: 'range' },
          { id: 'm', name: 'method', label: 'Methodology', order: 5, width: 20, type: 'method' },
        ],
        sections: [{ id: 's', type: 'grid', isVisible: true, rows: [{
          id: 'row1', parameterName: 'LDL Cholesterol', title: 'LDL Cholesterol',
          cells: { result: '128', unit: 'mg/dL', range: '<100' },
        }] }],
      },
    });
    expect(text).toContain('Methodology');
    expect(text).toContain('(Calculated)');   // the method cell, drawn as a PDF string
    expect(text).toContain('(LDL Cholesterol)');
  });

  it('a per-value methodology "Calculated" prints alongside the other values\' method', () => {
    const text = renderText([{
      testId: 'lipid', name: 'Lipid Profile', department: 'Biochemistry', method: 'Enzymatic',
      valueMethods: { Cholesterol: 'Enzymatic', LDL: 'Calculated' },
      result: { values: {
        Cholesterol: { value: '210', unit: 'mg/dL', range: '<200' },
        LDL: { value: '128', unit: 'mg/dL', range: '<100' },
      } },
    }]);
    expect(text).toContain('Calculated (LDL)');
    expect(text).toContain('Enzymatic (Cholesterol)');
  });
});

describe('methodologyChoices — Test Master Methodology picker', () => {
  it('offers "Calculated" alongside the standard methods', () => {
    const c = methodologyChoices('');
    expect(c).toContain(CALCULATED_METHODOLOGY);
    expect(c).toEqual([...STANDARD_METHODOLOGIES]);
  });
  it('keeps a hand-entered current value first, and adds the tenant\'s own methods (deduped)', () => {
    const c = methodologyChoices('Jaffe kinetic', ['Biuret', 'photometry', '', null, 'Biuret']);
    expect(c[0]).toBe('Jaffe kinetic');
    expect(c.filter(m => m.toLowerCase() === 'photometry')).toEqual(['Photometry']);
    expect(c.filter(m => m === 'Biuret')).toHaveLength(1);
  });
  it('an existing "Calculated" value is not duplicated', () => {
    const c = methodologyChoices('calculated', ['Calculated']);
    expect(c.filter(m => m.toLowerCase() === 'calculated')).toHaveLength(1);
  });
});
