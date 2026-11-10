import { ANSWERED_OPS, KindBuild, opt } from '../../build/contract';

/** Studio descriptor for `multi`. */
export const MULTI_BUILD: KindBuild = {
  kind: 'multi',
  name: 'Multiple choice',
  hint: 'Tick any number: complaints, triggers. What was not ticked can be written as "Denies …".',
  icon: 'list-check',
  group: 'Ask',
  starterOptions: [opt('first', 'First choice'), opt('second', 'Second choice'), opt('third', 'Third choice')],
  sentence: () => 'The patient reports {value}.',
  ifNone: 'negativeHistory',
  conditionValue: 'options',
  conditionOps: [
    { op: 'contains', words: 'includes' },
    { op: 'notContains', words: 'does not include' },
    ...ANSWERED_OPS,
  ],
  config: [{ name: 'display', label: 'Shown as', choices: { chips: 'Cards', list: 'Cards (older forms)', dropdown: 'A drop-down (long lists)' } }],
  sample: (f) => (f.options ?? []).slice(0, 2).map((o) => o.key),
};
