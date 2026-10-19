import {
  fieldToParam,
  hasLegacyFields,
  loadEditorFields,
  paramToField,
  readParameters,
  writeParameters,
} from './test-parameters';
import { choiceOptionsFor, resolveParamEntryKind } from './param-entry-kind';
import { hasOptions } from '../forms/field-registry';
import type { TestParameter } from '../models/test.model';

const rows = [
  { code: 'URO001', value: 'Normal', normal: true, active: true },
  { code: 'URO002', value: 'Increased', normal: false, active: true },
];
const P = (x: Record<string, unknown>) =>
  ({ id: 'p1', name: 'result', title: 'Result', ...x }) as unknown as TestParameter;
const blobOf = (...ps: TestParameter[]) => JSON.stringify({ parameters: ps });
const editorSaysChoice = (json: string) => hasOptions(loadEditorFields(json)[0].type);

describe('loadEditorFields — every stored dropdown shape is a choice in the editor', () => {
  it.each([
    ['CLP select + optionRows', P({ type: 'select', optionRows: rows, options: ['Normal', 'Increased'] })],
    ['old editor save "options"', P({ type: 'options', options: ['Few', 'Many'] })],
    ['"choice"', P({ type: 'choice', options: ['Few', 'Many'] })],
    ['"dropdown"', P({ type: 'dropdown', options: ['Few', 'Many'] })],
    ['capitalised "Select"', P({ type: 'Select', options: ['Few', 'Many'] })],
    ['hem "qualitative" + options', P({ type: 'qualitative', options: ['Normocytic', 'Microcytic'], normalValue: 'Normocytic' })],
    ['"qualitative" without options', P({ type: 'qualitative', normalValue: 'Negative' })],
    ['"text" + mapped optionRows', P({ type: 'text', optionRows: rows })],
    ['unknown type + options', P({ type: 'weird', options: ['A', 'B'] })],
  ])('%s', (_label, p) => {
    const json = blobOf(p);
    expect(resolveParamEntryKind(p)).toBe('select');          // what result entry decides
    expect(editorSaysChoice(json)).toBe(true);                 // what the editor shows
    expect((loadEditorFields(json)[0].options ?? []).map(o => o.label)).toEqual(choiceOptionsFor(p));
  });

  it('plain text / numeric / textarea stay what they are', () => {
    const t = (p: TestParameter) => loadEditorFields(blobOf(p))[0].type;
    expect(t(P({ type: 'text' }))).toBe('text');
    expect(t(P({ type: 'numeric' }))).toBe('number');
    expect(t(P({ type: 'multiline' }))).toBe('textarea');
    expect(t(P({ type: 'textarea' }))).toBe('textarea');
    expect(t(P({ type: 'yesno' }))).toBe('yesno');
    expect(t(P({ type: 'date' }))).toBe('date');
  });

  it('tolerates junk and the bare-array shape', () => {
    expect(loadEditorFields('')).toEqual([]);
    expect(loadEditorFields('not json')).toEqual([]);
    expect(loadEditorFields('null')).toEqual([]);
    expect(loadEditorFields(JSON.stringify([P({ type: 'numeric' })]))[0].type).toBe('number');
  });
});

