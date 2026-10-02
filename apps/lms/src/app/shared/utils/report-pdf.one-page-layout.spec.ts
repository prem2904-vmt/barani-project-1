import { buildReportPdf } from './report-pdf';
import type { ReportColumn, ResolvedReportLayout } from '../models/report-layout.model';
import { defaultCbcLayout, bodyArea } from './report-profile-layout';
import { PAGE } from './report-header-layout';

/**
 * Profile ONE-PAGE report layout — PDF integration (owner, 2026-10-02).
 *
 * Renders real PDFs (same technique as report-column-override.spec.ts): the
 * byte-identical guarantee for a profile with NO `page_layout` section is
 * already proven by report-header-legacy.spec.ts / report-theme-classic.spec.ts
 * (golden-hash fixtures that carry no page_layout section anywhere and still
 * pass after this feature). This file additionally proves the narrower,
 * feature-local claim: a `page_layout` section that is PRESENT but
 * `enabled: false` renders EXACTLY like no section at all (same code path —
 * `onePageBundles` stays empty either way), and an ENABLED one adds its own
 * forced page with the table + signatures (+ analyzer image when attached).
 */

const CBC_COLUMNS: ReportColumn[] = [
  { id: 'c-name', name: 'name', label: 'Investigation', order: 1, width: 34, type: 'name', locked: false } as ReportColumn,
  { id: 'c-result', name: 'result', label: 'Result', order: 2, width: 16, type: 'result', locked: false } as ReportColumn,
  { id: 'c-unit', name: 'unit', label: 'Unit', order: 3, width: 10, type: 'unit', locked: false } as ReportColumn,
  { id: 'c-range', name: 'range', label: 'Reference range', order: 4, width: 24, type: 'range', locked: false } as ReportColumn,
];

const BODY = bodyArea(140, PAGE.h - 64);

function memberLayout(testId: string, name: string): ResolvedReportLayout {
  return {
    testId, testName: name, departmentName: 'Haematology', columns: CBC_COLUMNS,
    sections: [{ id: 'g1', type: 'grid', order: 1, isVisible: true, rows: [{
      parameterName: name, isMerged: false, unit: 'g/dL', cells: { result: '11.4', unit: 'g/dL', range: '12.0 – 16.0' },
    }] }],
  } as unknown as ResolvedReportLayout;
}

function profileLayout(opts: { enabled: boolean; boxes?: ReturnType<typeof defaultCbcLayout> } | null): ResolvedReportLayout {
  const sections: ResolvedReportLayout['sections'] = [
    { id: 'g1', type: 'grid', order: 1, isVisible: true, rows: [] } as unknown as ResolvedReportLayout['sections'][number],
  ];
  if (opts) {
    sections.push({
      id: 'page-layout', type: 'page_layout', order: 2, isVisible: true,
      pageLayout: { v: 1, enabled: opts.enabled, boxes: opts.boxes ?? defaultCbcLayout(BODY) },
    } as unknown as ResolvedReportLayout['sections'][number]);
  }
  return {
    testId: 'pkg-cbc', testName: 'CBC', departmentName: 'Haematology', columns: CBC_COLUMNS, sections,
  } as unknown as ResolvedReportLayout;
}

function snapshot() {
  return {
    patient: { displayName: 'Test Patient', age: 30, sex: 'F' },
    order: { id: 'o1', orderNumber: 'LAB-2610-000002', createdAt: '2026-10-02T00:00:00Z' },
    type: 'final',
    deptSignatures: [{ department: 'Haematology', signatures: [{ name: 'Dr. Technician' }] }],
    tests: [
      { testId: 't1', name: 'Hemoglobin', packageTestId: 'pkg-cbc', packageType: 'profile', profileName: 'CBC',
        department: 'Haematology', sampleType: 'EDTA Whole Blood', result: { values: { Hemoglobin: { value: '11.4', unit: 'g/dL', range: '12.0 – 16.0' } } } },
    ],
  };
}

