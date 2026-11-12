import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { AgeChecklistPanelComponent } from '../family/family.studio';
import { resolveItems } from './checklist-data';

/** Studio descriptor for `ageChecklist` (presets: milestones, vaccines, own list). */
export const AGE_CHECKLIST_BUILD: KindBuild = {
  kind: 'ageChecklist',
  name: 'Checklist by age',
  hint: 'Follows the patient’s age: developmental milestones, the India immunisation schedule or your own list. The case note reports only what is late.',
  icon: 'k-checklist',
  group: 'Ask',
  starterConfig: { preset: 'milestones' },
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'preset', label: 'List', choices: { milestones: 'Developmental milestones', vaccines: 'Vaccines (India)', custom: 'My own list' } },
    { name: 'unsetIsMissing', label: 'Count lines nobody answered as late', hint: 'Off: only lines marked “Not yet” are written.' },
  ],
  sample: (f: FieldDef) => {
    const preset = f.config?.['preset'];
    const age = preset === 'vaccines' ? 1096 : preset === 'custom' ? 20 : 548;
    const shown = resolveItems(f.config).filter((i) => i.fromDays <= age);
    if (shown.length === 0) return undefined;
    const items: Record<string, string> = {};
    for (const i of shown.slice(0, 4)) items[i.key] = 'done';
    items[shown[shown.length - 1].key] = 'notDone';
    return { ageDays: age, items };
  },
  panel: AgeChecklistPanelComponent,
};
