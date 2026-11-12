import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { ageFromSheet, ageWords, parseAge, toDays } from './age-text';
import { resolveItems, stateOf } from './checklist-data';
import { AgeChecklistFill } from './ageChecklist.fill';

const milestones = () => f('dev', 'ageChecklist', { label: 'Development', config: { preset: 'milestones' } });
const vaccines = () => f('imm', 'ageChecklist', { label: 'Immunisation', config: { preset: 'vaccines' } });

describe('age text', () => {
  it('reads the usual ways a doctor writes an age', () => {
    expect(parseAge('18 months')).toBe(548);
    expect(parseAge('1y 6m')).toBe(548);
    expect(parseAge('6 weeks')).toBe(42);
    expect(parseAge('5')).toBe(toDays(5, 'years'));
    expect(parseAge('abc')).toBeNull();
    expect(parseAge('2020-06-15', '2024-06-15')).toBe(1461);
    expect(parseAge('2020-06-15')).toBeNull();
  });
  it('writes ages in words', () => {
    expect(ageWords(548)).toBe('18 months');
    expect(ageWords(42)).toBe('6 weeks');
    expect(ageWords(1096)).toBe('3 years');
  });
  it('finds the sheet\'s own age question (or the one named)', () => {
    const fields = [{ key: 'age', label: 'Age' }, { key: 'dob', label: 'Date of birth' }];
    expect(ageFromSheet({ key: 'dev' }, fields, { age: '2 years' })).toBe(toDays(2, 'years'));
    expect(ageFromSheet({ key: 'dev', config: { ageField: 'dob' } }, fields, { age: '2 years', dob: '2023-05-15' }, '2024-11-15')).toBe(550);
    expect(ageFromSheet({ key: 'dev' }, fields, {})).toBeNull();
  });
});

describe('checklist lines', () => {
  it('a line is flagged only when "not yet" and the age has reached the age it is expected by', () => {
    const walks = resolveItems({ preset: 'milestones' }).find((i) => i.key === 'walks')!;
    expect(stateOf(walks, 'notDone', 547, false)).toBe('open');
    expect(stateOf(walks, 'notDone', 548, false)).toBe('flagged');
    expect(stateOf(walks, 'notDone', 100, false)).toBe('later');
    expect(stateOf(walks, 'done', 100, false)).toBe('done');
    expect(stateOf(walks, undefined, 600, true)).toBe('flagged');
  });
  it('the presets list real lines; vaccines can leave some out', () => {
    expect(resolveItems({ preset: 'milestones' }).length).toBeGreaterThan(30);
    expect(resolveItems({ preset: 'milestones', domains: ['gross'] }).every((i) => i.group === 'Gross motor')).toBe(true);
    expect(resolveItems({ preset: 'vaccines', exclude: ['je1', 'je2'] }).some((i) => i.key === 'je1')).toBe(false);
    expect(resolveItems({ preset: 'custom', items: [{ key: 'a', label: 'A', byMonths: 1 }] })).toHaveLength(1);
  });
});

describe('ageChecklist fill', () => {
  it.each(examplesOf('ageChecklist').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(AgeChecklistFill, ex.field, ex.answers[ex.field.key]);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('takes the age from the sheet and shows it in words', async () => {
    const r = await renderKind(AgeChecklistFill, milestones(), null, { scope: { age: '18 months' } });
    expect(r.el.querySelector('[data-age]')?.textContent?.trim()).toBe('18 months');
    // items that start later are tucked away behind a button
    expect(r.el.querySelector('[data-item="hops"]')).toBeNull();
    await r.click('[data-act="later"]');
    expect(r.el.querySelector('[data-item="hops"]')).not.toBeNull();
  });

  it('one tap writes the answer and the age that was used; a late line is named in words', async () => {
    const r = await renderKind(AgeChecklistFill, milestones(), null, { scope: { age: '18 months' } });
    await r.click('[data-item="walks"] [data-answer="notDone"]');
    expect(r.last()).toEqual({ ageDays: 548, items: { walks: 'notDone' } });
    expect(r.el.querySelector('[data-item="walks"]')?.getAttribute('data-state')).toBe('flagged');
    expect(r.el.querySelector('[data-item="walks"]')?.textContent).toContain('Later than expected');
    await r.click('[data-item="walks"] [data-answer="notDone"]'); // again = clear
    expect(r.last()).toEqual({ ageDays: 548 });
  });

  it('"All done for this age" ticks every line shown and leaves later lines alone', async () => {
    const r = await renderKind(AgeChecklistFill, milestones(), null, { scope: { age: '9 months' } });
    await r.click('[data-act="all-done"]');
    const items = (r.last() as { items: Record<string, string> }).items;
    expect(items['sits']).toBe('done');
    expect(items['walks']).toBe('done'); // walking starts being asked at 9 months
    expect(items['runs']).toBeUndefined();
    await r.click('[data-item="walks"] [data-answer="notDone"]');
    expect((r.last() as { items: Record<string, string> }).items['walks']).toBe('notDone');
  });

  it('asks for the age when the sheet has none', async () => {
    const r = await renderKind(AgeChecklistFill, milestones());
    const box = r.el.querySelector<HTMLInputElement>('[data-age-input]')!;
    expect(box).not.toBeNull();
    box.value = '2';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await r.stable();
    await r.click('[data-unit="years"]');
    await r.click('[data-act="set-age"]');
    expect(r.last()).toEqual({ ageDays: 730 });
    expect(r.el.querySelector('[data-age]')?.textContent?.trim()).toBe('2 years');
  });

  it('vaccines say Given / Not given and Overdue', async () => {
    const r = await renderKind(AgeChecklistFill, vaccines(), { ageDays: 1096, items: { mr2: 'notDone' } });
    expect(r.el.querySelector('[data-item="mr2"] [data-answer="done"]')?.textContent?.trim()).toBe('Given');
    expect(r.el.querySelector('[data-item="mr2"] [data-answer="notDone"]')?.textContent?.trim()).toBe('Not given');
    expect(r.el.querySelector('[data-item="mr2"]')?.textContent).toContain('Overdue');
    expect(r.el.querySelector('[data-item="mr2"]')?.getAttribute('data-state')).toBe('flagged');
  });

  it('a note is kept with the answer; Clear removes everything', async () => {
    const r = await renderKind(AgeChecklistFill, milestones(), { ageDays: 548, items: { sits: 'done' } });
    const note = r.el.querySelector<HTMLInputElement>('[data-note]')!;
    note.value = 'Parents worried';
    note.dispatchEvent(new Event('change', { bubbles: true }));
    await r.stable();
    expect(r.last()).toEqual({ ageDays: 548, items: { sits: 'done' }, note: 'Parents worried' });
    await r.click('[data-act="clear"]');
    expect(r.last()).toBeUndefined();
  });

  it('read-only: no answer button can be used', async () => {
    const r = await renderKind(AgeChecklistFill, milestones(), { ageDays: 548, items: { sits: 'done' } });
    await r.setDisabled(true);
    expect([...r.el.querySelectorAll<HTMLButtonElement>('[data-answer]')].every((b) => b.disabled)).toBe(true);
    expect(r.el.querySelector('[data-act="all-done"]')).toBeNull();
  });
});
