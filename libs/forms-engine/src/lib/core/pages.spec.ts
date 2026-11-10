import {
  isAnswered,
  missingRequired,
  optionChosen,
  pageProgress,
  pageScope,
  patientLabelOf,
  setInScope,
  visibleFields,
  wizardPages,
} from './pages';
import { lookupIn, resizeInstances } from './rules';
import { FieldDef, FormDefinition } from './types';
import { ENT_SAMPLE } from '../testing/ent-sample';

const f = (key: string, kind = 'text', extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  kind,
  label: key,
  ...extra,
});

describe('isAnswered', () => {
  it.each([
    [null, false],
    ['', false],
    ['  ', false],
    ['x', true],
    [0, true],
    [false, true],
    [[], false],
    [['a'], true],
    [{ amount: null, unit: 'days' }, false],
    [{ amount: 5, unit: 'days' }, true],
    [{ dimensions: [null, null], unit: 'cm' }, false],
    [{ dimensions: [2, null], unit: 'cm' }, true],
    [{ value: null, unit: 'kg' }, false],
    [{ height: null, weight: 70, heightUnit: 'm', weightUnit: 'kg' }, true],
    [{ instances: [] }, false],
  ])('%j → %s', (v, want) => expect(isAnswered(v)).toBe(want));
});

describe('the ENT sample (the API fixture forms/ent-nose)', () => {
  it('shows the detail pages only for the chosen complaints', () => {
    const ids = (a: Record<string, unknown>) => wizardPages(ENT_SAMPLE, a).map((p) => p.id);
    expect(ids({})).toEqual(['patient_info', 'timeline', 'other_symptoms']);
    expect(ids({ complaints: ['obstruction'] })).toEqual([
      'patient_info',
      'timeline',
      'obstruction_details',
      'other_symptoms',
    ]);
    expect(ids({ complaints: ['obstruction', 'discharge'] })).toContain('discharge_details');
  });

  it('a chosen option opens its follow-up fields inline', () => {
    const page = ENT_SAMPLE.pages[0];
    const keys = (a: Record<string, unknown>) => visibleFields(page, lookupIn(a)).map((x) => x.key);
    expect(keys({})).not.toContain('obstructionSide');
    const k = keys({ complaints: ['obstruction'] });
    expect(k.indexOf('obstructionSide')).toBe(k.indexOf('complaints') + 1);
    expect(k).toContain('obstructionDuration');
    expect(k).not.toContain('dischargeSide');
  });

  it('finds the patient label', () => {
    expect(patientLabelOf(ENT_SAMPLE, { patientName: '  Rajesh Kumar ' })).toBe('Rajesh Kumar');
    expect(patientLabelOf(ENT_SAMPLE, {})).toBeNull();
  });

  it('progress counts visible fields only', () => {
    const wp = wizardPages(ENT_SAMPLE, {})[0];
    const p = pageProgress(wp, { patientName: 'A', age: 3 });
    expect(p.answered).toBe(2);
    expect(p.total).toBe(9);
  });
});

describe('optionChosen', () => {
  it('string, list, tick box', () => {
    expect(optionChosen('Left', 'left')).toBe(true);
    expect(optionChosen(['a', 'b'], 'b')).toBe(true);
    expect(optionChosen(true, 'yes')).toBe(true);
    expect(optionChosen(false, 'yes')).toBe(false);
    expect(optionChosen(null, 'yes')).toBe(false);
  });
});

describe('repeating pages', () => {
  const def: FormDefinition = {
    pages: [
      {
        key: 'ob',
        title: 'Obstetric history',
        fields: [f('pregnancies', 'repeatPages', { config: { pages: ['pregnancy'], showIndex: true } })],
      },
      {
        key: 'pregnancy',
        title: 'Pregnancy',
        fields: [
          f('outcome', 'text', { required: true }),
          f('notes', 'text', { showWhen: { conditions: [{ field: 'outcome', op: 'equals', value: 'other' }] } }),
        ],
      },
      { key: 'end', title: 'Plan', fields: [f('plan')] },
    ],
  };

  it('owned pages leave the flow and come back once per repetition', () => {
    expect(wizardPages(def, {}).map((p) => p.id)).toEqual(['ob', 'end']);
    const two = resizeInstances(def.pages[0].fields[0], null, 2);
    const pages = wizardPages(def, { pregnancies: two });
    expect(pages.map((p) => p.title)).toEqual(['Obstetric history', 'Pregnancy 1', 'Pregnancy 2', 'Plan']);
    expect(pages[1].instance).toEqual({ fieldKey: 'pregnancies', page: 'pregnancy', index: 0 });
  });

  it('a repetition reads and writes its own values; conditions see them first', () => {
    let a: Record<string, unknown> = { pregnancies: resizeInstances(def.pages[0].fields[0], null, 2) };
    const second = wizardPages(def, a)[2];
    a = setInScope(second, a, 'outcome', 'other');
    expect(pageScope(second, a)).toEqual({ outcome: 'other' });
    expect(pageScope(wizardPages(def, a)[1], a)).toEqual({});
    expect(visibleFields(second.page, lookupIn(pageScope(second, a), a)).map((x) => x.key)).toEqual([
      'outcome',
      'notes',
    ]);
  });

  it('resizing keeps what was filled', () => {
    const field = def.pages[0].fields[0];
    const three = resizeInstances(
      field,
      { instances: [{ page: 'pregnancy', index: 0, values: { outcome: 'live' } }] },
      3,
    );
    expect(three.instances).toHaveLength(3);
    expect(three.instances[0].values).toEqual({ outcome: 'live' });
    expect(resizeInstances(field, three, 1).instances).toEqual([
      { page: 'pregnancy', index: 0, values: { outcome: 'live' } },
    ]);
  });

  it('Finish lists required answers missing in each repetition, by page', () => {
    const a = { pregnancies: resizeInstances(def.pages[0].fields[0], null, 2) };
    const miss = missingRequired(def, a);
    expect(miss.map((m) => m.pageTitle)).toEqual(['Pregnancy 1', 'Pregnancy 2']);
    expect(miss[0].label).toBe('outcome');
  });

  it('a hidden required field is not missing', () => {
    const d: FormDefinition = {
      pages: [
        {
          key: 'p',
          title: 'P',
          fields: [
            f('a', 'yesno'),
            f('b', 'text', { required: true, showWhen: { conditions: [{ field: 'a', op: 'equals', value: 'yes' }] } }),
          ],
        },
      ],
    };
    expect(missingRequired(d, {})).toEqual([]);
    expect(missingRequired(d, { a: 'yes' }).map((m) => m.fieldKey)).toEqual(['b']);
  });

  it('required children of a repeat row', () => {
    const d: FormDefinition = {
      pages: [
        {
          key: 'p',
          title: 'P',
          fields: [
            f('ulcers', 'repeat', { label: 'Ulcer', children: [f('site', 'text', { label: 'Site', required: true })] }),
          ],
        },
      ],
    };
    expect(missingRequired(d, { ulcers: [{ site: 'leg' }, {}] }).map((m) => m.label)).toEqual(['Ulcer 2: Site']);
  });
});
