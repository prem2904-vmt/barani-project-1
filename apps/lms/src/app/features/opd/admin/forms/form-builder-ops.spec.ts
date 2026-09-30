import { OpdQuestion, emptyDoc } from './form-schema';
import {
  addSection, applyAction, changeType, fixConditions, fromParsed, fromType, insertAt, keysOf, moveSection, patchQuestion, removeSection,
  renameSection, sectionIndexOfKey, setSides, undoDelete, versionState, withQuestions,
} from './form-builder-ops';
import { parseQuestion } from './sentence-parser';

const Q = (o: Partial<OpdQuestion> & { key: string }): OpdQuestion => ({ label: o.key, type: 'short', print: true, ...o });
const LIST: OpdQuestion[] = [
  Q({ key: 'complaint' }),
  Q({ key: 'discharge', label: 'Ear discharge?', type: 'yn' }),
  Q({ key: 'dtype', type: 'one', choices: ['Mucoid', 'Purulent'], when: { key: 'discharge', value: 'Yes' } }),
  Q({ key: 'notes', type: 'long' }),
];

describe('form builder operations', () => {
  it('adds a parsed sentence with a unique key and a sample answer', () => {
    const q = fromParsed(parseQuestion('Ear discharge? yes/no')!, keysOf(LIST));
    expect(q).toMatchObject({ key: 'ear_discharge', type: 'yn', print: true, required: false, sample: 'No' });
    const list = insertAt(LIST, q, 1);
    expect(keysOf(list)).toEqual(['complaint', 'ear_discharge', 'discharge', 'dtype', 'notes']);
    expect(keysOf(insertAt(LIST, q, null)).at(-1)).toBe('ear_discharge');
  });

  it('adds a gallery type with its defaults (left & right = sided pick-one)', () => {
    const lr = fromType('lr', []);
    expect(lr).toMatchObject({ type: 'one', sides: true, choices: ['Normal', 'Reduced', 'Absent'] });
    expect(lr.sample).toEqual({ r: 'Normal', l: 'Normal' });
    expect(fromType('scale', [])).toMatchObject({ type: 'scale', min: 0, max: 4 });
    expect(fromType('table', []).cols!.length).toBe(6);
  });

  it('moves up / down and drops a condition that would point below its question', () => {
    const up = applyAction(LIST, 'dtype', 'up');
    expect(keysOf(up.list)).toEqual(['complaint', 'dtype', 'discharge', 'notes']);
    expect(up.list[1].when).toBeNull();          // its source is now BELOW it
    expect(applyAction(LIST, 'complaint', 'up').list).toBe(LIST);   // already first: no change
  });

  it('duplicates with a "(copy)" label and a new key, keeping the "?"', () => {
    const r = applyAction(LIST, 'discharge', 'dup');
    expect(r.list[2]).toMatchObject({ label: 'Ear discharge (copy)?', type: 'yn' });
    expect(r.selected).toBe(r.list[2].key);
    expect(new Set(keysOf(r.list)).size).toBe(r.list.length);
  });

  it('toggles required', () => {
    expect(applyAction(LIST, 'notes', 'req').list[3].required).toBe(true);
  });

  it('delete breaks dependent conditions and undo restores both', () => {
    const r = applyAction(LIST, 'discharge', 'del');
    expect(keysOf(r.list)).toEqual(['complaint', 'dtype', 'notes']);
    expect(r.list[1].when).toBeNull();
    expect(r.undo!.deps).toEqual([['dtype', { key: 'discharge', value: 'Yes' }]]);
    const back = undoDelete(r.list, r.undo!);
    expect(back).toEqual(LIST);
  });

  it('changing the answer type keeps the wording and fills sensible defaults', () => {
    const q = changeType(LIST[0], 'many');
    expect(q).toMatchObject({ label: 'complaint', type: 'many', choices: ['Sneezing', 'Headache', 'Loss of smell'] });
    const lr = changeType(LIST[1], 'lr');
    expect(lr).toMatchObject({ type: 'yn', sides: true });
    const media = changeType(lr, 'media');
    expect(media).toMatchObject({ type: 'media', sides: false });
    expect(media.choices).toBeUndefined();
    expect(changeType(LIST[0], 'num').unit).toBe('kg');
  });

  it('turning left & right on clears conditions that depend on it', () => {
    const out = setSides(LIST, 'discharge', true);
    expect(out[1].sides).toBe(true);
    expect(out[2].when).toBeNull();
    expect((out[1].sample as { r: unknown }).r).toBeUndefined();   // no sample → both sides empty
  });

  it('renaming a choice away drops a condition on it (fixConditions)', () => {
    const list = patchQuestion(LIST, 'discharge', { type: 'one', choices: ['Present', 'Absent'] });
    expect(list[2].when).toBeNull();
    expect(fixConditions(LIST)).toEqual(LIST);
  });

  it('withQuestions redistributes the flat, form-wide list back across sections by their original length', () => {
    const doc = {
      ...emptyDoc(),
      sections: [
        { key: 's1', title: 'S1', fields: [Q({ key: 'a' }), Q({ key: 'b' })] },
        { key: 's2', title: 'S2', fields: [Q({ key: 'c' })] },
      ],
    };
    const flat = [Q({ key: 'a', required: true }), Q({ key: 'b' }), Q({ key: 'c', required: true })];
    const out = withQuestions(doc, flat);
    expect(out.sections[0].fields.map((q) => q.key)).toEqual(['a', 'b']);
    expect(out.sections[0].fields[0].required).toBe(true);
    expect(out.sections[1].fields.map((q) => q.key)).toEqual(['c']);
    expect(out.sections[1].fields[0].required).toBe(true);
  });
});

