import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { cfg } from '../../core/types';

/** Studio descriptor for `repeatPages`. */
export const REPEAT_PAGES_BUILD: KindBuild = {
  kind: 'repeatPages',
  name: 'Repeating pages',
  hint: 'Repeats whole pages as often as needed: each pregnancy, each operation.',
  icon: 'k-pages',
  group: 'Repeat',
  sentence: () => '',
  ifNone: null,
  conditionValue: 'number',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'labelPrefix', label: 'Each one is called' },
    { name: 'minCount', label: 'At least' },
    { name: 'maxCount', label: 'At most' },
    { name: 'defaultCount', label: 'Starts with' },
    { name: 'mode', label: 'Pages', choices: { uniform: 'The same pages each time', individual: 'Each page once' } },
    { name: 'showIndex', label: 'Number them (1, 2, 3)' },
    { name: 'separateNarrativeSections', label: 'Each one in its own paragraph' },
  ],
  sample: (f) => ({
    instances: cfg<string[]>(f, 'pages', []).slice(0, 1).map((page) => ({ page, index: 0, values: {} })),
  }),
};
