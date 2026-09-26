import { buildReportPdf } from './report-pdf';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * ≥ ≤ print as REAL symbols on the report (owner, 2026-09-26: "in Test Master
 * it's ≥ but in the report it's >="). The body font is cp1252 and has no ≥,
 * so the glyph is drawn from the PDF-standard Symbol font as its own run.
 * Renders the REAL pipeline and reads the content stream back.
 */

const FBS = 'Normal: 70–99 {u}\nPrediabetes: 100–125 {u}\nDiabetes: ≥126 {u}';

const PLAIN: Record<string, ResolvedReportLayout> = {
  glu: { testId: 'glu', testName: 'Glucose Fasting', departmentName: 'Biochemistry', columns: [], configured: true, sections: [] } as unknown as ResolvedReportLayout,
};

function grid(range: string): Record<string, ResolvedReportLayout> {
  return { glu: {
    testId: 'glu', testName: 'Glucose Fasting', departmentName: 'Biochemistry', configured: true,
    columns: [
      { id: 'c1', name: 'result', label: 'Result', order: 1, width: 40, type: 'result', locked: false },
      { id: 'c2', name: 'unit', label: 'Unit', order: 2, width: 20, type: 'unit', locked: false },
      { id: 'c3', name: 'range', label: 'Reference range', order: 3, width: 40, type: 'range', locked: false },
    ],
    sections: [{ id: 'g1', type: 'grid', order: 1, isVisible: true, rows: [{
      parameterName: 'Glucose Fasting', isMerged: false, unit: 'mg/dL',
      cells: { result: '92', unit: 'mg/dL', range },
    }] }],
  } as unknown as ResolvedReportLayout };
}

export function renderSymbolReport(range: string, layouts: Record<string, ResolvedReportLayout>, name = 'Glucose Fasting'): string {
  const snap = {
    patient: { displayName: 'Test Patient', age: 40, sex: 'F' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000003', createdAt: '2026-09-26T00:00:00Z' },
    type: 'final',
    tests: [{
      testId: 'glu', name, department: 'Biochemistry', sampleType: 'Plasma',
      result: { values: { [name]: { value: '92', flag: 'N', unit: 'mg/dL', range } } },
    }],
  };
  const doc = buildReportPdf({ report: { id: 'r1', createdAt: '2026-09-26T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: layouts, template: null } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

/** Every string drawn with Tj, in order. */
function drawn(pdf: string): string[] {
  return [...pdf.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map(m => m[1]);
}

describe('report PDF — ≥ / ≤ print as real symbols', () => {
  it('plain results table: "Diabetes: ≥126" draws ≥ from the Symbol font, never ">="', () => {
    const pdf = renderSymbolReport(FBS.replace(/\{u\}/g, 'mg/dL'), PLAIN);
    const runs = drawn(pdf);
    expect(pdf).toContain('/BaseFont /Symbol');
    expect(runs.join('|')).not.toContain('>=');
    const at = runs.indexOf('Diabetes: ');
    expect(at).toBeGreaterThan(-1);
    expect(runs.slice(at, at + 3)).toEqual(['Diabetes: ', '³', '126 mg/dL']);
    // en dash is cp1252 0x96 in the latin1-decoded stream
    expect(runs).toContain('Normal: 70\x9699 mg/dL');
    expect(runs).toContain('Prediabetes: 100\x96125 mg/dL');
  });

  it('layout grid (reference-range column): ≤ and ≥ are Symbol runs on the line baseline', () => {
    const pdf = renderSymbolReport('Desirable: ≤99 {u}\nHigh: ≥126 {u}', grid('Desirable: ≤99 {u}\nHigh: ≥126 {u}'));
    const runs = drawn(pdf);
    expect(runs.join('|')).not.toMatch(/[<>]=/);
    expect(runs).toContain('£');
    expect(runs).toContain('³');
    // the Symbol run sits between its neighbours on the same baseline
    const i = pdf.indexOf('(³) Tj');
    const tds = [...pdf.slice(Math.max(0, i - 400), i + 200).matchAll(/([\d.]+) ([\d.]+) Td/g)].map(m => Number(m[2]));
    expect(new Set(tds.slice(-3)).size).toBe(1);
  });

  it('text with no symbol prints exactly as before (no Symbol font reference)', () => {
    const pdf = renderSymbolReport('70-99 mg/dL', PLAIN);
    expect(pdf).not.toMatch(/\/F14 [\d.]+ Tf/);
    expect(drawn(pdf)).toContain('70-99 mg/dL');
  });
});
