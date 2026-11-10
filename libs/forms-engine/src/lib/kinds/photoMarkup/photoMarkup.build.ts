import { ANSWERED_OPS, KindBuild } from '../../build/contract';

/** Studio descriptor for `photoMarkup` (API "Image kinds"). */
export const PHOTO_MARKUP_BUILD: KindBuild = {
  kind: 'photoMarkup',
  name: 'Photo with markings',
  hint: 'One photo taken on the spot, marked up with the pen, pins and text, with a description.',
  icon: 'k-photo',
  group: 'Picture',
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'photoSource', label: 'Photo from', choices: { either: 'Camera or library', camera: 'Camera only', upload: 'Library only' } },
    { name: 'showDescription', label: 'Description box' },
    { name: 'maxPins', label: 'Most pins', hint: '0 = no pins.' },
    { name: 'attachedSentence', label: 'Says when added', hint: 'Default “Photo attached.”' },
  ],
  sample: () => ({ description: 'Wound on the left shin, day 5.' }),
};
