import { buildReportPdfWithLayout } from './report-pdf';
import { writeReportOption } from './report-header-layout';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * The owner's OGTT report (report-ADAE321E.pdf, 2026-10-01): a profile table
 * + a time-series chart below it + the final department's 3-signatory
 * sign-off deferred to below "****End of Report****". Page 1 ended with the
 * chart and the marker, with real free space left, yet the sign-off alone
 * jumped to an almost-empty page 2 — because the marker's own small reserve
 * and the sign-off's separate, later placement check were decided
 * independently. Reproduces that exact shape (profile + chart + deferred
 * sign-off) so the pagination DECISION is tested against the real pipeline,
 * not a mock of it.
 */

const PAGE_H = 841.89;

const col = (name: string, label: string, type: string, width: number) =>
  ({ id: 'c-' + name, name, label, order: 1, width, type, locked: false });
const COLS = [
  col('result', 'Result', 'result', 22), col('unit', 'Unit', 'unit', 14),
  col('range', 'Reference Range', 'range', 22), col('method', 'Methodology', 'method', 14),
];

const OFFSETS = [0, 30, 60, 90, 120];
const NAMES = ['Fasting Blood Sugar', 'OGTT – 30 Minutes', 'OGTT – 60 Minutes', 'OGTT – 90 Minutes', 'OGTT – 120 Minutes'];
const VALUES = [70, 77, 90, 140, 138];
// The owner's actual multi-band reference ranges.
const RANGES = [
  'Normal: 70–99 mg/dL\nPrediabetes: 100–125 mg/dL\nDiabetes: ≥126 mg/dL',
  '40–600',
  'G-OGTT: <180 mg/dL',
  'Normal <140 mg/dL',
  'Normal: <140 mg/dL\nIGT: 140–199 mg/dL\nDiabetes: ≥200 mg/dL\nG-OGTT: <153 mg/dL',
];
const METHODS = ['Hexokinase', 'Hexokinase', 'Hexokinase', 'Hexokinase', 'GOD-POD'];

function layoutFor(id: string, name: string, i: number): ResolvedReportLayout {
  return {
    testId: id, testName: name, departmentName: 'Biochemistry', columns: COLS, configured: true,
    sections: [{ id: 'g', type: 'grid', order: 1, isVisible: true, rows: [
      { id: 'r-' + id, parameterName: name, title: name, isMerged: false,
        cells: { result: String(VALUES[i]), unit: 'mg/dL', range: RANGES[i], method: METHODS[i] } },
    ] }],
  } as unknown as ResolvedReportLayout;
}

/** `fillerWords` pads the order-level technician note — the one knob that
 *  moves the cursor closer to the page floor without changing the table or
 *  chart shape, so a sweep of it crosses the "just barely doesn't fit"
 *  boundary this bug lived on. */
export function build(fillerWords = 0) {
  const tests = OFFSETS.map((off, i) => ({
    testId: 'ogtt' + i, name: NAMES[i], department: 'Biochemistry', sampleType: 'Serum', method: METHODS[i],
    packageTestId: 'ogttprof', profileTestId: 'ogttprof', packageType: 'profile',
    packageName: 'ORAL GLUCOSE TOLERANCE TEST', profileName: 'ORAL GLUCOSE TOLERANCE TEST',
    sampleId: String(26271 + i),
    repeatOffsetMin: off,
    result: { values: { [NAMES[i]]: { value: String(VALUES[i]), flag: 'N', unit: 'mg/dL', range: RANGES[i], low: 70, high: 99 } } },
  }));
  const snap = {
    type: 'final',
    patient: { displayName: 'Zpatient', age: 32, sex: 'Male', mrn: 'AA0023' },
    order: {
      id: 'o1', orderNumber: 'AA0023-TEST', createdAt: '2026-10-01T08:32:00Z',
      collectedAt: '2026-10-01T08:32:00Z', branchName: 'Main',
    },
    tests,
    ...(fillerWords > 0 ? { techNotes: { order: 'note '.repeat(fillerWords).trim() } } : {}),
    deptSignatures: [
      { department: 'Biochemistry', signatures: [
        { name: 'Admin User', title: 'Doctor', regNo: '123434' },
        { name: 'Admin User', title: 'Tech', regNo: '123434' },
        { name: 'Admin User', title: 'Test', regNo: '123434' },
      ] },
    ],
  };
  const layouts: Record<string, ResolvedReportLayout> = Object.fromEntries(
    OFFSETS.map((off, i) => ['ogtt' + i, layoutFor('ogtt' + i, NAMES[i], i)])
  );
  layouts['ogttprof'] = {
    testId: 'ogttprof', testName: 'ORAL GLUCOSE TOLERANCE TEST', departmentName: 'Biochemistry', columns: COLS,
    sections: [{ id: 'c1', type: 'chart', order: 1, isVisible: true, label: 'Chart', trend: { kind: 'line', x: 'series', refBand: true } }],
  } as unknown as ResolvedReportLayout;
  const template = {
    disclaimer: '', footerText: 'Test results should be correlated clinically.',
    groupByDepartment: true, metadata: writeReportOption({ metadata: null } as never, 'specimenLine', true),
  };
  return buildReportPdfWithLayout({
    report: { id: 'r1', type: 'final', createdAt: '2026-10-01T08:34:00Z', data: JSON.stringify(snap) },
    template, resolvedLayouts: layouts,
    practice: { name: 'MICRO WORLD', tagline: 'Accurate | Caring | Instant' },
  } as never);
}

export type Run = { page: number; text: string; x: number; top: number };

/** Every Tj text run with its page and TOP-down y (points), read back from
 *  the content streams (Standard-14 fonts write literal latin1 text). */
export function textRuns(doc: ReturnType<typeof build>['doc']): Run[] {
  const pages = (doc as unknown as { internal: { pages: Array<string[] | null> } }).internal.pages;
  const out: Run[] = [];
  pages.forEach((lines, page) => {
    if (!lines) return;
    let x = 0, y = 0;
    for (const raw of lines) {
      const line = String(raw);
      for (const m of line.matchAll(/(-?[\d.]+) (-?[\d.]+) Td|\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
        if (m[1] !== undefined) { x = Number(m[1]); y = Number(m[2]); continue; }
        out.push({ page, text: m[3], x, top: PAGE_H - y });
      }
    }
  });
  return out;
}

export { PAGE_H };
