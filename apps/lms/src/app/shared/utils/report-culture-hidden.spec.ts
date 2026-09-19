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

interface StageSnap {
  key: string; label: string; caseLabel?: string | null;
  values: { fields?: Array<{ name: string; title: string; value: string }>; notes?: string };
}

function renderCulture(values: CultureValues, hidden?: string[], stages?: StageSnap[],
                       deptSignatures?: Array<{ department?: string; signatures?: Array<{ name?: string; title?: string }> }>,
                       layoutSections?: Array<Record<string, unknown>>): string {
  const snap = {
    patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-19T00:00:00Z' },
    type: 'final',
    ...(deptSignatures ? { deptSignatures } : {}),
    tests: [{
      testId: 'ct1',
      name: 'Bacterial Culture & Sensitivity',
      packageTestId: null,
      packageType: null,
      department: 'Microbiology',
      sampleType: 'Urine',
      result: { microFormat: 'culture_sensitivity', values,
                ...(hidden ? { hidden } : {}), ...(stages ? { stages } : {}) },
    }],
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-19T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: layoutSections
      ? { ct1: { testId: 'ct1', testName: 'Bacterial Culture & Sensitivity', departmentName: 'Microbiology',
                 columns: [], sections: layoutSections } }
      : {},
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

  it('root stage findings print as lines; hidden fields drop; branch stages stay bench-only', () => {
    const stages: StageSnap[] = [
      { key: 'gram', label: 'Gram / Direct smear', values: { fields: [
        { name: 'pus_cells', title: 'Pus Cells', value: 'PUSVAL' },
        { name: 'yeast', title: 'Yeast', value: 'YEASTVAL' },
      ]}},
      { key: 'gram', label: 'Sub gram', caseLabel: 'Blood agar', values: { fields: [
        { name: 'pus_cells', title: 'Pus Cells', value: 'BRANCHVAL' },
      ]}},
    ];
    const all = renderCulture(VALUES, [], stages);
    expect(all).toContain('PUSVAL');
    expect(all).toContain('YEASTVAL');
    expect(all).not.toContain('BRANCHVAL');   // subculture stages are bench-only
    const some = renderCulture(VALUES, ['stage:gram:pus_cells'], stages);
    expect(some).not.toContain('PUSVAL');
    expect(some).toContain('YEASTVAL');
  });

  it('a customized layout drives order + labels; classic stays without one', () => {
    // Admin arranged: clinical notes FIRST under a custom label, then AST,
    // and dropped the organisms line entirely — the renderer must follow.
    const sections = [
      { id: 'l1', type: 'culture_line', label: 'PHYSICIAN ADVICE', content: 'clinicalNotes', isVisible: true },
      { id: 'a1', type: 'culture_ast', isVisible: true },
      { id: 'p1', type: 'paragraph', content: 'CUSTOMPARAGRAPH', isVisible: true },
    ];
    const text = renderCulture(VALUES, undefined, undefined, undefined, sections);
    expect(text).toContain('PHYSICIAN ADVICE');
    expect(text).toContain('CLINNOTEVAL');
    expect(text).toContain('Amikacin');            // AST block still renders
    expect(text).toContain('CUSTOMPARAGRAPH');
    expect(text).not.toContain('GRAMSTAINVAL');    // gram line not in the layout
    // Order: advice label precedes the AST table head.
    expect(text.indexOf('PHYSICIAN ADVICE')).toBeLessThan(text.indexOf('Antimicrobial for'));
  });

  it('layout mode still honors the row-hide checkboxes', () => {
    const sections = [
      { id: 'l1', type: 'culture_line', content: 'gramStain', isVisible: true },
      { id: 'a1', type: 'culture_ast', isVisible: true },
    ];
    const text = renderCulture(VALUES, ['ast:0:Ciprofloxacin'], undefined, undefined, sections);
    expect(text).toContain('GRAMSTAINVAL');
    expect(text).not.toContain('Ciprofloxacin');
    expect(text).toContain('Amikacin');
  });

  it('culture-only report still draws its department signatories', () => {
    // The sign-off block is normally drawn by the columnar table, which a
    // pure-culture report never enters — the signatures must defer to below
    // the End-of-Report marker instead of vanishing.
    const text = renderCulture(VALUES, undefined, undefined,
      [{ department: 'Microbiology', signatures: [{ name: 'Dr SIGNATORYNAME', title: 'Consultant Microbiologist' }] }]);
    expect(text).toContain('Dr SIGNATORYNAME');
    expect(text).toContain('Consultant Microbiologist');
  });

  it('hidden summary lines vanish while the rest print', () => {
    const text = renderCulture(VALUES, ['gramStain', 'resistancePattern']);
    expect(text).not.toContain('GRAMSTAINVAL');
    expect(text).not.toContain('RESISTPATVAL');
    expect(text).toContain('COLONYVAL');
    expect(text).toContain('CLINNOTEVAL');
  });
});
