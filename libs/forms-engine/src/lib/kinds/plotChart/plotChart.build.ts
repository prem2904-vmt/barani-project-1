import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { PlotChartPanelComponent } from './plotChart.studio';
import { presetOf } from './plotchart-value';

/** Studio descriptor for `plotChart` (presets: growth, audiogram, partograph). */
export const PLOT_CHART_BUILD: KindBuild = {
  kind: 'plotChart',
  name: 'Plotted chart',
  hint: 'A growth chart, an audiogram or a labour chart: values plotted on a reference chart, with the centile, hearing grade or alert and action lines worked out.',
  icon: 'k-chart',
  group: 'Measure',
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    {
      name: 'preset',
      label: 'Which chart',
      choices: { growth: 'Growth chart (weight, height, head size)', audiogram: 'Audiogram (hearing)', partograph: 'Partograph (labour)' },
    },
  ],
  sample: (f) => {
    switch (presetOf(f.config)) {
      case 'audiogram':
        return {
          right: { air: { '250': 40, '500': 45, '1000': 45, '2000': 50, '4000': 50, '8000': 60 }, bone: { '500': 40, '1000': 40, '2000': 45, '4000': 50 } },
          left: { air: { '250': 10, '500': 10, '1000': 15, '2000': 10, '4000': 15, '8000': 20 } },
        };
      case 'partograph':
        return {
          readings: [
            { hour: 0, dilatation: 4, descent: 4, fhr: 140, contractions: 2 },
            { hour: 2, dilatation: 5, descent: 4, fhr: 136, contractions: 3 },
            { hour: 4, dilatation: 6, descent: 3, fhr: 128, contractions: 3 },
            { hour: 6, dilatation: 7, descent: 3, fhr: 152, contractions: 4 },
          ],
        };
      default: {
        const m = (f.config?.['measures'] as string[] | undefined)?.[0] ?? 'weight';
        const v = m === 'weight' ? [9.4, 11.2] : m === 'height' ? [76, 81] : [45, 46.5];
        return { sex: 'girl', points: [{ measure: m, age: 12, value: v[0] }, { measure: m, age: 18, value: v[1] }] };
      }
    }
  },
  panel: PlotChartPanelComponent,
};
