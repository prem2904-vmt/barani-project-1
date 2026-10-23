import { editorFieldTypeFor, resolveParamEntryKind } from './param-entry-kind';
import { loadEditorFields, writeParameters } from './test-parameters';
import { isFilled } from '../../features/lab/sample-result-entry/submit-all';
import { hasEnteredValue } from './print-picker';
import { savedResultHasValue } from './line-status';

/** Family (hierarchical) answers — owner 2026-10-23. */
describe('entry kind: family', () => {
  it('type "family" resolves to the family kind in every spelling', () => {
    for (const type of ['family', 'Family', ' FAMILY ']) expect(resolveParamEntryKind({ type, familyCode: 'FAM-CASTS' })).toBe('family');
    // The type wins even with a stray option list on the parameter.
    expect(resolveParamEntryKind({ type: 'family', options: ['A', 'B'] })).toBe('family');
  });

  it('a familyCode on another type never turns it into a family', () => {
    expect(resolveParamEntryKind({ type: 'select', options: ['A'], familyCode: 'FAM-X' })).toBe('select');
    expect(resolveParamEntryKind({ type: 'numeric', familyCode: 'FAM-X' })).toBe('number');
  });

  it('the editor shows it as the family field type', () => {
    expect(editorFieldTypeFor({ type: 'family', familyCode: 'FAM-CASTS' })).toBe('family');
  });

  it('familyCode round-trips through the editor (and is dropped when the type changes)', () => {
    const json = JSON.stringify({ parameters: [{ id: 'p1', name: 'casts', title: 'Casts', type: 'family', familyCode: 'FAM-CASTS', printOnReport: true }] });
    const fields = loadEditorFields(json);
    expect(fields[0].type).toBe('family');
    expect(fields[0].familyCode).toBe('FAM-CASTS');
    expect(fields[0].options).toBeNull();
    const back = JSON.parse(writeParameters(json, fields)).parameters[0];
    expect(back).toMatchObject({ name: 'casts', type: 'family', familyCode: 'FAM-CASTS' });
    const asText = JSON.parse(writeParameters(json, [{ ...fields[0], type: 'textarea' }])).parameters[0];
    expect(asText.type).toBe('textarea');
    expect('familyCode' in asText).toBe(false);
  });

  it('a non-family parameter gains no familyCode key', () => {
    const fields = loadEditorFields(JSON.stringify({ parameters: [{ id: 'g', name: 'glu', title: 'Glucose', type: 'numeric' }] }));
    expect('familyCode' in fields[0] && fields[0].familyCode !== undefined).toBe(false);
  });
});

describe('a family value counts as entered only with a root answer', () => {
  const filled = { family: 'FAM-CASTS', v: 'PRS', label: 'Present' };
  const blank = { family: 'FAM-CASTS', v: '', label: '' };
  it('bench (submit-all), print picker and the saved-draft check agree', () => {
    expect(isFilled(filled)).toBe(true);
    expect(isFilled(blank)).toBe(false);
    expect(hasEnteredValue(filled)).toBe(true);
    expect(hasEnteredValue(blank)).toBe(false);
    expect(savedResultHasValue(JSON.stringify({ values: { casts: filled } }))).toBe(true);
    expect(savedResultHasValue(JSON.stringify({ values: { casts: blank } }))).toBe(false);
  });
});
