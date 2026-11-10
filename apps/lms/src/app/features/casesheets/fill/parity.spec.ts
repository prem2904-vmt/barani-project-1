import { TestBed } from '@angular/core/testing';
import { FormDefinition } from '@prefrontal/forms-engine';
import { CaseNarrative, NarrativeSection } from '../data/cases/case-models';
import { CaseSession } from '../data/cases/case-session';
import { CasesApi } from '../data/cases/cases-api';
import { MockCasesApi, defaultsOf } from '../data/cases/mock-cases-api';
import { CaseSuggestions } from '../data/suggestions/case-suggestions';
import { NarrativeCardComponent } from './narrative-card.component';
import { HOLD_FINISH, HOLD_LEAVE, HOLD_NOTE, SHORTCUTS } from './case.page';

/** Legacy parity in the app (pf-work/plans/prepare-parity.md): defaults, suggestions, own sections, titles, pins, shortcuts. */

const NOTES: FormDefinition = {
  title: 'Notes',
  pages: [
    {
      key: 'p',
      title: 'Page',
      fields: [
        { key: 'patientName', kind: 'text', label: 'Patient name' },
        { key: 'complaint', kind: 'text', label: 'Complaint' },
        { key: 'phone', kind: 'text', label: 'Phone', config: { format: 'phone' } },
        {
          key: 'side',
          kind: 'choice',
          label: 'Side',
          default: 'l',
          options: [
            { key: 'l', label: 'Left', subFields: [{ key: 'since', kind: 'text', label: 'Since', default: 'birth' }] },
            { key: 'r', label: 'Right' },
          ],
        },
        { key: 'blank', kind: 'text', label: 'Blank', default: '  ' },
      ],
    },
  ],
};

describe('mock API keeps the server’s parity rules', () => {
  it('a new sheet starts with the form’s defaults (fields and follow-ups, never blanks)', async () => {
    expect(defaultsOf(NOTES)).toEqual({ side: 'l', since: 'birth' });
    const api = new MockCasesApi();
    api.addForm('notes', NOTES);
    expect((await api.createCase('notes')).answers).toEqual({ side: 'l', since: 'birth' });
  });

  it('Finish teaches the suggestion chips (ranked by use; never names or phones); one can be removed', async () => {
    const api = new MockCasesApi();
    api.addForm('notes', NOTES);
    for (const complaint of ['Nasal block', 'nasal block', 'Sneezing']) {
      const c = await api.createCase('notes', { name: 'Test Patient' });
      await api.saveCase(c.id, {
        rowVersion: 1,
        requestId: c.id,
        answers: { complaint, patientName: 'Test Patient', phone: '+91 98765 43210' },
      });
      await api.finishCase(c.id, 2);
    }
    const top = await api.suggestions('notes', 'complaint');
    expect(top.map((s) => [s.text, s.uses])).toEqual([
      ['Nasal block', 2],
      ['Sneezing', 1],
    ]);
    expect(await api.suggestions('notes', 'patientName')).toEqual([]);
    expect(await api.suggestions('notes', 'phone')).toEqual([]);
    expect((await api.suggestions('notes', 'complaint', 'SNEE')).map((s) => s.text)).toEqual(['Sneezing']);
    await api.deleteSuggestion(top[1].id);
    expect((await api.suggestions('notes', 'complaint')).map((s) => s.text)).toEqual(['Nasal block']);
  });

  it('rename keeps the generated words; own sections follow, can be edited and removed', async () => {
    const api = new MockCasesApi();
    const c = await api.createCase('form-ent');
    await api.saveCase(c.id, { rowVersion: 1, requestId: 'a', answers: { patientName: 'Asha' } });
    const first = (await api.narrative(c.id)).sections[0];
    let rv = (await api.renameSection(c.id, first.id, 'Who', 2)).rowVersion;
    let n = await api.narrative(c.id);
    expect(n.sections[0].title).toBe('Who');
    expect(n.sections[0].formTitle).toBe(first.title);
    expect(n.sections[0].edited).toBeNull();
    const added = await api.addOwnSection(c.id, { title: 'Plan', text: '' }, rv);
    rv = added.rowVersion;
    rv = (await api.editSection(c.id, added.sectionId, 'Steam inhalation.', rv)).rowVersion;
    n = await api.narrative(c.id);
    const own = n.sections.at(-1)!;
    expect([own.title, own.content, own.own]).toEqual(['Plan', 'Steam inhalation.', true]);
    rv = (await api.clearSection(c.id, added.sectionId, rv)).rowVersion;
    expect((await api.narrative(c.id)).sections.some((s) => s.own)).toBe(false);
    // clearing the words of a renamed section keeps its new title
    rv = (await api.editSection(c.id, first.id, 'Mine.', rv)).rowVersion;
    await api.clearSection(c.id, first.id, rv);
    n = await api.narrative(c.id);
    expect([n.sections[0].title, n.sections[0].edited]).toEqual(['Who', null]);
  });

  it('pinned forms come first', async () => {
    const api = new MockCasesApi();
    api.addForm('notes', NOTES);
    await api.pinForm('notes', true);
    expect((await api.listForms()).map((f) => [f.id, f.pinned])).toEqual([
      ['notes', true],
      ['form-ent', false],
    ]);
  });
});

