import { addField, addPage, emptyDefinition, findField, setLabel, updateField, FormDefinition } from '@prefrontal/forms-engine';
import { StudioError } from '../data/studio-models';
import {
  MAX_FILES,
  MAX_TOTAL_BYTES,
  addPages,
  checkNoteOf,
  clearCheck,
  countChecks,
  dropEditedChecks,
  jobFailure,
  markedSignatures,
  moveItem,
  pagesProblem,
  startRefusal,
  stepStates,
} from './cortex-import';

const file = (name: string, type: string, size = 1000) => ({ name, type, size, lastModified: 1 });

describe('Cortex import: the pages the dialog accepts', () => {
  it('needs at least one page', () => {
    expect(pagesProblem([])).toBe('Add at least one page.');
  });

  it('accepts JPEG, PNG, WebP and PDF, even when the browser sends no type (by the file name)', () => {
    const ok = [file('a.jpg', 'image/jpeg'), file('b.png', 'image/png'), file('c.webp', 'image/webp'), file('d.pdf', 'application/pdf'), file('e.JPEG', '')];
    expect(pagesProblem(ok)).toBe('');
  });

  it('refuses another type and names the file', () => {
    expect(pagesProblem([file('a.jpg', 'image/jpeg'), file('notes.docx', 'application/msword')])).toContain('“notes.docx”');
    expect(pagesProblem([file('anim.gif', 'image/gif')])).toContain('JPEG, PNG, WebP or PDF');
  });

  it('allows 8 pages, not 9', () => {
    const eight = Array.from({ length: MAX_FILES }, (_, i) => file(`p${i}.jpg`, 'image/jpeg'));
    expect(pagesProblem(eight)).toBe('');
    expect(pagesProblem([...eight, file('p9.jpg', 'image/jpeg')])).toBe('Use up to 8 pages. Remove 1 to continue.');
  });

  it('allows 20 MB together, not a byte more', () => {
    expect(pagesProblem([file('a.jpg', 'image/jpeg', MAX_TOTAL_BYTES)])).toBe('');
    expect(pagesProblem([file('a.jpg', 'image/jpeg', MAX_TOTAL_BYTES / 2), file('b.jpg', 'image/jpeg', MAX_TOTAL_BYTES / 2 + 1)])).toContain('over 20 MB');
  });

  it('adding keeps the order, leaves out the wrong types (named) and the same file twice', () => {
    const a = file('a.jpg', 'image/jpeg');
    const r = addPages([a], [a, file('b.png', 'image/png'), file('x.txt', 'text/plain')]);
    expect(r.files.map((f) => f.name)).toEqual(['a.jpg', 'b.png']);
    expect(r.rejected).toEqual(['x.txt']);
  });

  it('reorders pages', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 5)).toEqual(['a', 'b', 'c']);
  });
});

describe('Cortex import: plain words', () => {
  it.each([
    ['no_files', 'Add at least one page.'],
    ['too_many_files', 'Use up to 8 pages.'],
    ['too_large', 'over 20 MB'],
    ['bad_type', 'JPEG, PNG, WebP or PDF'],
    ['unknown_department', 'Pick a department'],
    ['feature_off', "Cortex isn't switched on"],
    ['cortex_unavailable', "Cortex isn't set up yet."],
    ['cap_reached', 'limit for Cortex'],
  ])('a refused start with code %s says it in plain words', (code, words) => {
    expect(startRefusal(new StudioError(code, 'server words', 400))).toContain(words);
  });

  it('404 / 424 with no code mean "not available here"; offline says so; anything else is a retry', () => {
    expect(startRefusal({ status: 404 })).toContain("isn't available here yet");
    expect(startRefusal({ status: 424 })).toContain("isn't available here yet");
    expect(startRefusal({ status: 0 })).toContain("Can't reach the server");
    expect(startRefusal({ status: 500 })).toContain('Please try again');
  });

  it.each([
    ['unreadable', 'Try a clearer photo.'],
    ['patient_data', "This sheet has a patient's details. Upload a blank one."],
    ['model_error', 'ran into a problem'],
    ['invalid_result', "couldn't turn this sheet into a form"],
    [undefined, 'could not finish'],
  ])('a failed job with code %s', (code, words) => {
    expect(jobFailure(code)).toContain(words);
  });

  it('never says AI', () => {
    for (const c of ['unreadable', 'patient_data', 'model_error', 'invalid_result', undefined]) expect(jobFailure(c)).not.toMatch(/\bAI\b/);
  });
});

describe('Cortex import: the four steps', () => {
  it('tick off as the job moves on', () => {
    expect(stepStates('queued')).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(stepStates('reading')).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(stepStates('building')).toEqual(['done', 'active', 'active', 'pending']);
    expect(stepStates('checking')).toEqual(['done', 'done', 'done', 'active']);
    expect(stepStates('done')).toEqual(['done', 'done', 'done', 'done']);
  });
});

function marked(): { def: FormDefinition; a: string; b: string; sub: string } {
  let def = addPage(emptyDefinition('ENT'), 'History').def;
  const a = addField(def, { pageKey: 'history' }, 'choice');
  def = updateField(setLabel(a.def, a.key, 'Side'), a.key, (f) => {
    f.options = [{ key: 'l', label: 'Left' }, { key: 'r', label: 'Right' }];
    f.config = { checkNote: 'Is it left or right?' };
  });
  const b = addField(def, { pageKey: 'history' }, 'text');
  def = setLabel(b.def, b.key, 'Notes');
  const sub = addField(def, { option: { fieldKey: a.key, optionKey: 'l' } }, 'text');
  def = updateField(setLabel(sub.def, sub.key, 'Since when'), sub.key, (f) => (f.config = { checkNote: 'Smudged' }));
  return { def, a: a.key, b: b.key, sub: sub.key };
}

describe('Cortex import: "Check this" markers', () => {
  it('counts marked questions, follow-ups included', () => {
    const { def } = marked();
    expect(countChecks(def)).toBe(2);
    expect(countChecks(null)).toBe(0);
  });

  it('Looks right removes only that marker (and an empty config)', () => {
    const { def, a, sub } = marked();
    const next = clearCheck(def, sub);
    expect(countChecks(next)).toBe(1);
    expect(findField(next, sub)!.config).toBeUndefined();
    expect(checkNoteOf(findField(next, a)!)).toBe('Is it left or right?');
  });

  it('an edit to a marked question clears it; an edit elsewhere does not', () => {
    const { def, a, b, sub } = marked();
    const before = markedSignatures(def);
    const elsewhere = dropEditedChecks(before, setLabel(def, b, 'Other notes'));
    expect(countChecks(elsewhere)).toBe(2);
    const edited = dropEditedChecks(before, setLabel(def, a, 'Which side'));
    expect(checkNoteOf(findField(edited, a)!)).toBe('');
    expect(checkNoteOf(findField(edited, sub)!)).toBe('Smudged');
  });

  it("editing a follow-up clears the follow-up's marker, not its parent's", () => {
    const { def, a, sub } = marked();
    const edited = dropEditedChecks(markedSignatures(def), setLabel(def, sub, 'Since when?'));
    expect(checkNoteOf(findField(edited, sub)!)).toBe('');
    expect(checkNoteOf(findField(edited, a)!)).toBe('Is it left or right?');
  });
});
