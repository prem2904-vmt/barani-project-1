import type { ResolvedReportLayout } from '../models/report-layout.model';
import { buildReportPdf } from './report-pdf';

/**
 * A value's Description (test editor → Printed report → Description column)
 * when the report table has NO Description column (owner 2026-09-28): it
 * prints as ONE full-width row (every column merged) IMMEDIATELY under that
 * value's row, before the next value — like the Sentence row:
 *
 *   P1 | result | unit | range
 *   <D1 spanning every column>
 *   P2 | …                          (no description → no row)
 *   P3 | …
 *   <D3>
 *
 * With a Description column the text prints in that column only.
 * Real PDFs: rows are read back through autotable's row model and the page
 * content streams.
 */

const col = (name: string, label: string, type: string, order: number, width = 25) =>
  ({ id: 'c-' + name, name, label, order, width, type, locked: false });
const NO_DESC = [col('result', 'Result', 'result', 1, 30), col('unit', 'Unit', 'unit', 2, 20),
  col('range', 'Reference range', 'range', 3, 30)] as ResolvedReportLayout['columns'];
const WITH_DESC = [...NO_DESC, col('description', 'Description', 'text', 4)] as ResolvedReportLayout['columns'];

const gridRow = (title: string, value: string, description = '') => ({
  id: 'r-' + title, parameterName: title, title, isMerged: false, isBold: false,
  cells: { result: value, unit: 'mg/dL', range: '70-100', ...(description ? { description } : {}) },
});
const grid = (rows: unknown[]) => ({ id: 'g', type: 'grid', order: 1, isVisible: true, rows });
const layout = (testId: string, testName: string, sections: unknown[], columns = NO_DESC) =>
  ({ testId, testName, departmentName: 'Biochemistry', columns, sections } as unknown as ResolvedReportLayout);

const snapTest = (testId: string, name: string, values: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  testId, name, department: 'Biochemistry', sampleType: 'Serum', packageTestId: null,
  result: { values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, unit: 'mg/dL', range: '70-100' }])) },
  ...extra,
});

