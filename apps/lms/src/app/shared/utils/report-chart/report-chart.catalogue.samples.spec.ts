import { CATALOGUE_SAMPLES } from './report-chart.catalogue.spec-helpers';
import { buildChartReport } from './report-chart.spec-helpers';

/** Writes one sample PDF per chart type when CHART_SHOTS_DIR is set (skipped
 *  in the normal suite). */
const dir = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['CHART_SHOTS_DIR'];
const unz = <T,>(t: T): T => JSON.parse(JSON.stringify(t)
  .replace(/Zfasting Glucose/g, 'Fasting Plasma Glucose').replace(/Zogtt (\d+) Minutes/g, 'OGTT – $1 Minutes')
  .replace(/ZORAL GLUCOSE TOLERANCE/g, 'Oral Glucose Tolerance Test').replace(/Zlipid Profile/g, 'Lipid Profile')
  .replace(/Zdifferential Count/g, 'Differential Leucocyte Count').replace(/Zglycated Haemoglobin/g, 'Glycated Haemoglobin (HbA1c)')
  .replace(/Zliver Function Test/g, 'Liver Function Test').replace(/Zurine Protein (\d+) h/g, 'Urine Protein – from $1 h')
  .replace(/ZSPLIT URINE PROTEIN/g, 'Split 24-hour Urine Protein'));

describe.skipIf(!dir)('report chart catalogue sample PDFs', () => {
  it('writes one PDF per chart type', async () => {
    const fs = await import('node:fs');
    for (const s of CATALOGUE_SAMPLES) {
      for (const flagStyle of ['bold_color'] as const) {
        const doc = buildChartReport({ tests: unz(s.tests), chartOwner: s.owner, spec: s.spec, title: s.title, titles: s.titles,
          flagStyle, patientName: 'Asha Verma' });
        fs.writeFileSync(`${dir}/charttypes-${s.name}.pdf`, new Uint8Array(doc.output('arraybuffer')));
      }
    }
    expect(fs.existsSync(`${dir}/charttypes-gauge.pdf`)).toBe(true);
  });
});
