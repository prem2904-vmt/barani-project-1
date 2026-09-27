import type { ResolvedReportLayout } from '../models/report-layout.model';
import { buildReportPdf } from './report-pdf';

/**
 * A test's Sentence (paragraph block) prints INSIDE the results table (owner,
 * 2026-09-28): one full-width row — every column merged — directly after the
 * test's rows (or before them, when the admin placed the Sentence above the
 * table), the same way the "Method:" line sits under a panel band. A profile's
 * own Sentences close the profile's rows, before the next test. A renamed
 * block ("Interpretation") prints its name in bold at the start of the row.
 *
 * Real PDFs: the results table is read back through autotable's own row
 * model (`lastAutoTable.body`) and the page content streams.
 */

const COLUMNS = [
  { id: 'c-result', name: 'result', label: 'Result', order: 1, width: 30, type: 'result', locked: false },
  { id: 'c-unit', name: 'unit', label: 'Unit', order: 2, width: 20, type: 'unit', locked: false },
  { id: 'c-range', name: 'range', label: 'Reference range', order: 3, width: 30, type: 'range', locked: false },
] as ResolvedReportLayout['columns'];

const SENTENCE = 'Fasting of 8-10 hours is required before collection';

const gridRow = (id: string, title: string, value: string) => ({
  id: 'r-' + id, parameterName: title, title, isMerged: false, isBold: false,
  cells: { result: value, unit: 'mg/dL', range: '70-100' },
});
const grid = (rows: unknown[], order = 1) => ({ id: 'g', type: 'grid', order, isVisible: true, rows });
const para = (content: string, extra: Record<string, unknown> = {}) =>
  ({ id: 'p-' + content.slice(0, 6), type: 'paragraph', isVisible: true, content, ...extra });

const layout = (testId: string, testName: string, sections: unknown[], extra: Record<string, unknown> = {}) =>
  ({ testId, testName, departmentName: 'Biochemistry', columns: COLUMNS, sections, ...extra } as unknown as ResolvedReportLayout);

const snapTest = (testId: string, name: string, values: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  testId, name, department: 'Biochemistry', sampleType: 'Serum', packageTestId: null,
  result: { values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, unit: 'mg/dL', range: '70-100' }])) },
  ...extra,
});