function build(tests: unknown[], layouts: Record<string, ResolvedReportLayout>, template: unknown = null) {
  const snap = {
    type: 'final',
    patient: { displayName: 'Mr. Test', age: 45, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000301', createdAt: '2026-09-28T06:11:45Z' },
    tests,
  };
  return buildReportPdf({
    report: { id: 'r1', type: 'final', createdAt: '2026-09-28T06:17:08Z', data: JSON.stringify(snap) },
    template,
    resolvedLayouts: layouts,
  } as never);
}

type ATCell = { raw: unknown; colSpan: number; text: string[]; styles: { fontSize: number; fontStyle: string } };
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
const merged = (t: ATable, i: number) => {
  const cells = Object.values(t.body[i].cells);
  return cells.length === 1 && cells[0].colSpan === t.columns.length;
};

const PPBS_DESC = 'this is test';

describe("a value's description with no Description column prints as a merged row under it", () => {
  it('single test: a full-width row directly after its value row, Sentence style', () => {
    const doc = build(
      [snapTest('ppbs', 'Postprandial Blood Sugar', { 'Postprandial Blood Sugar': '180' })],
      { ppbs: layout('ppbs', 'Postprandial Blood Sugar', [grid([gridRow('Postprandial Blood Sugar', '180', PPBS_DESC)])]) },
    );
    const t = lastTable(doc);
    const v = rowIndexOf(t, '180');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(rowIndexOf(t, PPBS_DESC)).toBe(v + 1);
    expect(merged(t, v + 1)).toBe(true);
    const cell = Object.values(t.body[v + 1].cells)[0];
    expect(cell.styles.fontSize).toBeCloseTo(8.5);
    expect(cell.styles.fontStyle).toBe('normal');
    expect(pageText(doc).split(`(${PPBS_DESC})`).length).toBe(2);
    // Still ONE compact test row — the description does not turn it into a panel.
    expect(pageText(doc)).not.toContain('POSTPRANDIAL BLOOD SUGAR');
  });

  it('scales with the template font scale', () => {
    const doc = build(
      [snapTest('ppbs', 'Postprandial Blood Sugar', { 'Postprandial Blood Sugar': '180' })],
      { ppbs: layout('ppbs', 'Postprandial Blood Sugar', [grid([gridRow('Postprandial Blood Sugar', '180', PPBS_DESC)])]) },
      { id: 't', name: 'T', fontSize: 'lg' },
    );
    const t = lastTable(doc);
    const cell = Object.values(t.body[rowIndexOf(t, PPBS_DESC)].cells)[0];
    expect(cell.styles.fontSize).toBeCloseTo(8.5 * 1.1);
  });

  it('a Description column exists → it prints in that column only, no extra row', () => {
    const doc = build(
      [snapTest('ppbs', 'Postprandial Blood Sugar', { 'Postprandial Blood Sugar': '180' })],
      { ppbs: layout('ppbs', 'Postprandial Blood Sugar', [grid([gridRow('Postprandial Blood Sugar', '180', PPBS_DESC)])], WITH_DESC) },
    );
    const t = lastTable(doc);
    const v = rowIndexOf(t, '180');
    expect(t.body.length).toBe(1);
    expect(rowText(t.body[v])).toContain(PPBS_DESC);
    expect(merged(t, v)).toBe(false);
    expect(pageText(doc).split(`(${PPBS_DESC})`).length).toBe(2);
  });

  it('panel: each description sits under its OWN value — P1, D1, P2, P3, D3', () => {
    const doc = build(
      [snapTest('lft', 'Liver Function Test', { SGOT: '30', SGPT: '35', ALP: '90' }),
       snapTest('cre', 'Creatinine', { Creatinine: '0.9' })],
      {
        lft: layout('lft', 'Liver Function Test', [grid([
          gridRow('SGOT', '30', 'SGOT DESCRIPTION'), gridRow('SGPT', '35'), gridRow('ALP', '90', 'ALP DESCRIPTION')])]),
        cre: layout('cre', 'Creatinine', [grid([gridRow('Creatinine', '0.9')])]),
      },
    );
    const t = lastTable(doc);
    const order = ['SGOT |', 'SGOT DESCRIPTION', 'SGPT |', 'ALP |', 'ALP DESCRIPTION', 'Creatinine']
      .map(n => rowIndexOf(t, n));
    const p1 = order[0];
    expect(order).toEqual([p1, p1 + 1, p1 + 2, p1 + 3, p1 + 4, p1 + 5]);
    expect(merged(t, p1 + 1)).toBe(true);
    expect(merged(t, p1 + 4)).toBe(true);
    expect(merged(t, p1 + 2)).toBe(false);
  });

  it("keeps the admin's line breaks", () => {
    const doc = build(
      [snapTest('ppbs', 'PPBS', { PPBS: '180' })],
      { ppbs: layout('ppbs', 'PPBS', [grid([gridRow('PPBS', '180', 'LINE ONE\r\nLINE TWO')])]) },
    );
    const t = lastTable(doc);
    expect(Object.values(t.body[rowIndexOf(t, 'LINE ONE')].cells)[0].text).toEqual(['LINE ONE', 'LINE TWO']);
  });

  it('a "depends on the result" description that did not match (engine resolved it blank) prints nothing', () => {
    const doc = build(
      [snapTest('ppbs', 'PPBS', { PPBS: '180' })],
      { ppbs: layout('ppbs', 'PPBS', [grid([{ ...gridRow('PPBS', '180'), cells: { result: '180', unit: 'mg/dL', range: '70-100', description: '  ' } }])]) },
    );
    const t = lastTable(doc);
    expect(t.body.length).toBe(1);
  });

  it('the abnormal-results sheet ignores descriptions', () => {
    const doc = build(
      [snapTest('ppbs', 'PPBS', { PPBS: '180' }, {
        result: { values: { PPBS: { value: '180', unit: 'mg/dL', range: '70-100', flag: 'H' } } } })],
      { ppbs: layout('ppbs', 'PPBS', [grid([gridRow('PPBS', '180', PPBS_DESC)])]) },
      { id: 't', name: 'T', metadata: JSON.stringify({ options: { abnormalSummary: true } }) },
    );
    // Printed once — under the value — never repeated on a summary sheet.
    expect(pageText(doc).split(`(${PPBS_DESC})`).length).toBe(2);
  });

  it("profile: a member's description prints under the member's row inside the profile block", () => {
    const member = (id: string, name: string, v: string) => ({
      ...snapTest(id, name, { [name]: v }),
      packageTestId: 'dia', profileTestId: 'dia', packageType: 'profile',
      packageName: 'Diabetes Profile', profileName: 'Diabetes Profile',
    });
    const doc = build(
      [member('fbs', 'Fasting Blood Sugar', '132'), member('ppbs', 'Postprandial Blood Sugar', '180')],
      {
        fbs: layout('fbs', 'Fasting Blood Sugar', [grid([gridRow('Fasting Blood Sugar', '132', 'Raised in diabetes')])]),
        ppbs: layout('ppbs', 'Postprandial Blood Sugar', [grid([gridRow('Postprandial Blood Sugar', '180', PPBS_DESC)])]),
        dia: layout('dia', 'Diabetes Profile', [{ id: 'p', type: 'paragraph', order: 2, isVisible: true, content: 'PROFILE SENTENCE' }]),
      },
    );
    const t = lastTable(doc);
    const f = rowIndexOf(t, '132');
    expect(rowIndexOf(t, 'Raised in diabetes')).toBe(f + 1);
    expect(rowIndexOf(t, '180')).toBe(f + 2);
    expect(rowIndexOf(t, PPBS_DESC)).toBe(f + 3);
    // The profile's own Sentence still closes the block, after the last description.
    expect(rowIndexOf(t, 'PROFILE SENTENCE')).toBe(f + 4);
  });

  it('page breaks: a description never lands at the top of a page away from its value row', () => {
    let hits = 0;
    for (let m = 1; m <= 3; m++) {
      for (let n = 12; n <= 32; n++) {
        const rows = Array.from({ length: n }, (_, i) =>
          gridRow('Filler ' + i, String(100 + i), i === n - 1 ? 'LAST DESCRIPTION' : ''));
        const values = Object.fromEntries(rows.map(r => [r.title, r.cells.result]));
        const spacer = Array.from({ length: m }, (_, i) => 'Spacer line ' + i).join('\n');
        const doc = build(
          [snapTest('sp', 'Spacer', { Spacer: '1' }), snapTest('big', 'Big Panel', values)],
          {
            sp: layout('sp', 'Spacer', [grid([gridRow('Spacer', '1', spacer)])]),
            big: layout('big', 'Big Panel', [grid(rows)]),
          },
        );
        const pages = (doc as unknown as { internal: { pages: unknown[] } }).internal.pages;
        const pageOf = (needle: string) => pages.findIndex(p => JSON.stringify(p ?? '').includes(`(${needle})`));
        const anchor = pageOf('Filler ' + (n - 1));
        expect({ m, n, samePage: pageOf('LAST DESCRIPTION') === anchor }).toEqual({ m, n, samePage: true });
        if (anchor > pageOf('Filler ' + (n - 2))) hits++;
      }
    }
    expect(hits).toBeGreaterThan(0);
  });
});
