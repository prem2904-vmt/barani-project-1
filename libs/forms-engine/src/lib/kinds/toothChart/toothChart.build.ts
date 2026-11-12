import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { ConditionsPanelComponent } from '../family/family.studio';
import { DEFAULT_CONDITIONS, ToothCondition } from './teeth';

/** Studio descriptor for `toothChart`: the conditions (and the words each writes) are set in its panel. */
export const TOOTH_CHART_BUILD: KindBuild = {
  kind: 'toothChart',
  name: 'Tooth chart',
  hint: 'Tooth numbers for adult, child or mixed teeth: tap a tooth, then caries, missing, filled, root canal, crown, mobile.',
  icon: 'k-tooth',
  group: 'Picture',
  starterConfig: { dentition: 'adult', chart: true, conditions: DEFAULT_CONDITIONS },
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'dentition', label: 'Teeth', choices: { adult: 'Adult (32 teeth)', child: 'Child (20 teeth)', mixed: 'Adult and child' } },
    { name: 'chart', label: 'Print the chart', hint: 'The tooth chart is drawn in the printed case sheet under its words.' },
  ],
  sample: (f: FieldDef) => {
    const conds = (Array.isArray(f.config?.['conditions']) ? (f.config!['conditions'] as ToothCondition[]) : DEFAULT_CONDITIONS);
    const baby = f.config?.['dentition'] === 'child';
    const first = conds[0];
    if (!first) return undefined;
    const marks: unknown[] = [{ tooth: baby ? '54' : '36', condition: first.key, ...(first.surfaces ? { surfaces: ['O'] } : {}) }];
    if (conds.length > 1) marks.push({ tooth: baby ? '84' : '46', condition: conds[conds.length - 1].key });
    return { marks };
  },
  panel: ConditionsPanelComponent,
};
