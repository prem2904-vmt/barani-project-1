import {
  OpdQuestion, answerText, conditionMet, conditionSources, isAnswered, isWide, missingRequired, normalizeSchema, printRows,
  sampleAnswers, slugKey, typeName, visibleQuestions,
} from './form-schema';

const Q = (o: Partial<OpdQuestion> & { key: string }): OpdQuestion => ({ label: o.key, type: 'short', print: true, ...o });

const ENT: OpdQuestion[] = [
  Q({ key: 'complaint', label: 'Chief complaints', required: true }),
  Q({ key: 'discharge', label: 'Ear discharge?', type: 'yn' }),
  Q({ key: 'dtype', label: 'Discharge type', type: 'one', choices: ['Mucoid', 'Purulent'], when: { key: 'discharge', value: 'Yes' }, required: true }),
  Q({ key: 'oto', label: 'Otoscopy', type: 'one', sides: true, choices: ['Normal', 'Wax'] }),
  Q({ key: 'symptoms', label: 'Symptoms', type: 'many', choices: ['Fever', 'Headache'], print: false }),
  Q({ key: 'aud', label: 'Audiometry', type: 'table', unit: 'dB', rows: ['Right', 'Left'], cols: ['250', '500'] }),
];

describe('form schema — reading stored forms', () => {
  it('normalises the foundation v1 schema (text / select / boolean / options)', () => {
    const d = normalizeSchema({ sections: [{ key: 's', title: 'S', fields: [
      { key: 'a', label: 'A', type: 'text' }, { key: 'b', label: 'B', type: 'select', options: ['X', 'Y'] },
      { key: 'c', label: 'C', type: 'boolean' }, { key: 'd', label: 'D', type: 'multiselect', options: ['P'] },
      { key: 'e', label: 'E', type: 'number', unit: 'kg' }, { key: 'f', label: 'F', type: 'textarea' },
    ] }] });
    expect(d.schemaVersion).toBe(2);
    expect(d.sections[0].fields.map((f) => f.type)).toEqual(['short', 'one', 'yn', 'many', 'num', 'long']);
    expect(d.sections[0].fields[1].choices).toEqual(['X', 'Y']);
    expect(d.sections[0].fields.every((f) => f.print)).toBe(true);
  });

  it('never throws on junk and always has a Findings section', () => {
    expect(normalizeSchema(null).sections[0].title).toBe('Findings');
    expect(normalizeSchema({ sections: [{ fields: [{ nope: 1 }, { label: 'Ok', type: 'weird' }] }] }).sections[0].fields).toEqual([
      expect.objectContaining({ label: 'Ok', type: 'short', key: 'ok' }),
    ]);
  });

  it('media and tables are never left & right', () => {
    const d = normalizeSchema({ sections: [{ fields: [{ key: 'm', label: 'M', type: 'media', sides: true }] }] });
    expect(d.sections[0].fields[0].sides).toBe(false);
  });

  it('slugKey makes stable unique keys and never a built-in key', () => {
    expect(slugKey('Ear discharge?')).toBe('ear_discharge');
    expect(slugKey('Ear discharge?', ['ear_discharge'])).toBe('ear_discharge_2');
    expect(slugKey('2D echo')).toBe('q_2d_echo');
    expect(slugKey('Diagnosis')).toBe('diagnosis_notes');
  });
});

