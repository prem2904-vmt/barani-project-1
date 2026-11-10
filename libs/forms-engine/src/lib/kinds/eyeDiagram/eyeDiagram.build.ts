import { ANSWERED_OPS, KindBuild } from '../../build/contract';

/** Studio descriptor for `eyeDiagram` (legacy eom + eyeFields as presets). */
export const EYE_DIAGRAM_BUILD: KindBuild = {
  kind: 'eyeDiagram',
  name: 'Eye diagram',
  hint: 'Both eyes: eye movements marked full or restricted, or four boxes around each eye.',
  icon: 'k-eye',
  group: 'Picture',
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    {
      name: 'preset',
      label: 'Shown as',
      choices: { movements: 'Eye movements (+ / −)', boxes: 'Four boxes around each eye' },
    },
    { name: 'includeSwitch', label: '“Include in the case sheet” switch' },
  ],
  sample: (f) =>
    f.config?.['preset'] === 'boxes'
      ? { re: { top: 'Normal', bottom: 'Clear' }, le: { top: 'Normal', bottom: 'Clear' } }
      : { re: ['+', '+', '-', '+', '+', '+', '+', '+'], le: ['+', '+', '+', '+', '+', '+', '-', '+'] },
};
