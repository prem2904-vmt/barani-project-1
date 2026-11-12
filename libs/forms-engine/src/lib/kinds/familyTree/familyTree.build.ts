import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { ConditionsPanelComponent } from '../family/family.studio';
import { DEFAULT_FAMILY_CONDITIONS } from './familyTree.fill';

/** Studio descriptor for `familyTree`: the conditions to mark are set in its panel. */
export const FAMILY_TREE_BUILD: KindBuild = {
  kind: 'familyTree',
  name: 'Family tree',
  hint: 'Parents, brothers and sisters, spouse, children, grandparents: who has which condition, who has died, blood relatives.',
  icon: 'k-family',
  group: 'Picture',
  starterConfig: { chart: true, conditions: DEFAULT_FAMILY_CONDITIONS },
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [{ name: 'chart', label: 'Print the tree', hint: 'The family tree is drawn in the printed case sheet under its words.' }],
  sample: (f: FieldDef) => {
    const first = (Array.isArray(f.config?.['conditions']) ? (f.config!['conditions'] as { key: string }[]) : DEFAULT_FAMILY_CONDITIONS)[0]?.key;
    return {
      self: { sex: 'male' },
      people: [{ relation: 'father', age: 60, ...(first ? { conditions: [first] } : {}) }, { relation: 'mother', age: 56 }],
    };
  },
  panel: ConditionsPanelComponent,
};