describe('suggestions of one open sheet', () => {
  it('top 5 per field fetched once; a search always asks; remove forgets the cached list', async () => {
    const api = new MockCasesApi();
    api.addSuggestion('form-ent', 'complaint', 'Nasal block', 3);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: CasesApi, useValue: api }, CaseSession, CaseSuggestions] });
    const session = TestBed.inject(CaseSession);
    const c = await api.createCase('form-ent');
    await session.open(c.id);
    const s = TestBed.inject(CaseSuggestions);
    await s.list('complaint');
    await s.list('complaint');
    expect(api.calls.filter((x) => x.op === 'suggestions').length).toBe(1);
    await s.list('complaint', 'nas');
    expect(api.calls.filter((x) => x.op === 'suggestions').length).toBe(2);
    const [row] = await s.list('complaint');
    await s.remove('complaint', row.id);
    expect(await s.list('complaint')).toEqual([]);
    session.destroy();
  });
});

describe('narrative card: titles and sections of your own', () => {
  const sec = (over: Partial<NarrativeSection>): NarrativeSection => ({
    id: 'hpi',
    key: 'hpi',
    title: 'History',
    order: 1,
    generated: 'Fever.',
    edited: null,
    stale: false,
    content: 'Fever.',
    own: false,
    formTitle: null,
    ...over,
  });
  async function render(sections: NarrativeSection[], openSection: string | null = null) {
    TestBed.resetTestingModule();
    const f = TestBed.createComponent(NarrativeCardComponent);
    const n: CaseNarrative = { state: 'draft', rowVersion: 1, frozen: false, patientName: 'A', age: null, sex: null, warnings: [], sections };
    f.componentRef.setInput('narrative', n);
    f.componentRef.setInput('openSection', openSection);
    const out = { rename: [] as string[], add: 0, remove: [] as string[] };
    f.componentInstance.rename.subscribe((s) => out.rename.push(s.id));
    f.componentInstance.addOwn.subscribe(() => out.add++);
    f.componentInstance.remove.subscribe((s) => out.remove.push(s.id));
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, out };
  }

  it('Rename and "Add a section of your own" ask the page; the form’s title is shown when renamed', async () => {
    const r = await render([sec({ title: 'Presenting complaint', formTitle: 'History' })]);
    (r.el.querySelector('[aria-label="Rename Presenting complaint"]') as HTMLButtonElement).click();
    expect(r.out.rename).toEqual(['hpi']);
    expect(r.el.textContent).toContain("Form's title: History");
    [...r.el.querySelectorAll('button')].find((b) => b.textContent?.includes('Add a section of your own'))!.click();
    expect(r.out.add).toBe(1);
  });

  it('an own section shows even while empty, opens for typing when just added, and can be removed', async () => {
    const own = sec({ id: 'own-1', key: 'own-1', title: 'Note', generated: '', content: '', edited: '', own: true });
    const r = await render([own], 'own-1');
    await new Promise((res) => setTimeout(res, 80));
    r.f.detectChanges();
    expect(r.el.querySelector('[data-section="own-1"]')?.textContent).toContain('Your section');
    expect(r.el.querySelector('textarea[data-edit="own-1"]')).not.toBeNull();
    (r.el.querySelector('[aria-label="Remove Note"]') as HTMLButtonElement | null)?.click();
    // in edit mode the row actions are hidden; cancel first
    [...r.el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel')!.click();
    r.f.detectChanges();
    (r.el.querySelector('[aria-label="Remove Note"]') as HTMLButtonElement).click();
    expect(r.out.remove).toEqual(['own-1']);
  });
});

describe('holds and shortcuts (legacy timings)', () => {
  it('match the legacy tab-nav / navbar logo holds', () => {
    // tab-nav.ts:138-140 — Next 200 ms + 1.5 s, the step indicator 200 ms + 800 ms; navbar.ts:117-118 — the PF logo 300 ms + 1.2 s
    expect(HOLD_FINISH).toEqual({ delay: 200, fill: 1500 });
    expect(HOLD_LEAVE).toEqual({ delay: 200, fill: 800 });
    expect(HOLD_NOTE).toEqual({ delay: 300, fill: 1200 });
    expect(SHORTCUTS.map((s) => s.does)).toEqual([
      'Next page',
      'Previous page',
      'Finish',
      'Open or close the narrative',
      'This list',
      'Close a list or a dialog',
    ]);
  });
});
