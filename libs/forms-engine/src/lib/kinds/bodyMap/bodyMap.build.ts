import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { pictureConfig } from '../../canvas/picture';
import { BodyMapPanelComponent } from './bodyMap.studio';

/**
 * Studio descriptor for `bodyMap` (API "Image kinds"): areas are the picture's (their words in `config.regions`);
 * fixed tap markers are the field's OPTIONS (words, follow-ups) placed by `config.markers`.
 */
export const BODY_MAP_BUILD: KindBuild = {
  kind: 'bodyMap',
  name: 'Body map',
  hint: 'A body, face, eye or teeth picture: the doctor taps areas and markers, drops pins, adds a note.',
  icon: 'k-body',
  group: 'Picture',
  starterConfig: { template: 'body-front' },
  sentence: () => '',
  ifNone: null,
  conditionValue: (f) => (pictureConfig(f).markers.length ? 'options' : 'none'),
  conditionOps: (f) =>
    pictureConfig(f).markers.length
      ? [{ op: 'contains', words: 'includes' }, { op: 'notContains', words: 'does not include' }, ...ANSWERED_OPS]
      : ANSWERED_OPS,
  config: [
    { name: 'allowInk', label: 'Pen', hint: 'The doctor can also draw on the picture.' },
    { name: 'allowLabels', label: 'Text on the picture' },
    { name: 'maxPins', label: 'Most pins', hint: '0 = no pins.' },
    { name: 'showDescription', label: 'Description box' },
    { name: 'regionSentence', label: 'Says for marked areas', hint: 'Default “Marked over {regions}.”' },
  ],
  sample: (f) => {
    const m = pictureConfig(f).markers.slice(0, 1).map((x) => x.key);
    return { regions: [{ id: 'abdomen' }], ...(m.length ? { markers: m } : {}) };
  },
  panel: BodyMapPanelComponent,
};
