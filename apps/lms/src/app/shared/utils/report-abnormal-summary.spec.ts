import { buildReportPdf, type ReportPdfInput } from './report-pdf';
import {
  collectAbnormalResults, isSummaryRow, summaryCount, summaryTestValidated, SUMMARY_TITLE,
  type SummarySourceGroup,
} from './report-abnormal-summary';
import { addBackground, readReportOption, setBackground, writeHeaderLayout, writeReportOption } from './report-header-layout';
import type { ReportTemplate } from '../models/report.model';

/**
 * Consolidated sheet (owner, 2026-09-27): "Summary of abnormal results" as
 * the FIRST page of the report when the lab turns it on (template metadata
 * option `abnormalSummary`). Collector rules + the real PDF pipeline.
 */

// ── Collector ────────────────────────────────────────────────────

describe('abnormal summary — collector', () => {
  const p = (name: string, flag: string, extra: Record<string, unknown> = {}) =>
    ({ kind: 'param' as const, name, result: '5', unit: 'u', range: '1 - 4', flag, abnormal: !!flag, isLow: flag === 'L', ...extra });

  it('takes values the report prints as H / L (criticals arrive as H / L) and abnormal options (A); never N / normal', () => {
    expect(isSummaryRow(p('a', 'H'))).toBe(true);
    expect(isSummaryRow(p('b', 'L'))).toBe(true);
    expect(isSummaryRow(p('c', 'A'))).toBe(true);           // qualitative abnormal option — listed, no letter
    expect(isSummaryRow(p('d', 'N', { abnormal: false }))).toBe(false);
    expect(isSummaryRow(p('e', ''))).toBe(false);           // normal
    // Legacy direction-less critical: the report prints it bold, no letter.
    expect(isSummaryRow(p('f', '', { abnormal: true }))).toBe(true);
    expect(isSummaryRow({ kind: 'note', note: 'x' } as never)).toBe(false);
    expect(isSummaryRow(p('g', 'H', { unvalidated: true }))).toBe(false);
    expect(isSummaryRow(p('h', 'H', { result: '—' }))).toBe(false);
    expect(isSummaryRow(p('i', 'H', { result: '' }))).toBe(false);
  });

  it('validated = validatedAt or a signed-off status; a preview test (no status) counts', () => {
    expect(summaryTestValidated({ status: 'validated' })).toBe(true);
    expect(summaryTestValidated({ status: 'completed' })).toBe(true);
    expect(summaryTestValidated({ status: 'entered', validatedAt: '2026-09-27T00:00:00Z' })).toBe(true);
    expect(summaryTestValidated({ status: 'entered' })).toBe(false);
    expect(summaryTestValidated({ status: 'in_progress' })).toBe(false);
    expect(summaryTestValidated({})).toBe(true);
  });

  it('groups by department (first seen) → test (report order), rows in report order; compact single-analyte', () => {
    const groups: SummarySourceGroup[] = [
      { testName: 'CBC', department: 'Haematology', rows: [p('Hb', 'L'), p('WBC', ''), p('Plt', 'H'), { kind: 'note', note: 'n' }] },
      { testName: 'Glucose', department: 'Biochemistry', rows: [p('Glucose', 'H')] },
      { testName: 'ESR', department: 'Haematology', rows: [p('ESR', 'H')] },
      { testName: 'Urea', department: 'Biochemistry', rows: [p('Urea', '')] },
    ];
    const out = collectAbnormalResults(groups);
    expect(out.map(d => d.department)).toEqual(['Haematology', 'Biochemistry']);
    expect(out[0].tests.map(t => [t.testName, t.compact, t.rows.map(r => r.name)])).toEqual([
      ['CBC', false, ['Hb', 'Plt']],
      ['ESR', true, ['ESR']],
    ]);
    expect(out[1].tests.map(t => t.testName)).toEqual(['Glucose']);   // Urea normal → no entry
    expect(summaryCount(out)).toBe(4);
    expect(out[0].tests[0].rows[0]).toMatchObject({ flag: 'L', isLow: true, unit: 'u', range: '1 - 4' });
  });

  it('never grows a unit onto a qualitative result; nothing abnormal → empty', () => {
    const out = collectAbnormalResults([{ testName: 'Urine', department: 'CP', rows: [p('Colour', 'H', { result: 'Red', unit: 'mg' })] }]);
    expect(out[0].tests[0].rows[0].unit).toBe('');
    expect(collectAbnormalResults([{ testName: 'X', rows: [p('x', '')] }])).toEqual([]);
  });
});

