import { ANSWERED_OPS, KindBuild } from '../../build/contract';

/** Studio descriptor for `repeat`. Its rows are written by `config.narrativeTemplate` ({{childKey}}, {{index}}, {{groupLabel}}). */
export const REPEAT_BUILD: KindBuild = {
  kind: 'repeat',
  name: 'Repeating group',
  hint: 'A few questions the doctor can add again and again: each ulcer, each scar.',
  icon: 'k-repeat',
  group: 'Repeat',
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'labelPrefix', label: 'Each one is called' },
    { name: 'minCount', label: 'At least' },
    { name: 'maxCount', label: 'At most' },
    { name: 'defaultCount', label: 'Starts with' },
    { name: 'narrativeTemplate', label: 'Each one says', hint: 'Tap a question below to put its answer in.' },
    { name: 'separateNarrativeSections', label: 'Each one in its own paragraph' },
  ],
  sample: () => [{}],
};