describe('sections', () => {
  const doc = () => ({
    ...emptyDoc(),
    sections: [
      { key: 's1', title: 'S1', fields: [Q({ key: 'a' })] },
      { key: 's2', title: 'S2', fields: [Q({ key: 'b' }), Q({ key: 'c' })] },
      { key: 's3', title: 'S3', fields: [] },
    ],
  });

  it('finds which section a key lives in', () => {
    expect(sectionIndexOfKey(doc(), 'a')).toBe(0);
    expect(sectionIndexOfKey(doc(), 'c')).toBe(1);
    expect(sectionIndexOfKey(doc(), 'nope')).toBeNull();
    expect(sectionIndexOfKey(doc(), null)).toBeNull();
  });

  it('renames a section, keeping its questions', () => {
    const out = renameSection(doc(), 1, '  Examination  ');
    expect(out.sections[1]).toMatchObject({ key: 's2', title: 'Examination' });
    expect(out.sections[1].fields.map((q) => q.key)).toEqual(['b', 'c']);
    expect(renameSection(doc(), 1, '   ')).toEqual(doc()); // blank is a no-op
  });

  it('moves a section up / down; a no-op at either end', () => {
    const down = moveSection(doc(), 0, 1);
    expect(down.sections.map((s) => s.key)).toEqual(['s2', 's1', 's3']);
    expect(moveSection(doc(), 0, -1)).toEqual(doc());
    expect(moveSection(doc(), 2, 1)).toEqual(doc());
  });

  it('adds a new, empty section with a unique key', () => {
    const out = addSection(doc(), 'S1'); // collides with the existing "S1" key
    expect(out.sections.length).toBe(4);
    expect(out.sections[3]).toMatchObject({ title: 'S1', fields: [] });
    expect(out.sections[3].key).not.toBe('s1');
  });

  it('removes a section but never the last one', () => {
    const out = removeSection(doc(), 2);
    expect(out.sections.map((s) => s.key)).toEqual(['s1', 's2']);
    const one = { ...emptyDoc(), sections: [{ key: 'x', title: 'X', fields: [] }] };
    expect(removeSection(one, 0)).toEqual(one);
  });
});

describe('versioning (chip + Publish label)', () => {
  it('a new form is a draft that publishes as v1', () => {
    expect(versionState({ published: null, draft: 1 })).toEqual({ chip: 'New · draft', draft: true, publishLabel: 'Publish v1', canPublish: true });
  });
  it('published without changes cannot publish again', () => {
    expect(versionState({ published: 3, draft: null })).toEqual({ chip: 'v3 · published', draft: false, publishLabel: 'Published', canPublish: false });
  });
  it('a draft on top of v3 publishes as v4 (past consults keep v3)', () => {
    expect(versionState({ published: 3, draft: 4 })).toMatchObject({ chip: 'v3 · draft changes', publishLabel: 'Publish v4', canPublish: true });
  });
});
