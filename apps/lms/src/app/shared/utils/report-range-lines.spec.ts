import { buildReportPdf, rangeCellText } from './report-pdf';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * A typed multi-line report text ("Normal: 70–99⏎Prediabetes: 100–125⏎
 * Diabetes: ≥126") prints ONE LINE PER LINE in the reference column — never
 * run together. Renders the REAL pipeline (buildReportPdf) and reads the
 * content stream back (Standard-14 fonts write literal latin1 text), the same
 * technique as report-abnormal-amended.spec.ts.
 */

const LAYOUTS: Record<string, ResolvedReportLayout> = {
  glu: { testId: 'glu', testName: 'Glucose Fasting', departmentName: 'Biochemistry', columns: [], configured: true, sections: [] } as unknown as ResolvedReportLayout,
};

function render(range: string): string {
  const snap = {
    patient: { displayName: 'Test Patient', age: 40, sex: 'F' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-26T00:00:00Z' },
    type: 'final',
    tests: [{
      testId: 'glu', name: 'Glucose Fasting', department: 'Biochemistry', sampleType: 'Plasma',
      result: { values: { 'Glucose Fasting': { value: '92', flag: 'N', unit: 'mg/dL', range } } },
    }],
  };
  const report = { id: 'r1', createdAt: '2026-09-26T00:00:00Z', data: JSON.stringify(snap) };
  const doc = buildReportPdf({ report, resolvedLayouts: LAYOUTS, template: null } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

/** Every string drawn with Tj / TJ, in order. */
function drawn(pdf: string): string[] {
  return [...pdf.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map(m => m[1]);
}

describe('report PDF — a multi-line reference prints line by line', () => {
  it('each typed line is its own text run, on its own baseline', () => {
    const pdf = render('ZNORMAL 70-99\r\nZPREDIAB 100-125\nZDIABETES 126 up\n\n  ');
    const runs = drawn(pdf).filter(t => /Z(NORMAL|PREDIAB|DIABETES)/.test(t));
    expect(runs).toEqual(['ZNORMAL 70-99', 'ZPREDIAB 100-125', 'ZDIABETES 126 up']);
    // Three distinct baselines (each run is positioned separately).
    const ys = ['ZNORMAL', 'ZPREDIAB', 'ZDIABETES'].map(k => {
      const at = pdf.indexOf(`(${k}`);
      const td = [...pdf.slice(Math.max(0, at - 120), at).matchAll(/([\d.]+) ([\d.]+) Td/g)].at(-1);
      return td ? Number(td[2]) : NaN;
    });
    expect(new Set(ys).size).toBe(3);
    expect(ys[0]).toBeGreaterThan(ys[1]);           // top to bottom
    expect(ys[1]).toBeGreaterThan(ys[2]);
    // No stray carriage return reaches the page.
    expect(pdf).not.toContain('\\r');
  });

  it('the layout-driven results table (grid) prints each line too, {u} filled with the unit', () => {
    const grid = {
      testId: 'glu', testName: 'Glucose Fasting', departmentName: 'Biochemistry', configured: true,
      columns: [
        { id: 'c1', name: 'result', label: 'Result', order: 1, width: 40, type: 'result', locked: false },
        { id: 'c2', name: 'unit', label: 'Unit', order: 2, width: 20, type: 'unit', locked: false },
        { id: 'c3', name: 'range', label: 'Reference range', order: 3, width: 40, type: 'range', locked: false },
      ],
      sections: [{ id: 'g1', type: 'grid', order: 1, isVisible: true, rows: [{
        parameterName: 'Glucose Fasting', isMerged: false, unit: 'mg/dL',
        cells: { result: '92', unit: 'mg/dL', range: 'ZGNORMAL 70-99\nZGPREDIAB 100-125\nZGDIAB 126 {u}' },
      }] }],
    } as unknown as ResolvedReportLayout;
    const snap = {
      patient: { displayName: 'Test Patient', age: 40, sex: 'F' },
      order: { id: 'o1', orderNumber: 'LAB-2609-000002', createdAt: '2026-09-26T00:00:00Z' },
      type: 'final',
      tests: [{ testId: 'glu', name: 'Glucose Fasting', department: 'Biochemistry', sampleType: 'Plasma',
        result: { values: { 'Glucose Fasting': { value: '92', flag: 'N', unit: 'mg/dL' } } } }],
    };
    const doc = buildReportPdf({ report: { id: 'r2', createdAt: '2026-09-26T00:00:00Z', data: JSON.stringify(snap) },
      resolvedLayouts: { glu: grid }, template: null } as never);
    const pdf = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    expect(drawn(pdf).filter(t => t.startsWith('ZG'))).toEqual(['ZGNORMAL 70-99', 'ZGPREDIAB 100-125', 'ZGDIAB 126 mg/dL']);
  });

  it('a one-line reference is unchanged', () => {
    expect(drawn(render('ZONELINE 70-99')).filter(t => t.startsWith('ZONELINE'))).toEqual(['ZONELINE 70-99']);
  });

  it('rangeCellText: CRLF → LF, trailing spaces / blank lines trimmed, inner lines kept', () => {
    expect(rangeCellText('a  \r\nb\r\n\r\n')).toBe('a\nb');
    expect(rangeCellText('a\rb')).toBe('a\nb');
    expect(rangeCellText('a\n\nb')).toBe('a\n\nb');
    expect(rangeCellText(null)).toBe('');
    expect(rangeCellText('70-99 {U}', 'mg/dL')).toBe('70-99 mg/dL');
    expect(rangeCellText('70-99 {u}', '')).toBe('70-99');
  });
});
