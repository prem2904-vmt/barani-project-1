import { buildReportPdf } from './report-pdf';
import { applyDefaultResultUnitLink } from './result-unit-link';
import type { ReportColumn, ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Owner regression 2026-09-27: "if I unpin the result and unit, it is not
 * unpinning, and the results and unit are not coming under a separate
 * column". The unpinned state is saved as `linkedNext: false` on the Result
 * column; the renderer (and the editor on reload) re-merged the pair because
 * a config with no link anywhere was read as "never configured".
 *
 * Renders REAL PDFs and reads the text back (Standard-14 fonts write literal
 * text into the content stream).
 */
const col = (name: string, label: string, type: string, order: number, extra: Partial<ReportColumn> = {}) =>
  ({ id: 'c-' + name, name, label, order, width: 20, type, locked: false, ...extra }) as ReportColumn;

const UNPINNED = [
  col('name', 'Investigation', 'name', 1),
  col('result', 'Result', 'result', 2, { linkedNext: false }),
  col('unit', 'Unit', 'unit', 3),
  col('range', 'Reference range', 'range', 4),
];
const PINNED = UNPINNED.map(c => (c.type === 'result' ? { ...c, linkedNext: true } : c));
/** Never touched the link (config predates the merge feature). */
const LEGACY = UNPINNED.map(c => { const { linkedNext: _l, ...rest } = c; return rest as ReportColumn; });
/** An older server that coerced the missing flag to false on EVERY column. */
const COERCED = LEGACY.map(c => ({ ...c, linkedNext: false }));

function layout(columns: ReportColumn[], override = false): ResolvedReportLayout {
  return {
    testId: 'glu', testName: 'Glucose Fasting', departmentName: 'Biochemistry', columns,
    ...(override ? { hasColumnOverride: true, departmentColumns: PINNED } : {}),
    sections: [{ id: 'g', type: 'grid', order: 1, isVisible: true, rows: [
      { id: 'r', parameterName: 'glu', title: 'Glucose Fasting', isMerged: false,
        cells: { name: 'Glucose Fasting', result: '132', unit: 'mg/dL', range: '70-110' } },
    ] }],
  } as unknown as ResolvedReportLayout;
}

function render(l: ResolvedReportLayout): string {
  const snap = {
    patient: { displayName: 'Test Patient', age: 45, sex: 'Female' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-27T00:00:00Z' },
    type: 'final',
    tests: [{ testId: 'glu', name: 'Glucose Fasting', department: 'Biochemistry',
      result: { values: { glu: { value: '132', unit: 'mg/dL', range: '70-110' } } } }],
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-27T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: { glu: l },
    template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

/** The Unit header prints as its own cell text `(Unit) Tj`. */
const hasUnitHeader = (pdf: string) => /\(Unit\) Tj/.test(pdf);
const mergedCell = (pdf: string) => pdf.includes('132 mg/dL');

describe('report PDF: pinned vs unpinned Result + Unit', () => {
  it('unpinned (department columns): separate Result and Unit headers, unit in its own column', () => {
    const pdf = render(layout(UNPINNED));
    expect(hasUnitHeader(pdf)).toBe(true);
    expect(pdf).toContain('(Result) Tj');
    expect(mergedCell(pdf)).toBe(false);
    expect(pdf).toContain('(mg/dL) Tj');
  });

  it('unpinned per-test column override: separate Result and Unit columns', () => {
    const pdf = render(layout(UNPINNED, true));
    expect(hasUnitHeader(pdf)).toBe(true);
    expect(mergedCell(pdf)).toBe(false);
  });

  it('pinned: one merged column ("132 mg/dL"), no Unit header', () => {
    const pdf = render(layout(PINNED));
    expect(hasUnitHeader(pdf)).toBe(false);
    expect(mergedCell(pdf)).toBe(true);
  });

  it('a config that never touched the link keeps the default merge', () => {
    const pdf = render(layout(LEGACY));
    expect(hasUnitHeader(pdf)).toBe(false);
    expect(mergedCell(pdf)).toBe(true);
  });

  it('an older server payload (false on every column) keeps the default merge', () => {
    const pdf = render(layout(COERCED));
    expect(hasUnitHeader(pdf)).toBe(false);
    expect(mergedCell(pdf)).toBe(true);
  });
});

describe('applyDefaultResultUnitLink', () => {
  const linked = (cols: ReportColumn[]) => applyDefaultResultUnitLink(cols).find(c => c.type === 'result')?.linkedNext;

  it('keeps an explicit unpin', () => expect(linked(UNPINNED)).toBe(false));
  it('merges a legacy config by default', () => expect(linked(LEGACY)).toBe(true));
  it('merges a server-coerced config by default', () => expect(linked(COERCED)).toBe(true));
  it('leaves a pinned config as is', () => expect(linked(PINNED)).toBe(true));
  it('respects any other link exactly', () => {
    const other = UNPINNED.map(c => (c.type === 'unit' ? { ...c, linkedNext: true } : { ...c, linkedNext: undefined }));
    expect(linked(other)).toBeUndefined();
  });
  it('no merge when Unit is not right after Result', () => {
    const apart = [UNPINNED[0], LEGACY[1], LEGACY[3], LEGACY[2]];
    expect(linked(apart)).toBeUndefined();
  });
});
