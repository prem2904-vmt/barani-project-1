import { FormDefinition } from '../core/types';
import { addField, addOption, addPage, emptyDefinition, removeField, setLabel, updateField, updateOption, moveField } from './doc';
import { diffDefinitions, summariseChanges } from './diff';

function base(): { d: FormDefinition; pain: string; notes: string } {
  let d = addPage(emptyDefinition('ENT'), 'History').def;
  const pain = addField(d, { pageKey: 'history' }, 'yesno');
  d = setLabel(pain.def, pain.key, 'Pain');
  const notes = addField(d, { pageKey: 'history' }, 'text');
  d = setLabel(notes.def, notes.key, 'Notes');
  return { d, pain: pain.key, notes: notes.key };
}

describe('version diff in words', () => {
  it('no change, no lines', () => {
    const { d } = base();
    expect(diffDefinitions(d, structuredClone(d))).toEqual([]);
    expect(summariseChanges([])).toBe('No changes');
  });

  it('added / removed questions and pages', () => {
    const { d, notes } = base();
    let after = addPage(d, 'Examination').def;
    after = addField(after, { pageKey: 'history' }, 'number').def;
    after = removeField(after, notes);
    const lines = diffDefinitions(d, after).map((c) => `${c.kind}: ${c.text}`);
    expect(lines).toContain('added: Added the page “Examination”');
    expect(lines).toContain('added: Added the question “Number”');
    expect(lines).toContain('removed: Removed the question “Notes”');
  });

  it('sentence, condition, choice words and order changes read as words', () => {
    const { d, pain, notes } = base();
    let after = updateField(d, notes, (f) => (f.says!.sentence = 'The patient says {value}.'));
    after = updateField(after, notes, (f) => (f.showWhen = { conditions: [{ field: pain, op: 'equals', value: 'yes' }] }));
    after = updateOption(after, pain, 'yes', (o) => (o.says = 'complains of pain'));
    after = addOption(after, pain, 'Not sure').def;
    after = moveField(after, notes, 0);
    const ch = diffDefinitions(d, after);
    const said = ch.find((c) => c.text === 'Changed what “Notes” says')!;
    expect(said.before).toBe('Notes: {value}.');
    expect(said.after).toBe('The patient says {value}.');
    const shown = ch.find((c) => c.text === 'Changed when “Notes” shows')!;
    expect(shown.before).toBe('Always shown');
    expect(shown.after).toBe('Shown when Pain is Yes');
    expect(ch.some((c) => c.text === 'Changed what “Yes” says in “Pain”')).toBe(true);
    expect(ch.some((c) => c.text === 'Added the choice “Not sure” to “Pain”')).toBe(true);
    expect(ch.some((c) => c.kind === 'moved' && c.text === 'Changed the order of the questions')).toBe(true);
    expect(summariseChanges(ch)).toMatch(/^\d+ changed$/);
  });

  it('never shows an inner key', () => {
    const { d, pain } = base();
    const after = updateField(d, pain, (f) => (f.required = true));
    for (const c of diffDefinitions(d, after)) expect(c.text).not.toContain(pain);
  });
});
