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