// ── Settings round-trip (template metadata option) ─────────────────

describe('abnormal summary — setting persistence', () => {
  it('writes / reads the option, keeping every other metadata key', () => {
    const bg = setBackground(addBackground(null, '/uploads/t/bg.png', 'b1'), 'b1', { pages: 'first' });
    const tpl = { metadata: writeReportOption({ metadata: writeHeaderLayout(null, bg) }, 'specimenLine', true) };
    expect(readReportOption(tpl, 'abnormalSummary')).toBe(false);
    const on = { metadata: writeReportOption(tpl, 'abnormalSummary', true) };
    expect(readReportOption(on, 'abnormalSummary')).toBe(true);
    expect(readReportOption(on, 'specimenLine')).toBe(true);
    expect(JSON.parse(on.metadata).headerLayout.backgrounds[0].id).toBe('b1');
    // The server stores the metadata string verbatim → the same JSON reads back.
    const reloaded = JSON.parse(JSON.stringify(on));
    expect(readReportOption(reloaded, 'abnormalSummary')).toBe(true);
    const off = { metadata: writeReportOption(on, 'abnormalSummary', false) };
    expect(readReportOption(off, 'abnormalSummary')).toBe(false);
    expect(readReportOption(off, 'specimenLine')).toBe(true);
  });
});

// ── Real PDF pipeline ─────────────────────────────────────────────

const PNG_4x2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGM4UaEBRwzIHACXWgtB+VT+egAAAABJRU5ErkJggg==';
const BG = '/uploads/00000000-0000-0000-0000-000000000001/bg.png';

function tpl(p: Partial<ReportTemplate> = {}, sheet = true): ReportTemplate {
  const t = {
    id: 't', tenantId: 'x', labName: 'Micro World Diagnostics', tagline: 'Accurate | Caring | Instant',
    address: '14 Gandhi Road', phone: '+91 98400 12345', email: 'lab@microworld.in', website: '',
    logoUrl: '', nablAccredited: false, headerPreset: 'drlogy', topAccentBar: true, primaryColor: '#1B3A6B',
    showPatientName: true, showAge: true, showRefDoctor: true, showOrderId: true, showAbhaId: false, showQrCode: false,
    showCollectionDate: true, showReportDate: true, showMethod: false, showInstrument: false, groupByDepartment: false,
    showCriticalFlag: true, showPathologistName: true, showSignature: true, showPoweredBy: false, ...p,
  } as ReportTemplate;
  if (sheet) t.metadata = writeReportOption(t, 'abnormalSummary', true);
  return t;
}

/** A multi-department report: every rule the sheet must honour in one snapshot. */
function snapshot(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    patient: { displayName: 'Sita Raman', age: 37, sex: 'Female' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000042', createdAt: '2026-09-20T04:30:00Z' },
    type: 'final',
    tests: [
      { testId: 'cbc', name: 'Complete Blood Count', department: 'Haematology', status: 'validated',
        hidden: ['Platelets'],
        result: { values: {
          Hemoglobin: { value: '11.4', unit: 'g/dL', range: '12.0 - 16.0', flag: 'L' },
          'WBC Count': { value: '7000', unit: '/cmm', range: '4000 - 11000' },
          Platelets: { value: '520000', unit: '/cmm', range: '150000 - 410000', flag: 'H' },   // hidden row
          MCV: { value: '50', unit: 'fL', range: '80 - 100', flag: 'CL' },                      // critical low
        } } },
      { testId: 'glu', name: 'Glucose Random', department: 'Biochemistry', status: 'validated',
        result: { values: { 'Glucose Random': { value: '600', unit: 'mg/dL', range: '70 - 140', flag: 'CH' } } } },
      { testId: 'cre', name: 'Creatinine', department: 'Biochemistry', status: 'validated',
        result: { values: { Creatinine: { value: '9.1', unit: 'mg/dL', range: '0.6 - 1.2', flag: 'C' } } } },  // legacy C
      { testId: 'ure', name: 'Urea', department: 'Biochemistry', status: 'entered',                          // not validated
        result: { values: { Urea: { value: '90', unit: 'mg/dL', range: '15 - 40', flag: 'H' } } } },
      { testId: 'uri', name: 'Urine Routine', department: 'Clinical Pathology', status: 'validated',
        result: { values: { Colour: { value: 'Red', flag: 'A' } } } },                                       // option abnormal
    ],
    deptSignatures: [{ department: 'Biochemistry', signatures: [{ name: 'Dr. Kavya Signer', title: 'Pathologist' }] }],
    ...over,
  });
}
const NORMAL_ONLY = JSON.stringify({
  patient: { displayName: 'Sita Raman', age: 37, sex: 'Female' },
  order: { id: 'o1', orderNumber: 'LAB-2609-000042', createdAt: '2026-09-20T04:30:00Z' },
  type: 'final',
  tests: [{ testId: 'glu', name: 'Glucose', department: 'Biochemistry', status: 'validated',
    result: { values: { Glucose: { value: '92', unit: 'mg/dL', range: '70 - 140' } } } }],
});

