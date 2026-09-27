import { of } from 'rxjs';
import { vi } from 'vitest';
import type { ResolvedReportLayout } from '../models/report-layout.model';
import { buildReportPdf } from './report-pdf';
import { resolveReportLayouts } from './report-layouts';
import { ApiLike, prepareReportPdfInput } from './report-render-input';
import { sectionsNeedResultsTable, withResultsTable, withResultsTableFirst } from './results-table';

/**
 * Patient-safety RCA (2026-09-27): a Sentence added to a single test with no
 * saved layout stored ONLY the Sentence; the engine resolved it without a
 * results table and the RESULT vanished from the patient report — "Glucose
 * Fasting 110 mg/dL" gone, only "Fasting of 8–10 hours is required" printed.
 * The render path now adds the default table for a standalone test with
 * values (same rule as mw ReportResultsTable), so preview == PDF.
 */

const SENTENCE = 'Fasting of 8-10 hours is required';
const COLUMNS = [
  { id: 'c-result', name: 'result', label: 'Result', order: 1, width: 40, type: 'result', locked: false },
  { id: 'c-unit', name: 'unit', label: 'Unit', order: 2, width: 20, type: 'unit', locked: false },
  { id: 'c-range', name: 'range', label: 'Reference range', order: 3, width: 40, type: 'range', locked: false },
] as ResolvedReportLayout['columns'];

/** What a pre-fix engine returns for a stored Sentence-only layout. */
const sentenceOnly = (extra: Partial<ResolvedReportLayout> = {}): ResolvedReportLayout => ({
  testId: 'glu', testName: 'Glucose Fasting', departmentName: 'Biochemistry', columns: COLUMNS,
  sections: [{ id: 'p1', type: 'paragraph', isVisible: true, content: SENTENCE }],
  ...extra,
});

const GLUCOSE_TEST = {
  testId: 'glu', name: 'Glucose Fasting', packageTestId: null, packageType: null,
  department: 'Biochemistry', sampleType: 'Fluoride plasma',
  result: { values: { 'Glucose Fasting': { value: 110, unit: 'mg/dL', range: '70-100', flag: 'H' } } },
};
const snapshot = (tests: unknown[]) => ({
  type: 'final',
  patient: { displayName: 'Mr. Test', age: 45, sex: 'M' },
  order: { id: 'o1', orderNumber: 'LAB-2609-000200', createdAt: '2026-09-27T06:11:45Z' },
  tests,
});
const report = (tests: unknown[]) =>
  ({ id: 'r1', type: 'final', createdAt: '2026-09-27T06:17:08Z', data: JSON.stringify(snapshot(tests)) });

const api: ApiLike = { get: vi.fn(() => of(null)) } as unknown as ApiLike;

/** jsPDF page streams — drawn text appears as "(…) Tj". */
function pageText(doc: ReturnType<typeof buildReportPdf>): string {
  return JSON.stringify((doc as unknown as { internal: { pages: unknown[] } }).internal.pages);
}

describe('a Sentence-only stored layout still prints the result (render safety net)', () => {
  it('PDF via the shared recipe (viewer / queue / public link) carries the value AND the Sentence', async () => {
    const preview = vi.fn(async () => sentenceOnly());
    const input = await prepareReportPdfInput(report([GLUCOSE_TEST]), { api, preview, apiUrl: '', trendograms: false });
    const text = pageText(buildReportPdf(input));
    // In the results table like any other test (flag letter included); the
    // Sentence is a merged row under it (report-sentence-row.spec.ts).
    expect(text).toContain('(110 mg/dL  H)');
    expect(text).toContain(SENTENCE);
  });

  it('PDF built straight from resolved layouts (test-editor live preview path) — same', () => {
    const doc = buildReportPdf({ report: report([GLUCOSE_TEST]), template: null, resolvedLayouts: { glu: sentenceOnly() } });
    const text = pageText(doc);
    expect(text).toContain('(110 mg/dL  H)');
    expect(text).toContain(SENTENCE);
  });

  it('resolveReportLayouts adds the table first, from the snapshot values against the layout columns', async () => {
    const layouts = await resolveReportLayouts<ResolvedReportLayout>(async () => sentenceOnly(), [GLUCOSE_TEST]);
    const secs = layouts['glu'].sections;
    expect(secs.map(s => s.type)).toEqual(['grid', 'paragraph']);
    expect(secs[0].rows![0]).toMatchObject({
      parameterName: 'Glucose Fasting', unit: 'mg/dL', flag: 'H',
      cells: { result: '110', unit: 'mg/dL', range: '70-100' },
    });
  });
});