function build(tests: unknown[], layouts: Record<string, ResolvedReportLayout>) {
  const snap = {
    type: 'final',
    patient: { displayName: 'Mr. Test', age: 45, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000300', createdAt: '2026-09-28T06:11:45Z' },
    tests,
  };
  return buildReportPdf({
    report: { id: 'r1', type: 'final', createdAt: '2026-09-28T06:17:08Z', data: JSON.stringify(snap) },
    template: null,
    resolvedLayouts: layouts,
  } as never);
}

type ATCell = { raw: unknown; colSpan: number; text: string[] };
type ATRow = { cells: Record<number, ATCell> };
type ATable = { body: ATRow[]; columns: unknown[] };
const lastTable = (doc: ReturnType<typeof build>): ATable =>
  (doc as unknown as { lastAutoTable: ATable }).lastAutoTable;
const rawText = (c: ATCell | undefined): string => {
  const r = c?.raw as { content?: unknown } | string | undefined;
  return typeof r === 'object' && r ? String(r.content ?? '') : String(r ?? '');
};
const rowText = (row: ATRow) => Object.values(row.cells).map(rawText).join(' | ');
const rowIndexOf = (t: ATable, needle: string) => t.body.findIndex(r => rowText(r).includes(needle));
const pageText = (doc: ReturnType<typeof build>) =>
  JSON.stringify((doc as unknown as { internal: { pages: unknown[] } }).internal.pages);

describe("a test's Sentence prints as a merged row inside the results table", () => {
  it('single test: the Sentence is a full-width row right after the test row', () => {
    const doc = build(
      [snapTest('glu', 'Glucose Fasting', { 'Glucose Fasting': '110' })],
      { glu: layout('glu', 'Glucose Fasting', [grid([gridRow('glu', 'Glucose Fasting', '110')]), para(SENTENCE)]) },
    );
    const t = lastTable(doc);
    const valueRow = rowIndexOf(t, '110');
    const sRow = rowIndexOf(t, SENTENCE);
    expect(valueRow).toBeGreaterThanOrEqual(0);
    expect(sRow).toBe(valueRow + 1);
    const cells = Object.values(t.body[sRow].cells);
    expect(cells.length).toBe(1);
    expect(cells[0].colSpan).toBe(t.columns.length);
    // No separate narrative block: the centred uppercase test heading is gone.
    expect(pageText(doc)).not.toContain('GLUCOSE FASTING');
    // The text itself reaches the page once.
    expect(pageText(doc).split(SENTENCE).length).toBe(2);
  });

  it('a Sentence placed BEFORE the table prints before the test rows', () => {
    const doc = build(
      [snapTest('glu', 'Glucose Fasting', { 'Glucose Fasting': '110' })],
      { glu: layout('glu', 'Glucose Fasting', [para(SENTENCE), grid([gridRow('glu', 'Glucose Fasting', '110')], 2)]) },
    );
    const t = lastTable(doc);
    expect(rowIndexOf(t, SENTENCE)).toBeGreaterThanOrEqual(0);
    expect(rowIndexOf(t, SENTENCE)).toBeLessThan(rowIndexOf(t, '110'));
  });

  it('panel: the Sentence follows the LAST parameter row, before the next test', () => {
    const doc = build(
      [
        snapTest('lft', 'Liver Function Test', { SGOT: '30', SGPT: '35' }),
        snapTest('cre', 'Creatinine', { Creatinine: '0.9' }),
      ],
      {
        lft: layout('lft', 'Liver Function Test', [grid([gridRow('a', 'SGOT', '30'), gridRow('b', 'SGPT', '35')]), para(SENTENCE)]),
        cre: layout('cre', 'Creatinine', [grid([gridRow('c', 'Creatinine', '0.9')])]),
      },
    );
    const t = lastTable(doc);
    const s = rowIndexOf(t, SENTENCE);
    expect(s).toBe(rowIndexOf(t, 'SGPT') + 1);
    expect(s).toBeLessThan(rowIndexOf(t, 'Creatinine'));
  });

  it("a profile's Sentence closes the profile's rows, before the next test", () => {
    const member = (id: string, name: string, v: string) => ({
      ...snapTest(id, name, { [name]: v }),
      packageTestId: 'dia', profileTestId: 'dia', packageType: 'profile',
      packageName: 'Diabetes Profile', profileName: 'Diabetes Profile',
    });
    const doc = build(
      [member('fbs', 'Fasting Blood Sugar', '132'), member('ppbs', 'Postprandial Blood Sugar', '180'),
       snapTest('cre', 'Creatinine', { Creatinine: '0.9' })],
      {
        fbs: layout('fbs', 'Fasting Blood Sugar', [grid([gridRow('f', 'Fasting Blood Sugar', '132')]), para('MEMBER SENTENCE')]),
        ppbs: layout('ppbs', 'Postprandial Blood Sugar', [grid([gridRow('p', 'Postprandial Blood Sugar', '180')])]),
        dia: layout('dia', 'Diabetes Profile', [para(SENTENCE)]),
        cre: layout('cre', 'Creatinine', [grid([gridRow('c', 'Creatinine', '0.9')])]),
      },
    );
    const t = lastTable(doc);
    const s = rowIndexOf(t, SENTENCE);
    expect(s).toBe(rowIndexOf(t, 'Postprandial Blood Sugar') + 1);
    expect(s).toBeLessThan(rowIndexOf(t, 'Creatinine'));
    expect(Object.values(t.body[s].cells)[0].colSpan).toBe(t.columns.length);
    // Notes follow what was ORDERED: the member's own Sentence stays off.
    expect(pageText(doc)).not.toContain('MEMBER SENTENCE');
    // The profile's Sentence prints once — no second narrative block after the table.
    expect(pageText(doc).split(SENTENCE).length).toBe(2);
  });

  it('a conditional Sentence whose condition is not met (engine: dropped / invisible) and a hidden one print nothing', () => {
    const doc = build(
      [snapTest('glu', 'Glucose Fasting', { 'Glucose Fasting': '110' })],
      { glu: layout('glu', 'Glucose Fasting', [
        grid([gridRow('glu', 'Glucose Fasting', '110')]),
        para('NOT MET SENTENCE', { isVisible: false }),
        para('   '),
      ]) },
    );
    const t = lastTable(doc);
    expect(pageText(doc)).not.toContain('NOT MET SENTENCE');
    // Nothing but the test row (no empty merged row, no narrative block).
    expect(t.body.length).toBe(1);
    expect(pageText(doc)).not.toContain('GLUCOSE FASTING');
  });

  it('a renamed block prints its name in bold at the start of the row', () => {
    const doc = build(
      [snapTest('glu', 'Glucose Fasting', { 'Glucose Fasting': '110' })],
      { glu: layout('glu', 'Glucose Fasting', [
        grid([gridRow('glu', 'Glucose Fasting', '110')]),
        para(SENTENCE, { label: 'Interpretation' }),
      ]) },
    );
    const text = pageText(doc);
    const at = text.indexOf('(Interpretation:)');
    expect(at).toBeGreaterThan(0);
    const bold = (doc as unknown as { internal: { getFont(n: string, s: string): { id: string } } })
      .internal.getFont('helvetica', 'bold').id;
    const normal = (doc as unknown as { internal: { getFont(n: string, s: string): { id: string } } })
      .internal.getFont('helvetica', 'normal').id;
    const lastFontBefore = (idx: number) => [...text.slice(0, idx).matchAll(/\/(F\d+) [\d.]+ Tf/g)].pop()?.[1];
    expect(lastFontBefore(at)).toBe(bold);
    const s = text.indexOf(SENTENCE);
    expect(s).toBeGreaterThan(at);
    expect(lastFontBefore(s)).toBe(normal);
    // Still a merged row of the results table.
    const t = lastTable(doc);
    expect(rowIndexOf(t, SENTENCE)).toBe(rowIndexOf(t, '110') + 1);
  });

  it("the default block name ('Sentence') is not printed as a label", () => {
    const doc = build(
      [snapTest('glu', 'Glucose Fasting', { 'Glucose Fasting': '110' })],
      { glu: layout('glu', 'Glucose Fasting', [grid([gridRow('glu', 'Glucose Fasting', '110')]), para(SENTENCE, { label: 'Sentence' })]) },
    );
    expect(pageText(doc)).not.toContain('Sentence:');
    expect(pageText(doc)).toContain(SENTENCE);
  });

  it("keeps the admin's line breaks", () => {
    const doc = build(
      [snapTest('glu', 'Glucose Fasting', { 'Glucose Fasting': '110' })],
      { glu: layout('glu', 'Glucose Fasting', [grid([gridRow('glu', 'Glucose Fasting', '110')]), para('LINE ONE\nLINE TWO')]) },
    );
    const t = lastTable(doc);
    const cell = Object.values(t.body[rowIndexOf(t, 'LINE ONE')].cells)[0];
    expect(cell.text).toEqual(['LINE ONE', 'LINE TWO']);
  });

  it('a narrative-only test (values written in the Sentences) still renders as its own narrative block', () => {
    const doc = build(
      [snapTest('hp', 'Histopathology', { Gross: 'Grey-white tissue' })],
      { hp: layout('hp', 'Histopathology', [para('Gross: Grey-white tissue')], { valuesInNarrative: true }) },
    );
    const text = pageText(doc);
    expect(text).toContain('HISTOPATHOLOGY');
    expect(text).toContain('Gross: Grey-white tissue');
  });

  it('a test carrying a chart keeps its narrative block (charts cannot live in the table)', () => {
    const doc = build(
      [snapTest('glu', 'Glucose Fasting', { 'Glucose Fasting': '110' })],
      { glu: layout('glu', 'Glucose Fasting', [
        grid([gridRow('glu', 'Glucose Fasting', '110')]),
        para(SENTENCE),
        { id: 'ch', type: 'chart', isVisible: true, chart: { parameter: 'Glucose Fasting', min: 0, max: 200, value: 110, zones: [] } },
      ]) },
    );
    expect(pageText(doc)).toContain('GLUCOSE FASTING');
  });

  it('page breaks: the Sentence never lands alone at the top of a page away from its test', () => {
    // A spacer test with 1..3 Sentence lines shifts where the page break falls
    // (a line is ~half a result row), so the sweep hits the tight spots.
    let hits = 0;
    for (let m = 1; m <= 3; m++) {
      for (let n = 12; n <= 30; n++) {
        const rows = Array.from({ length: n }, (_, i) => gridRow('x' + i, 'Filler ' + i, String(100 + i)));
        const values = Object.fromEntries(rows.map(r => [r.title, r.cells.result]));
        const spacer = Array.from({ length: m }, (_, i) => 'Spacer line ' + i).join('\n');
        const doc = build(
          [snapTest('sp', 'Spacer', { Spacer: '1' }), snapTest('big', 'Big Panel', values)],
          {
            sp: layout('sp', 'Spacer', [grid([gridRow('sp', 'Spacer', '1')]), para(spacer)]),
            big: layout('big', 'Big Panel', [grid(rows), para(SENTENCE)]),
          },
        );
        // Which page each piece of text was drawn on (jsPDF page streams).
        const pages = (doc as unknown as { internal: { pages: unknown[] } }).internal.pages;
        const pageOf = (needle: string) => pages.findIndex(p => JSON.stringify(p ?? '').includes(`(${needle})`));
        const anchor = pageOf('Filler ' + (n - 1));
        const sentence = pageOf(SENTENCE);
        expect({ m, n, samePage: sentence === anchor }).toEqual({ m, n, samePage: true });
        // Renders where the last row was carried over WITH its Sentence.
        if (anchor > pageOf('Filler ' + (n - 2))) hits++;
      }
    }
    // The sweep really exercised the page-bottom case.
    expect(hits).toBeGreaterThan(0);
  });
});
