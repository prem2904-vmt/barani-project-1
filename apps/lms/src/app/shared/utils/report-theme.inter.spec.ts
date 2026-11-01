import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildReportPdf, prepareReportTheme } from './report-pdf';
import { INTER_DIR, INTER_FACES, loadReportFonts, reportFontsLoaded, resetReportFonts } from './report-fonts';
import { INTER_THEME, REPORT_TYPE_THEMES, SOURCE_SANS_THEME, readReportTheme, reportTypeTheme, writeReportTheme, type TypeEl } from './report-theme';
import { hash, silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { richInput } from './report-theme.spec-helpers';
import { PdfRun, readPdfRuns, runOf } from './report-pdf-read.spec-helpers';

/**
 * REPORT THEME "Modern — Inter" (report layout phase 4). Real PDFs read back:
 * the four Inter faces embed under their own names, the sizes are the Source
 * Sans scale at 0.94, symbols print natively, and nothing is fetched until a
 * report in this theme is prepared.
 */
silenceJsdomCanvas();

const FONT_DIR = resolve(process.cwd(), 'apps/lms/public', INTER_DIR);
const fromDisk = async (file: string): Promise<ArrayBuffer> => {
  const b = readFileSync(resolve(FONT_DIR, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const INTER = { metadata: JSON.stringify({ reportTheme: 'inter', options: { abnormalSummary: true, specimenLine: true } }) };
function render(patch: Record<string, unknown> = INTER): { pdf: string; runs: PdfRun[]; pages: number } {
  const doc = buildReportPdf(richInput(patch));
  const pdf = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  return { pdf, runs: readPdfRuns(pdf), pages: doc.getNumberOfPages() };
}
const px = (el: TypeEl) => INTER_THEME.tokens[el].size;

describe('Inter theme — stored choice and token table', () => {
  it('round-trips, and Classic stores nothing', () => {
    const m = writeReportTheme({ metadata: '{}' }, 'inter');
    expect(readReportTheme({ metadata: m })).toBe('inter');
    expect(reportTypeTheme({ metadata: m })).toBe(INTER_THEME);
    expect(writeReportTheme({ metadata: m }, 'classic')).toBe('{}');
  });
  it('defines every element, embeds Inter and flows like Source Sans', () => {
    expect(Object.keys(INTER_THEME.tokens).sort()).toEqual(Object.keys(REPORT_TYPE_THEMES.classic.tokens).sort());
    expect(INTER_THEME).toMatchObject({ embedded: 'Inter', flowHeader: true, splitLabels: true, splitSubLines: true, deptRule: 1.5 });
  });
  it('is the Source Sans scale at 0.94 to the nearest half point, never under 6.5', () => {
    for (const el of Object.keys(INTER_THEME.tokens) as TypeEl[]) {
      const s = SOURCE_SANS_THEME.tokens[el], i = INTER_THEME.tokens[el];
      expect(i.weight).toBe(s.weight);
      if (el === 'watermark') { expect(i.size).toBe(s.size); continue; }
      expect(i.size).toBeGreaterThanOrEqual(6.5);
      expect(i.size).toBe(Math.max(6.5, Math.round(s.size * 0.94 * 2) / 2));
      expect(i.size * 2).toBe(Math.round(i.size * 2));
    }
    expect(px('labName')).toBe(19.5);
    expect(px('testName')).toBe(9.5);
  });
});

describe('Inter theme — font loading is lazy', () => {
  afterEach(() => resetReportFonts());
  it('a Classic or Source Sans template fetches no Inter; an Inter template fetches the four faces once', async () => {
    resetReportFonts();
    const seen: string[] = [];
    const spy = async (f: string) => { seen.push(f); return fromDisk(f); };
    expect(await loadReportFonts(spy, 'Inter')).toBe(true);
    expect(seen.sort()).toEqual(Object.values(INTER_FACES).map(f => f.file).sort());
    expect(await loadReportFonts(spy, 'Inter')).toBe(true);
    expect(seen).toHaveLength(4);
    expect(reportFontsLoaded('Inter')).toBe(true);
    expect(reportFontsLoaded()).toBe(false);   // Source Sans stays unloaded
  });
  it('prepareReportTheme does nothing for Classic', async () => {
    resetReportFonts();
    await prepareReportTheme(richInput().template);
    expect(reportFontsLoaded('Inter')).toBe(false);
  });
  it('a failed fetch resolves false and the report still renders (Helvetica, Inter sizes)', async () => {
    resetReportFonts();
    expect(await loadReportFonts(() => Promise.reject(new Error('offline')), 'Inter')).toBe(false);
    const { runs } = render();
    expect(runOf(runs, 'MICRO')).toMatchObject({ font: 'Helvetica-Bold', size: px('labName') });
  });
});

describe('Inter theme — real PDF read-back', () => {
  beforeAll(async () => { resetReportFonts(); expect(await loadReportFonts(fromDisk, 'Inter')).toBe(true); });
  afterAll(() => resetReportFonts());
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('embeds four Inter faces under their own PostScript names and no Helvetica', () => {
    const { pdf } = render();
    for (const n of ['Inter-Regular', 'Inter-SemiBold', 'Inter-Bold', 'Inter-Italic']) expect(pdf).toContain(`/BaseFont /${n}`);
    expect(pdf).toContain('/FontFile2');
    expect(pdf).not.toContain('/BaseFont /Helvetica');
    expect(pdf).not.toContain('/BaseFont /SourceSans3');
  });

  it('type: lab name Bold, test names Semibold, abnormal result Bold, specimen Italic, at the Inter sizes', () => {
    const { runs } = render();
    expect(runOf(runs, 'MICRO')).toMatchObject({ font: 'Inter-Bold', size: px('labName') });
    expect(runOf(runs, 'Haemoglobin')).toMatchObject({ font: 'Inter-SemiBold', size: px('testName') });
    expect(runOf(runs, '96 U/L')).toMatchObject({ font: 'Inter-Bold', size: px('resultAbnormal') });
    expect(runOf(runs, '13.0 – 17.0')).toMatchObject({ font: 'Inter-Regular', size: px('range') });
    expect(runOf(runs, 'Specimen: EDTA Whole Blood')).toMatchObject({ font: 'Inter-Italic', size: px('specimen') });
  });

  it('prints ₹ µ ° ≤ ≥ × ⁹ natively', () => {
    const { runs } = render();
    const all = runs.map(r => r.text).join('\n');
    for (const g of ['₹', 'µIU/mL', '°C', '≤ 41', '≥ 126', '×10⁹/L']) expect(all).toContain(g);
    expect(all).not.toContain('>=');
  });

  it('the report is the same length class as Source Sans (Inter is set smaller)', () => {
    const { pages } = render();
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pages).toBeLessThanOrEqual(4);
  });

  it('FINGERPRINT: the Inter render is stable (text runs + font + size)', () => {
    const { runs } = render();
    const sig = runs.filter(r => r.page === 1).slice(0, 40).map(r => `${r.font}|${r.size}|${r.text}`).join('\n');
    expect(sig.length).toBeGreaterThan(200);
    expect(hash(sig)).toBe('0c685868a5bedad9:1376');
  });
});