describe('writeParameters — ONE stored list', () => {
  it('writes parameters only, never fields[], and keeps other blob keys', () => {
    const f = paramToField(P({ type: 'numeric', unit: 'g/dL' }), 0);
    const out = JSON.parse(writeParameters(JSON.stringify({ microFormat: 'x', attachments: true, parameters: [] }), [f]));
    expect(out.fields).toBeUndefined();
    expect(out.microFormat).toBe('x');
    expect(out.attachments).toBe(true);
    expect(out.parameters).toHaveLength(1);
    expect(out.parameters[0].type).toBe('numeric');             // older readers' number word
  });

  it('editor-only props live ON the parameter (lossless)', () => {
    const f = {
      ...paramToField(P({ name: 'a', type: 'yesno' }), 0),
      isRequired: true, isConditional: true,
      showWhen: { fieldId: 'p0', operator: 'equals', value: 'Yes' },
      validation: { min: 1, max: 5 }, placeholder: 'x', helperText: 'h',
      sizeConfig: { boxCount: 3, defaultUnit: 'cm' as const },
    } as never;
    const [p] = JSON.parse(writeParameters('', [f])).parameters;
    expect(p).toMatchObject({
      type: 'yesno', isRequired: true, isConditional: true,
      showWhen: { fieldId: 'p0', operator: 'equals', value: 'Yes' },
      validation: { min: 1, max: 5 }, placeholder: 'x', helperText: 'h',
      sizeConfig: { boxCount: 3, defaultUnit: 'cm' },
    });
    const back = paramToField(p, 0);
    expect(back.isRequired).toBe(true);
    expect(back.showWhen).toEqual({ fieldId: 'p0', operator: 'equals', value: 'Yes' });
    expect(back.sizeConfig).toEqual({ boxCount: 3, defaultUnit: 'cm' });
    expect(back.type).toBe('yesno');
  });

  it('default-false flags are not stored', () => {
    const p = fieldToParam(paramToField(P({ type: 'text' }), 0)) as unknown as Record<string, unknown>;
    expect('isRequired' in p).toBe(false);
    expect('isConditional' in p).toBe(false);
  });

  it('unknown catalogue keys on a parameter survive a save', () => {
    const json = blobOf(P({ type: 'numeric', methodology: 'Photometric', segmentTag: 7 }));
    const [p] = JSON.parse(writeParameters(json, loadEditorFields(json))).parameters;
    expect(p.methodology).toBe('Photometric');
    expect(p.segmentTag).toBe(7);
  });
});

describe('round-trip: load → save unchanged keeps the mapping', () => {
  it.each([
    ['CLP select + optionRows', P({ type: 'select', optionRows: rows, options: ['Normal', 'Increased'], normalValue: 'Normal', optionGroupName: 'Urine' })],
    ['hem qualitative + options', P({ type: 'qualitative', options: ['Normocytic', 'Microcytic'], normalValue: 'Normocytic' })],
    ['qualitative without options', P({ type: 'qualitative', normalValue: 'Negative' })],
    ['dropdown', P({ type: 'dropdown', options: ['Few', 'Many'] })],
    ['text + mapped rows', P({ type: 'text', optionRows: rows })],
    ['radio', P({ type: 'radio', options: ['Few', 'Many'] })],
    ['button_select', P({ type: 'button_select', options: ['Few', 'Many'] })],
  ])('%s', (_label, p) => {
    const json = blobOf(p);
    const out = JSON.parse(writeParameters(json, loadEditorFields(json)));
    expect(out.fields).toBeUndefined();
    const [saved] = out.parameters as TestParameter[];
    expect(resolveParamEntryKind(saved)).toBe('select');
    expect(choiceOptionsFor(saved)).toEqual(choiceOptionsFor(p));
    expect(saved.optionRows ?? null).toEqual(p.optionRows ?? null);
    expect(saved.normalValue ?? null).toEqual(p.normalValue ?? null);
    expect(saved.optionGroupName ?? null).toEqual(p.optionGroupName ?? null);
    expect(editorSaysChoice(JSON.stringify(out))).toBe(true);
    // Saving again is a fixed point.
    const again = writeParameters(JSON.stringify(out), loadEditorFields(JSON.stringify(out)));
    expect(JSON.parse(again)).toEqual(out);
  });
});

