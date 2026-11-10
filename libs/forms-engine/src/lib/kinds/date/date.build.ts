import { ANSWERED_OPS, KindBuild } from '../../build/contract';

/** Studio descriptor for `date`. */
export const DATE_BUILD: KindBuild = {
  kind: 'date',
  name: 'Date',
  hint: 'A calendar date: date of birth, onset, last visit. Written as dd/mm/yyyy.',
  icon: 'calendar',
  group: 'Measure',
  sentence: (label) => `${label}: {value}.`,
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'allowFuture', label: 'Allow dates after today' },
    { name: 'quickChips', label: 'Quick picks (this week, last week…)' },
  ],
  sample: () => '2024-01-15',
};
