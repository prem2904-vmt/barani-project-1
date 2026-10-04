import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadReportFonts, resetReportFonts, SOURCE_SANS_DIR } from '../report-fonts';
import { readPdfRuns } from '../report-pdf-read.spec-helpers';
import { silenceJsdomCanvas } from '../report-header-legacy.spec-helpers';
import { CATALOGUE_SAMPLES } from './report-chart.catalogue.spec-helpers';
import { buildChartReport } from './report-chart.spec-helpers';

/**
 * A chart in the Modern report theme prints in the theme's family (Source
 * Sans 3, through the same weight → face resolver the tables use), and in
 * Classic stays Helvetica. With CHART_SHOTS_DIR set, also writes the owner's
 * Classic / Modern sample PDFs (donut of counts, gauge, OGTT line).
 */
silenceJsdomCanvas();

const FONT_DIR = resolve(process.cwd(), 'apps/lms/public', SOURCE_SANS_DIR);
const fromDisk = async (file: string): Promise<ArrayBuffer> => {
  const b = readFileSync(resolve(FONT_DIR, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const MODERN = { metadata: JSON.stringify({ reportTheme: 'source-sans' }) };
const sample = (n: string) => CATALOGUE_SAMPLES.find(s => s.name === n)!;
const render = (n: string, modern: boolean) => {
  const s = sample(n);
  return buildChartReport({ tests: s.tests, chartOwner: s.owner, spec: s.spec, title: `Zchart ${s.name}`, titles: s.titles,
    flagStyle: 'bold_color', template: modern ? MODERN : undefined });
};
/** The chart's text runs: everything on the chart's page from its title down. */
function chartRuns(pdf: string, title: string) {
  const runs = readPdfRuns(pdf);
  const t = runs.find(r => r.text === title)!;
  expect(t, title).toBeTruthy();
  return runs.filter(r => r.page === t.page && r.y <= t.y + 0.5);
}
const latin1 = (doc: ReturnType<typeof render>) => Buffer.from(doc.output('arraybuffer')).toString('latin1');

describe('report chart — Modern theme (Source Sans 3)', () => {
  beforeAll(async () => { resetReportFonts(); expect(await loadReportFonts(fromDisk)).toBe(true); });
  afterAll(() => resetReportFonts());

  for (const n of ['donut-counts', 'gauge', 'line']) {
    it(`${n}: every chart label is a Source Sans 3 face (bold / italic included), no Helvetica`, () => {
      const pdf = latin1(render(n, true));
      const runs = chartRuns(pdf, `Zchart ${n}`);
      expect(runs.length).toBeGreaterThan(3);
      for (const r of runs) expect(r.font, r.text).toMatch(/^SourceSans3-/);
      expect(pdf).not.toContain('/BaseFont /Helvetica');
      if (n === 'donut-counts') {
        expect(runs.some(r => r.font === 'SourceSans3-Bold' && r.text === '78 %')).toBe(true);     // the share, bold
        expect(runs.some(r => r.font === 'SourceSans3-It' && /share of the total/.test(r.text))).toBe(true);
      }
    });
  }

  it('Classic stays Helvetica', () => {
    resetReportFonts();
    const runs = chartRuns(latin1(render('donut-counts', false)), 'Zchart donut-counts');
    expect(runs.every(r => /^Helvetica/.test(r.font))).toBe(true);
  });
});

const dir = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['CHART_SHOTS_DIR'];
describe.skipIf(!dir)('report chart — Classic / Modern sample PDFs', () => {
  it('writes the donut-of-counts, gauge and OGTT line in both themes', async () => {
    const fs = await import('node:fs');
    for (const modern of [false, true]) {
      resetReportFonts();
      if (modern) expect(await loadReportFonts(fromDisk)).toBe(true);
      for (const n of ['donut-counts', 'gauge', 'line']) {
        fs.writeFileSync(`${dir}/ctpush-${n}-${modern ? 'modern' : 'classic'}.pdf`, new Uint8Array(render(n, modern).output('arraybuffer')));
      }
    }
    resetReportFonts();
  });
});