describe('legacy blobs with a fields[] twin', () => {
  // What the server's option-group mapping used to leave behind: parameters[]
  // mapped to a dropdown, the editor's fields[] copy still plain text.
  const stale = {
    parameters: [P({ id: 'f1', name: 'urobilinogen', type: 'select', optionRows: rows, options: ['Normal', 'Increased'], normalValue: 'Normal' })],
    fields: [{ id: 'f1', name: 'urobilinogen', label: 'Urobilinogen', type: 'text', order: 0,
               isRequired: true, isConditional: false, showWhen: { fieldId: 'x', operator: 'isNotEmpty' } }],
  };

  it('readParameters folds editor props onto the parameter; the answer list wins', () => {
    const [p] = readParameters(stale as never);
    expect(p.type).toBe('select');
    expect(p.optionRows).toEqual(rows);
    expect(p.isRequired).toBe(true);
    expect(p.showWhen).toEqual({ fieldId: 'x', operator: 'isNotEmpty' });
    expect(resolveParamEntryKind(p)).toBe('select');
  });

  it('the editor opens it as a choice and the next save drops fields[]', () => {
    const json = JSON.stringify(stale);
    expect(hasLegacyFields(json)).toBe(true);
    const fields = loadEditorFields(json);
    expect(fields[0].type).toBe('select');
    expect(fields[0].isRequired).toBe(true);
    const out = JSON.parse(writeParameters(json, fields));
    expect(out.fields).toBeUndefined();
    expect(hasLegacyFields(JSON.stringify(out))).toBe(false);
    expect(out.parameters[0]).toMatchObject({ type: 'select', isRequired: true, optionRows: rows, normalValue: 'Normal' });
  });

  it('the field\'s richer type wins over the old lossy save (yes/no, date, radio)', () => {
    const blob = {
      parameters: [P({ name: 'a', type: 'text' }), P({ name: 'b', type: 'text' }), P({ name: 'c', type: 'options', options: ['X', 'Y'] })],
      fields: [
        { id: 'a', name: 'a', label: 'A', type: 'yesno', order: 0, isRequired: false, isConditional: false },
        { id: 'b', name: 'b', label: 'B', type: 'date', order: 1, isRequired: false, isConditional: false },
        { id: 'c', name: 'c', label: 'C', type: 'radio', order: 2, isRequired: false, isConditional: false },
      ],
    };
    expect(readParameters(blob as never).map(p => p.type)).toEqual(['yesno', 'date', 'radio']);
  });

  it('a group edit that only touched parameters[] shows the NEW rows (radio kept)', () => {
    const newRows = [...rows, { code: 'URO003', value: 'Markedly increased', normal: false, active: true }];
    const blob = {
      parameters: [P({ name: 'u', type: 'options', optionRows: newRows, options: newRows.map(r => r.value) })],
      fields: [{ id: 'f1', name: 'u', label: 'U', type: 'radio', order: 0, isRequired: false, isConditional: false,
                 optionRows: rows, options: rows.map((r, i) => ({ id: `o${i}`, label: r.value, value: r.value, order: i })) }],
    };
    const [f] = loadEditorFields(JSON.stringify(blob));
    expect(f.type).toBe('radio');
    expect(f.optionRows).toEqual(newRows);
    expect(f.options?.map(o => o.label)).toEqual(newRows.map(r => r.value));
  });

  it('fields with no parameter twin are kept; fields-only blobs read fine', () => {
    const blob = {
      parameters: [P({ name: 'a', type: 'text' })],
      fields: [{ id: 'fa', name: 'a', label: 'A', type: 'text', order: 0, isRequired: false, isConditional: false },
               { id: 'fx', name: 'extra', label: 'Extra', type: 'select', order: 1, isRequired: true, isConditional: false,
                 options: [{ id: 'o', label: 'X', value: 'X', order: 0 }] }],
    };
    expect(readParameters(blob as never).map(p => [p.name, p.type, p.options ?? null]))
      .toEqual([['a', 'text', null], ['extra', 'select', ['X']]]);
    const only = { fields: [{ id: 'q', name: 'q', label: 'Q', type: 'number', order: 0, isRequired: true, isConditional: false, unit: 'mg' }] };
    expect(readParameters(only as never)).toEqual([{ id: 'q', name: 'q', title: 'Q', type: 'numeric', unit: 'mg', isRequired: true }]);
  });
});
