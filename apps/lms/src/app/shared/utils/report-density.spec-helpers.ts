import type { ResolvedReportLayout } from '../models/report-layout.model';
import type { ReportPdfInput } from './report-pdf';
import { PNG_1x1, RICH_COLUMNS, richSnapshot, richTemplate } from './report-theme.spec-helpers';

/**
 * Fixtures of the report-density work (Compact + squeeze): ONE department of
 * `n` single-analyte tests, each with a method line, signed by two people -
 * so the page count moves in small, predictable steps as `n` grows. A NON-spec
 * module on purpose (see report-header-legacy.spec-helpers.ts).
 */

const layout = (id: string, name: string, v: string): ResolvedReportLayout => ({
  testId: id, testName: name, departmentName: 'Biochemistry', columns: RICH_COLUMNS, configured: true,
  sections: [{
    id: `${id}-g`, type: 'grid', order: 1, isVisible: true,
    rows: [{ id: `r-${id}`, parameterName: name, title: name, isMerged: false, isBold: false, unit: 'mg/dL',
             cells: { name, result: v, unit: 'mg/dL', range: '10 – 90' } }],
  }],
} as unknown as ResolvedReportLayout);

export function listLayouts(n: number): Record<string, ResolvedReportLayout> {
  const out: Record<string, ResolvedReportLayout> = {};
  for (let i = 0; i < n; i++) out[`a${i}`] = layout(`a${i}`, `Analyte ${i + 1}`, `${20 + (i % 60)}`);
  return out;
}

export function listSnapshot(n: number): Record<string, unknown> {
  const base = richSnapshot() as { patient: unknown; order: unknown };
  return {
    patient: base.patient, order: base.order, type: 'final',
    tests: Array.from({ length: n }, (_, i) => ({
      testId: `a${i}`, name: `Analyte ${i + 1}`, department: 'Biochemistry', sampleType: 'Serum', sampleId: '26001',
      status: 'validated', method: 'Photometry', result: { values: { [`Analyte ${i + 1}`]: { value: `${20 + (i % 60)}`, unit: 'mg/dL', range: '10 – 90', flag: 'N' } } },
    })),
    deptSignatures: [{ department: 'Biochemistry', signatures: [
      { name: 'Arun Kumar', title: 'Lab Technician', regNo: 'TN-LT-4412' }, { name: 'Dr. Meena Iyer', title: 'MD Biochemistry', regNo: 'TNMC 88213' }] }],
  };
}

/** `n` single-analyte tests in one department; `style` is merged into `reportStyle`. */
export function listInput(n: number, style: Record<string, unknown> = {}, patch: Record<string, unknown> = {}): ReportPdfInput {
  const meta = { options: { specimenLine: true }, ...(Object.keys(style).length ? { reportStyle: { v: 1, ...style } } : {}) };
  return {
    report: { id: 'r-list-1', type: 'final', createdAt: '2026-09-29T09:15:00Z', data: JSON.stringify(listSnapshot(n)) },
    template: richTemplate({ metadata: JSON.stringify(meta), ...patch }),
    resolvedLayouts: listLayouts(n),
    imageCache: { '/uploads/logo.png': PNG_1x1 },
    publicBaseUrl: 'https://reports.example.test',
  };
}
