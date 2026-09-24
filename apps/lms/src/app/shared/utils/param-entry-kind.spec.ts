import {
  choiceOptionsFor,
  editorFieldTypeFor,
  fieldIsStaleForChoice,
  resolveParamEntryKind,
} from './param-entry-kind';

describe('resolveParamEntryKind — every stored dropdown shape', () => {
  const rows = [
    { code: 'URO001', value: 'Normal', normal: true, active: true },
    { code: 'URO002', value: 'Increased', normal: false, active: true },
    { code: 'URO003', value: 'Retired', normal: false, active: false },
  ];

  it.each([
    ['select'], ['options'], ['choice'], ['dropdown'], ['radio'], ['button_select'],
    ['buttonSelect'], ['multiselect'], ['imageSelect'],
    ['Select'], ['DROPDOWN'], ['Drop-down'], ['Button Select'], [' options '],
  ])('choice-ish type %j is a dropdown even without inline options', (type) => {
    expect(resolveParamEntryKind({ type })).toBe('select');
  });

  it('option-group mapped params (rows / options, any non-explicit type) are dropdowns', () => {
    expect(resolveParamEntryKind({ type: 'text', optionRows: rows })).toBe('select');
    expect(resolveParamEntryKind({ type: 'text', options: ['Few', 'Many'] })).toBe('select');
    expect(resolveParamEntryKind({ type: 'qualitative', options: ['Normocytic', 'Microcytic'] })).toBe('select');
    expect(resolveParamEntryKind({ optionRows: rows })).toBe('select');
    expect(resolveParamEntryKind({ type: 'weird', options: ['A', 'B'] })).toBe('select');
  });

  it('qualitative type with NO options is a dropdown (Sickling Test)', () => {
    expect(resolveParamEntryKind({ type: 'qualitative' })).toBe('select');
    expect(choiceOptionsFor({ type: 'qualitative' })).toEqual(['Positive', 'Negative']);
  });

  it('explicit non-choice types win', () => {
    expect(resolveParamEntryKind({ type: 'numeric' })).toBe('number');
    expect(resolveParamEntryKind({ type: 'Numeric' })).toBe('number');
    expect(resolveParamEntryKind({ type: 'decimal' })).toBe('number');
    expect(resolveParamEntryKind({ type: 'numeric_with_range' })).toBe('number');
    expect(resolveParamEntryKind({ type: 'textarea' })).toBe('textarea');
    expect(resolveParamEntryKind({ type: 'multiline' })).toBe('textarea');
    expect(resolveParamEntryKind({ type: 'date' })).toBe('date');
    expect(resolveParamEntryKind({ type: 'yesno' })).toBe('checkbox');
  });

  it('plain text stays free text', () => {
    expect(resolveParamEntryKind({ type: 'text' })).toBe('text');
    expect(resolveParamEntryKind({})).toBe('text');
    expect(resolveParamEntryKind({ type: 'text', options: ['', '  '], optionRows: [] })).toBe('text');
  });

  it('choiceOptionsFor prefers active optionRows, then qualitative, then options', () => {
    expect(choiceOptionsFor({ type: 'select', optionRows: rows, options: ['X'] })).toEqual(['Normal', 'Increased']);
    expect(choiceOptionsFor({ type: 'select', options: ['Few', 'Many'] })).toEqual(['Few', 'Many']);
    expect(choiceOptionsFor({ type: 'select' })).toEqual([]);
  });
});

describe('editorFieldTypeFor — the editor makes the SAME decision', () => {
  it.each([
    [{ type: 'select' }, 'select'],
    [{ type: 'options' }, 'select'],
    [{ type: 'choice' }, 'select'],
    [{ type: 'dropdown' }, 'select'],
    [{ type: 'Select' }, 'select'],
    [{ type: 'radio' }, 'radio'],
    [{ type: 'button_select' }, 'buttonSelect'],
    [{ type: 'multiselect' }, 'multiselect'],
    [{ type: 'qualitative', options: ['Normocytic', 'Microcytic'] }, 'select'],
    [{ type: 'qualitative' }, 'select'],
    [{ type: 'text', options: ['Few', 'Many'] }, 'select'],
    [{ type: 'numeric' }, 'number'],
    [{ type: 'decimal' }, 'number'],
    [{ type: 'multiline' }, 'textarea'],
    [{ type: 'textarea' }, 'textarea'],
    [{ type: 'text' }, 'text'],
    [{ type: 'date' }, 'date'],
    [{ type: 'yesno' }, 'yesno'],
    [{ type: 'mystery' }, 'text'],
  ])('%j → %s', (p, expected) => {
    expect(editorFieldTypeFor(p)).toBe(expected);
  });
});

describe('fieldIsStaleForChoice', () => {
  const mapped = { type: 'select', optionRows: [{ value: 'Few', active: true }] };
  it('a plain-input field next to a mapped parameter is stale', () => {
    expect(fieldIsStaleForChoice('text', mapped)).toBe(true);
    expect(fieldIsStaleForChoice('textarea', mapped)).toBe(true);
    expect(fieldIsStaleForChoice('number', mapped)).toBe(true);
  });
  it('never overrides choice / checkbox / layout fields, nor an empty list', () => {
    expect(fieldIsStaleForChoice('radio', mapped)).toBe(false);
    expect(fieldIsStaleForChoice('checkbox', { type: 'options' })).toBe(false);
    expect(fieldIsStaleForChoice('text', { type: 'options' })).toBe(false);
    expect(fieldIsStaleForChoice('text', { type: 'text' })).toBe(false);
  });
});
