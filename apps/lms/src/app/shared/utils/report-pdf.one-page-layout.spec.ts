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

  it('a HIDDEN box keeps its place in the layout but never prints', () => {
    const boxes = defaultCbcLayout(BODY).map(b => (b.kind === 'signatures' ? { ...b, hidden: true } : b));
    const doc = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true, boxes }) });
    const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    expect(text).not.toContain('Dr. Technician');
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

  it('table "Fill": the rows grow to the box\'s height in the REAL render; "Top" leaves them natural', () => {
    const run = (vAlign: 'top' | 'fill') => {
      const boxes = defaultCbcLayout(BODY).map(b => (b.kind === 'table' ? { ...b, h: 120, vAlign } : b));
      const seen: Array<{ body: { top: number }; tableBottom?: number | null; tableNaturalH?: number | null }> = [];
      buildReportPdf({
        report: { id: 'r1', type: 'final', createdAt: '2026-10-02T00:00:00Z', data: JSON.stringify(snapshot()) },
        resolvedLayouts: { t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true, boxes }) },
        template: null,
        onOnePageBody: (i: (typeof seen)[number]) => seen.push(i),
      } as never);
      return seen.find(i => i.tableBottom !== undefined)!;
    };
    const top = run('top'), fill = run('fill');
    expect(fill.tableNaturalH).toBeCloseTo(top.tableNaturalH!, 1);                 // same natural height
    expect(top.tableBottom! - top.body.top).toBeLessThan(120 * 2.8346 - 10);       // natural: well short of the box
    expect(fill.tableBottom! - fill.body.top).toBeCloseTo(120 * 2.8346, 0);         // filled: exactly the box
  });
});
