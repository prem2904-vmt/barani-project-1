import {
  applyChange,
  applyLinks,
  applyTriggers,
  evaluateCondition,
  isEmptyValue,
  isShown,
  linkDisabledKeys,
  lookupIn,
  refToKey,
} from './rules';
import { FieldDef, FormDefinition } from './types';

/**
 * Rule engine, table-driven. The cases mirror the legacy filler
 * (resident-fe dynamic-form.ts evaluateCondition / syncLinkedComponentValues /
 * evaluateConditionalTriggers) and the API's importer test
 * `Show_When_Links_And_Triggers_Point_At_Keys` (fever → rash).
 */
describe('evaluateCondition', () => {
  const cases: [unknown, string, unknown, boolean][] = [
    ['yes', 'equals', 'yes', true],
    ['YES ', 'equals', 'yes', true],
    [true, 'equals', 'yes', true],
    [false, 'equals', 'no', true],
    ['no', 'equals', 'yes', false],
    [['dust', 'cold'], 'equals', 'cold', true],
    [['dust'], 'notEquals', 'cold', true],
    [['dust', 'cold'], 'contains', 'cold', true],
    [['dust'], 'contains', 'cold', false],
    ['nasal block', 'contains', 'block', true],
    ['nasal block', 'notContains', 'pain', true],
    [['a'], 'notContains', 'a', false],
    [null, 'isEmpty', null, true],
    ['', 'isEmpty', null, true],
    [[], 'isEmpty', null, true],
    [{ amount: null, unit: 'days' }, 'isEmpty', null, true],
    [{ amount: 5, unit: 'days' }, 'isNotEmpty', null, true],
    ['x', 'isNotEmpty', null, true],
    [42, 'greaterThan', 40, true],
    ['42', 'greaterThan', '50', false],
    [{ value: 70, unit: 'kg' }, 'greaterThanOrEqual', 70, true],
    [{ amount: 6, unit: 'months' }, 'lessThan', 12, true],
    [10, 'lessThanOrEqual', 10, true],
    [null, 'greaterThan', 0, false],
    ['x', 'somethingNew', 'x', false],
  ];
  it.each(cases)('%j %s %j → %s', (fv, op, cv, want) => {
    expect(evaluateCondition(fv, op, cv)).toBe(want);
  });

  it('isEmptyValue', () => {
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue({ dimensions: [] })).toBe(false);
  });
});

describe('isShown', () => {
  const get = lookupIn({ fever: 'yes', complaints: ['obstruction'], age: 42 });
  it('no rule / no conditions → shown', () => {
    expect(isShown(null, get)).toBe(true);
    expect(isShown({ conditions: [] }, get)).toBe(true);
  });
  it('and / or / hide', () => {
    const a = { field: 'fever', op: 'equals', value: 'yes' };
    const b = { field: 'age', op: 'greaterThan', value: 60 };
    expect(isShown({ logic: 'and', conditions: [a, b] }, get)).toBe(false);
    expect(isShown({ logic: 'or', conditions: [a, b] }, get)).toBe(true);
    expect(isShown({ logic: 'or', visibility: 'hide', conditions: [a, b] }, get)).toBe(false);
    expect(isShown({ visibility: 'hide', conditions: [b] }, get)).toBe(true);
  });
  it('ENT: the obstruction page shows when complaints contain obstruction', () => {
    const rule = { conditions: [{ field: 'complaints', op: 'contains', value: 'obstruction' }] };
    expect(isShown(rule, get)).toBe(true);
    expect(isShown(rule, lookupIn({ complaints: ['discharge'] }))).toBe(false);
  });
  it('scoped lookup reads the first scope first', () => {
    const g = lookupIn({ x: 'inner' }, { x: 'outer', y: 'outer' });
    expect(g('x')).toBe('inner');
    expect(g('y')).toBe('outer');
  });
});

const f = (key: string, kind = 'text', extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  kind,
  label: key,
  ...extra,
});
const form = (extra: Partial<FormDefinition>): FormDefinition => ({
  pages: [
    { key: 'p', title: 'P', fields: [f('fever', 'yesno'), f('rash'), f('count', 'number'), f('ulcers', 'repeat')] },
  ],
  ...extra,
});

