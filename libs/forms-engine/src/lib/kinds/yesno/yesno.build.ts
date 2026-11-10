import { ANSWERED_OPS, KindBuild, opt } from '../../build/contract';
import { cfg } from '../../core/types';

const isTick = (f: { config?: Record<string, unknown> }) => f.config?.['display'] === 'check';

/** Studio descriptor for `yesno`. */
export const YESNO_BUILD: KindBuild = {
  kind: 'yesno',
  name: 'Yes / No',
  hint: 'A yes or no question. Yes and No can each say their own words and ask follow-ups.',
  icon: 'k-yesno',
  group: 'Ask',
  starterOptions: [opt('yes', 'Yes'), opt('no', 'No')],
  sentence: () => '',
  ifNone: (f) => (isTick(f) ? 'whenFalse' : 'noOption'),
  conditionValue: 'yesno',
  conditionOps: [{ op: 'equals', words: 'is' }, ...ANSWERED_OPS],
  config: [
    { name: 'display', label: 'Shown as', choices: { buttons: 'Yes / No buttons', switch: 'A switch', check: 'A tick box' } },
    { name: 'allowNa', label: 'Offer "Not applicable"' },
    { name: 'labelFallback', label: 'Write the question when an answer has no words' },
  ],
  sample: (f) => (cfg<string>(f, 'display', 'buttons') === 'check' ? true : 'yes'),
};
