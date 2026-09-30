import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/auth/auth.service';
import { OpdAdminApi, OpdFormDetail } from './opd-admin.api';
import { OpdFormBuilderPage } from './form-builder.page';
import { OpdFormDoc } from './forms/form-schema';
import { BusyDirective } from '../../../shared/directives/busy.directive';

/**
 * Form builder — edit in place, add by sentence, autosaved DRAFT, Publish
 * = the next immutable version (the draft is flushed first), try-as-a-doctor
 * never saves, and "+ New form" from a department attaches the new form.
 */
const schema = (keys: string[]): OpdFormDoc => ({ schemaVersion: 2, allowAddons: true, sections: [{ key: 'findings', title: 'Findings',
  fields: keys.map((k) => ({ key: k, label: k === 'discharge' ? 'Ear discharge?' : k, type: k === 'discharge' ? 'yn' : 'short', print: true })) }] });
const q = (k: string): { key: string; label: string; type: 'short'; print: true } => ({ key: k, label: k, type: 'short', print: true });
/** A 3-section doc, the seeded ENT/Derm/Gynae shape (§ admin/forms/form-builder.page.ts task 1). */
const multiSchema = (): OpdFormDoc => ({
  schemaVersion: 2, allowAddons: true,
  sections: [
    { key: 'history', title: 'History', fields: [q('chief'), q('duration')] },
    { key: 'exam', title: 'Examination', fields: [q('bp')] },
    { key: 'invest', title: 'Investigations', fields: [q('cbc'), q('esr')] },
  ],
});
const detail = (o: Partial<OpdFormDetail> = {}): OpdFormDetail => ({
  id: 'f1', name: 'ENT assessment', code: 'ent', isActive: true, currentVersionId: 'v3',
  published: { id: 'v3', formId: 'f1', version: 3, status: 'published', schema: schema(['complaint']), createdAt: '' },
  draft: null, versions: [], usedBy: [{ kind: 'service', id: 's1', name: 'ENT consultation', code: 'ENT-C01' }], ...o,
});

