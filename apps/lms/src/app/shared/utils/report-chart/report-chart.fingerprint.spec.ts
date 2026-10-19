import { buildChartData } from './report-chart.data';
import { layoutChart } from './report-chart.layout';
import { LIPID_SPEC, LIPID_TITLES, OGTT_SPEC, fingerprint, lipidTest, ogttTests } from './report-chart.spec-helpers';

const OLD = {
  ogttLine: () => layoutChart(buildChartData(OGTT_SPEC, 'Glucose curve', 'zogtt', ogttTests([92, 168, null, 131, 212]))!, 535),
  ogttDots: () => layoutChart(buildChartData({ ...OGTT_SPEC, kind: 'dots' }, 'Glucose curve', 'zogtt', ogttTests([92, 168, 155, 131, 118]))!, 535),
  ogttTwoLines: () => layoutChart(buildChartData({ ...OGTT_SPEC, lines: [{ unit: 'mg/dL' }, { unit: 'µIU/mL', label: 'Insulin' }] }, 'G', 'zogtt',
    ogttTests([92, 168, 155, 131, 118], { secondLine: [6, 48, 52, null, 20] }))!, 535),
  ogttTwoBars: () => layoutChart(buildChartData({ ...OGTT_SPEC, kind: 'bar', lines: [{ unit: 'mg/dL' }, { unit: 'µIU/mL', label: 'Insulin' }] }, 'G', 'zogtt',
    ogttTests([92, 168, 155, 131, 118], { secondLine: [6, 48, 52, null, 20] }))!, 535),
  lipidBar: () => layoutChart(buildChartData(LIPID_SPEC, 'Lipid fractions', 'zlipid', [lipidTest({ tc: 232, hdl: 36, ldl: 150, vldl: 28, tg: 142 })], LIPID_TITLES)!, 535),
  lipidHalf: () => layoutChart(buildChartData({ ...LIPID_SPEC, size: 'half' }, 'Lipid fractions', 'zlipid', [lipidTest({ tc: 180, hdl: 52, ldl: 90, vldl: 20, tg: 110 })], LIPID_TITLES)!, 268),
};

/** Captured on feat/tm-report-charts BEFORE the chart-type catalogue: the v1
 *  kinds must keep drawing exactly these operations (old saved configs). */
const BASELINE: Record<keyof typeof OLD, string> = {
  ogttLine: '3621613a:222', ogttDots: 'c73fb089:203', ogttTwoLines: '3f97b222:203',
  ogttTwoBars: '92aeee57:203', lipidBar: '4dec751f:203', lipidHalf: 'be4344c2:179',
};

describe('report chart — fingerprints', () => {
  for (const k of Object.keys(OLD) as Array<keyof typeof OLD>) {
    it(`v1 ${k} draws exactly what it drew before the new chart types`, () => {
      const l = OLD[k]();
      expect(`${fingerprint(l.ops)}:${l.height}`).toBe(BASELINE[k]);
    });
  }
});
