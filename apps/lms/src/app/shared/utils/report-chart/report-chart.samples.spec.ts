import { LIPID_SPEC, OGTT_SPEC, buildChartReport, lipidTest, ogttTests } from './report-chart.spec-helpers';

/**
 * Writes the owner's sample PDFs when CHART_SHOTS_DIR is set (skipped in the
 * normal suite): OGTT normal / diabetic / missed time point, lipid bars.
 */
const dir = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['CHART_SHOTS_DIR'];

const NAMES: Array<[RegExp, string]> = [
  [/Zfasting Glucose/g, 'Fasting Plasma Glucose'], [/Zogtt (\d+) Minutes/g, 'OGTT – $1 Minutes'],
  [/ZORAL GLUCOSE TOLERANCE/g, 'Oral Glucose Tolerance Test'], [/Zlipid Profile/g, 'Lipid Profile'],
];
const unz = <T extends Record<string, unknown>>(t: T): T =>
  JSON.parse(NAMES.reduce((s, [re, to]) => s.replace(re, to), JSON.stringify(t)));

describe.skipIf(!dir)('report chart sample PDFs', () => {
  it('writes the samples', async () => {
    const fs = await import('node:fs');
    const write = (name: string, doc: { output: (t: 'arraybuffer') => ArrayBuffer }) =>
      fs.writeFileSync(`${dir}/${name}.pdf`, new Uint8Array(doc.output('arraybuffer')));
    const ogtt = (vals: Array<number | null>) => ogttTests(vals).map(unz);
    write('chart-ogtt-normal', buildChartReport({ tests: ogtt([88, 142, 128, 112, 104]), chartOwner: 'zogtt', spec: OGTT_SPEC,
      title: 'Glucose tolerance curve', flagStyle: 'bold_color', patientName: 'Asha Verma' }));
    write('chart-ogtt-diabetic', buildChartReport({ tests: ogtt([132, 238, 276, 258, 231]), chartOwner: 'zogtt', spec: OGTT_SPEC,
      title: 'Glucose tolerance curve', flagStyle: 'bold_color', patientName: 'Asha Verma' }));
    write('chart-ogtt-missed', buildChartReport({ tests: ogtt([94, 171, null, 139, 126]), chartOwner: 'zogtt', spec: OGTT_SPEC,
      title: 'Glucose tolerance curve', flagStyle: 'bold', patientName: 'Asha Verma' }));
    write('chart-lipid-bar', buildChartReport({ tests: [unz(lipidTest({ tc: 232, hdl: 36, ldl: 150, vldl: 28, tg: 142 }))],
      chartOwner: 'zlipid', spec: LIPID_SPEC, title: 'Lipid fractions', flagStyle: 'bold_color', patientName: 'Asha Verma' }));
    write('chart-ogtt-pagebreak', buildChartReport({ tests: ogtt([88, 142, 128, 112, 104]), chartOwner: 'zogtt', spec: OGTT_SPEC,
      title: 'Glucose tolerance curve', flagStyle: 'bold_color', fillers: 22, patientName: 'Asha Verma' }));
    expect(fs.existsSync(`${dir}/chart-lipid-bar.pdf`)).toBe(true);
  });
});
