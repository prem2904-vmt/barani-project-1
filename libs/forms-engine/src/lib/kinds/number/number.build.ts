import { KindBuild, NUMBER_OPS } from '../../build/contract';
import { cfg } from '../../core/types';

/** Studio descriptor for `number`. */
export const NUMBER_BUILD: KindBuild = {
  kind: 'number',
  name: 'Number',
  hint: 'An age, a count or a reading, typed on the number pad.',
  icon: 'k-number',
  group: 'Measure',
  sentence: (label) => `${label}: {value}.`,
  ifNone: null,
  conditionValue: 'number',
  conditionOps: NUMBER_OPS,
  config: [
    { name: 'unit', label: 'Unit (shown after the number)' },
    { name: 'min', label: 'Lowest allowed' },
    { name: 'max', label: 'Highest allowed' },
    { name: 'step', label: 'Steps of' },
    { name: 'display', label: 'Looks like', choices: { box: 'A number box', stepper: '− and + buttons with a number pad' } },
  ],
  sample: (f) => {
    const min = cfg<number | null>(f, 'min', null);
    const max = cfg<number | null>(f, 'max', null);
    if (min !== null && max !== null) return Math.round((min + max) / 2);
    return min !== null ? min + 1 : 42;
  },
};
