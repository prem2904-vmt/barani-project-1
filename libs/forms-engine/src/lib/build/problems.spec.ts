import { addField, addPage, emptyDefinition, setLabel } from './doc';
import { placeProblem } from './problems';

describe('publish problems, placed and in plain words', () => {
  let d = addPage(emptyDefinition('ENT'), 'History').def;
  const pain = addField(d, { pageKey: 'history' }, 'multi');
  d = setLabel(pain.def, pain.key, 'Pain');

  it('finds the field by its (key) and says what to do', () => {
    const p = placeProblem(d, {
      severity: 'error',
      path: `pages[0].fields[0](${pain.key}).options`,
      message: 'A multi field needs at least one option.',
    });
    expect(p).toMatchObject({ severity: 'error', pageKey: 'history', pageTitle: 'History', fieldKey: pain.key, fieldLabel: 'Pain', area: 'options', text: 'Add at least one choice.' });
  });

  it('a condition on a removed question points at "Show when"', () => {
    const p = placeProblem(d, {
      severity: 'error',
      path: `pages[0].fields[0](${pain.key}).showWhen.conditions[0].field`,
      message: "Field 'gone' does not exist.",
    });
    expect(p.area).toBe('showWhen');
    expect(p.text).toMatch(/Show when/);
    expect(p.text).not.toContain('gone');
  });

  it('walks [i] indexes when there is no (key), and keeps unknown messages', () => {
    const p = placeProblem(d, { severity: 'warning', path: 'pages[0].fields[0].label', message: 'This field has no label.' });
    expect(p.fieldKey).toBe(pain.key);
    expect(p.text).toBe('Give this question a name.');
    const q = placeProblem(d, { severity: 'error', path: 'schemaVersion', message: 'Only schema version 2 is supported.' });
    expect(q).toMatchObject({ fieldKey: null, area: 'form', text: 'Only schema version 2 is supported.' });
  });
});