function render(id = 'f1', q: Record<string, string> = {}, d: OpdFormDetail = detail()) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const params = new BehaviorSubject(convertToParamMap({ id }));
  const api = {
    starters: vi.fn(() => of([])), forms: vi.fn(() => of([])),
    form: vi.fn(() => of(d)),
    saveDraft: vi.fn((_: string, s: OpdFormDoc) => of(detail({ draft: { id: 'v4', formId: 'f1', version: 4, status: 'draft', schema: s, createdAt: '' } }))),
    publish: vi.fn(() => of(detail({ published: { id: 'v4', formId: 'f1', version: 4, status: 'published', schema: schema(['complaint', 'discharge']), createdAt: '' } }))),
    discardDraft: vi.fn(() => of(detail())),
    createForm: vi.fn(() => of(detail({ id: 'f9', name: 'ENT assessment 2' }))),
    departments: vi.fn(() => of([{ id: 'ent', name: 'ENT', code: 'ENT', sortOrder: 1, isActive: true, defaultFormId: 'f1' }])),
    saveDepartments: vi.fn(() => of([])),
    updateForm: vi.fn(() => of(detail({ name: 'Renamed' }))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const dialog = { confirm: vi.fn(async () => true), prompt: vi.fn(async () => 'Smell test? yes/no') };
  const router = { navigate: vi.fn() };
  TestBed.configureTestingModule({
    imports: [OpdFormBuilderPage],
    providers: [
      { provide: OpdAdminApi, useValue: api }, { provide: ToastService, useValue: toasts }, { provide: DialogService, useValue: dialog },
      { provide: Router, useValue: router }, { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: AuthService, useValue: { user: () => ({ tenantName: 'Micro World Clinic' }) } },
      { provide: ActivatedRoute, useValue: { paramMap: params, snapshot: { queryParamMap: convertToParamMap(q) } } },
    ],
  });
  TestBed.overrideComponent(OpdFormBuilderPage, { set: { imports: [BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
  const f = TestBed.createComponent(OpdFormBuilderPage);
  f.detectChanges();
  return { f, c: f.componentInstance, api, toasts, dialog, router };
}

afterEach(() => vi.useRealTimers());

describe('Form builder page', () => {
  it('opens the working copy: the draft when there is one, else the published version', () => {
    const { c } = render();
    expect(c.list().map((q) => q.key)).toEqual(['complaint']);
    expect(c.vstate()).toMatchObject({ chip: 'v3 · published', canPublish: false });
    TestBed.resetTestingModule();
    const d = render('f1', {}, detail({ draft: { id: 'v4', formId: 'f1', version: 4, status: 'draft', schema: schema(['complaint', 'discharge']), createdAt: '' } }));
    expect(d.c.list().length).toBe(2);
    expect(d.c.vstate()).toMatchObject({ chip: 'v3 · draft changes', publishLabel: 'Publish v4' });
  });

  it('typing a sentence adds the question and autosaves the draft (debounced)', async () => {
    vi.useFakeTimers();
    const { c, api } = render();
    c.addText.set('Ear discharge? yes/no');
    expect(c.parsedType()).toBe('Yes / No / Not examined');
    c.addFromSentence();
    expect(c.list().map((q) => q.key)).toEqual(['complaint', 'ear_discharge']);
    expect(c.saveState()).toBe('dirty');
    expect(c.vstate().publishLabel).toBe('Publish v4');
    expect(api.saveDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect((api.saveDraft.mock.calls[0][1] as OpdFormDoc).sections[0].fields.map((q) => q.key)).toEqual(['complaint', 'ear_discharge']);
    expect(c.saveState()).toBe('saved');
  });

  it('Publish flushes the pending draft first, then makes the next version', async () => {
    const { c, api, toasts } = render();
    c.addText.set('Weight in kg');
    c.addFromSentence();
    await c.publish();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.publish).toHaveBeenCalledWith('f1');
    expect(api.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(api.publish.mock.invocationCallOrder[0]);
    expect(toasts.success.mock.calls.at(-1)![0]).toContain('past consults keep v3');
  });

  it('delete offers Undo that restores the question', () => {
    const { c } = render('f1', {}, detail({ published: { id: 'v3', formId: 'f1', version: 3, status: 'published', schema: schema(['complaint', 'discharge']), createdAt: '' } }));
    c.onAction('discharge', 'del');
    expect(c.list().map((q) => q.key)).toEqual(['complaint']);
    expect(c.undo()).not.toBeNull();
    c.undoDelete();
    expect(c.list().map((q) => q.key)).toEqual(['complaint', 'discharge']);
  });

  it('"+" between questions asks for a sentence and inserts there', async () => {
    const { c, dialog } = render();
    await c.insertHere(0);
    expect(dialog.prompt).toHaveBeenCalled();
    expect(c.list()[0]).toMatchObject({ label: 'Smell test?', type: 'yn' });
  });

  it('trying it as a doctor never saves', async () => {
    vi.useFakeTimers();
    const { c, api } = render();
    c.setTry(true);
    expect(c.inspectorMode()).toBe('try');
    c.tryAnswers.set({ complaint: 'typed while trying' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.saveDraft).not.toHaveBeenCalled();
    c.setTry(false);
    expect(c.inspectorMode()).toBe('form');
  });

  it('the printed view lists what prints; selecting a question opens its settings', () => {
    const { c } = render();
    c.setView('print');
    expect(c.inspectorMode()).toBe('print');
    c.setView('doctor');
    c.select('complaint');
    expect(c.inspectorMode()).toBe('question');
  });

  it('changing the answer type from the gallery keeps the question', () => {
    const { c } = render();
    c.select('complaint');
    c.openTypes(true, null);
    c.pickType('many');
    expect(c.list()[0]).toMatchObject({ key: 'complaint', type: 'many' });
  });

  it('New form: the starter gallery opens; a new form from a department is attached to it', () => {
    const { c, api, router } = render('new', { departmentId: 'ent' });
    expect(c.gallery()).toEqual({ kind: 'starters' });
    c.pickStarter({ kind: 'starter', key: 'ent' });
    expect(api.createForm).toHaveBeenCalledWith({ starterKey: 'ent' });
    expect(api.saveDepartments).toHaveBeenCalledWith([expect.objectContaining({ id: 'ent', defaultFormId: 'f9' })]);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/opd/forms', 'f9'], { replaceUrl: true });
  });

  it('closing the starter gallery on a new form goes back to the library', () => {
    const { c, router } = render('new');
    c.closeGallery();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/opd/forms']);
  });

  it('Discard draft asks, then returns to the published version', async () => {
    const { c, api, dialog } = render();
    c.addText.set('Weight in kg');
    c.addFromSentence();
    expect(c.canDiscard()).toBe(true);
    await c.discardDraft();
    expect(dialog.confirm).toHaveBeenCalled();
    expect(api.discardDraft).toHaveBeenCalledWith('f1');
    expect(c.list().map((q) => q.key)).toEqual(['complaint']);
  });
});

/**
 * Multi-section forms (seeded ENT/Derm/Gynae docs have 6–8 sections) — the
 * builder must render, edit and round-trip EVERY section, never only the
 * first one.
 */
describe('Form builder page — multi-section forms', () => {
  it('a 3-section doc loads with every section intact and ALL questions counted', () => {
    const { c } = render('f1', {}, detail({ published: { id: 'v3', formId: 'f1', version: 3, status: 'published', schema: multiSchema(), createdAt: '' } }));
    expect(c.doc().sections.map((s) => s.title)).toEqual(['History', 'Examination', 'Investigations']);
    expect(c.list().map((q) => q.key)).toEqual(['chief', 'duration', 'bp', 'cbc', 'esr']); // list() = every question, form-wide
  });

  it('adding a question to section 3 leaves sections 1 and 2 untouched (never drops a section)', async () => {
    vi.useFakeTimers();
    const { c, api } = render('f1', {}, detail({ published: { id: 'v3', formId: 'f1', version: 3, status: 'published', schema: multiSchema(), createdAt: '' } }));
    c.addText.set('Fasting sugar in mg/dl');
    c.addFromSentence(2); // the third section, "Investigations"
    expect(c.doc().sections[0].fields.map((q) => q.key)).toEqual(['chief', 'duration']);
    expect(c.doc().sections[1].fields.map((q) => q.key)).toEqual(['bp']);
    expect(c.doc().sections[2].fields.map((q) => q.key)).toEqual(['cbc', 'esr', 'fasting_sugar']);
    await vi.advanceTimersByTimeAsync(1000);
    const sent = api.saveDraft.mock.calls[0][1] as OpdFormDoc;
    expect(sent.sections.length).toBe(3);
    expect(sent.sections[0].fields.map((q) => q.key)).toEqual(['chief', 'duration']);
    expect(sent.sections[1].fields.map((q) => q.key)).toEqual(['bp']);
    expect(sent.sections[2].fields.map((q) => q.key)).toEqual(['cbc', 'esr', 'fasting_sugar']);
  });

  it('deleting / moving a question stays inside its own section', () => {
    const { c } = render('f1', {}, detail({ published: { id: 'v3', formId: 'f1', version: 3, status: 'published', schema: multiSchema(), createdAt: '' } }));
    c.onAction('esr', 'up'); // "esr" is the 2nd field of section 2 (Investigations)
    expect(c.doc().sections[2].fields.map((q) => q.key)).toEqual(['esr', 'cbc']);
    expect(c.doc().sections[0].fields.map((q) => q.key)).toEqual(['chief', 'duration']); // section 0 untouched
    c.onAction('bp', 'del');
    expect(c.doc().sections[1].fields).toEqual([]);
    expect(c.doc().sections[0].fields.length).toBe(2);
    expect(c.doc().sections[2].fields.length).toBe(2);
    c.undoDelete();
    expect(c.doc().sections[1].fields.map((q) => q.key)).toEqual(['bp']);
  });

  it('renames, reorders and removes a section; the inspector still counts every question', () => {
    const { c, dialog } = render('f1', {}, detail({ published: { id: 'v3', formId: 'f1', version: 3, status: 'published', schema: multiSchema(), createdAt: '' } }));
    c.renameSection(1, 'Vitals & exam');
    expect(c.doc().sections[1].title).toBe('Vitals & exam');
    expect(c.doc().sections[1].fields.map((q) => q.key)).toEqual(['bp']); // rename never touches questions

    c.moveSection(0, 1); // History ↔ Vitals & exam
    expect(c.doc().sections.map((s) => s.key)).toEqual(['exam', 'history', 'invest']);
    expect(c.doc().sections[1].fields.map((q) => q.key)).toEqual(['chief', 'duration']); // "History"'s own fields moved WITH it

    expect(c.list().length).toBe(5); // 2 + 1 + 2, still every question across the (reordered) sections

    return c.removeSection(2).then(() => {
      expect(dialog.confirm).toHaveBeenCalled();
      expect(c.doc().sections.map((s) => s.key)).toEqual(['exam', 'history']);
      expect(c.list().length).toBe(3);
    });
  });

  it('a question edited through the inspector (attribute-only) stays in its own section after the round-trip', () => {
    const { c } = render('f1', {}, detail({ published: { id: 'v3', formId: 'f1', version: 3, status: 'published', schema: multiSchema(), createdAt: '' } }));
    const flat = c.list().map((x) => (x.key === 'bp' ? { ...x, required: true } : x)); // section 1's only question
    c.setList(flat);
    expect(c.doc().sections[0].fields.map((q) => q.key)).toEqual(['chief', 'duration']);
    expect(c.doc().sections[1].fields).toMatchObject([{ key: 'bp', required: true }]);
    expect(c.doc().sections[2].fields.map((q) => q.key)).toEqual(['cbc', 'esr']);
  });

  it("a form needs at least one section — can't remove the last one", async () => {
    const { c, toasts } = render(); // single-section fixture
    await c.removeSection(0);
    expect(toasts.error).toHaveBeenCalledWith('A form needs at least one section');
    expect(c.doc().sections.length).toBe(1);
  });
});
