import { buildReportPdfWithLayout, computeReportPageLayout, type ReportPdfInput } from './report-pdf';
import {
  BG_MAX_EDGE, FOOTER_AREA_H, HeaderLayoutConfig, MAX_BACKGROUNDS, MM, PAGE, addBackground, backgroundArea,
  backgroundPrints, backgroundRect, downscaleSize, readHeaderLayout, removeBackground, setBackground,
  validateBackgroundFile, writeHeaderLayout,
} from './report-header-layout';
import type { ReportTemplate } from '../models/report.model';
import { LEGACY_SNAPSHOT, silenceJsdomCanvas } from './report-header-legacy.spec-helpers';

/**
 * Background images (owner, 2026-09-27 — "the key thing"): letterhead artwork
 * or a watermark behind the report. Model = fit → drawn rectangle, opacity,
 * which pages, left out on letterhead paper; the PDF draws them FIRST on each
 * page (behind every text run / image) with exactly the resolved bounds.
 */

// 4 × 2 px PNG → aspect 2:1.
const PNG_4x2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGM4UaEBRwzIHACXWgtB+VT+egAAAABJRU5ErkJggg==';
const BG = '/uploads/00000000-0000-0000-0000-000000000001/bg.png';

function tpl(cfg: HeaderLayoutConfig | null, p: Partial<ReportTemplate> = {}): ReportTemplate {
  const t = {
    id: 't', tenantId: 'x', labName: 'Micro World Diagnostics', tagline: 'Accurate | Caring | Instant',
    address: '14 Gandhi Road', phone: '+91 98400 12345', email: 'lab@microworld.in', website: '',
    logoUrl: '', nablAccredited: false, headerPreset: 'drlogy', topAccentBar: true, primaryColor: '#1B3A6B',
    showPatientName: true, showAge: true, showRefDoctor: true, showOrderId: true, showAbhaId: false, showQrCode: true,
    showCollectionDate: true, showReportDate: true, showMethod: false, showInstrument: false, groupByDepartment: false,
    showCriticalFlag: true, showPathologistName: true, showSignature: true, showPoweredBy: true, ...p,
  } as ReportTemplate;
  if (cfg) t.metadata = writeHeaderLayout(t, cfg);
  return t;
}
const withBg = (patch: Record<string, unknown> = {}, area: 'page' | 'header' | 'footer' = 'page') =>
  setBackground(addBackground(null, BG, 'b1', area), 'b1', patch);

