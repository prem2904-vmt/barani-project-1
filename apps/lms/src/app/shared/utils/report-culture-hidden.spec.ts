import { buildReportPdf } from './report-pdf';

/**
 * Culture report-row visibility (owner's model, 2026-09-19): the bench/
 * validator can UNTICK any culture row — that row is then hidden on the
 * patient PDF only (the bench record keeps everything). Keys ride the
 * sign-out snapshot as result.hidden[]:
 *   summary lines  — 'gramStain' | 'colonyCount' | 'resistancePattern' |
 *                    'intrinsicResistance' | 'clinicalNotes' |
 *                    'infectionControlAdvice'
 *   whole organism — 'org:{originalIndex}'
 *   one AST row    — 'ast:{originalIndex}:{antibioticName}'
 * Default (no hidden list) prints every row — checkboxes start checked.
 */

interface CultureValues {
  specimen?: string; gramStain?: string; colonyCount?: string; noGrowth?: boolean;
  organisms?: Array<{ name?: string; antibiotics?: Array<{ name?: string; interpretation?: string }> }>;
  resistancePattern?: string; clinicalNotes?: string;
}

function renderCulture(values: CultureValues, hidden?: string[]): string {
  const snap = {
    patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-19T00:00:00Z' },
    type: 'final',
    tests: [{
      testId: 'ct1',
      name: 'Bacterial Culture & Sensitivity',
      packageTestId: null,
      packageType: null,
      department: 'Microbiology',
      sampleType: 'Urine',
      result: { microFormat: 'culture_sensitivity', values, ...(hidden ? { hidden } : {}) },
    }],
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-19T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: {},
    template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

const VALUES: CultureValues = {
  specimen: 'Urine',
  gramStain: 'GRAMSTAINVAL gram negative bacilli',
  colonyCount: 'COLONYVAL cfu/ml',
  organisms: [
    { name: 'Escherichia coli', antibiotics: [
      { name: 'Amikacin', interpretation: 'S' },
      { name: 'Ciprofloxacin', interpretation: 'R' },
    ]},
    { name: 'Klebsiella pneumoniae', antibiotics: [
      { name: 'Meropenem', interpretation: 'S' },
    ]},
  ],
  resistancePattern: 'RESISTPATVAL',
  clinicalNotes: 'CLINNOTEVAL',
};

describe('culture report-row visibility', () => {
  it('no hidden list → every row prints (checkboxes default checked)', () => {
    const text = renderCulture(VALUES);
    expect(text).toContain('GRAMSTAINVAL');
    expect(text).toContain('Amikacin');
    expect(text).toContain('Ciprofloxacin');
    expect(text).toContain('Klebsiella');
    expect(text).toContain('RESISTPATVAL');
  });

  it('hidden AST row disappears; its siblings stay', () => {
    const text = renderCulture(VALUES, ['ast:0:Ciprofloxacin']);
    expect(text).not.toContain('Ciprofloxacin');
    expect(text).toContain('Amikacin');
    expect(text).toContain('Meropenem');
  });

  it('hidden organism drops its whole block; keys use ORIGINAL indexes', () => {
    // Hiding organism 0 must not shift organism 1's AST keys.
    const text = renderCulture(VALUES, ['org:0']);
    expect(text).not.toContain('Escherichia');
    expect(text).not.toContain('Amikacin');
    expect(text).toContain('Klebsiella');
    expect(text).toContain('Meropenem');
  });

  it('hidden summary lines vanish while the rest print', () => {
    const text = renderCulture(VALUES, ['gramStain', 'resistancePattern']);
    expect(text).not.toContain('GRAMSTAINVAL');
    expect(text).not.toContain('RESISTPATVAL');
    expect(text).toContain('COLONYVAL');
    expect(text).toContain('CLINNOTEVAL');
  });
});