function render(t: ReportTemplate | null, data = snapshot(), extra: Partial<ReportPdfInput> = {}) {
  const doc = buildReportPdf({ report: { id: 'r1', type: 'final', createdAt: '2026-09-20T06:00:00Z', data },
    template: t, imageCache: { [BG]: PNG_4x2 }, ...extra });
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const pages = [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map(m => m[1]).filter(s => /BT/.test(s));
  return { pages, count: doc.getNumberOfPages(), text: (i: number) => drawn(pages[i]) };
}
function drawn(stream: string): string[] {
  return [...stream.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map(m => m[1]);
}
const has = (runs: string[], s: string) => runs.some(r => r.includes(s));
const imageDraws = (stream: string) => (stream.match(/\/I\d+ Do/g) ?? []).length;

describe('abnormal summary — PDF', () => {
  it('enabled: page 1 is the sheet — H / L incl. criticals + abnormal options, report order, no hidden / unvalidated / normal rows, no C', () => {
    const r = render(tpl());
    const p1 = r.text(0);
    expect(has(p1, SUMMARY_TITLE)).toBe(true);
    expect(has(p1, 'Gandhi Road')).toBe(true);                   // letterhead
    expect(has(p1, 'Sita Raman')).toBe(true);                    // patient block as on page 1
    for (const name of ['Hemoglobin', 'MCV', 'Glucose Random', 'Creatinine', 'Colour']) expect(has(p1, name)).toBe(true);
    for (const name of ['Platelets', 'Urea', 'WBC Count']) expect(has(p1, name)).toBe(false);
    // Report order: Haematology (Hb, MCV) → Biochemistry (Glucose, Creatinine).
    const at = (s: string) => p1.findIndex(x => x.includes(s));
    expect(at('HAEMATOLOGY')).toBeLessThan(at('Hemoglobin'));
    expect(at('Hemoglobin')).toBeLessThan(at('MCV'));
    expect(at('MCV')).toBeLessThan(at('BIOCHEMISTRY'));
    expect(at('Glucose Random')).toBeLessThan(at('Creatinine'));
    // Criticals marked like the report: H / L, never C.
    expect(has(p1, '50 fL  L')).toBe(true);
    expect(has(p1, '600 mg/dL  H')).toBe(true);
    expect(has(p1, '9.1 mg/dL  H')).toBe(true);
    expect(p1.some(x => /(^|\s)C$/.test(x.trim()) || /critical/i.test(x))).toBe(false);
    expect(has(p1, '5 results outside the reference range')).toBe(true);
    expect(at('Creatinine')).toBeLessThan(at('Colour'));        // Clinical Pathology after Biochemistry
    // Signatures stay on the department pages, not on the summary.
    expect(has(p1, 'Dr. Kavya Signer')).toBe(false);
    expect(r.pages.slice(1).some(s => has(drawn(s), 'Dr. Kavya Signer'))).toBe(true);
    // The department pages open with the letterhead + patient block again.
    const p2 = r.text(1);
    expect(has(p2, SUMMARY_TITLE)).toBe(false);
    expect(has(p2, 'Gandhi Road')).toBe(true);
    expect(has(p2, 'Sita Raman')).toBe(true);
    expect(has(p2, 'Platelets')).toBe(false);                    // still hidden on the report itself
  });

  it('adds exactly the sheet page(s); page numbers run over the whole document', () => {
    const on = render(tpl());
    const off = render(tpl({}, false));
    expect(on.count).toBe(off.count + 1);
    expect(on.pages.length).toBe(on.count);
    for (let i = 0; i < on.count; i++) expect(has(on.text(i), String(i + 1))).toBe(true);
    // Disclaimer / footer text only on the (new) last page.
    expect(has(on.text(on.count - 1), 'Generated on')).toBe(true);
  });

  it('disabled → no sheet; the report is byte-identical in its page text to a template without the option', () => {
    const off = render(tpl({}, false));
    expect(off.pages.some(s => has(drawn(s), SUMMARY_TITLE))).toBe(false);
    const nullTpl = render(null);
    expect(nullTpl.pages.some(s => has(drawn(s), SUMMARY_TITLE))).toBe(false);
  });

  it('enabled but no abnormal value → no sheet (skip by default)', () => {
    const on = render(tpl(), NORMAL_ONLY);
    const off = render(tpl({}, false), NORMAL_ONLY);
    expect(on.pages.some(s => has(drawn(s), SUMMARY_TITLE))).toBe(false);
    expect(on.count).toBe(off.count);
  });

  it('letterpad print: sheet still page 1, no drawn letterhead on it or on the department page', () => {
    const r = render(tpl(), snapshot(), { blankLetterhead: true });
    expect(has(r.text(0), SUMMARY_TITLE)).toBe(true);
    expect(has(r.text(0), 'Gandhi Road')).toBe(false);
    expect(has(r.text(1), 'Gandhi Road')).toBe(false);
    expect(has(r.text(1), 'Sita Raman')).toBe(true);
  });

  it('background images: first-page art prints on the sheet AND on the department first page; "all" on every page', () => {
    const withBg = (pages: 'first' | 'all') => {
      const t = tpl();
      const meta = JSON.parse(writeHeaderLayout(t, setBackground(addBackground(null, BG, 'b1'), 'b1', { pages })));
      meta.options = { abnormalSummary: true };
      return { ...t, metadata: JSON.stringify(meta) } as ReportTemplate;
    };
    const first = render(withBg('first'));
    expect(first.pages.map(imageDraws)).toEqual(first.pages.map((_, i) => (i <= 1 ? 1 : 0)));
    const all = render(withBg('all'));
    expect(all.pages.every(s => imageDraws(s) === 1)).toBe(true);
    // Without the sheet, first-page art stays on page 1 only (unchanged).
    const t = tpl({}, false);
    const plain = render({ ...t, metadata: writeHeaderLayout(t, setBackground(addBackground(null, BG, 'b1'), 'b1', { pages: 'first' })) } as ReportTemplate);
    expect(plain.pages.map(imageDraws)).toEqual(plain.pages.map((_, i) => (i === 0 ? 1 : 0)));
  });

  it('arrow indicator: no letter on the sheet, the triangle is drawn; indicator none prints plain values', () => {
    const arrow = render(tpl({ flagIndicator: 'arrow' } as Partial<ReportTemplate>));
    expect(has(arrow.text(0), '600 mg/dL  H')).toBe(false);
    expect(has(arrow.text(0), '600 mg/dL')).toBe(true);
    const none = render(tpl({ flagIndicator: 'none' } as Partial<ReportTemplate>));
    expect(has(none.text(0), '600 mg/dL  H')).toBe(false);
    expect(has(none.text(0), SUMMARY_TITLE)).toBe(true);
  });

  it('a long report: the sheet flows onto a second page before the department pages', () => {
    const values: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) values[`Analyte ${i}`] = { value: String(200 + i), unit: 'U/L', range: '10 - 50', flag: 'H' };
    const data = JSON.stringify({ ...JSON.parse(NORMAL_ONLY), tests: [{ testId: 'big', name: 'Big Panel', department: 'Biochemistry', status: 'validated', result: { values } }] });
    const r = render(tpl(), data);
    expect(has(r.text(0), SUMMARY_TITLE)).toBe(true);
    expect(has(r.text(1), 'CONTINUED')).toBe(true);
    const deptStart = r.pages.findIndex((s, i) => i > 0 && has(drawn(s), 'Sita Raman'));
    expect(deptStart).toBeGreaterThanOrEqual(2);
    expect(has(r.text(deptStart), SUMMARY_TITLE)).toBe(false);
  });
});