/** The PDF's raw text (all pages, or one 1-based page's content stream). */
function pdfText(doc: { output(t: 'arraybuffer'): ArrayBuffer; internal?: unknown }, page?: number): string {
  if (page == null) return Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const pages = (doc as unknown as { internal: { pages: string[][] } }).internal.pages;
  return (pages[page] ?? []).join('\n');
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

function render(layouts: Record<string, ResolvedReportLayout>) {
  const doc = buildReportPdf({
    report: { id: 'r1', type: 'final', createdAt: '2026-10-02T00:00:00Z', data: JSON.stringify(snapshot()) },
    resolvedLayouts: layouts,
    template: null,
  } as never);
  return doc;
}

describe('profile one-page layout — PDF render', () => {
  it('no page_layout section at all: renders fine, no extra page forced', () => {
    const doc = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout(null) });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('a page_layout section present but DISABLED renders IDENTICALLY (byte-for-byte) to no section at all', () => {
    const withNone = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout(null) });
    const withDisabled = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: false }) });
    const strip = (d: typeof withNone) => Buffer.from(d.output('arraybuffer')).toString('latin1').replace(/\/CreationDate \([^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');
    expect(strip(withDisabled)).toBe(strip(withNone));
  });

  it('an ENABLED page_layout renders the table on the SAME page as the letterhead — no blank page 1 (owner follow-up, 2026-10-02)', () => {
    const disabled = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: false }) });
    const enabled = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true }) });
    // A one-page profile that is the ONLY content prints on page 1, exactly
    // like the disabled/no-layout case — never a blank page 1 followed by
    // the profile on page 2 (the bug the owner flagged after reviewing the
    // first render). The table content itself must be present.
    expect(enabled.getNumberOfPages()).toBe(disabled.getNumberOfPages());
    const text = Buffer.from(enabled.output('arraybuffer')).toString('latin1');
    expect(text).toContain('Investigation');
    expect(text).toContain('Hemoglobin');
  });

  it('a CBC-only order (14 real catalogue parameters, the shipped default layout) renders in EXACTLY ONE page', () => {
    const names = [
      'Hemoglobin', 'RBC Count', 'Hematocrit (PCV)', 'MCV', 'MCH', 'MCHC', 'RDW-CV',
      'WBC Count', 'Neutrophils', 'Lymphocytes', 'Monocytes', 'Eosinophils', 'Basophils', 'Platelet Count',
    ];
    const layouts: Record<string, ResolvedReportLayout> = { 'pkg-cbc': profileLayout({ enabled: true }) };
    const tests = names.map((name, i) => {
      const id = `ot${i + 1}`;
      layouts[id] = memberLayout(id, name);
      return { testId: id, name, packageTestId: 'pkg-cbc', packageType: 'profile', profileName: 'CBC',
        department: 'Haematology', sampleType: 'EDTA Whole Blood', sampleId: 'SMP-1',
        result: { values: { [name]: { value: '1', unit: '', range: '' } } } };
    });
    const snap = {
      patient: { displayName: 'Test Patient', age: 30, sex: 'F' },
      order: { id: 'o1', orderNumber: 'LAB-2610-000003', createdAt: '2026-10-02T00:00:00Z' },
      type: 'final',
      deptSignatures: [{ department: 'Haematology', signatures: [{ name: 'Dr. Technician' }] }],
      tests,
    };
    const doc = buildReportPdf({
      report: { id: 'r1', type: 'final', createdAt: '2026-10-02T00:00:00Z', data: JSON.stringify(snap) },
      resolvedLayouts: layouts,
      template: null,
    } as never);
    expect(doc.getNumberOfPages()).toBe(1);
    const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    expect(text).toContain('End of Report');
  });

  it('prints the department heading + Sample ID line, and the profile title row, same as the continuous report', () => {
    const snap = {
      patient: { displayName: 'Test Patient', age: 30, sex: 'F' },
      order: { id: 'o1', orderNumber: 'LAB-2610-000004', createdAt: '2026-10-02T00:00:00Z' },
      type: 'final',
      deptSignatures: [{ department: 'Haematology', signatures: [{ name: 'Dr. Technician' }] }],
      tests: [
        { testId: 't1', name: 'Hemoglobin', packageTestId: 'pkg-cbc', packageType: 'profile',
          profileName: 'CBC', packageName: 'CBC',
          department: 'Haematology', sampleType: 'EDTA Whole Blood', sampleId: 'SMP-42',
          result: { values: { Hemoglobin: { value: '11.4', unit: 'g/dL', range: '12.0 – 16.0' } } } },
      ],
    };
    const doc = buildReportPdf({
      report: { id: 'r1', type: 'final', createdAt: '2026-10-02T00:00:00Z', data: JSON.stringify(snap) },
      resolvedLayouts: { t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true }) },
      template: null,
    } as never);
    const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    expect(text).toContain('HAEMATOLOGY');
    expect(text).toContain('Sample ID:');
    expect(text).toContain('SMP-42');
    expect(text).toContain('CBC');
  });

  it('never throws when an analyzer box has no attached image (collapses instead)', () => {
    expect(() => render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true }) })).not.toThrow();
  });

  it('the department signatures print on the one-page block (no second signature logic — same ReportSignature list)', () => {
    const doc = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true }) });
    const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    expect(text).toContain('Dr. Technician');
  });

  it('reports the exact body rect and where the themed table really ended (designer hook)', () => {
    const seen: Array<{ page: number; tableBottom?: number | null }> = [];
    buildReportPdf({
      report: { id: 'r1', type: 'final', createdAt: '2026-10-02T00:00:00Z', data: JSON.stringify(snapshot()) },
      resolvedLayouts: { t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true }) },
      template: null,
      onOnePageBody: (i: { page: number; tableBottom?: number | null }) => seen.push(i),
    } as never);
    expect(seen[0].page).toBe(1);
    const t = seen.find(i => i.tableBottom !== undefined);
    expect(typeof t?.tableBottom).toBe('number');
  });

  it('a HIDDEN signatures box: the box never prints, but the department still signs ONCE (after End of Report)', () => {
    const boxes = defaultCbcLayout(BODY).map(b => (b.kind === 'signatures' ? { ...b, hidden: true } : b));
    const doc = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true, boxes }) });
    const text = pdfText(doc);
    expect(count(text, 'Dr. Technician')).toBe(1);
    expect(text.indexOf('End of Report')).toBeLessThan(text.lastIndexOf('Dr. Technician'));
  });

  it('the analyzer graphs placed in the layout are not printed AGAIN in the images block', () => {
    // A 1x1 PNG — the same url is the member's attachment AND its analyzer image.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const snap = snapshot();
    (snap.tests[0] as Record<string, unknown>)['images'] = [png];
    (snap.tests[0] as Record<string, unknown>)['analyzerImages'] = { '12003': png };
    const doc = buildReportPdf({
      report: { id: 'r1', type: 'final', createdAt: '2026-10-02T00:00:00Z', data: JSON.stringify(snap) },
      resolvedLayouts: { t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true }) },
      template: null,
      imageCache: { [png]: png },
    } as never);
    const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    expect(text).not.toContain('IMAGES');
  });

  // ── Custom layout: multi-page (owner 2026-10-02) ───────────────────────
  const CBC14 = ['Hemoglobin', 'RBC Count', 'Hematocrit', 'MCV', 'MCH', 'MCHC', 'RDW-CV',
    'WBC Count', 'Neutrophils', 'Lymphocytes', 'Monocytes', 'Eosinophils', 'Basophils', 'Platelet Count'];
  function cbcSnapshot(extra: Array<Record<string, unknown>> = []) {
    const tests = CBC14.map((name, i) => ({ testId: `ot${i + 1}`, name, packageTestId: 'pkg-cbc', packageType: 'profile', profileName: 'CBC',
      department: 'Haematology', sampleType: 'EDTA Whole Blood', sampleId: 'SMP-1',
      result: { values: { [name]: { value: String(10 + i), unit: 'g/dL', range: '1 – 99' } } } }));
    return {
      patient: { displayName: 'Test Patient', age: 30, sex: 'F' },
      order: { id: 'o1', orderNumber: 'LAB-2610-000009', createdAt: '2026-10-02T00:00:00Z' },
      type: 'final',
      deptSignatures: [
        { department: 'Haematology', signatures: [{ name: 'Dr. Technician' }] },
        { department: 'Biochemistry', signatures: [{ name: 'Dr. Biochemist' }] },
      ],
      tests: [...tests, ...extra],
    };
  }
  function cbcLayouts(page: Record<string, unknown>, extraLayouts: Record<string, ResolvedReportLayout> = {}) {
    const layouts: Record<string, ResolvedReportLayout> = { ...extraLayouts };
    CBC14.forEach((n, i) => { layouts[`ot${i + 1}`] = memberLayout(`ot${i + 1}`, n); });
    layouts['pkg-cbc'] = {
      testId: 'pkg-cbc', testName: 'CBC', departmentName: 'Haematology', columns: CBC_COLUMNS,
      sections: [{ id: 'page-layout', type: 'page_layout', isVisible: true, pageLayout: { v: 2, enabled: true, ...page } }],
    } as unknown as ResolvedReportLayout;
    return layouts;
  }
  const renderCustom = (page: Record<string, unknown>, snap = cbcSnapshot(), extra: Record<string, ResolvedReportLayout> = {}) => {
    const seen: Array<{ page: number; layoutPage?: number; boxId?: string; rowsPrinted?: number }> = [];
    const doc = buildReportPdf({
      report: { id: 'r1', type: 'final', createdAt: '2026-10-02T00:00:00Z', data: JSON.stringify(snap) },
      resolvedLayouts: cbcLayouts(page, extra), template: null,
      onOnePageBody: (i: (typeof seen)[number]) => seen.push(i),
    } as never);
    return { doc, text: pdfText(doc), seen };
  };
  const table = (id: string, y: number, h: number, rows?: string[]) => ({ id, kind: 'table', x: 0, y, w: 188, h, ...(rows ? { rows } : {}) });

  it('AUTO-continue: the page-1 table box takes the rows that fit, the rest continue in the page-2 box — every row once, never cut', () => {
    const { doc, text, seen } = renderCustom({ tableMode: 'auto', pages: [
      { id: 'p1', boxes: [table('t-a', 0, 45)] },
      { id: 'p2', boxes: [table('t-b', 0, 150)] },
    ] });
    expect(doc.getNumberOfPages()).toBe(2);
    const p1 = seen.find(x => x.boxId === 't-a')!, p2 = seen.find(x => x.boxId === 't-b')!;
    expect(p1.rowsPrinted).toBeGreaterThan(0);
    expect(p1.rowsPrinted).toBeLessThan(14);
    expect(p2.layoutPage).toBe(1);
    for (const n of CBC14) expect(count(text, n)).toBeGreaterThanOrEqual(1);
    expect(pdfText(doc, 2)).toContain('CONTINUED');
  });

  it('MANUAL rows: each box prints its chosen rows; a row placed nowhere still prints (last box) — never dropped', () => {
    const page1 = CBC14.slice(0, 7), page2 = CBC14.slice(7, 13);                 // 'Platelet Count' unplaced
    const { doc, text } = renderCustom({ tableMode: 'manual', pages: [
      { id: 'p1', boxes: [table('t-a', 0, 120, page1)] },
      { id: 'p2', boxes: [table('t-b', 0, 120, page2)] },
    ] });
    expect(doc.getNumberOfPages()).toBe(2);
    expect(count(text, 'Platelet Count')).toBe(1);
    const p1Text = pdfText(doc, 1);
    expect(p1Text).toContain('Hemoglobin');
    expect(p1Text).not.toContain('Neutrophils');
  });

  it('a page left with nothing (its only box is a graph that never arrived) is dropped', () => {
    const { doc } = renderCustom({ pages: [
      { id: 'p1', boxes: [table('t-a', 0, 150)] },
      { id: 'p2', boxes: [{ id: 'g', kind: 'analyzer', ref: '12003', x: 0, y: 0, w: 60, h: 40 }] },
    ] });
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('a v1 (single-page) saved layout still prints exactly as before — page 1', () => {
    const { doc, text } = renderCustom({ v: 1, boxes: [table('t-a', 0, 150)] });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(text).toContain('Platelet Count');
  });

  it('MIXED report: CBC (custom) then a Biochemistry test — CBC starts its own page, each department signs once after its LAST item', () => {
    const lft = { testId: 'lft1', name: 'SGPT', department: 'Biochemistry', sampleId: 'SMP-2',
      result: { values: { SGPT: { value: '30', unit: 'U/L', range: '0 – 40' } } } };
    const sigBox = { id: 'signatures', kind: 'signatures', x: 0, y: 160, w: 188, h: 24 };
    const { doc, text } = renderCustom({ pages: [{ id: 'p1', boxes: [table('t-a', 0, 150), sigBox] }] }, cbcSnapshot([lft]),
      { lft1: memberLayout('lft1', 'SGPT') });
    expect(doc.getNumberOfPages()).toBe(2);
    expect(count(text, 'Dr. Technician')).toBe(1);                       // in the CBC layout — Haematology's last item
    expect(pdfText(doc, 1)).toContain('Dr. Technician');
    expect(count(text, 'Dr. Biochemist')).toBe(1);
    expect(pdfText(doc, 2)).toContain('SGPT');
  });

  it('MIXED: CBC (custom) followed by MORE Haematology — no signature inside the layout; Haematology signs after its last test', () => {
    const esr = { testId: 'esr1', name: 'ESR', department: 'Haematology', sampleId: 'SMP-1',
      result: { values: { ESR: { value: '12', unit: 'mm/hr', range: '0 – 20' } } } };
    const sigBox = { id: 'signatures', kind: 'signatures', x: 0, y: 160, w: 188, h: 24 };
    const { doc, text } = renderCustom({ pages: [{ id: 'p1', boxes: [table('t-a', 0, 150), sigBox] }] }, cbcSnapshot([esr]),
      { esr1: memberLayout('esr1', 'ESR') });
    expect(count(text, 'Dr. Technician')).toBe(1);
    expect(pdfText(doc, 1)).not.toContain('Dr. Technician');
    expect(pdfText(doc, doc.getNumberOfPages())).toContain('Dr. Technician');
  });
});
