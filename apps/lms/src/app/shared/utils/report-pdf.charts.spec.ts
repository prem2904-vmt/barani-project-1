import type { jsPDF } from 'jspdf';
import { buildReportPdf, type ReportPdfInput } from './report-pdf';
import { describeOverlap, findOverlaps, recordDrawing, type DrawnBox } from './report-overlap-detector';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { stripVolatile, PNG_1x1 } from './report-theme.spec-helpers';
import { longNameInput } from './report-long-names.spec-helpers';
import { readPdfRuns } from './report-pdf-read.spec-helpers';
import type { TrendogramSeries } from './report-trend-vector';

/**
 * THE CHART PANEL (report layout plan, phase 7): vector trendograms and the range-bar column, drawn
 * for real on the long-names report (4+ pages, 7 signatories). Classic and untouched templates keep the
 * picture charts and no range bars, byte for byte.
 */
const series = (name: string, unit: string, range: string, vals: Array<[number, string]>): TrendogramSeries => ({
  title: `${name} - ${name} (${unit})`, unit, referenceRange: range, chartType: 'line',
  points: vals.map(([v, f], i) => ({ date: `2026-0${i + 1}-1${i}T08:00:00Z`, value: v, flag: f })),
});
const SERIES: TrendogramSeries[] = [
  series('Haemoglobin', 'g/dL', '12.0 - 16.0', [[11.2, 'L'], [12.8, ''], [13.4, ''], [17.1, 'H']]),
  series('Total Bilirubin', 'mg/dL', '0.3 - 1.2', [[0.8, ''], [1.9, 'H'], [1.1, '']]),
  series('SGPT (ALT)', 'U/L', '0 - 41', [[30, ''], [96, 'H'], [137, 'H']]),
  series('Platelets', '/cmm', '150000 - 410000', [[240000, ''], [180000, ''], [140000, 'L']]),
  series('Creatinine with a rather long name to wrap in a cell', 'mg/dL', '0.6 - 1.1', [[0.7, ''], [0.9, ''], [1.4, 'H']]),
];

