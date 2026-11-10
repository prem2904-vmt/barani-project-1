import { ANSWERED_OPS, KindBuild, opt } from '../../build/contract';

/** Studio descriptor for `choice`. */
export const CHOICE_BUILD: KindBuild = {
  kind: 'choice',
  name: 'One choice',
  hint: 'Pick one from a short list: side, onset, severity. Each choice can say its own words.',
  icon: 'k-choice',
  group: 'Ask',
  starterOptions: [opt('first', 'First choice'), opt('second', 'Second choice')],
  sentence: (label) => `${label}: {value}.`,
  ifNone: null,
  conditionValue: 'options',
  conditionOps: [{ op: 'equals', words: 'is' }, { op: 'notEquals', words: 'is not' }, ...ANSWERED_OPS],
  config: [
    {
      name: 'display',
      label: 'Shown as',
      choices: { buttons: 'Big buttons', list: 'A list', dropdown: 'A drop-down', images: 'Pictures' },
    },
  ],
  sample: (f) => f.options?.[0]?.key ?? null,
};
