import { tidyParametersJson } from './test-parameters';
import { stripRedundantMethodology } from './methodology';
import { buildReportPdf } from './report-pdf';

/**
 * RCA 2026-09-28 — "I change the methodology (picked or typed) and save; the
 * report doesn't show it."
 *
 * 1. The Admin Test Master carries a per-value `methodology` copy equal to the
 *    test-level one on ~386 tests (e.g. Calcium: test "Colorimetric", value
 *    "Colorimetric"). Changing the TEST's methodology left that copy behind,
 *    where the hybrid rule (value ?? test) read it as a per-value override —
 *    the snapshot's valueMethods kept the OLD method.
 * 2. A single-value (compact) test printed no "Method:" line at all, and a
 *    profile block claimed none, so the method never reached the page.
 */

describe('changing the test methodology carries its followers along', () => {
  const calcium = JSON.stringify({ parameters: [
    { name: 'Calcium', unit: 'mg/dL', methodology: 'Colorimetric' },
  ] });

  it('a copy equal to the methodology as loaded is stripped when it changes', () => {
    const out = JSON.parse(tidyParametersJson(calcium, 'Modified Arsenazo III', 'Colorimetric')!);
    expect(out.parameters[0].methodology).toBeUndefined();
  });

  it('a typed (custom) methodology works the same way', () => {
    const out = JSON.parse(tidyParametersJson(calcium, 'my lab method — typed', 'colorimetric ')!);
    expect(out.parameters[0].methodology).toBeUndefined();
  });

  it('a genuinely different per-value method is kept', () => {
    const ps = [
      { name: 'Na', methodology: 'ISE (Indirect)' },
      { name: 'Cl', methodology: 'Colorimetric' },
    ];
    const out = stripRedundantMethodology(ps, 'Photometry', 'Colorimetric');
    expect(out.map(p => p.methodology)).toEqual(['ISE (Indirect)', undefined]);
  });

  it('without a previous value the old rule stands (only copies of the current one go)', () => {
    const ps = [{ name: 'a', methodology: 'Colorimetric' }];
    expect(stripRedundantMethodology(ps, 'Hexokinase')).toBe(ps);
  });
});

function renderText(tests: unknown[], template: unknown = { showMethod: true },
                    resolvedLayouts: Record<string, unknown> = {}): string {
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-28T00:00:00Z', data: JSON.stringify({
      patient: { displayName: 'Test Patient', age: 40, sex: 'F' },
      order: { id: 'o1', orderNumber: 'LAB-2609-000002', createdAt: '2026-09-28T00:00:00Z' },
      type: 'final',
      tests,
    }) },
    resolvedLayouts,
    template,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1').replace(/\\([()\\])/g, '$1');
}

const calciumTest = (over: Record<string, unknown> = {}) => ({
  testId: 'ca', name: 'Calcium', department: 'Biochemistry',
  method: 'TYPEDMETHOD', valueMethods: { Calcium: 'TYPEDMETHOD' },
  result: { values: { Calcium: { value: '9', unit: 'mg/dL', range: '8.5 – 10.5 mg/dL' } } },
  ...over,
});

describe('report prints the methodology of a single-value test', () => {
  it('"Show method line" on: "Method: <typed>" prints under the compact row', () => {
    expect(renderText([calciumTest()])).toContain('Method: TYPEDMETHOD');
  });

  it('older snapshots (no valueMethods) print the test-level method', () => {
    expect(renderText([calciumTest({ valueMethods: undefined })])).toContain('Method: TYPEDMETHOD');
  });

  it('switch off (the default): nothing printed', () => {
    expect(renderText([calciumTest()], { showMethod: false })).not.toContain('TYPEDMETHOD');
    expect(renderText([calciumTest()], null)).not.toContain('TYPEDMETHOD');
  });

  it('with a Method column the method prints in the column, not twice', () => {
    const text = renderText([calciumTest()], { showMethod: true }, {
      ca: {
        testId: 'ca', testName: 'Calcium',
        columns: [
          { id: 'n', name: 'name', label: 'Investigation', order: 1, width: 35, type: 'name' },
          { id: 'r', name: 'result', label: 'Result', order: 2, width: 15, type: 'result' },
          { id: 'g', name: 'range', label: 'Reference Range', order: 3, width: 30, type: 'range' },
          { id: 'm', name: 'method', label: 'Methodology', order: 4, width: 20, type: 'method' },
        ],
        sections: [{ id: 's', type: 'grid', isVisible: true, rows: [{
          id: 'row1', parameterName: 'Calcium', title: 'Calcium', cells: { result: '9', range: '8.5 – 10.5' },
        }] }],
      },
    });
    expect(text).toContain('(TYPEDMETHOD)');
    expect(text).not.toContain('Method: TYPEDMETHOD');
  });

  it('a master-list methodology prints the same way', () => {
    expect(renderText([calciumTest({ method: 'Hexokinase', valueMethods: { Calcium: 'Hexokinase' } })]))
      .toContain('Method: Hexokinase');
  });
});

describe('report prints the methodology of a profile\'s members', () => {
  const member = (id: string, name: string, method: string, value: string) => ({
    testId: id, name, department: 'Biochemistry', method, valueMethods: { [name]: method },
    packageTestId: 'lipid', packageType: 'profile', packageName: 'Lipid Profile',
    result: { values: { [name]: { value, unit: 'mg/dL', range: '<200' } } },
  });

  it('members measured by one method → "Method: X" under the profile band', () => {
    const text = renderText([member('tc', 'Total Cholesterol', 'CHODPAP', '180'), member('tg', 'Triglycerides', 'CHODPAP', '120')]);
    expect(text).toContain('Method: CHODPAP');
  });

  it('members measured differently → each method named with its values', () => {
    const text = renderText([member('tc', 'Total Cholesterol', 'CHODPAP', '180'), member('hdl', 'HDL Cholesterol', 'DIRECTENZ', '45')]);
    expect(text).toContain('CHODPAP (Total Cholesterol)');
    expect(text).toContain('DIRECTENZ (HDL Cholesterol)');
  });

  it('switch off: the profile prints no method', () => {
    const text = renderText([member('tc', 'Total Cholesterol', 'CHODPAP', '180'), member('hdl', 'HDL Cholesterol', 'DIRECTENZ', '45')],
      { showMethod: false });
    expect(text).not.toContain('CHODPAP');
  });
});