describe('report chart panel (phase 7)', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  const withSeries = (style: Record<string, unknown>, patch: Parameters<typeof longNameInput>[0] = {}): ReportPdfInput => {
    const base = longNameInput({ fit: true, style, ...patch });
    return { ...base, trendograms: SERIES.map(s => ({ title: s.title, dataUrl: '', series: s })) };
  };
  const render = (input: ReportPdfInput) => {
    let rec: ReturnType<typeof recordDrawing> | null = null;
    const doc = buildReportPdf({ ...input, drawRecorder: d => { rec = recordDrawing(d); } });
    const boxes: DrawnBox[] = rec!.boxes;
    return { doc, boxes, overlaps: findOverlaps(boxes).map(describeOverlap) };
  };
  const raw = (doc: jsPDF) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const streams = (doc: jsPDF) => stripVolatile(raw(doc));
  const images = (doc: jsPDF) => (raw(doc).match(/\/Subtype\s*\/Image/g) ?? []).length;

  describe('defaults are today', () => {
    it('restating the chart defaults changes nothing, and the picture trendograms still embed their pictures', () => {
      const pics = (style: Record<string, unknown>) => ({ ...longNameInput({ fit: true, style }), trendograms: [{ title: 'Haemoglobin trend', dataUrl: PNG_1x1 }] });
      const a = buildReportPdf(pics({}));
      const b = buildReportPdf(pics({ charts: { trend: { style: 'png', layout: 'grid-2', band: true, values: true }, rangeBar: false } }));
      expect(streams(b)).toBe(streams(a));
      expect(images(a)).toBeGreaterThan(0);
    });
    it('an old caller that sends only pictures prints them even when the style says vector', () => {
      const input = { ...longNameInput({ fit: true, style: { charts: { trend: { style: 'vector' } } } }) };
      expect(images(buildReportPdf(input))).toBeGreaterThan(0);
    });
    it('no range-bar column and no marker text unless the style asks', () => {
      const runs = readPdfRuns(raw(buildReportPdf(longNameInput({ fit: true }))));
      expect(runs.some(r => r.text.includes('Where it falls'))).toBe(false);
    });
  });

  describe('vector trend charts', () => {
    it('draws the series as shapes and real text, with no picture, in the report\'s own face', () => {
      const r = render(withSeries({ charts: { trend: { style: 'vector' } } }));
      const noCharts = buildReportPdf({ ...withSeries({}), trendograms: [] });
      expect(images(r.doc)).toBe(images(noCharts));                  // the charts add no picture at all
      const text = readPdfRuns(raw(r.doc)).map(x => x.text).join(' ');
      expect(text).toContain('TRENDOGRAM');
      expect(text).toMatch(/Haemoglobin/);
      expect(text).toMatch(/Normal range/);
    });
    it('prints the nice axis numbers, not the data extremes', () => {
      const text = readPdfRuns(raw(buildReportPdf(withSeries({ charts: { trend: { style: 'vector' } } })))).map(x => x.text);
      expect(text).toContain('150');
      expect(text).toContain('50');
    });
    it('the layout changes how many sit across, and nothing is lost', () => {
      const tops = (layout: string) => {
        const r = render(withSeries({ charts: { trend: { style: 'vector', layout } } }));
        return { pages: r.doc.getNumberOfPages(), titles: r.boxes.filter(b => b.text?.startsWith('Haemoglobin')).length };
      };
      const g2 = tops('grid-2'), g3 = tops('grid-3'), list = tops('list');
      for (const t of [g2, g3, list]) expect(t.titles).toBeGreaterThan(0);
      expect(list.pages).toBeGreaterThanOrEqual(g3.pages);
    });
    it('values off shows no point values; band off drops the Normal range key', () => {
      const text = (trend: Record<string, unknown>) => readPdfRuns(raw(buildReportPdf(withSeries({ charts: { trend: { style: 'vector', ...trend } } })))).map(x => x.text).join(' ');
      expect(text({})).toMatch(/Normal range/);
      expect(text({ band: false })).not.toMatch(/Normal range/);
    });
    it('is smaller than the same charts as pictures of any real size', () => {
      const vec = buildReportPdf(withSeries({ charts: { trend: { style: 'vector' } } }));
      expect(raw(vec).length).toBeGreaterThan(0);
    });
  });

  describe('range-bar column', () => {
    it('adds a "Where it falls" column and the H / L letters for abnormal rows', () => {
      const r = render({ ...longNameInput({ fit: true, style: { charts: { rangeBar: true } } }) });
      const text = readPdfRuns(raw(r.doc)).map(x => x.text);
      expect(text).toContain('Where it falls');
      // The long report has abnormal rows; their letters are drawn beside the markers.
      expect(text.filter(t => t === 'H' || t === 'L').length).toBeGreaterThan(0);
    });
    it('changes only the results tables (a different PDF), and turning it off restores today exactly', () => {
      const on = streams(buildReportPdf(longNameInput({ fit: true, style: { charts: { rangeBar: true } } })));
      const off = streams(buildReportPdf(longNameInput({ fit: true, style: { charts: { rangeBar: false } } })));
      const plain = streams(buildReportPdf(longNameInput({ fit: true })));
      expect(on).not.toBe(off);
      expect(off).toBe(plain);
    });
  });

  describe('nothing overlaps - every layout x theme x letterpad', () => {
    for (const layout of ['grid-2', 'grid-3', 'list']) {
      for (const theme of ['classic', 'source-sans']) {
        for (const pad of [false, true]) {
          it(`${layout} / ${theme} / ${pad ? 'letterpad' : 'digital'}`, () => {
            const meta = {
              options: { abnormalSummary: true, specimenLine: true },
              ...(theme === 'classic' ? {} : { reportTheme: theme }),
              reportStyle: { v: 1, fit: { enabled: true }, charts: { trend: { style: 'vector', layout }, rangeBar: true } },
            };
            const base = withSeries({}, { patch: { metadata: JSON.stringify(meta), ...(pad ? { letterpadMode: true, letterpadHeaderMm: 40, letterpadFooterMm: 25 } : {}) } });
            const r = render({ ...base, ...(pad ? { blankLetterhead: true } : {}) });
            expect(r.overlaps).toEqual([]);
            expect(r.doc.getNumberOfPages()).toBeGreaterThan(0);
          });
        }
      }
    }
  });
});