describe('form schema — conditions ("show only when…")', () => {
  const byKey = new Map(ENT.map((q) => [q.key, q] as const));

  it('a conditional question shows only for its answer', () => {
    expect(conditionMet(ENT[2], byKey, { discharge: 'No' })).toBe(false);
    expect(conditionMet(ENT[2], byKey, { discharge: 'Yes' })).toBe(true);
    expect(visibleQuestions(ENT, {}).map((q) => q.key)).not.toContain('dtype');
    expect(visibleQuestions(ENT, { discharge: 'Yes' }).map((q) => q.key)).toContain('dtype');
  });

  it('a Pick-several source matches when the answer is ticked', () => {
    const list = [ENT[4], Q({ key: 'hd', when: { key: 'symptoms', value: 'Headache' } })];
    const m = new Map(list.map((q) => [q.key, q] as const));
    expect(conditionMet(list[1], m, { symptoms: ['Fever'] })).toBe(false);
    expect(conditionMet(list[1], m, { symptoms: ['Fever', 'Headache'] })).toBe(true);
  });

  it('a condition whose source is gone never hides the question', () => {
    expect(conditionMet(Q({ key: 'x', when: { key: 'deleted', value: 'Yes' } }), byKey, {})).toBe(true);
  });

  it('sources are EARLIER Yes/No or pick questions that are not left & right', () => {
    expect(conditionSources(ENT, 5).map((q) => q.key)).toEqual(['discharge', 'dtype', 'symptoms']);
    expect(conditionSources(ENT, 0)).toEqual([]);
  });

  it('required counts only visible questions', () => {
    expect(missingRequired(ENT, {})).toEqual(['Chief complaints']);
    expect(missingRequired(ENT, { complaint: 'x', discharge: 'Yes' })).toEqual(['Discharge type']);
    expect(missingRequired(ENT, { complaint: 'x', discharge: 'Yes', dtype: 'Mucoid' })).toEqual([]);
  });
});

describe('form schema — answers in plain words and printing', () => {
  it('formats answers the way the report reads', () => {
    expect(answerText(Q({ key: 'n', type: 'num', unit: 'kg' }), '62')).toBe('62 kg');
    expect(answerText(Q({ key: 's', type: 'scale', max: 4 }), 2)).toBe('2 / 4');
    expect(answerText(Q({ key: 'm', type: 'many' }), ['A', 'B'])).toBe('A, B');
    expect(answerText(Q({ key: 'd', type: 'date' }), '2026-09-12')).toBe('12 Sep 2026');
    expect(answerText(Q({ key: 'g', type: 'diagram' }), [{ x: 1, y: 2, note: 'Right elbow' }])).toBe('1. Right elbow');
    expect(answerText(Q({ key: 'p', type: 'media' }), [{ name: 'a' }, { name: 'b' }])).toContain('2 files');
    expect(answerText(Q({ key: 'e' }), '')).toBe('');
  });

  it('prints answered, visible, print-on questions only; left & right as R · L', () => {
    const rows = printRows(ENT, { complaint: 'Nasal block', discharge: 'No', oto: { r: 'Normal', l: 'Wax' }, symptoms: ['Fever'],
      aud: [['15', '20'], ['20', '']] });
    expect(rows.map((r) => r.key)).toEqual(['complaint', 'discharge', 'oto', 'aud']);   // symptoms: print off; dtype: hidden
    expect(rows[2].sides).toEqual({ r: 'Normal', l: 'Wax' });
    expect(rows[3].table!.cells).toEqual([['15', '20'], ['20', '']]);
    expect(rows[1].label).toBe('Ear discharge');                                        // "?" dropped on paper
  });

  it('an empty form prints blanks when asked', () => {
    expect(printRows(ENT, {}).length).toBe(0);
    expect(printRows(ENT, {}, true).map((r) => r.key)).toEqual(['complaint', 'discharge', 'oto', 'aud']);
  });

  it('left & right is answered when either side is', () => {
    expect(isAnswered(ENT[3], { r: 'Normal' })).toBe(true);
    expect(isAnswered(ENT[3], {})).toBe(false);
  });

  it('samples come from the stored sample, else a sensible default', () => {
    const a = sampleAnswers([Q({ key: 'x', sample: 'Given' }), Q({ key: 'y', type: 'yn' }), Q({ key: 'z', type: 'media', sample: 2 as unknown })]);
    expect(a['x']).toBe('Given');
    expect(a['y']).toBe('No');
    expect((a['z'] as unknown[]).length).toBe(2);
  });

  it('type names and layout width read like the mockup', () => {
    expect(typeName(ENT[3])).toBe('Left & right · Pick one · 2 choices');
    expect(typeName(Q({ key: 's', type: 'scale', min: 0, max: 4 }))).toBe('Scale 0–4');
    expect(typeName(Q({ key: 'n', type: 'num', unit: 'kg' }))).toBe('Number with unit · kg');
    expect(isWide(ENT[1])).toBe(false);
    expect(isWide(ENT[0])).toBe(true);
    expect(isWide(ENT[3])).toBe(true);
  });
});
