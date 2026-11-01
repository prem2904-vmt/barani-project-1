import type { jsPDF } from 'jspdf';
import { buildReportPdf, buildReportPdfWithLayout, type ReportPdfInput } from './report-pdf';
import { describeOverlap, findOverlaps, recordDrawing, type DrawnBox } from './report-overlap-detector';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { stripVolatile } from './report-theme.spec-helpers';
import { LONG_LAB, longNameInput } from './report-long-names.spec-helpers';
import { MM } from './report-header-layout';
import { applyLetterheadPreset, setLetterheadContinuation, type LetterheadApplyOptions, type LetterheadPresetId } from './report-letterhead';
import type { ReportTemplate } from '../models/report.model';

/**
 * LETTERHEAD PRESETS + CONTINUATION LETTERHEAD (report layout plan, phase 5), on the
 * long-names report (4+ pages). Rendered the ways a lab sees it: on screen / shared
 * (digital) and the blank "letterhead paper" print.
 */
const SCAN = '/uploads/t/scan.png';
const HDR = '/uploads/t/header.png';
// 4 x 2 px PNG - stands in for a scanned sheet.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGM4UaEBRwzIHACXWgtB+VT+egAAAABJRU5ErkJggg==';
// 56 x 12 px RGB PNG (aspect 4.7:1, the shape of a letterhead strip).
const PNG_STRIP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAAMCAIAAAC4D+nyAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAIklEQVR42mOQtsoeEohh1KGjDh116KhDRx066tBRh5LjUAD60fgQCIRexwAAAABJRU5ErkJggg==';

