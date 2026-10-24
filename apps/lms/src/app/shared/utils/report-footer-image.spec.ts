import { buildReportPdfWithLayout, computeReportPageLayout, footerFloor, footerStripBase, type ReportPdfInput } from './report-pdf';
import {
  FOOTER_AREA_H, HeaderLayoutConfig, PAGE, addBackground, footerImageLift, setBackground, writeHeaderLayout,
  type ResolvedBackground,
} from './report-header-layout';
import type { ReportTemplate } from '../models/report.model';
import { LEGACY_SNAPSHOT, silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { readPdfRuns, runOf, type PdfRun } from './report-pdf-read.spec-helpers';

/**
 * Owner 2026-10-24: with a FOOTER background image, "Generated on", the page
 * number, "Powered by Prefrontal" and the footer note / text printed ON the
 * image. They now sit ABOVE it on every page and the body floor rises with
 * them (results never run under them); without a footer image nothing moves.
 */

const PNG_4x2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGM4UaEBRwzIHACXWgtB+VT+egAAAABJRU5ErkJggg==';
const BG = '/uploads/00000000-0000-0000-0000-000000000001/footer.png';
const DISCLAIMER = 'Test results should be correlated clinically.';
const FOOTER_TEXT = 'Reg. No. TN/1234';

function tpl(cfg: HeaderLayoutConfig | null, p: Partial<ReportTemplate> = {}): ReportTemplate {
  const t = {
    id: 't', tenantId: 'x', labName: 'Micro World Diagnostics', tagline: 'Accurate | Caring | Instant',
    address: '14 Gandhi Road', phone: '+91 98400 12345', email: 'lab@microworld.in', website: '',
    logoUrl: '', nablAccredited: false, headerPreset: 'classic', topAccentBar: true, primaryColor: '#1B3A6B',
    showPatientName: true, showAge: true, showRefDoctor: true, showOrderId: true, showAbhaId: false, showQrCode: true,
    showCollectionDate: true, showReportDate: true, showMethod: false, showInstrument: false, groupByDepartment: false,
    showCriticalFlag: true, showPathologistName: true, showSignature: true, showPoweredBy: true,
    showSampleCollectionBand: false, disclaimer: DISCLAIMER, footerText: FOOTER_TEXT, ...p,
  } as ReportTemplate;
  if (cfg) t.metadata = writeHeaderLayout(t, cfg);
  return t;
}
const footerBg = (patch: Record<string, unknown> = {}) =>
  setBackground(addBackground(null, BG, 'f1', 'footer'), 'f1', { fit: 'stretch', ...patch });

/** 40 tests → the results run onto a second page. */
const LONG_SNAPSHOT = JSON.stringify({
  ...JSON.parse(LEGACY_SNAPSHOT),
  tests: Array.from({ length: 40 }, (_, i) => ({
    testId: 't' + i, name: 'Analyte ' + i, department: 'Biochemistry', sampleType: 'Serum',
    result: { values: { ['Analyte ' + i]: { value: String(10 + i), unit: 'mg/dL', range: '5 - 60' } } },
  })),
});

function input(t: ReportTemplate, data = LEGACY_SNAPSHOT): ReportPdfInput {
  return { report: { id: 'r1', type: 'final', createdAt: '2026-10-24T06:00:00Z', data }, template: t, imageCache: { [BG]: PNG_4x2 } };
}
function render(t: ReportTemplate, data?: string) {
  const { doc, layout } = buildReportPdfWithLayout(input(t, data));
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  return { runs: readPdfRuns(raw), layout, pages: doc.getNumberOfPages() };
}
/** Runs are in PDF space (y up from the page bottom). */
const onPage = (runs: PdfRun[], page: number) => runs.filter(r => r.page === page);
const pageNo = (runs: PdfRun[], page: number) =>
  onPage(runs, page).find(r => r.text === String(page) && r.x > PAGE.w / 2 && r.y < 120)!;
const FOOTER_RUNS = [/^Generated on/, /^\d+$/, /^Powered by Prefrontal/, /correlated clinically/, /^Reg\. No\./];

silenceJsdomCanvas();

describe('footerImageLift — model', () => {
  const bg = (p: Partial<ResolvedBackground>) =>
    ({ area: 'footer', hidden: false, loaded: true, box: { x: 0, y: PAGE.h - FOOTER_AREA_H, w: PAGE.w, h: FOOTER_AREA_H }, ...p }) as ResolvedBackground;
  it('no footer image → 0 (layout unchanged)', () => {
    expect(footerImageLift(null)).toBe(0);
    expect(footerImageLift([])).toBe(0);
    expect(footerImageLift([bg({ area: 'page', box: { x: 0, y: 0, w: PAGE.w, h: PAGE.h } })])).toBe(0);
    expect(footerImageLift([bg({ area: 'header', box: { x: 0, y: 0, w: PAGE.w, h: 98 } })])).toBe(0);
    expect(footerImageLift([bg({ hidden: true })])).toBe(0);
    expect(footerImageLift([bg({ loaded: false })])).toBe(0);
    expect(footerImageLift([bg({ box: { x: 0, y: PAGE.h, w: PAGE.w, h: 0 } })])).toBe(0);
  });
  it('a footer image → its visible height from the page bottom (the tallest wins)', () => {
    expect(footerImageLift([bg({})])).toBe(FOOTER_AREA_H);
    expect(footerImageLift([bg({ box: { x: 0, y: PAGE.h - 30, w: 100, h: 20 } })])).toBe(30);
    expect(footerImageLift([bg({ box: { x: 0, y: PAGE.h - 30, w: 100, h: 30 } }), bg({ box: { x: 0, y: PAGE.h - 50, w: 9, h: 50 } })])).toBe(50);
  });
  it('the layout carries the lift only when a footer image prints', () => {
    expect(computeReportPageLayout(input(tpl(null))).footerLift).toBeUndefined();
    expect(computeReportPageLayout(input(tpl(footerBg({ hidden: true })))).footerLift).toBeUndefined();
    expect(computeReportPageLayout(input(tpl(footerBg()))).footerLift).toBe(FOOTER_AREA_H);
    // contain + 50 %: a 2:1 image fills 128 × 64, halved → 32 high, centred → its top is 48 up.
    expect(computeReportPageLayout(input(tpl(footerBg({ fit: 'contain', scale: 50 })))).footerLift).toBe(48);
    expect(footerStripBase(null)).toBe(PAGE.h);
    expect(footerStripBase({ footerLift: 64 })).toBe(PAGE.h - 64);
  });
});

describe('report footer with a footer image — the PDF', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T06:09:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('without a footer image the strip is where it always was (h-18 / h-4) and the floor unchanged', () => {
    const { runs, layout } = render(tpl(null));
    expect(runOf(runs, 'Generated on').y).toBeCloseTo(18, 3);
    expect(pageNo(runs, 1).y).toBeCloseTo(18, 3);
    expect(runOf(runs, 'Powered by Prefrontal').y).toBeCloseTo(4, 3);
    expect(runOf(runs, 'correlated clinically').y).toBeCloseTo(40, 3);
    expect(layout.footerLift).toBeUndefined();
    const plain = footerFloor(layout);
    // A page / header background does not move it either.
    const pageBg = render(tpl(setBackground(addBackground(null, BG, 'p', 'page'), 'p', {})));
    expect(footerFloor(pageBg.layout)).toBe(plain);
    expect(runOf(pageBg.runs, 'Generated on').y).toBeCloseTo(18, 3);
  });

  it('with a footer image every footer line sits above the image top, and the floor rises by the same amount', () => {
    const lift = FOOTER_AREA_H;
    const without = render(tpl(null));
    const { runs, layout } = render(tpl(footerBg()));
    expect(layout.footerLift).toBe(lift);
    expect(runOf(runs, 'Generated on').y).toBeCloseTo(18 + lift, 3);
    expect(pageNo(runs, 1).y).toBeCloseTo(18 + lift, 3);
    expect(runOf(runs, 'Powered by Prefrontal').y).toBeCloseTo(4 + lift, 3);
    expect(runOf(runs, 'correlated clinically').y).toBeCloseTo(40 + lift, 3);
    expect(runOf(runs, 'Reg. No.').y).toBeGreaterThan(runOf(runs, 'correlated clinically').y);
    for (const re of FOOTER_RUNS) {
      for (const r of runs.filter(x => re.test(x.text) && x.y < 200)) expect(r.y).toBeGreaterThan(lift);
    }
    expect(footerFloor(layout)).toBe(footerFloor(without.layout) + lift);
    // The designer outlines exactly what printed.
    expect(computeReportPageLayout(input(tpl(footerBg())))).toEqual(layout);
  });

  it('two pages: the strip clears the image on EVERY page (also a first-page-only image) and no result runs under it', () => {
    for (const pages of ['all', 'first'] as const) {
      const { runs, layout, pages: n } = render(tpl(footerBg({ pages })), LONG_SNAPSHOT);
      expect(n).toBeGreaterThan(1);
      const floorY = footerFloor(layout);           // PDF-space y of the body floor
      for (let p = 1; p <= n; p++) {
        const gen = onPage(runs, p).find(r => r.text.startsWith('Generated on'))!;
        expect(gen.y).toBeCloseTo(18 + FOOTER_AREA_H, 3);
        expect(pageNo(runs, p).y).toBeCloseTo(18 + FOOTER_AREA_H, 3);
        // Only footer lines print below the body floor.
        const below = onPage(runs, p).filter(r => r.y < floorY && r.text.trim() && !FOOTER_RUNS.some(re => re.test(r.text)));
        expect(below.map(r => r.text)).toEqual([]);
      }
      // The last page's note / powered-by also sit above the image.
      const last = onPage(runs, n);
      expect(last.find(r => /correlated clinically/.test(r.text))!.y).toBeCloseTo(40 + FOOTER_AREA_H, 3);
      expect(last.find(r => /Powered by/.test(r.text))!.y).toBeCloseTo(4 + FOOTER_AREA_H, 3);
    }
  });

  it('Sample Collection band on: powered-by rides the lifted strip; the band itself stays at the page edge', () => {
    const band = { showSampleCollectionBand: true };
    expect(runOf(render(tpl(null, band)).runs, 'Powered by Prefrontal').y).toBeCloseTo(18, 3);
    const { runs } = render(tpl(footerBg(), band));
    expect(runOf(runs, 'Powered by Prefrontal').y).toBeCloseTo(18 + FOOTER_AREA_H, 3);
    expect(runOf(runs, 'Sample Collection').y).toBeCloseTo(3.5, 3);
  });

  it('two pages without a footer image: the strip stays at h-18 on every page', () => {
    const { runs, pages: n } = render(tpl(null), LONG_SNAPSHOT);
    expect(n).toBeGreaterThan(1);
    for (let p = 1; p <= n; p++) {
      expect(onPage(runs, p).find(r => r.text.startsWith('Generated on'))!.y).toBeCloseTo(18, 3);
      expect(pageNo(runs, p).y).toBeCloseTo(18, 3);
    }
  });
});
