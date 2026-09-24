import { fieldToParam, legacyParamToField, loadEditorFields } from './editor-fields';
import { choiceOptionsFor, resolveParamEntryKind } from '../../../../shared/utils/param-entry-kind';
import { hasOptions } from '../../../../shared/forms/field-registry';
import type { TestParameter } from '../../../../shared/models/test.model';

const rows = [
  { code: 'URO001', value: 'Normal', normal: true, active: true },
  { code: 'URO002', value: 'Increased', normal: false, active: true },
];
const P = (x: Partial<TestParameter> & Record<string, unknown>) =>
  ({ id: 'p1', name: 'result', title: 'Result', ...x }) as unknown as TestParameter;

/** Editor "entry kind" as the component derives it for field 0. */
const editorSaysChoice = (json: string) => hasOptions(loadEditorFields(json)[0].type);

describe('loadEditorFields — legacy parameters[] only', () => {
  it.each([
    ['CLP select + optionRows', P({ type: 'select', optionRows: rows, options: ['Normal', 'Increased'] })],
    ['editor-saved "options"', P({ type: 'options' as never, options: ['Few', 'Many'] })],
    ['"choice"', P({ type: 'choice' as never, options: ['Few', 'Many'] })],
    ['"dropdown"', P({ type: 'dropdown' as never, options: ['Few', 'Many'] })],
    ['capitalised "Select"', P({ type: 'Select' as never, options: ['Few', 'Many'] })],
    ['hem "qualitative" + options', P({ type: 'qualitative' as never, options: ['Normocytic', 'Microcytic'], normalValue: 'Normocytic' })],
    ['"qualitative" without options', P({ type: 'qualitative' as never, normalValue: 'Negative' })],
    ['"text" + mapped optionRows', P({ type: 'text', optionRows: rows })],
    ['unknown type + options', P({ type: 'weird' as never, options: ['A', 'B'] })],
  ])('%s → choice in the editor AND a dropdown at result entry', (_label, p) => {
    const json = JSON.stringify({ parameters: [p] });
    expect(resolveParamEntryKind(p)).toBe('select');
    expect(editorSaysChoice(json)).toBe(true);
    const f = loadEditorFields(json)[0];
    expect((f.options ?? []).map(o => o.label)).toEqual(choiceOptionsFor(p));
  });

  it('plain text / numeric / textarea stay what they are', () => {
    const load = (p: TestParameter) => loadEditorFields(JSON.stringify({ parameters: [p] }))[0].type;
    expect(load(P({ type: 'text' }))).toBe('text');
    expect(load(P({ type: 'numeric' }))).toBe('number');
    expect(load(P({ type: 'multiline' as never }))).toBe('textarea');
    expect(load(P({ type: 'textarea' }))).toBe('textarea');
  });
});

