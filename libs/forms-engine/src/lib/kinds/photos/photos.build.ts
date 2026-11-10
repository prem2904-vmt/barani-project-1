import { ANSWERED_OPS, KindBuild } from '../../build/contract';

/** Studio descriptor for `photos` (legacy image gallery; API "Image kinds"). */
export const PHOTOS_BUILD: KindBuild = {
  kind: 'photos',
  name: 'Photos',
  hint: 'A few photos with captions, each can be marked up.',
  icon: 'k-photo',
  group: 'Picture',
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'maxPhotos', label: 'Most photos', hint: 'Up to 20.' },
    { name: 'photoSource', label: 'Photos from', choices: { either: 'Camera or library', camera: 'Camera only', upload: 'Library only' } },
    { name: 'layout', label: 'Printed as', choices: { '1x1': 'One', '1x2': 'Two side by side', '2x1': 'Two stacked', '2x2': 'Two by two', '2x3': 'Two by three', '3x2': 'Three by two' } },
    { name: 'requireDescription', label: 'Caption needed' },
    { name: 'attachedSentence', label: 'Says when added', hint: 'Default “N photos attached.”; {count} is the number.' },
  ],
  sample: () => ({ photos: [{ photo: '00000000-0000-4000-8000-000000000001', description: 'Left ear, tympanic membrane' }] }),
};
