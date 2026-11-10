import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { cfg } from '../../core/types';

/** Studio descriptor for `size`. */
export const SIZE_BUILD: KindBuild = {
  kind: 'size',
  name: 'Size',
  hint: 'A size in one to five measurements with a unit: a swelling of 2 × 3 cm.',
  icon: 'k-size',
  group: 'Measure',
  sentence: (label) => `${label} of {value}.`,
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'boxCount', label: 'Number of measurements' },
    {
      name: 'defaultUnit',
      label: 'Unit',
      choices: { cm: 'cm', mm: 'mm', inch: 'inch', feet: 'feet', meter: 'metre' },
    },
  ],
  sample: (f) => ({
    dimensions: [2, 3, 1, 1, 1].slice(0, Math.max(1, Math.min(5, cfg(f, 'boxCount', 2)))),
    unit: cfg<string>(f, 'defaultUnit', 'cm'),
  }),
};
