import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { CHOICE_BUILD } from '../choice/choice.build';
import { MEASURE_BUILD } from '../measure/measure.build';
import { MULTI_BUILD } from '../multi/multi.build';
import { NUMBER_BUILD } from '../number/number.build';
import { SHORTHAND_BUILD } from '../shorthand/shorthand.build';
import { TEXT_BUILD } from '../text/text.build';
import { SidePairPanelComponent } from './sidePair.studio';
import { innerOf } from './side-pair-model';

/** The descriptors of the kinds a pair can ask (imported directly: build-registry imports this file). */
const INNER_BUILDS: Record<string, KindBuild | undefined> = {
  number: NUMBER_BUILD,
  measure: MEASURE_BUILD,
  choice: CHOICE_BUILD,
  multi: MULTI_BUILD,
  text: TEXT_BUILD,
  shorthand: SHORTHAND_BUILD,
};

/** Studio descriptor for `sidePair`. The question asked for each side is set in its panel; the words, order and labels below. */
export const SIDE_PAIR_BUILD: KindBuild = {
  kind: 'sidePair',
  name: 'Left and right',
  hint: 'One question for both sides, side by side: vision of each eye, power of each limb, a finding in each ear.',
  icon: 'k-pair',
  group: 'Ask',
  starterConfig: { sideWords: 'rightLeft', order: 'rightFirst', bilateral: true },
  starterChild: { kind: 'text', label: 'Finding', config: { multiline: false, format: 'plain', voice: true, suggestions: true } },
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'sideWords', label: 'Side words', choices: { rightLeft: 'Right and Left', eyes: 'RE and LE', ears: 'R ear and L ear' } },
    { name: 'order', label: 'Which side first', choices: { rightFirst: 'Right first', leftFirst: 'Left first' } },
    { name: 'bilateral', label: 'Write “Bilateral” when both sides match' },
    { name: 'rightLabel', label: 'Own word for the right side', hint: 'Leave empty for the usual word.' },
    { name: 'leftLabel', label: 'Own word for the left side', hint: 'Leave empty for the usual word.' },
  ],
  sample: (f: FieldDef) => {
    const inner = innerOf(f);
    const v = inner ? INNER_BUILDS[inner.kind]?.sample(inner) : undefined;
    return v === undefined ? undefined : { right: structuredClone(v), left: structuredClone(v) };
  },
  panel: SidePairPanelComponent,
};
