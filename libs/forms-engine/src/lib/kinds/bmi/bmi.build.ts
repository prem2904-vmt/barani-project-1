import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { cfg } from '../../core/types';

/** Studio descriptor for `bmi`. */
export const BMI_BUILD: KindBuild = {
  kind: 'bmi',
  name: 'Height, weight and BMI',
  hint: 'Height and weight; the BMI is worked out and written with them.',
  icon: 'k-bmi',
  group: 'Measure',
  sentence: () => '{value}.',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'heightUnit', label: 'Height in', choices: { m: 'metres', cm: 'cm', ft: 'feet', in: 'inches' } },
    { name: 'weightUnit', label: 'Weight in', choices: { kg: 'kg', lb: 'pounds', g: 'grams' } },
  ],
  sample: (f) => {
    const hu = cfg<string>(f, 'heightUnit', 'm');
    const wu = cfg<string>(f, 'weightUnit', 'kg');
    const height = hu === 'cm' ? 170 : hu === 'ft' ? 5.6 : hu === 'in' ? 67 : 1.7;
    const weight = wu === 'lb' ? 154 : wu === 'g' ? 70000 : 70;
    return { height, heightUnit: hu, weight, weightUnit: wu };
  },
};