function input(t: ReportTemplate, extra: Partial<ReportPdfInput> = {}, data = LEGACY_SNAPSHOT): ReportPdfInput {
  return { report: { id: 'r1', type: 'final', createdAt: '2026-09-20T06:00:00Z', data }, template: t, imageCache: { [BG]: PNG_4x2 }, ...extra };
}
function pdf(t: ReportTemplate, extra: Partial<ReportPdfInput> = {}, data?: string) {
  const { doc, layout } = buildReportPdfWithLayout(input(t, extra, data));
  return { raw: Buffer.from(doc.output('arraybuffer')).toString('latin1'), layout, pages: doc.getNumberOfPages() };
}
/** Page content streams in order. */
function streams(raw: string): string[] {
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map(m => m[1]).filter(s => /BT|Do/.test(s));
}
/** The background image draw: `w 0 0 h x y cm /I? Do` (PDF space). */
function imageDraws(stream: string) {
  return [...stream.matchAll(/(-?[\d.]+) 0 0 (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm\s*\/(I\d+) Do/g)]
    .map(m => ({ w: +m[1], h: +m[2], x: +m[3], y: +m[4], name: m[5], at: m.index! }));
}


silenceJsdomCanvas();

describe('background images — model', () => {
  const clip = { x: 0, y: 0, w: 100, h: 100 };
  const img = { w: 200, h: 100 };
  it('fit modes → the drawn rectangle', () => {
    expect(backgroundRect({ fit: 'cover' }, clip, img)).toEqual({ x: -50, y: 0, w: 200, h: 100 });
    expect(backgroundRect({ fit: 'contain' }, clip, img)).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(backgroundRect({ fit: 'stretch' }, clip, img)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(backgroundRect({ fit: 'original' }, clip, img)).toEqual({ x: -25, y: 12.5, w: 150, h: 75 });   // 96 dpi
    expect(backgroundRect({ fit: 'contain', scale: 50 }, clip, img)).toEqual({ x: 25, y: 37.5, w: 50, h: 25 });
    const moved = backgroundRect({ fit: 'contain', x: 10, y: 20 }, clip, img);
    expect(moved.x).toBeCloseTo(10 * MM, 6); expect(moved.y).toBeCloseTo(20 * MM, 6);
  });

  it('areas: whole page, the letterhead down to the patient details, the footer band', () => {
    expect(backgroundArea('page', 98)).toEqual({ x: 0, y: 0, w: PAGE.w, h: PAGE.h });
    expect(backgroundArea('header', 98)).toEqual({ x: 0, y: 0, w: PAGE.w, h: 98 });
    expect(backgroundArea('footer', 98)).toEqual({ x: 0, y: PAGE.h - FOOTER_AREA_H, w: PAGE.w, h: FOOTER_AREA_H });
  });

  it('which pages / letterhead paper / hidden', () => {
    const b = { hidden: false, loaded: true, pages: 'first' as const, onLetterhead: false };
    expect(backgroundPrints(b, 1, false)).toBe(true);
    expect(backgroundPrints(b, 2, false)).toBe(false);
    expect(backgroundPrints({ ...b, pages: 'all' }, 2, false)).toBe(true);
    expect(backgroundPrints(b, 1, true)).toBe(false);                            // paper has the design
    expect(backgroundPrints({ ...b, onLetterhead: true }, 1, true)).toBe(true);  // "also print on letterhead paper"
    expect(backgroundPrints({ ...b, hidden: true }, 1, false)).toBe(false);
    expect(backgroundPrints({ ...b, loaded: false }, 1, false)).toBe(false);
  });

  it('storage: add (max 3) / edit / remove, junk cleaned', () => {
    let cfg = addBackground(null, BG, 'a');
    cfg = addBackground(cfg, BG, 'b', 'header');
    cfg = addBackground(cfg, BG, 'c', 'footer');
    cfg = addBackground(cfg, BG, 'd');
    expect(cfg.backgrounds!.map(b => b.id)).toEqual(['a', 'b', 'c']);
    expect(MAX_BACKGROUNDS).toBe(3);
    cfg = setBackground(cfg, 'b', { opacity: 0.3, pages: 'all', onLetterhead: true, x: 12.345 });
    const read = readHeaderLayout({ metadata: writeHeaderLayout(null, cfg) })!;
    expect(read.backgrounds![1]).toEqual({ id: 'b', url: BG, area: 'header', fit: 'contain', opacity: 0.3, pages: 'all', onLetterhead: true, x: 12.35 });
    expect(removeBackground(removeBackground(removeBackground(cfg, 'a'), 'b'), 'c').backgrounds).toBeUndefined();
    const junk = JSON.stringify({ headerLayout: { items: {}, backgrounds: [{ id: 'z', url: BG, fit: 'tile', opacity: 7, area: 'moon' }, { id: 'y' }] } });
    expect(readHeaderLayout({ metadata: junk })!.backgrounds).toEqual([{ id: 'z', url: BG, area: 'page', fit: 'cover', opacity: 1, pages: 'first' }]);
  });

  it('upload rules: PNG / JPG / WebP only, 15 MB pick limit; shrink to A4 @ 300 dpi', () => {
    expect(validateBackgroundFile({ type: 'image/svg+xml', name: 'a.svg', size: 10 })).toMatch(/SVG/);
    expect(validateBackgroundFile({ type: 'image/gif', name: 'a.gif', size: 10 })).toMatch(/PNG, JPG or WebP/);
    expect(validateBackgroundFile({ type: 'image/png', name: 'a.png', size: 16 * 1048576 })).toMatch(/16\.0 MB/);
    expect(validateBackgroundFile({ type: 'image/webp', name: 'a.webp', size: 10 })).toBeNull();
    expect(downscaleSize(4960, 7016)).toEqual({ w: Math.round(4960 * BG_MAX_EDGE / 7016), h: BG_MAX_EDGE });
    expect(downscaleSize(800, 600)).toEqual({ w: 800, h: 600 });
  });
});

describe('background images — the PDF', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('a full-page background is drawn FIRST on page 1 — behind every text run — with the resolved bounds', () => {
    const { raw, layout } = pdf(tpl(withBg({ fit: 'contain' })));
    const p1 = streams(raw)[0];
    const d = imageDraws(p1);
    expect(d.length).toBe(1);
    expect(d[0].at).toBeLessThan(p1.indexOf('BT'));                // under all text
    expect(p1.slice(0, d[0].at)).toMatch(/re\s+W\s+n/);               // clipped to its area
    const r = layout.backgrounds[0].rect;
    expect(d[0].w).toBeCloseTo(r.w, 3); expect(d[0].h).toBeCloseTo(r.h, 3);
    expect(d[0].x).toBeCloseTo(r.x, 3); expect(d[0].y).toBeCloseTo(PAGE.h - r.y - r.h, 3);
    expect(r.w).toBeCloseTo(PAGE.w, 3);                                // 2:1 contained in A4 → full width
    expect(r.h).toBeCloseTo(PAGE.w / 2, 3);
  });

  it('opacity rides a graphics state (ca), restored after the image', () => {
    const { raw } = pdf(tpl(withBg({ opacity: 0.25 })));
    expect(raw).toMatch(/\/ca 0\.25/);
    const p1 = streams(raw)[0];
    const gs = p1.search(/\/GS\d+ gs/);
    expect(gs).toBeGreaterThan(-1);
    expect(gs).toBeLessThan(imageDraws(p1)[0].at);
    expect(p1.indexOf('Q', imageDraws(p1)[0].at)).toBeLessThan(p1.indexOf('BT'));
  });

  it('a header background is clipped to the letterhead band', () => {
    const { raw, layout } = pdf(tpl(withBg({ fit: 'cover' }, 'header')));
    const bg = layout.backgrounds[0];
    expect(bg.clip).toEqual({ x: 0, y: 0, w: PAGE.w, h: layout.bodyTop });
    const p1 = streams(raw)[0];
    // jsPDF writes the clip as `x yTop w -h re` in PDF space.
    const m = p1.match(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\s+W\s+n/)!;
    expect(+m[1]).toBeCloseTo(0, 3);
    expect(+m[2]).toBeCloseTo(PAGE.h, 3);
    expect(+m[3]).toBeCloseTo(PAGE.w, 3);
    expect(Math.abs(+m[4])).toBeCloseTo(layout.bodyTop, 3);
  });

  it('first page only vs every page', () => {
    const twoDepts = JSON.stringify({ ...JSON.parse(LEGACY_SNAPSHOT), tests: [
      { testId: 'a', name: 'Hemoglobin', department: 'Haematology', sampleType: 'Blood', result: { values: { Hb: { value: '11', unit: 'g/dL' } } } },
      { testId: 'b', name: 'Glucose', department: 'Biochemistry', sampleType: 'Serum', result: { values: { Glu: { value: '90', unit: 'mg/dL' } } } },
    ] });
    const multi = { departmentPageBreak: true, groupByDepartment: true };
    const first = pdf(tpl(withBg(), multi), {}, twoDepts);
    expect(first.pages).toBeGreaterThan(1);
    const fs = streams(first.raw);
    expect(imageDraws(fs[0]).length).toBe(1);
    expect(fs.slice(1).every(s => imageDraws(s).length === 0)).toBe(true);
    const all = pdf(tpl(withBg({ pages: 'all' }), multi), {}, twoDepts);
    const as = streams(all.raw);
    expect(as.every(s => imageDraws(s).length === 1 && imageDraws(s)[0].at < s.indexOf('BT'))).toBe(true);
  });

  it('letterhead paper leaves it out — unless "also print on letterhead paper" is on; plain paper keeps it', () => {
    const lp = { letterpadMode: true };
    expect(imageDraws(streams(pdf(tpl(withBg(), lp), { blankLetterhead: true }).raw)[0]).length).toBe(0);
    expect(imageDraws(streams(pdf(tpl(withBg(), lp), { blankLetterhead: false }).raw)[0]).length).toBe(1);
    expect(imageDraws(streams(pdf(tpl(withBg({ onLetterhead: true }), lp), { blankLetterhead: true }).raw)[0]).length).toBe(1);
  });

  it('hidden or not-yet-loaded backgrounds draw nothing; the designer layout equals the drawn one', () => {
    expect(imageDraws(streams(pdf(tpl(withBg({ hidden: true }))).raw)[0]).length).toBe(0);
    const t = tpl(withBg({ fit: 'original', scale: 150, x: 20, y: 30 }));
    const { layout } = buildReportPdfWithLayout(input(t));
    expect(computeReportPageLayout(input(t))).toEqual(layout);
    const noBytes = buildReportPdfWithLayout({ ...input(t), imageCache: {} });
    expect(noBytes.layout.backgrounds[0].loaded).toBe(false);
  });
});
