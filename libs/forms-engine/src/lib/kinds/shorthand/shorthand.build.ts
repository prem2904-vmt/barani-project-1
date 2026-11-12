import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { ShorthandValue, presetOf, writeShorthand } from './shorthand-math';

/** What each preset is called, in doctor words (Studio chips and the question's starter label). */
export const PRESET_WORDS: Record<string, string> = {
  obstetricScore: 'Obstetric score (G P L A)',
  menstrual: 'Periods',
  visualAcuity: 'Vision',
  refraction: 'Glasses power',
  musclePower: 'Muscle power',
};

/** A typical answer for each preset (the same ones the server's Studio sample uses). */
export const PRESET_SAMPLES: Record<string, ShorthandValue> = {
  obstetricScore: { g: 3, p: 2, l: 2, a: 0 },
  menstrual: { flowDays: 5, cycleDays: 28, regularity: 'regular' },
  visualAcuity: { distance: '6/9', near: 'N6' },
  refraction: { sph: -1.25, cyl: -0.5, axis: 180 },
  musclePower: { grade: 4 },
};

/** Studio descriptor for `shorthand`. Which boxes it shows is `config.preset` (Studio's "Which notation" chips). */
export const SHORTHAND_BUILD: KindBuild = {
  kind: 'shorthand',
  name: 'Clinical shorthand',
  hint: 'Small boxes that write standard notation: obstetric score, periods, vision, glasses power, muscle power.',
  icon: 'k-shorthand',
  group: 'Measure',
  /** The same as the catalogue's defaults: every switch shows what the control really does. */
  starterConfig: { preset: 'obstetricScore', deaths: false, lmp: true, near: true, pinhole: true, glasses: true, add: true },
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    {
      name: 'preset',
      label: 'Which notation',
      choices: {
        obstetricScore: 'Obstetric score (G P L A)',
        menstrual: 'Periods',
        visualAcuity: 'Vision',
        refraction: 'Glasses power',
        musclePower: 'Muscle power',
      },
    },
    { name: 'deaths', label: 'Also ask deaths (D)', when: (f) => presetOf(f.config) === 'obstetricScore' },
    { name: 'lmp', label: 'Ask the last menstrual period', when: (f) => presetOf(f.config) === 'menstrual' },
    { name: 'near', label: 'Ask near vision', when: (f) => presetOf(f.config) === 'visualAcuity' },
    { name: 'pinhole', label: 'Ask vision with pinhole', when: (f) => presetOf(f.config) === 'visualAcuity' },
    { name: 'glasses', label: 'Ask “with glasses”', when: (f) => presetOf(f.config) === 'visualAcuity' },
    { name: 'add', label: 'Ask the reading add', when: (f) => presetOf(f.config) === 'refraction' },
  ],
  sample: (f: FieldDef) => PRESET_SAMPLES[presetOf(f.config)],
};

/** The words a sample writes (used by Studio hints and specs). */
export function sampleWords(f: FieldDef): string {
  return writeShorthand(presetOf(f.config), PRESET_SAMPLES[presetOf(f.config)]);
}
