import { ANSWERED_OPS, KindBuild, opt } from '../../build/contract';
import { PictureChoicePanelComponent } from './pictureChoice.studio';

/**
 * Studio descriptor for `pictureChoice`: a multi-select (or single choice) whose choices are pictures laid out in a
 * box. Its narrative is `multi`'s (same words, same follow-ups, same negative history); the parts and the box are
 * set in its panel, the names / sentences / follow-ups under Choices, combination sentences under those.
 */
export const PICTURE_CHOICE_BUILD: KindBuild = {
  kind: 'pictureChoice',
  name: 'Picture choice',
  hint: 'Pictures in a box (a hand, a leg, a tooth): the doctor taps the ones that apply and they light up.',
  icon: 'k-picture',
  group: 'Picture',
  starterConfig: { multiple: true, aspect: 1, showLabels: true },
  starterOptions: [
    { ...opt('part_1', 'Part 1'), place: { x: 0.05, y: 0.05, w: 0.4, h: 0.4 } },
    { ...opt('part_2', 'Part 2'), place: { x: 0.55, y: 0.05, w: 0.4, h: 0.4 } },
  ],
  sentence: () => 'The patient reports {value}.',
  ifNone: 'negativeHistory',
  conditionValue: 'options',
  conditionOps: [
    { op: 'contains', words: 'includes' },
    { op: 'notContains', words: 'does not include' },
    ...ANSWERED_OPS,
  ],
  config: [],
  sample: (f) => (f.options ?? []).slice(0, 2).map((o) => o.key),
  panel: PictureChoicePanelComponent,
};
