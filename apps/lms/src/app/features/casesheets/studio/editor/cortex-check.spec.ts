import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FormDefinition, addField, addPage, emptyDefinition, findField, provideFormsEngine, setLabel, updateField } from '@prefrontal/forms-engine';
import { AuthService } from '../../../../core/auth/auth.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { checkNoteOf } from '../cortex-import/cortex-import';
import { MockStudioApi } from '../data/mock-studio-api';
import { StudioApi } from '../data/studio-api';
import { StudioSession } from '../data/studio-session';
import { EditorStore } from './editor-store';
import { FieldActions } from './field-actions';
import { ConfigPanelComponent } from './config-panel.component';
import { StudioEditorPage } from './editor.page';

/** A form like Cortex makes one: two marked questions (one of them a follow-up) and one clean one. */
function draft(): { def: FormDefinition; side: string; sub: string; notes: string } {
  let def = addPage(emptyDefinition('Cardiology'), 'History').def;
  const side = addField(def, { pageKey: 'history' }, 'choice');
  def = updateField(setLabel(side.def, side.key, 'Side'), side.key, (f) => {
    f.options = [{ key: 'l', label: 'Left' }, { key: 'r', label: 'Right' }];
    f.config = { checkNote: 'Is it left or right?' };
  });
  const notes = addField(def, { pageKey: 'history' }, 'text');
  def = setLabel(notes.def, notes.key, 'Notes');
  const sub = addField(def, { option: { fieldKey: side.key, optionKey: 'l' } }, 'text');
  def = updateField(setLabel(sub.def, sub.key, 'Since when'), sub.key, (f) => (f.config = { checkNote: 'The writing is smudged.' }));
  return { def, side: side.key, sub: sub.key, notes: notes.key };
}

const settle = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
};

async function open(def: FormDefinition) {
  TestBed.resetTestingModule();
  const api = new MockStudioApi();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideFormsEngine(), StudioSession, EditorStore, FieldActions, { provide: StudioApi, useValue: api }, DialogService],
  });
  const id = api.seed('Cardiology', def);
  const store = TestBed.inject(EditorStore);
  await store.session.load(id);
  await store.loadCatalogue();
  store.selectPage('history');
  return { api, store, id };
}

describe('Cortex "Check this" in the editor', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('a marked question shows "Check this: reason" with Looks right in its panel; an unmarked one shows nothing', async () => {
    const { def, side, notes } = draft();
    const { store } = await open(def);
    store.select(side);
    const marked = TestBed.createComponent(ConfigPanelComponent);
    await settle(marked);
    const chip = (marked.nativeElement as HTMLElement).querySelector('[data-check]')!;
    expect(chip.textContent).toContain('Check this: Is it left or right?');
    expect(chip.querySelector('[data-act="looks-right"]')!.textContent).toContain('Looks right');

    store.select(notes);
    await settle(marked);
    expect((marked.nativeElement as HTMLElement).querySelector('[data-check]')).toBeNull();
  });

  it('Looks right clears the marker through the normal save, and only that one', async () => {
    const { def, side, sub } = draft();
    const { store, api, id } = await open(def);
    store.select(side);
    const f = TestBed.createComponent(ConfigPanelComponent);
    await settle(f);
    (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-check] [data-act="looks-right"]')!.click();
    expect(checkNoteOf(findField(store.def()!, side)!)).toBe('');
    expect(checkNoteOf(findField(store.def()!, sub)!)).toBe('The writing is smudged.');
    expect(store.checkCount()).toBe(1);
    expect(store.session.saveState()).toBe('dirty'); // saved by the normal autosave
    await store.session.flush();
    expect(store.session.saveState()).toBe('saved');
    const draftId = store.session.version()!.id;
    const v = await api.version(id, draftId);
    expect(checkNoteOf(findField(v.definition!, side)!)).toBe('');
    expect(checkNoteOf(findField(v.definition!, sub)!)).toBe('The writing is smudged.');
  });

  it('Looks right works on a follow-up question too', async () => {
    const { def, sub } = draft();
    const { store } = await open(def);
    store.select(sub);
    const f = TestBed.createComponent(ConfigPanelComponent);
    await settle(f);
    (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-check] [data-act="looks-right"]')!.click();
    expect(store.checkCount()).toBe(1);
    expect(checkNoteOf(findField(store.def()!, sub)!)).toBe('');
  });

  it('any edit to the question clears its marker (and an edit to another question does not)', async () => {
    const { def, side, sub, notes } = draft();
    const { store } = await open(def);
    store.edit((d) => setLabel(d, notes, 'Other notes'));
    expect(store.checkCount()).toBe(2);
    store.edit((d) => setLabel(d, side, 'Which side'));
    expect(checkNoteOf(findField(store.def()!, side)!)).toBe('');
    expect(checkNoteOf(findField(store.def()!, sub)!)).toBe('The writing is smudged.');
    store.edit((d) => updateField(d, sub, (f) => (f.helper = 'Since when?')));
    expect(store.checkCount()).toBe(0);
  });

  it('the editor banner counts the marked questions and goes away with the last one', async () => {
    const { def, side, sub } = draft();
    TestBed.resetTestingModule();
    const api = new MockStudioApi();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideFormsEngine(), { provide: StudioApi, useValue: api }, DialogService, { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } }],
    });
    const id = api.seed('Cardiology', def);
    const f = TestBed.createComponent(StudioEditorPage);
    f.componentRef.setInput('id', id);
    const store = f.debugElement.injector.get(EditorStore);
    const el = f.nativeElement as HTMLElement;
    await vi.waitFor(async () => {
      await settle(f);
      expect(el.querySelector('[data-cortex-banner]'), el.textContent ?? '').not.toBeNull();
    });
    expect(el.querySelector('[data-cortex-banner]')!.textContent).toContain('Cortex made this draft from your sheet. Check the 2 marked questions, then publish.');
    for (const k of [side, sub]) {
      store.looksRight(k);
    }
    await settle(f);
    expect(el.querySelector('[data-cortex-banner]')).toBeNull();
    void side;
    void sub;
  });
});

describe('the "Check this" marker stays visible', () => {
  it('never shares a class with the row\'s hover-only selection tick (.lg-fcard__check is opacity 0 until hover)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const dir = resolve(process.cwd(), 'apps/lms/src/app/features/casesheets/studio/editor');
    const html = readFileSync(resolve(dir, 'editor.page.html'), 'utf8');
    const marker = html.match(/<div class="([^"]*)"[^>]*data-check[^>]*>/);
    expect(marker, 'the [data-check] marker').not.toBeNull();
    const classes = marker![1].split(/\s+/);
    expect(classes.some((c) => c.includes('check') && c !== 'fc-cortex__ok')).toBe(false);
  });
});
