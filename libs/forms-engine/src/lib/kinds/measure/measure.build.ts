import { KindBuild, NUMBER_OPS } from '../../build/contract';
import { cfg } from '../../core/types';

/** Studio descriptor for `measure`. */
export const MEASURE_BUILD: KindBuild = {
  kind: 'measure',
  name: 'Reading on a slider',
  hint: 'One reading with a unit on a big slider: weight, pain score, temperature.',
  icon: 'k-measure',
  group: 'Measure',
  sentence: (label) => `${label}: {value}.`,
  ifNone: null,
  conditionValue: 'number',
  conditionOps: NUMBER_OPS,
  config: [
    { name: 'unit', label: 'Unit' },
    { name: 'min', label: 'Lowest' },
    { name: 'max', label: 'Highest' },
    { name: 'step', label: 'Steps of' },
  ],
  sample: (f) => {
    const min = cfg(f, 'min', 0);
    const max = cfg(f, 'max', 200);
    return { value: Math.round((min + max) / 2), unit: cfg<string>(f, 'unit', '') };
  },
};