describe('report letterhead presets (phase 5)', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  const style = { fit: { enabled: true }, pageNumbers: 'n-of-m', patient: { continuation: 'mini' } };
  /** The long report with a preset applied exactly the way the editor applies it. */
  function build(preset: LetterheadPresetId | null, o: LetterheadApplyOptions & { continuation?: 'none' | 'slim' | 'full'; blank?: boolean; mini?: boolean } = {}): ReportPdfInput {
    const base = longNameInput({ fit: true, style: o.mini === false ? {} : style });
    let t: ReportTemplate = base.template!;
    if (preset) t = { ...t, ...applyLetterheadPreset(t, preset, o) };
    if (o.continuation) t = { ...t, ...setLetterheadContinuation(t, o.continuation) };
    return { ...base, template: t, imageCache: { ...base.imageCache, [SCAN]: PNG, [HDR]: PNG_STRIP }, blankLetterhead: !!o.blank };
  }
  const render = (input: ReportPdfInput) => {
    let rec: ReturnType<typeof recordDrawing> | null = null;
    const doc = buildReportPdf({ ...input, drawRecorder: d => { rec = recordDrawing(d); } });
    const boxes: DrawnBox[] = rec!.boxes;
    return { doc, boxes, pages: doc.getNumberOfPages(), overlaps: findOverlaps(boxes).map(describeOverlap) };
  };
  const raw = (doc: jsPDF) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const pageStreams = (doc: jsPDF) => [...raw(doc).matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map(m => m[1]).filter(s => /BT|Do/.test(s));
  /** Wide picture draws per page: the scan (tall) or the header artwork (short). */
  const artwork = (doc: jsPDF) => pageStreams(doc).map(s =>
    [...s.matchAll(/(-?[\d.]+) 0 0 (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm\s*\/(I\d+) Do/g)].map(m => ({ w: +m[1], h: Math.abs(+m[2]) })).filter(d => d.w > 500));
  const scans = (doc: jsPDF) => artwork(doc).map(a => a.filter(d => d.h > 800).length);
  const strips = (doc: jsPDF) => artwork(doc).map(a => a.filter(d => d.h < 200).length);
  const LAB = LONG_LAB.toUpperCase();
  const labNames = (r: { boxes: DrawnBox[] }, page: number) => r.boxes.filter(b => b.page === page && b.text === LAB);
  const streams = (doc: jsPDF) => stripVolatile(raw(doc));

  describe('defaults are today', () => {
    it('a style that only restates the letterhead defaults is byte-identical', () => {
      const base = longNameInput({ fit: true, style });
      const slim = { ...base.template!, ...setLetterheadContinuation(base.template!, 'slim') };
      const restated = { ...base, template: { ...slim, ...setLetterheadContinuation(slim, 'none') } };
      expect(streams(buildReportPdf(restated))).toBe(streams(buildReportPdf(base)));
    });
    it('Digital applied to an untouched template changes nothing', () => {
      const base = longNameInput({ fit: true, style });
      expect(streams(buildReportPdf(build('digital')))).toBe(streams(buildReportPdf(base)));
    });
  });

  describe('Digital: slim continuation letterhead', () => {
    let r: ReturnType<typeof render>;
    beforeEach(() => { r = render(build('digital', { continuation: 'slim' })); });   // inside the fake clock
    it('prints the lab name on one line and a rule on every later page, not on page 1', () => {
      expect(r.pages).toBeGreaterThanOrEqual(4);
      expect(labNames(r, 1)).toHaveLength(0);          // page 1 wraps the name inside its own letterhead
      const slimPages = [...new Set(r.boxes.filter(b => b.page > 1 && b.text === LAB).map(b => b.page))];
      expect(slimPages.length).toBeGreaterThan(0);
      for (const p of slimPages) {
        const n = labNames(r, p);
        expect(n, `p${p}`).toHaveLength(1);
        expect(n[0].y, `p${p} top`).toBeLessThan(50);
        expect(n[0].h).toBeLessThan(14);
      }
    });
    it('keeps the lab name whole inside the margins and nothing overlaps', () => {
      for (const b of r.boxes.filter(x => x.page > 1 && x.text === LAB)) {
        expect(b.x).toBeGreaterThanOrEqual(30 - 0.01);
        expect(b.x + b.w).toBeLessThanOrEqual(595.28 - 30 + 0.01);
      }
      expect(r.overlaps).toEqual([]);
    });
    it('the mini patient strip and the body sit BELOW the slim line on every later page', () => {
      const slimPages = [...new Set(r.boxes.filter(b => b.page > 1 && b.text === LAB).map(b => b.page))];
      for (const p of slimPages) {
        const name = labNames(r, p)[0];
        const below = r.boxes.filter(b => b.page === p && b !== name && b.y < 700 && b.y > 20);
        expect(Math.min(...below.map(b => b.y)), `p${p}`).toBeGreaterThanOrEqual(name.y + name.h);
      }
    });
    it('page 1 is exactly as it was (the slim line is a later-page thing)', () => {
      const none = render(build('digital', { continuation: 'none' }));
      const p1 = (x: { boxes: DrawnBox[] }) => x.boxes.filter(b => b.page === 1 && !/^Page \d+ of \d+$/.test(b.text ?? '')).map(b => [b.x, b.y, b.text]);
      expect(p1(r)).toEqual(p1(none));
    });
    it('works without the mini strip too', () => {
      const x = render(build('digital', { continuation: 'slim', mini: false }));
      expect(x.overlaps).toEqual([]);
      expect([...new Set(x.boxes.filter(b => b.page > 1 && b.text === LAB).map(b => b.page))].length).toBeGreaterThan(0);
    });
  });

  describe('Digital: whole letterhead on later pages', () => {
    it('repeats the letterhead and starts the body under it', () => {
      const none = render(build('digital', { continuation: 'none' }));
      const full = render(build('digital', { continuation: 'full' }));
      expect(full.overlaps).toEqual([]);
      const second = [...new Set(full.boxes.filter(b => b.page > 2 && b.text === 'DIAGNOSTICS CENTRE').map(b => b.page))];
      expect(second.length).toBeGreaterThan(0);
      const bottom = Math.max(...buildReportPdfWithLayout(build('digital', { continuation: 'full' })).layout.items.filter(i => i.region === 'header' && !i.hidden).map(i => i.box.y + i.box.h));
      for (const p of second) {
        const body = full.boxes.filter(b => b.page === p && b.y > bottom - 1 && b.y < 700);
        expect(body.length, `p${p}`).toBeGreaterThan(0);
      }
      expect(full.pages).toBeGreaterThanOrEqual(none.pages);
    });
  });

  describe('Pre-printed paper', () => {
    const pre = (o: Parameters<typeof build>[1] = {}) => build('preprinted', { scanUrl: SCAN, headerMm: 42, footerMm: 28, ...o });

    it('the DIGITAL copy shows the stationery scan on every page; the letterhead-paper print does not', () => {
      const digital = render(pre());
      const print = render(pre({ blank: true }));
      expect(digital.pages).toBeGreaterThanOrEqual(3);
      scans(digital.doc).forEach((n, i) => expect(n, `digital p${i + 1}`).toBe(1));
      scans(print.doc).forEach((n, i) => expect(n, `print p${i + 1}`).toBe(0));
    });

    it('the digital copy does not also draw the letterhead over the scan', () => {
      expect(render(pre()).boxes.some(b => b.page === 1 && b.text === 'DIAGNOSTICS CENTRE')).toBe(false);
    });

    it('the print leaves the top and bottom blank; the digital patient details start at the same line', () => {
      const print = render(pre({ blank: true }));
      const headerPt = 42 * MM, footerTop = 841.89 - 28 * MM;
      const ink = print.boxes.filter(b => b.text);
      expect(Math.min(...ink.map(b => b.y))).toBeGreaterThanOrEqual(headerPt - 0.01);
      expect(Math.max(...ink.map(b => b.y + b.h))).toBeLessThanOrEqual(footerTop + 0.01);
      const patient = render(pre()).boxes.filter(b => b.page === 1 && b.text);
      expect(Math.min(...patient.map(b => b.y))).toBeGreaterThanOrEqual(headerPt - 0.01);
    });

    it('digital pages 2+ start below the stationery header', () => {
      const d = render(pre());
      for (let p = 2; p <= d.pages; p++) {
        const body = d.boxes.filter(b => b.page === p && b.text);
        expect(Math.min(...body.map(b => b.y)), `p${p}`).toBeGreaterThanOrEqual(42 * MM - 0.01);
      }
    });

    it('the date strip sits above the stationery footer on screen', () => {
      const d = render(pre());
      const footerTop = 841.89 - 28 * MM;
      const strip = d.boxes.filter(x => /^Generated|^Page \d+ of/.test(x.text ?? '') && x.y > 700);
      expect(strip.length).toBeGreaterThan(0);
      for (const b of strip) expect(b.y + b.h, b.text).toBeLessThanOrEqual(footerTop + 0.5);
    });

    it('nothing overlaps - digital and letterpad, with and without the mini strip and a slim request (paper wins)', () => {
      for (const blank of [false, true]) {
        for (const continuation of ['none', 'slim', 'full'] as const) {
          for (const mini of [true, false]) {
            expect(render(pre({ blank, continuation, mini })).overlaps, `blank=${blank} ${continuation} mini=${mini}`).toEqual([]);
          }
        }
      }
    });

    it('on letterhead paper no slim / full letterhead is ever drawn (the paper has one)', () => {
      const r = render(build('digital', { blank: true, continuation: 'slim' }));
      expect(r.boxes.filter(b => b.page > 1 && b.text === LAB)).toHaveLength(0);
      expect(r.overlaps).toEqual([]);
    });
  });

  describe('Image letterhead', () => {
    const img = (o: Parameters<typeof build>[1] = {}) => build('image', { imageUrl: HDR, imageAspect: 12 / 56, ...o });
    it('the picture repeats across the top of every page, and the drawn letterhead stands down', () => {
      const r = render(img());
      strips(r.doc).forEach((n, i) => expect(n, `p${i + 1}`).toBe(1));
      expect(r.boxes.some(b => b.text === 'DIAGNOSTICS CENTRE')).toBe(false);
    });
    it('page 2+ content starts under the picture; page 1 details start under it too', () => {
      const r = render(img());
      const bottom = 48 * MM;       // imageLetterheadHeightMm(12 / 56)
      for (let p = 1; p <= r.pages; p++) {
        const body = r.boxes.filter(b => b.page === p && b.text && b.y < 800);
        expect(Math.min(...body.map(b => b.y)), `p${p}`).toBeGreaterThanOrEqual(bottom - 2)   // glyph top vs the artwork's padded edge;
      }
      expect(r.overlaps).toEqual([]);
    });
    it('a slim request defers to the picture (no second letterhead on top of it)', () => {
      const r = render(img({ continuation: 'slim' }));
      expect(r.boxes.filter(b => b.page > 1 && b.text === LAB)).toHaveLength(0);
      expect(r.overlaps).toEqual([]);
    });
    it('on letterhead paper the picture is left off (the paper already has it)', () => {
      strips(render(img({ blank: true })).doc).forEach((n, i) => expect(n, `p${i + 1}`).toBe(0));
    });
  });

  it('the engine stamp tells support which preset made a stored file', () => {
    expect(raw(buildReportPdf(build('preprinted', { scanUrl: SCAN })))).toMatch(/Prefrontal report engine v1/);
  });
});
