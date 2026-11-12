import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { ReadingsPanelComponent } from './readings.studio';
import { columnsOf, stamp } from './readings.fill';

/** Studio descriptor for `readings`: the columns (a name and a unit each; intake / output) are set in its panel. */
export const READINGS_BUILD: KindBuild = {
  kind: 'readings',
  name: 'Readings over time',
  hint: 'The same few readings taken again and again: vitals every 4 hours, a sugar chart, intake and output.',
  icon: 'k-readings',
  group: 'Repeat',
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [{ name: 'showCharts', label: 'A small chart for each reading on the printout' }],
  sample: (f) => {
    const cols = columnsOf(f.config);
    const day = stamp(new Date(2026, 0, 1, 8, 0)).slice(0, 10);
    return {
      rows: [0, 1, 2].map((i) => ({
        time: `${day}T${String(8 + 4 * i).padStart(2, '0')}:00`,
        values: Object.fromEntries(cols.map((c) => [c.key, Math.round(((c.min ?? 0) + ((c.max ?? 100) - (c.min ?? 0)) * (0.4 + 0.1 * i)) * 10) / 10])),
      })),
    };
  },
  panel: ReadingsPanelComponent,
};