describe('withResultsTable — only where the result would otherwise vanish', () => {
  it('a layout that already has a table is returned untouched (same object)', () => {
    const l = sentenceOnly({ sections: [{ id: 'g', type: 'grid', isVisible: true, rows: [] }] });
    expect(withResultsTable(l, GLUCOSE_TEST)).toBe(l);
  });

  it('no visible Sentence/chart (empty, images only, hidden Sentence) → untouched: the values table prints already', () => {
    for (const sections of [
      [],
      [{ id: 'i', type: 'image', isVisible: true, imageUrls: [] }],
      [{ id: 'p', type: 'paragraph', isVisible: false, content: 'x' }],
    ] as ResolvedReportLayout['sections'][]) {
      const l = sentenceOnly({ sections });
      expect(withResultsTable(l, GLUCOSE_TEST)).toBe(l);
    }
  });

  it('narrative-only (engine: valuesInNarrative) gets no table', () => {
    const l = sentenceOnly({ valuesInNarrative: true });
    expect(withResultsTable(l, GLUCOSE_TEST)).toBe(l);
  });

  it('profile/package members are unchanged — they print in the profile block as today', () => {
    const l = sentenceOnly();
    expect(withResultsTable(l, { ...GLUCOSE_TEST, packageTestId: 'prof' })).toBe(l);
    expect(withResultsTable(l, { ...GLUCOSE_TEST, profileTestId: 'prof' })).toBe(l);
  });

  it('culture reports and tests with no entered values are unchanged', () => {
    const l = sentenceOnly();
    expect(withResultsTable(l, { result: { ...GLUCOSE_TEST.result, microFormat: 'culture_sensitivity' } })).toBe(l);
    expect(withResultsTable(l, { result: { values: {} } })).toBe(l);
    expect(withResultsTable(l, { result: { values: { a: { value: '' } } } })).toBe(l);
    expect(withResultsTable(l, { result: null })).toBe(l);
  });

  it('non-layout shapes pass through', () => {
    const odd = { testId: 'x', values: {} };
    expect(withResultsTable(odd, GLUCOSE_TEST)).toBe(odd);
    expect(withResultsTable(undefined, GLUCOSE_TEST)).toBeUndefined();
  });

  it('a profile\'s own Sentence-only layout (Diabetes Profile) is unchanged in resolveReportLayouts', async () => {
    const member = { ...GLUCOSE_TEST, testId: 'hba1c', packageTestId: 'dp', profileTestId: 'dp', packageType: 'profile' };
    const profileLayout = sentenceOnly({ testId: 'dp' });
    const layouts = await resolveReportLayouts<ResolvedReportLayout>(
      async id => (id === 'dp' ? profileLayout : sentenceOnly({ testId: id })), [member]);
    expect(layouts['dp'].sections.map(s => s.type)).toEqual(['paragraph']);
    expect(layouts['hba1c'].sections.map(s => s.type)).toEqual(['paragraph']);
  });
});

describe('sectionsNeedResultsTable — the stored print order (mirrors mw)', () => {
  const p = (template: string, extra: Record<string, unknown> = {}) => ({ id: 'p', type: 'paragraph', template, ...extra });

  it('Sentence-only print order of a test with values needs the table', () =>
    expect(sectionsNeedResultsTable([p(SENTENCE)], ['Glucose Fasting'])).toBe(true));
  it('empty print order (engine synthesises) / any grid / culture / no values → no', () => {
    expect(sectionsNeedResultsTable([], ['x'])).toBe(false);
    expect(sectionsNeedResultsTable([{ type: 'grid', rows: [] }, p(SENTENCE)], ['x'])).toBe(false);
    expect(sectionsNeedResultsTable([{ type: 'culture_line', source: 'growth' }], ['x'])).toBe(false);
    expect(sectionsNeedResultsTable([p(SENTENCE)], [])).toBe(false);
  });
  it('narrative writing out every value → no; leaving one out → yes; _unit/_range and hidden blocks do not count', () => {
    expect(sectionsNeedResultsTable([p('{{Gross}} / {{ Impression }}')], ['Gross', 'Impression'])).toBe(false);
    expect(sectionsNeedResultsTable([p('{{Gross}}')], ['Gross', 'Impression'])).toBe(true);
    expect(sectionsNeedResultsTable([p('{{glu_unit}} {{glu_range}}')], ['glu'])).toBe(true);
    expect(sectionsNeedResultsTable([p('{{glu}}', { hidden: true })], ['glu'])).toBe(true);
  });
  it('withResultsTableFirst puts an empty grid first', () => {
    expect(withResultsTableFirst([p(SENTENCE)]).map(s => s.type)).toEqual(['grid', 'paragraph']);
  });
});