describe('links', () => {
  it('refToKey: a sub-field ref is the sub-field key', () => {
    expect(refToKey('fever')).toBe('fever');
    expect(refToKey('rash::opt::fever')).toBe('fever');
    expect(refToKey(null)).toBe('');
  });

  it('mirror: any linked field propagates', () => {
    const def = form({ links: [{ fields: ['fever', 'rash'], mode: 'mirror' }] });
    expect(applyLinks(def, {}, { rash: 'yes' })).toEqual({ rash: 'yes', fever: 'yes' });
    expect(applyLinks(def, {}, { fever: 'no' })).toEqual({ fever: 'no', rash: 'no' });
  });

  it('cascade: only the primary propagates', () => {
    const def = form({ links: [{ fields: ['fever', 'rash'], mode: 'cascade', primary: 'fever' }] });
    expect(applyLinks(def, {}, { rash: 'x' })).toEqual({ rash: 'x' });
    expect(applyLinks(def, {}, { fever: 'yes' })).toEqual({ fever: 'yes', rash: 'yes' });
  });

  it('clearing a linked field clears the others', () => {
    const def = form({ links: [{ fields: ['fever', 'rash'] }] });
    expect(applyLinks(def, { fever: 'yes', rash: 'yes' }, { rash: 'yes' })).toEqual({});
  });

  it('a number copied into a repeat becomes that many rows', () => {
    const def = form({ links: [{ fields: ['count', 'ulcers'], mode: 'cascade' }] });
    expect(applyLinks(def, {}, { count: 2 })).toEqual({ count: 2, ulcers: [{}, {}] });
  });

  it('disableLinked locks every field but the primary', () => {
    const def = form({ links: [{ fields: ['fever', 'rash::opt::count'], disableLinked: true }] });
    expect([...linkDisabledKeys(def)]).toEqual(['count']);
    expect(linkDisabledKeys(form({ links: [{ fields: ['fever', 'rash'] }] })).size).toBe(0);
  });
});

describe('triggers', () => {
  it('setValue when the condition is met (the importer case fever → rash)', () => {
    const def = form({
      triggers: [
        {
          name: 'trig',
          enabled: true,
          logic: 'and',
          conditions: [{ source: 'fever', op: 'equals', value: 'yes' }],
          actions: [{ target: 'rash', action: 'setValue', value: 'auto' }],
        },
      ],
    });
    expect(applyTriggers(def, { fever: 'yes' })).toEqual({ fever: 'yes', rash: 'auto' });
    expect(applyTriggers(def, { fever: 'no' })).toEqual({ fever: 'no' });
  });

  it('copyValue, chained, disabled triggers ignored, never loops forever', () => {
    const def = form({
      triggers: [
        {
          conditions: [{ source: 'rash', op: 'isNotEmpty' }],
          actions: [{ target: 'count', action: 'copyValue', source: 'rash' }],
        },
        {
          conditions: [{ source: 'fever', op: 'equals', value: 'yes' }],
          actions: [{ target: 'rash', action: 'setValue', value: '3' }],
        },
        {
          enabled: false,
          conditions: [{ source: 'fever', op: 'isNotEmpty' }],
          actions: [{ target: 'x', action: 'setValue', value: 1 }],
        },
        // ping-pong pair: must stop after 10 rounds
        {
          conditions: [{ source: 'a', op: 'equals', value: '1' }],
          actions: [{ target: 'a', action: 'setValue', value: '2' }],
        },
        {
          conditions: [{ source: 'a', op: 'equals', value: '2' }],
          actions: [{ target: 'a', action: 'setValue', value: '1' }],
        },
      ],
    });
    const out = applyTriggers(def, { fever: 'yes', a: '1' });
    expect(out['rash']).toBe('3');
    expect(out['count']).toBe('3');
    expect(out['x']).toBeUndefined();
    expect(['1', '2']).toContain(out['a']);
  });

  it('an OR trigger fires on any condition; an empty AND never fires', () => {
    const def = form({
      triggers: [
        {
          logic: 'or',
          conditions: [
            { source: 'fever', op: 'equals', value: 'yes' },
            { source: 'rash', op: 'equals', value: 'yes' },
          ],
          actions: [{ target: 'count', action: 'setValue', value: 1 }],
        },
        { conditions: [], actions: [{ target: 'x', action: 'setValue', value: 1 }] },
      ],
    });
    expect(applyTriggers(def, { rash: 'yes' })).toEqual({ rash: 'yes', count: 1 });
  });

  it('applyChange = links then triggers', () => {
    const def = form({
      links: [{ fields: ['fever', 'rash'] }],
      triggers: [
        {
          conditions: [{ source: 'rash', op: 'equals', value: 'yes' }],
          actions: [{ target: 'count', action: 'setValue', value: 9 }],
        },
      ],
    });
    expect(applyChange(def, {}, { fever: 'yes' })).toEqual({ fever: 'yes', rash: 'yes', count: 9 });
  });
});
