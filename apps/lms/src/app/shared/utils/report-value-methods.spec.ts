import { buildReportPdf } from './report-pdf';

/**
 * Test Master single source, rule 6 (hybrid methodology) on the REPORT: the
 * snapshot carries `tests[].valueMethods` = { paramName: value.methodology ??
 * test.Methodology }. The panel's "Method:" line uses it per value:
 *   - one method for every printed value → "Method: X" (the classic line);
 *   - different methods → each method named with its values;
 *   - no valueMethods (older snapshots) → the test-level `method`.
 */
function renderText(tests: unknown[], template: unknown = { showMethod: true }): string {
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-24T00:00:00Z', data: JSON.stringify({
      patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
      order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-24T00:00:00Z' },
      type: 'final',
      tests,
    }) },
    resolvedLayouts: {},
    template,
  } as never);
  // PDF string literals escape parentheses: "\(" → "(".
  return Buffer.from(doc.output('arraybuffer')).toString('latin1').replace(/\\([()\\])/g, '$1');
}

const panel = (over: Record<string, unknown> = {}) => ({
  testId: 'elec', name: 'Electrolytes', department: 'Biochemistry',
  method: 'TESTLEVELMETHOD',
  result: { values: {
    sodium: { value: '140', unit: 'mmol/L', range: '135-145' },
    potassium: { value: '4.1', unit: 'mmol/L', range: '3.5-5.1' },
  } },
  ...over,
});

describe('report Method line follows valueMethods (hybrid methodology)', () => {
  it('values measured by different methods: each method is named with its values', () => {
    const text = renderText([panel({ valueMethods: { sodium: 'ISEMETHOD', potassium: 'FLAMEMETHOD' } })]);
    expect(text).toContain('ISEMETHOD (Sodium)');
    expect(text).toContain('FLAMEMETHOD (Potassium)');
    expect(text).not.toContain('TESTLEVELMETHOD');
  });

  it('one effective method for every value prints the classic single line', () => {
    const text = renderText([panel({ valueMethods: { sodium: 'ONEMETHOD', potassium: 'ONEMETHOD' } })]);
    expect(text).toContain('Method: ONEMETHOD');
    expect(text).not.toContain('ONEMETHOD (');
  });

  it('keys match case-insensitively and a value missing from the map falls back to the test method', () => {
    const text = renderText([panel({ valueMethods: { SODIUM: 'ISEMETHOD' } })]);
    expect(text).toContain('ISEMETHOD (Sodium)');
    expect(text).toContain('TESTLEVELMETHOD (Potassium)');
  });

  it('older snapshots without valueMethods keep the test-level method', () => {
    const text = renderText([panel()]);
    expect(text).toContain('Method: TESTLEVELMETHOD');
  });
});

describe('report Method line follows the template\'s "Show method line" switch', () => {
  it('switch off: no "Method:" sub-line under the panel', () => {
    const text = renderText([panel()], { showMethod: false });
    expect(text).not.toContain('Method:');
    expect(text).not.toContain('TESTLEVELMETHOD');
  });

  it('no template (default): no "Method:" sub-line', () => {
    expect(renderText([panel()], null)).not.toContain('Method:');
  });

  it('switch on: the method line prints', () => {
    expect(renderText([panel()], { showMethod: true })).toContain('Method: TESTLEVELMETHOD');
  });
});
