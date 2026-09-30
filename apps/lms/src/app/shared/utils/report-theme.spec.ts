import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildReportPdf, computeReportPageLayout, prepareReportTheme } from './report-pdf';
import { loadReportFonts, reportFontsLoaded, resetReportFonts, SOURCE_SANS_DIR } from './report-fonts';
import { readReportTheme, REPORT_TYPE_THEMES, writeReportTheme, reportTypeTheme, TypeEl } from './report-theme';
import { unicodeFontSafeText } from './pdf-text';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { richInput } from './report-theme.spec-helpers';
import { PdfRun, readPdfRuns, runOf } from './report-pdf-read.spec-helpers';

/**
 * REPORT THEME "Modern — Source Sans 3" (owner's typography spec 2026-09-30).
 * Renders REAL PDFs (the rich multi-department fixture) and reads every text
 * run back — font (embedded face name), size, position — to pin the spec:
 * lab name 21pt Bold, test names Semibold, results Semibold / abnormal and
 * the tech's bold override Bold, specimen italic, disclaimer / footer sizes,
 * native Unicode glyphs, and a header / body that never overlaps.
 * Classic is pinned byte-for-byte by report-theme-classic.spec.ts.
 */
silenceJsdomCanvas();

const FONT_DIR = resolve(process.cwd(), 'apps/lms/public', SOURCE_SANS_DIR);
const fromDisk = async (file: string): Promise<ArrayBuffer> => {
  const b = readFileSync(resolve(FONT_DIR, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const MODERN = { metadata: JSON.stringify({ reportTheme: 'source-sans', options: { abnormalSummary: true, specimenLine: true } }) };

function render(patch: Record<string, unknown> = MODERN, snapPatch: Record<string, unknown> = {}): { pdf: string; runs: PdfRun[]; pages: number } {
  const doc = buildReportPdf(richInput(patch, snapPatch));
  const pdf = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  return { pdf, runs: readPdfRuns(pdf), pages: doc.getNumberOfPages() };
}

const px = (el: TypeEl) => REPORT_TYPE_THEMES['source-sans'].tokens[el].size;

describe('report theme — stored choice', () => {
  it('reads classic for no / junk metadata, and round-trips the modern theme keeping other keys', () => {
    expect(readReportTheme(null)).toBe('classic');
    expect(readReportTheme({ metadata: '{bad' })).toBe('classic');
    expect(readReportTheme({ metadata: JSON.stringify({ reportTheme: 'comic-sans' }) })).toBe('classic');
    const meta = writeReportTheme({ metadata: JSON.stringify({ options: { abnormalSummary: true } }) }, 'source-sans');
    expect(readReportTheme({ metadata: meta })).toBe('source-sans');
    expect(JSON.parse(meta).options).toEqual({ abnormalSummary: true });
    // Back to Classic stores nothing.
    expect(JSON.parse(writeReportTheme({ metadata: meta }, 'classic')).reportTheme).toBeUndefined();
  });

  it('every theme defines every element', () => {
    const keys = Object.keys(REPORT_TYPE_THEMES.classic.tokens).sort();
    expect(Object.keys(REPORT_TYPE_THEMES['source-sans'].tokens).sort()).toEqual(keys);
  });

  it('the Modern theme holds the spec values', () => {
    const t = REPORT_TYPE_THEMES['source-sans'].tokens;
    const want: Array<[TypeEl, number, string]> = [
      ['labName', 21, 'bold'], ['taglinePipes', 9.5, 'semibold'], ['labAddress', 9, 'normal'],
      ['patientName', 11.5, 'semibold'], ['demoLabel', 9.5, 'normal'], ['demoValue', 10, 'semibold'],
      ['mrnValue', 9.5, 'semibold'], ['regLabel', 9, 'normal'], ['barcodeText', 8, 'normal'],
      ['deptName', 13.5, 'bold'], ['columnHead', 9.5, 'semibold'], ['panelName', 11, 'bold'],
      ['testName', 10, 'semibold'], ['result', 10.5, 'semibold'], ['resultAbnormal', 10.5, 'bold'],
      ['unit', 9, 'normal'], ['range', 9, 'normal'], ['methodology', 8.5, 'normal'], ['specimen', 8.5, 'italic'],
      ['description', 8.5, 'normal'], ['interpretation', 9, 'normal'], ['summaryTitle', 12.5, 'bold'],
      ['summaryText', 9, 'normal'], ['endMarker', 8, 'semibold'], ['signatureName', 10, 'semibold'],
      ['signatureTitle', 8.5, 'normal'], ['signatureReg', 8, 'normal'], ['signatureStatement', 8, 'normal'],
      ['disclaimer', 7.5, 'normal'], ['reportId', 8, 'normal'], ['generated', 7.5, 'normal'],
      ['pageNumber', 8, 'normal'], ['poweredBy', 7, 'normal'],
    ];
    for (const [el, size, weight] of want) expect([el, t[el].size, t[el].weight]).toEqual([el, size, weight]);
    expect(REPORT_TYPE_THEMES['source-sans'].deptRule).toBe(1.5);
  });
});

describe('report theme — font loading is lazy', () => {
  afterEach(() => resetReportFonts());

  it('a Classic template fetches no font', async () => {
    resetReportFonts();
    await prepareReportTheme(richInput().template);
    expect(reportFontsLoaded()).toBe(false);
  });

  it('a failed fetch resolves false and the report still renders (Helvetica, Modern sizes)', async () => {
    resetReportFonts();
    expect(await loadReportFonts(() => Promise.reject(new Error('offline')))).toBe(false);
    const { runs } = render();
    const name = runOf(runs, 'MICRO');
    expect(name.font).toBe('Helvetica-Bold');
    expect(name.size).toBe(21);
  });
});

describe('report theme — Modern — Source Sans 3 (real PDF read-back)', () => {
  beforeAll(async () => { resetReportFonts(); expect(await loadReportFonts(fromDisk)).toBe(true); });
  afterAll(() => resetReportFonts());
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('embeds the four static faces under their own PostScript names', () => {
    const { pdf } = render();
    for (const n of ['SourceSans3-Regular', 'SourceSans3-Semibold', 'SourceSans3-Bold', 'SourceSans3-It']) {
      expect(pdf).toContain(`/BaseFont /${n}`);
    }
    expect(pdf).toContain('/FontFile2');
    expect(pdf).not.toContain('/BaseFont /Helvetica');   // only used fonts are written
  });

  it('letterhead: lab name 21pt Bold, tagline Semibold, contact Regular', () => {
    const { runs } = render();
    expect(runOf(runs, 'MICRO')).toMatchObject({ font: 'SourceSans3-Bold', size: 21 });
    expect(runOf(runs, 'Accurate')).toMatchObject({ font: 'SourceSans3-Semibold', size: px('taglinePipes') });
    expect(runOf(runs, 'Gandhi Road')).toMatchObject({ font: 'SourceSans3-Regular', size: px('labAddress') });
    expect(runOf(runs, '+91 98400')).toMatchObject({ font: 'SourceSans3-Regular', size: px('labContact') });
  });

  it('patient strip: name Semibold, labels Regular, values / MRN Semibold', () => {
    const { runs } = render();
    expect(runOf(runs, 'Lakshmi')).toMatchObject({ font: 'SourceSans3-Semibold' });
    expect(runOf(runs, 'Lakshmi').size).toBeLessThanOrEqual(11.5);
    expect(runOf(runs, 'Age : ')).toMatchObject({ font: 'SourceSans3-Regular', size: 9.5 });
    expect(runOf(runs, 'MRN : ')).toMatchObject({ font: 'SourceSans3-Regular', size: 9.5 });
    expect(runOf(runs, 'CHN-2609-004217-3')).toMatchObject({ font: 'SourceSans3-Semibold', size: 9.5 });
    expect(runOf(runs, 'Registered on')).toMatchObject({ font: 'SourceSans3-Regular', size: 9 });
  });

  it('results: department Bold 13.5, headings Semibold, panel Bold 11, test name Semibold 10', () => {
    const { runs } = render();
    // (The summary sheet lists departments too, smaller — the band is 13.5.)
    const bands = runs.filter(r => r.text === 'BIOCHEMISTRY');
    expect(bands.some(r => r.font === 'SourceSans3-Bold' && r.size === 13.5)).toBe(true);
    expect(runOf(runs, 'Investigation')).toMatchObject({ font: 'SourceSans3-Semibold', size: 9.5 });
    expect(runOf(runs, 'LIVER FUNCTION TEST')).toMatchObject({ font: 'SourceSans3-Bold', size: 11 });
    expect(runOf(runs, 'Haemoglobin')).toMatchObject({ font: 'SourceSans3-Semibold', size: 10 });
  });

  it('values: normal Semibold, abnormal Bold, the tech bold override Bold — all 10.5', () => {
    const { runs } = render();
    // Units are linked into the result cell ("7.9 ×10⁹/L").
    expect(runOf(runs, '7.9')).toMatchObject({ font: 'SourceSans3-Semibold', size: 10.5 });
    expect(runOf(runs, '96 U/L')).toMatchObject({ font: 'SourceSans3-Bold', size: 10.5 });           // ALT high
    expect(runOf(runs, '13.8 g/dL')).toMatchObject({ font: 'SourceSans3-Bold', size: 10.5 });        // bold override
    expect(runOf(runs, '13.0 – 17.0')).toMatchObject({ font: 'SourceSans3-Regular', size: 9 });      // range
  });

  it('method Regular 8.5, specimen Italic 8.5, description 8.5, interpretation 9', () => {
    const { runs } = render();
    expect(runOf(runs, 'Specimen: EDTA Whole Blood')).toMatchObject({ font: 'SourceSans3-It', size: 8.5 });
    expect(runOf(runs, 'Method: Flow cytometry')).toMatchObject({ font: 'SourceSans3-Regular', size: 8.5 });
    expect(runOf(runs, 'Enzyme mostly from liver')).toMatchObject({ font: 'SourceSans3-Regular', size: 8.5 });
    expect(runOf(runs, 'Interpretation:')).toMatchObject({ font: 'SourceSans3-Semibold', size: 9 });
  });

  it('summary, end marker, signatures, footer', () => {
    const { runs } = render();
    expect(runOf(runs, 'SUMMARY OF ABNORMAL RESULTS')).toMatchObject({ font: 'SourceSans3-Bold', size: 12.5 });
    expect(runOf(runs, 'outside the reference range')).toMatchObject({ font: 'SourceSans3-Regular', size: 9 });
    expect(runOf(runs, 'End of Report')).toMatchObject({ font: 'SourceSans3-Semibold', size: 8 });
    expect(runOf(runs, 'Dr. Meena Iyer')).toMatchObject({ font: 'SourceSans3-Semibold', size: 10 });
    expect(runOf(runs, '(MD Biochemistry)')).toMatchObject({ font: 'SourceSans3-Regular', size: 8.5 });
    expect(runOf(runs, 'Reg. TNMC 88213')).toMatchObject({ font: 'SourceSans3-Regular', size: 8 });
    expect(runOf(runs, 'digitally signed')).toMatchObject({ font: 'SourceSans3-Regular', size: 7.5 });
    expect(runOf(runs, 'Generated on')).toMatchObject({ font: 'SourceSans3-Regular', size: 7.5 });
    expect(runOf(runs, 'Powered by')).toMatchObject({ font: 'SourceSans3-Regular', size: 7 });
    const pageNo = runs.find(r => r.page === 1 && r.text === '1' && r.x > 500);
    expect(pageNo).toMatchObject({ font: 'SourceSans3-Regular', size: 8 });
  });

  it('prints ₹ µ ° ≤ ≥ × ⁹ natively — no transliteration, no Symbol font', () => {
    const { pdf, runs } = render();
    const all = runs.map(r => r.text).join('\n');
    for (const g of ['₹', 'µIU/mL', '°C', '≤ 41', '≥ 126', '×10⁹/L', '×10¹²/L', '10⁵']) expect(all).toContain(g);
    expect(all).not.toContain('>=');
    expect(all).not.toContain('^9');
    expect(all).not.toContain('�');
    expect(pdf).not.toContain('/BaseFont /Symbol');
  });

  it('a glyph the font lacks never truncates the line', () => {
    const font = { metadata: { characterToGlyph: (c: number) => (c === 0x4e2d ? 0 : 1) } };
    expect(unicodeFontSafeText('ab中cd', font)).toBe('ab?cd');
  });

  it('multi-page: profile panel, culture + AST, summary, signatures and footer all print', () => {
    const { runs, pages } = render();
    expect(pages).toBeGreaterThanOrEqual(2);
    for (const s of ['LIVER FUNCTION TEST', 'Antimicrobial for Escherichia coli', 'Ciprofloxacin', 'URINE CULTURE & SENSITIVITY',
                     'Dr. S. Balaji', 'PERIPHERAL SMEAR', 'Temperature noted']) runOf(runs, s);
    expect(runOf(runs, 'Amikacin')).toMatchObject({ font: 'SourceSans3-Semibold', size: 10 });
    const last = Math.max(...runs.map(r => r.page));
    expect(runs.some(r => r.page === last && r.text.includes('Powered by'))).toBe(true);
  });

  it('a long test name wraps inside its column', () => {
    const { runs } = render();
    const parts = runs.filter(r => r.font === 'SourceSans3-Semibold' && r.size === 10
      && /Mean Platelet Volume|must wrap|inside its column|unusually long/.test(r.text));
    // One name, several drawn lines (a single-line name would be one run).
    expect(parts.length).toBeGreaterThanOrEqual(2);
  });

  it('header never overlaps — long lab name + long address, every header style', () => {
    const longName = 'Sri Venkateswara Advanced Diagnostic and Research Laboratories';
    const longAddress = 'No. 12, 3rd Floor, Sri Krishna Towers, 145 Anna Salai, Near Gemini Flyover, Teynampet, Chennai, Tamil Nadu 600018, India'
      + ' (opposite the Metro station, Gate 2) — open 6 AM to 10 PM, all days';
    for (const headerPreset of ['classic', 'centered', 'banner', 'minimal']) {
      const input = richInput({ ...MODERN, headerPreset, labName: longName, address: longAddress });
      const layout = computeReportPageLayout(input);
      const items = layout.items.filter(i => i.region === 'header' && !i.hidden && i.kind !== 'banner' && i.kind !== 'bar');
      const pageR = 595.28 - 30 + 0.5;
      for (const it of items) {
        expect(it.box.x, `${headerPreset}/${it.id} left`).toBeGreaterThanOrEqual(-0.5);
        expect(it.box.x + it.box.w, `${headerPreset}/${it.id} right`).toBeLessThanOrEqual(pageR);
      }
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i].box, b = items[j].box;
        const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
        expect(overlap, `${headerPreset}: ${items[i].id} overlaps ${items[j].id}`).toBe(false);
      }
      expect(layout.bodyTop, `${headerPreset}: patient block below the letterhead`).toBeGreaterThanOrEqual(layout.headerBottom);
      const addr = layout.items.find(i => i.id === 'address' || i.id === 'contact');
      if (addr && (addr.text ?? '').includes('Teynampet')) expect((addr.lines ?? []).length).toBeGreaterThan(1);
    }
  });

  it('the theme picks by template: Classic stays on the built-in fonts even with Source Sans loaded', () => {
    const { pdf } = render({});
    expect(pdf).not.toContain('SourceSans3');
    expect(reportTypeTheme(richInput().template).id).toBe('classic');
  });
});