describe('loadEditorFields — stale fields[] twin (server option-group mapping)', () => {
  // What ApplyToTargets used to leave behind: parameters[] mapped, fields[] untouched.
  const staleBlob = {
    parameters: [P({ name: 'urobilinogen', type: 'select', optionRows: rows, options: ['Normal', 'Increased'], normalValue: 'Normal' })],
    fields: [{ id: 'f1', name: 'urobilinogen', label: 'Urobilinogen', type: 'text', order: 0,
               isRequired: true, isConditional: false, showWhen: { op: 'and', rules: [] } }],
  };

  it('the parameter wins: dropdown with its rows, editor metadata kept', () => {
    const [f] = loadEditorFields(JSON.stringify(staleBlob));
    expect(f.type).toBe('select');
    expect(f.optionRows).toEqual(rows);
    expect((f.options ?? []).map(o => o.label)).toEqual(['Normal', 'Increased']);
    expect(f.normalValue).toBe('Normal');
    expect(f.isRequired).toBe(true);
    expect(f.showWhen).toEqual({ op: 'and', rules: [] });
    expect(f.id).toBe('f1');
  });

  it('a group edit that only touched parameters[] shows the NEW rows', () => {
    const newRows = [...rows, { code: 'URO003', value: 'Markedly increased', normal: false, active: true }];
    const blob = {
      parameters: [P({ name: 'u', type: 'options' as never, optionRows: newRows, options: newRows.map(r => r.value) })],
      fields: [{ id: 'f1', name: 'u', label: 'U', type: 'radio', order: 0, isRequired: false, isConditional: false,
                 optionRows: rows, options: rows.map((r, i) => ({ id: `o${i}`, label: r.value, value: r.value, order: i })) }],
    };
    const [f] = loadEditorFields(JSON.stringify(blob));
    expect(f.type).toBe('radio');                              // richer choice type kept
    expect(f.optionRows).toEqual(newRows);
    expect(f.options?.map(o => o.label)).toEqual(newRows.map(r => r.value));
  });

  it('consistent twins are returned untouched; checkbox fields are never hijacked', () => {
    const blob = {
      parameters: [P({ name: 'a', type: 'text' }), P({ name: 'b', type: 'options' as never })],
      fields: [{ id: 'fa', name: 'a', label: 'A', type: 'text', order: 0, isRequired: false, isConditional: false },
               { id: 'fb', name: 'b', label: 'B', type: 'checkbox', order: 1, isRequired: false, isConditional: false }],
    };
    const out = loadEditorFields(JSON.stringify(blob));
    expect(out.map(f => f.type)).toEqual(['text', 'checkbox']);
    expect(out[0]).toEqual(blob.fields[0]);
  });

  it('parameters with no field twin are appended, not dropped', () => {
    const blob = {
      parameters: [P({ name: 'a', type: 'text' }), P({ name: 'extra', type: 'select', options: ['X', 'Y'] })],
      fields: [{ id: 'fa', name: 'a', label: 'A', type: 'text', order: 0, isRequired: false, isConditional: false }],
    };
    const out = loadEditorFields(JSON.stringify(blob));
    expect(out.map(f => [f.name, f.type])).toEqual([['a', 'text'], ['extra', 'select']]);
  });

  it('tolerates junk', () => {
    expect(loadEditorFields('')).toEqual([]);
    expect(loadEditorFields('not json')).toEqual([]);
    expect(loadEditorFields('null')).toEqual([]);
  });
});

describe('round-trip: load → save unchanged keeps the mapping', () => {
  it.each([
    ['CLP select + optionRows', P({ type: 'select', optionRows: rows, options: ['Normal', 'Increased'], normalValue: 'Normal', optionGroupName: 'Urine' })],
    ['hem qualitative + options', P({ type: 'qualitative' as never, options: ['Normocytic', 'Microcytic'], normalValue: 'Normocytic' })],
    ['qualitative without options', P({ type: 'qualitative' as never, normalValue: 'Negative' })],
    ['dropdown', P({ type: 'dropdown' as never, options: ['Few', 'Many'] })],
    ['text + mapped rows', P({ type: 'text', optionRows: rows })],
    ['radio', P({ type: 'radio', options: ['Few', 'Many'] })],
    ['button_select', P({ type: 'button_select', options: ['Few', 'Many'] })],
  ])('%s', (_label, p) => {
    const saved = fieldToParam(legacyParamToField(p, 0));
    expect(resolveParamEntryKind(saved)).toBe('select');
    expect(choiceOptionsFor(saved)).toEqual(choiceOptionsFor(p));
    expect(saved.optionRows ?? null).toEqual(p.optionRows ?? null);
    expect(saved.normalValue ?? null).toEqual(p.normalValue ?? null);
    expect(saved.optionGroupName ?? null).toEqual(p.optionGroupName ?? null);
    // …and reloading the saved blob (both twins) is still a choice.
    const reloaded = loadEditorFields(JSON.stringify({ parameters: [saved], fields: [legacyParamToField(p, 0)] }));
    expect(hasOptions(reloaded[0].type)).toBe(true);
  });
});
