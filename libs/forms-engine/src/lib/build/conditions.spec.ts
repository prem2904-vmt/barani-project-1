import { ENT_SAMPLE } from '../testing/ent-sample';
import { FormDefinition, ShowWhenDef } from '../core/types';
import { addField, addPage, emptyDefinition, setLabel, updateField } from './doc';
import {
  conditionSources,
  describeCondition,
  describeShowWhen,
  fromShowWhen,
  startRow,
  toShowWhen,
  valueChoices,
  withOp,
} from './conditions';

function form(): { d: FormDefinition; pain: string; temp: string; complaints: string; notes: string } {
  let d = addPage(emptyDefinition('Test'), 'History').def;
  const pain = addField(d, { pageKey: 'history' }, 'yesno');
  d = setLabel(pain.def, pain.key, 'Pain');
  const temp = addField(d, { pageKey: 'history' }, 'number');
  d = setLabel(temp.def, temp.key, 'Temperature');
  const complaints = addField(d, { pageKey: 'history' }, 'multi');
  d = setLabel(complaints.def, complaints.key, 'Chief complaints');
  d = updateField(d, complaints.key, (f) => (f.options = [{ key: 'nasalBlock', label: 'Nasal block' }, { key: 'bleeding', label: 'Bleeding' }]));
  const notes = addField(d, { pageKey: 'history' }, 'text');
  return { d: notes.def, pain: pain.key, temp: temp.key, complaints: complaints.key, notes: notes.key };
}

describe('condition builder', () => {
  it('rows ↔ stored rule round-trip', () => {
    const sw: ShowWhenDef = {
      logic: 'or',
      visibility: 'hide',
      conditions: [
        { field: 'a', op: 'equals', value: 'yes' },
        { field: 'b', op: 'isEmpty' },
      ],
    };
    expect(toShowWhen(fromShowWhen(sw))).toEqual(sw);
    const set = { rows: [{ field: 'pain', op: 'equals', value: 'yes' }], match: 'all' as const, visibility: 'show' as const };
    expect(fromShowWhen(toShowWhen(set))).toEqual(set);
  });

  it('no rows = always shown (null), unfinished rows are dropped', () => {
    expect(toShowWhen({ rows: [], match: 'all', visibility: 'show' })).toBeNull();
    expect(toShowWhen({ rows: [{ field: '', op: 'equals' }], match: 'all', visibility: 'show' })).toBeNull();
    expect(fromShowWhen(null)).toEqual({ rows: [], match: 'all', visibility: 'show' });
  });

  it('a tapped row starts with the kind’s first words and first value', () => {
    const { d, pain, complaints, temp, notes } = form();
    expect(startRow(d, pain)).toEqual({ field: pain, op: 'equals', value: 'yes' });
    expect(startRow(d, complaints)).toEqual({ field: complaints, op: 'contains', value: 'nasalBlock' });
    expect(startRow(d, temp)).toEqual({ field: temp, op: 'greaterThan', value: 0 });
    expect(startRow(d, notes)).toEqual({ field: notes, op: 'isNotEmpty' });
  });

  it('changing the words keeps or drops the value as the words need', () => {
    const { d, pain } = form();
    const row = startRow(d, pain);
    expect(withOp(d, row, 'isEmpty')).toEqual({ field: pain, op: 'isEmpty' });
    expect(withOp(d, { field: pain, op: 'isEmpty' }, 'equals')).toEqual({ field: pain, op: 'equals', value: 'yes' });
  });

  it('value pickers come from the field: choices, yes / no, a number', () => {
    const { d, pain, complaints, temp } = form();
    expect(valueChoices(d, complaints).options.map((o) => o.label)).toEqual(['Nasal block', 'Bleeding']);
    expect(valueChoices(d, pain)).toEqual({
      kind: 'yesno',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    });
    expect(valueChoices(d, temp).kind).toBe('number');
  });

  it('reads as a sentence', () => {
    const { d, pain, complaints, temp, notes } = form();
    expect(describeCondition(d, { field: pain, op: 'equals', value: 'yes' })).toBe('Pain is Yes');
    expect(describeCondition(d, { field: complaints, op: 'contains', value: 'nasalBlock' })).toBe('Chief complaints includes Nasal block');
    expect(describeCondition(d, { field: temp, op: 'greaterThan', value: 38 })).toBe('Temperature is more than 38');
    expect(describeCondition(d, { field: notes, op: 'isEmpty' })).toBe('Text is not answered');
    expect(describeShowWhen(d, null)).toBe('Always shown');
    expect(
      describeShowWhen(d, {
        logic: 'or',
        conditions: [
          { field: pain, op: 'equals', value: 'yes' },
          { field: temp, op: 'greaterThan', value: 38 },
        ],
      }),
    ).toBe('Shown when Pain is Yes or Temperature is more than 38');
    expect(describeShowWhen(d, { visibility: 'hide', conditions: [{ field: 'gone', op: 'equals', value: 'x' }] })).toBe(
      'Hidden when a question that was removed is x',
    );
  });

  it('a condition never reads its own field or its follow-ups', () => {
    const { d, pain } = form();
    expect(conditionSources(d, pain).some((f) => f.key === pain)).toBe(false);
  });

  it('describes every condition of the ENT sample without a key showing', () => {
    const walk = (fs: typeof ENT_SAMPLE.pages[number]['fields']): void => {
      for (const f of fs) {
        if (f.showWhen?.conditions?.length) {
          const s = describeShowWhen(ENT_SAMPLE, f.showWhen);
          expect(s).toMatch(/^(Shown|Hidden) when /);
          for (const c of f.showWhen.conditions) expect(s.includes(`${c.field} `) && !/\s/.test(c.field) && c.field !== ENT_SAMPLE.pages.flatMap((p) => p.fields).find((x) => x.key === c.field)?.label).toBe(false);
        }
        for (const o of f.options ?? []) walk(o.subFields ?? []);
      }
    };
    for (const p of ENT_SAMPLE.pages) walk(p.fields);
  });
});
