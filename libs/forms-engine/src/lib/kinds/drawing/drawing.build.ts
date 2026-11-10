import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { DrawingPanelComponent } from './drawing.studio';

/** Studio descriptor for `drawing` (API "Image kinds"): the picture and its areas are set in its panel. */
export const DRAWING_BUILD: KindBuild = {
  kind: 'drawing',
  name: 'Drawing',
  hint: 'Draw with a finger or a pen on a blank sheet, a body, an eye or a picture you upload.',
  icon: 'k-drawing',
  group: 'Picture',
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'showDescription', label: 'Description box', hint: 'A line under the drawing for what it shows.' },
    { name: 'allowLabels', label: 'Text on the picture' },
    { name: 'maxPins', label: 'Most pins', hint: '0 = no pins.' },
    { name: 'attachedSentence', label: 'Says when drawn', hint: 'Default “Drawing attached.”; empty = nothing.' },
  ],
  sample: () => ({
    description: 'Swelling on the dorsum of the hand.',
    strokes: [{ tool: 'pen', color: '#dc2626', width: 0.006, points: [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]] }],
  }),
  panel: DrawingPanelComponent,
};
