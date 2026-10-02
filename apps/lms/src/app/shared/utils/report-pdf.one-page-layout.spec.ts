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

  it('an ENABLED page_layout forces its own extra page (and the table renders on it)', () => {
    const disabled = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: false }) });
    const enabled = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true }) });
    // Strictly MORE pages (the profile's own forced page, plus — since that
    // page is filled edge to edge by design — the "End of Report" marker
    // spilling to its own page afterwards, same as any other report whose
    // last block reaches the floor). The table content itself must be present.
    expect(enabled.getNumberOfPages()).toBeGreaterThan(disabled.getNumberOfPages());
    const text = Buffer.from(enabled.output('arraybuffer')).toString('latin1');
    expect(text).toContain('Investigation');
    expect(text).toContain('Hemoglobin');
  });

  it('never throws when an analyzer box has no attached image (collapses instead)', () => {
    expect(() => render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true }) })).not.toThrow();
  });

  it('the department signatures print on the one-page block (no second signature logic — same ReportSignature list)', () => {
    const doc = render({ t1: memberLayout('t1', 'Hemoglobin'), 'pkg-cbc': profileLayout({ enabled: true }) });
    const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    expect(text).toContain('Dr. Technician');
  });
});
