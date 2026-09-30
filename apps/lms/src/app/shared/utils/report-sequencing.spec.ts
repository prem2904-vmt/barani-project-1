import { buildReportPdf } from './report-pdf';
import {
  applyReportSequencing, isDefaultSequencing, orderDepartmentsForEditor, orderItemsForEditor,
  readReportSequencing, sortItemsByMode, writeReportSequencing, type ReportSequencing, type SequencedTest,
} from './report-sequencing';
import { hash, silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { richInput, richTemplate, stripVolatile } from './report-theme.spec-helpers';
import { readPdfRuns } from './report-pdf-read.spec-helpers';
import { readReportOption } from './report-header-layout';

/**
 * REPORT SEQUENCING (owner, 2026-09-30): the lab arranges which department
 * prints first, second… and the order of tests inside a department. Default =
 * today's order (the snapshot's, departments first-seen) — untouched labs print
 * byte-for-byte as before.
 */

// ── Fixture: a desk order that is NOT sorted by anything ──────────────────
const T = (id: string, name: string, dept: string, code: string, extra: Partial<SequencedTest> = {}): SequencedTest =>
  ({ testId: id, name, department: dept, departmentCode: dept.slice(0, 3).toUpperCase(), departmentId: 'd-' + dept, code, ...extra });
const member = (id: string, name: string, code: string) =>
  T(id, name, 'Biochemistry', code, { packageTestId: 'lft', packageType: 'profile', profileTestId: 'lft',
    packageName: 'Liver Function Test', profileName: 'Liver Function Test', profileCode: 'BIO050' });
const DESK: SequencedTest[] = [
  T('tsh', 'TSH', 'Biochemistry', 'BIO120'),
  T('cbc', 'Complete Blood Count', 'Haematology', 'HAE001'),
  member('alt', 'SGPT (ALT)', 'BIO052'),
  member('bil', 'Total Bilirubin', 'BIO051'),     // the profile's internal order: ALT before Bilirubin
  T('glu', 'Glucose, Fasting', 'Biochemistry', 'BIO9'),
  T('cs', 'Urine Culture', 'Microbiology', 'MIC010'),
  T('esr', 'ESR', 'Haematology', 'HAE002'),
];
const ids = (ts: SequencedTest[]) => ts.map(t => t.testId);

describe('report sequencing — the ordering', () => {
  it('default (no config / default config) = today: the SAME array, untouched', () => {
    expect(applyReportSequencing(DESK, undefined)).toBe(DESK);
    expect(applyReportSequencing(DESK, {})).toBe(DESK);
    expect(applyReportSequencing(DESK, { mode: 'ordered' })).toBe(DESK);
    expect(isDefaultSequencing(readReportSequencing({ metadata: JSON.stringify({ sequencing: { mode: 'ordered', departments: [] } }) }))).toBe(true);
  });

  it('custom department order; departments not listed (added later) append at the end in first-seen order', () => {
    const s: ReportSequencing = { departments: [{ id: 'd-Microbiology' }, { id: 'd-Haematology' }] };
    expect(ids(applyReportSequencing(DESK, s))).toEqual(['cs', 'cbc', 'esr', 'tsh', 'alt', 'bil', 'glu']);
  });

  it('a department is matched by code, then name, when the snapshot has no department id (older snapshots)', () => {
    const old = DESK.map(t => ({ ...t, departmentId: undefined }));
    expect(ids(applyReportSequencing(old, { departments: [{ id: 'gone', code: 'MIC' }, { id: 'x', name: 'haematology' }] })))
      .toEqual(['cs', 'cbc', 'esr', 'tsh', 'alt', 'bil', 'glu']);
  });

  it('inside a department — as ordered keeps the desk order, grouping the department together', () => {
    expect(ids(applyReportSequencing(DESK, { departments: [{ id: 'd-Biochemistry' }] })))
      .toEqual(['tsh', 'alt', 'bil', 'glu', 'cbc', 'esr', 'cs']);
  });

  it('test number: numeric-aware; a profile sorts by ITS OWN number and prints its members in its internal order', () => {
    const out = applyReportSequencing(DESK, { mode: 'code' });
    // Biochemistry: BIO9 < BIO050 (LFT) < BIO120; the LFT block keeps ALT → Bilirubin.
    expect(ids(out)).toEqual(['glu', 'alt', 'bil', 'tsh', 'cbc', 'esr', 'cs']);
  });

  it('test number on a snapshot without profileCode falls back to the first member number', () => {
    const noCode = DESK.map(t => ({ ...t, profileCode: undefined }));
    // LFT → BIO052 (ALT, its first line): BIO9 < BIO052 < BIO120.
    expect(ids(applyReportSequencing(noCode, { mode: 'code' }))).toEqual(['glu', 'alt', 'bil', 'tsh', 'cbc', 'esr', 'cs']);
  });

  it('alphabetical: a profile by its profile name', () => {
    expect(ids(applyReportSequencing(DESK, { mode: 'alpha' })))
      .toEqual(['glu', 'alt', 'bil', 'tsh', 'cbc', 'esr', 'cs']);   // Glucose < Liver Function Test < TSH
  });

  it('custom within a department: the profile moves as one block; unlisted items follow in the lab-wide mode', () => {
    const s: ReportSequencing = {
      mode: 'alpha',
      depts: { 'd-Biochemistry': { mode: 'custom', items: [{ id: 'tsh' }, { id: 'lft' }] } },
    };
    // TSH, then the LFT block (ALT, Bilirubin), then Glucose (not listed → after, alphabetically).
    expect(ids(applyReportSequencing(DESK, s))).toEqual(['tsh', 'alt', 'bil', 'glu', 'cbc', 'esr', 'cs']);
  });

  it('custom items match by test code when the id differs (a re-cloned catalogue row)', () => {
    const s: ReportSequencing = { depts: { 'd-Biochemistry': { mode: 'custom', items: [{ id: 'old-glu', code: 'bio9' }] } } };
    expect(ids(applyReportSequencing(DESK, s))).toEqual(['glu', 'tsh', 'alt', 'bil', 'cbc', 'esr', 'cs']);
  });

  it("a department's own mode overrides the lab-wide one; other departments keep the lab-wide mode", () => {
    const s: ReportSequencing = { mode: 'code', depts: { 'd-Haematology': { mode: 'alpha', code: 'HAE' } } };
    const out = applyReportSequencing([...DESK, T('abo', 'Blood Group', 'Haematology', 'HAE999')], s);
    expect(ids(out)).toEqual(['glu', 'alt', 'bil', 'tsh', 'abo', 'cbc', 'esr', 'cs']);
    // Older snapshot: the department config is found by its code.
    const old = [...DESK, T('abo', 'Blood Group', 'Haematology', 'HAE999')].map(t => ({ ...t, departmentId: undefined }));
    expect(ids(applyReportSequencing(old, s))).toEqual(['glu', 'alt', 'bil', 'tsh', 'abo', 'cbc', 'esr', 'cs']);
  });

  it('never drops or duplicates a line', () => {
    const s: ReportSequencing = { departments: [{ id: 'd-Haematology' }], mode: 'alpha' };
    const out = applyReportSequencing(DESK, s);
    expect([...ids(out)].sort()).toEqual([...ids(DESK)].sort());
  });
});

describe('report sequencing — stored in the template metadata', () => {
  it('writes under `sequencing`, keeps other metadata keys, and removes itself when back to default', () => {
    const tpl = { metadata: JSON.stringify({ options: { abnormalSummary: true } }) };
    const on = writeReportSequencing(tpl, { departments: [{ id: 'd1', code: 'HAE', name: 'Haematology' }], mode: 'code' });
    expect(JSON.parse(on)).toEqual({ options: { abnormalSummary: true },
      sequencing: { departments: [{ id: 'd1', code: 'HAE', name: 'Haematology' }], mode: 'code' } });
    expect(readReportOption({ metadata: on }, 'abnormalSummary')).toBe(true);
    const off = writeReportSequencing({ metadata: on }, { mode: 'ordered' });
    expect(JSON.parse(off)).toEqual({ options: { abnormalSummary: true } });
  });

  it('cleans junk: unknown modes, entries without identity, custom items only on custom', () => {
    const s = readReportSequencing({ metadata: JSON.stringify({ sequencing: {
      mode: 'random', departments: [null, {}, { id: 'a' }],
      depts: { a: { mode: 'alpha', items: [{ id: 'x' }] }, b: { mode: 'nope' }, c: { mode: 'custom', items: [{ id: 'y' }, 5] } },
    } }) });
    expect(s).toEqual({ departments: [{ id: 'a' }], depts: { a: { mode: 'alpha' }, c: { mode: 'custom', items: [{ id: 'y' }] } } });
    expect(readReportSequencing({ metadata: 'not json' })).toEqual({});
  });
});

describe('report sequencing — the designer lists', () => {
  const depts = [{ id: 'b', code: 'BIO', name: 'Biochemistry' }, { id: 'h', code: 'HAE', name: 'Haematology' }, { id: 'm', code: 'MIC', name: 'Microbiology' }];
  it('saved order first, departments added since at the end, deleted ones dropped', () => {
    expect(orderDepartmentsForEditor(depts, [{ id: 'm' }, { id: 'gone' }, { id: 'b' }]).map(d => d.id)).toEqual(['m', 'b', 'h']);
    expect(orderDepartmentsForEditor(depts, undefined).map(d => d.id)).toEqual(['b', 'h', 'm']);
  });
  it('items: saved order first (id → code), new ones after; mode sort for the seed', () => {
    const items = [{ id: '1', code: 'BIO10', name: 'Urea' }, { id: '2', code: 'BIO2', name: 'Albumin' }, { id: '3', code: 'BIO3', name: 'Calcium' }];
    expect(orderItemsForEditor(items, [{ id: 'x', code: 'bio3' }, { id: '1' }]).map(i => i.id)).toEqual(['3', '1', '2']);
    expect(sortItemsByMode(items, 'code').map(i => i.code)).toEqual(['BIO2', 'BIO3', 'BIO10']);
    expect(sortItemsByMode(items, 'alpha').map(i => i.name)).toEqual(['Albumin', 'Calcium', 'Urea']);
  });
});

// ── The real PDF ──────────────────────────────────────────────────────────
describe('report sequencing — the printed report', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  const withSeq = (seq: ReportSequencing | null, base = richTemplate()) =>
    ({ metadata: writeReportSequencing(base, seq) });
  /** Without the page-1 abnormal sheet: the first band IS the body. */
  const NO_SHEET = richTemplate({ metadata: JSON.stringify({ options: { specimenLine: true } }) });
  const pdfOf = (patch: Record<string, unknown>) =>
    Buffer.from(buildReportPdf(richInput(patch)).output('arraybuffer')).toString('latin1');
  /** Text runs in reading order (page, then top-down). */
  const texts = (pdf: string) => readPdfRuns(pdf).map(r => r.text);
  /** First index of each needle in the run list AFTER `from`. */
  const at = (runs: string[], needle: string, from = 0) => runs.findIndex((t, i) => i >= from && t.includes(needle));

  it('untouched lab: byte-identical to the renderer without Sequencing (and a default config changes nothing)', () => {
    const base = stripVolatile(pdfOf({}));
    expect(hash(stripVolatile(pdfOf(withSeq(null))))).toBe(hash(base));
    expect(hash(stripVolatile(pdfOf(withSeq({ mode: 'ordered', departments: [] }))))).toBe(hash(base));
  });

  it('department order: Microbiology, Haematology, then Biochemistry — bands + culture section follow', () => {
    const runs = texts(pdfOf(withSeq({ departments: [{ id: 'x', name: 'Haematology' }, { id: 'y', name: 'Biochemistry' }] })));
    // Body starts after the abnormal-results sheet (page 1).
    const body = at(runs, 'HAEMATOLOGY');
    expect(body).toBeGreaterThan(-1);
    const bio = at(runs, 'BIOCHEMISTRY', body);
    expect(bio).toBeGreaterThan(body);
    expect(at(runs, 'Complete Blood Count', body)).toBeLessThan(bio);
    // The default order prints Biochemistry first.
    const def = texts(pdfOf({}));
    expect(at(def, 'BIOCHEMISTRY')).toBeLessThan(at(def, 'HAEMATOLOGY'));
  });

  it('abnormal summary follows the same department order as the body', () => {
    const def = texts(pdfOf({}));
    const seq = texts(pdfOf(withSeq({ departments: [{ id: 'x', name: 'Haematology' }] })));
    // Page-1 sheet: the first department heading printed.
    const firstDept = (runs: string[]) => {
      const h = at(runs, 'HAEMATOLOGY'), b = at(runs, 'BIOCHEMISTRY');
      return h >= 0 && (b < 0 || h < b) ? 'HAEMATOLOGY' : 'BIOCHEMISTRY';
    };
    expect(firstDept(def)).toBe('BIOCHEMISTRY');
    expect(firstDept(seq)).toBe('HAEMATOLOGY');
  });

  it('within Biochemistry — alphabetical puts Glucose before the LFT block before TSH; LFT members keep the profile order', () => {
    const runs = texts(pdfOf(withSeq({ mode: 'alpha' }, NO_SHEET)));
    const bio = at(runs, 'BIOCHEMISTRY');
    const glu = at(runs, 'Glucose, Fasting', bio);
    const lft = at(runs, 'LIVER FUNCTION TEST', bio);
    const tsh = at(runs, 'TSH', bio);
    expect(glu).toBeGreaterThan(bio);
    expect(lft).toBeGreaterThan(glu);
    expect(tsh).toBeGreaterThan(lft);
    // Members inside the block: Total Bilirubin → SGPT → SGOT → ALP → Albumin (profile order).
    const m = ['Total Bilirubin', 'SGPT (ALT)', 'SGOT (AST)', 'Alkaline Phosphatase', 'Albumin']
      .map(n => runs.findIndex((t, i) => i > lft && t === n));
    expect(m.every(i => i > lft && i < tsh)).toBe(true);
    expect(m).toEqual([...m].sort((a, b) => a - b));
  });

  it('custom within Biochemistry: TSH, then the LFT block, then Glucose', () => {
    const runs = texts(pdfOf(withSeq({ depts: { anyid: { mode: 'custom', name: 'Biochemistry', items: [{ id: 'tsh' }, { id: 'lft' }, { id: 'glu' }] } } }, NO_SHEET)));
    const bio = at(runs, 'BIOCHEMISTRY');
    const tsh = at(runs, 'TSH', bio);
    const bil = at(runs, 'Total Bilirubin', bio);
    const glu = at(runs, 'Glucose, Fasting', bio);
    expect(tsh).toBeGreaterThan(bio);
    expect(bil).toBeGreaterThan(tsh);
    expect(glu).toBeGreaterThan(bil);
  });
});
