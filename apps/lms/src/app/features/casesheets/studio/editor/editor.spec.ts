import { TestBed } from '@angular/core/testing';
import { DialogService } from '../../../../core/services/dialog.service';
import { FormDefinition, provideFormsEngine, addField, addPage, emptyDefinition, findField, setLabel, updateField } from '@prefrontal/forms-engine';
import { MockStudioApi } from '../data/mock-studio-api';
import { StudioApi } from '../data/studio-api';
import { StudioSession } from '../data/studio-session';
import { ConditionsComponent } from '../shared/conditions.component';
import { EditorStore } from './editor-store';
import { FieldActions } from './field-actions';
import { FieldCardComponent } from './field-card.component';
import { PaletteComponent } from './palette.component';

function form(): { def: FormDefinition; pain: string; notes: string } {
  let def = addPage(emptyDefinition('ENT'), 'History').def;
  const pain = addField(def, { pageKey: 'history' }, 'yesno');
  def = setLabel(pain.def, pain.key, 'Pain');
  const notes = addField(def, { pageKey: 'history' }, 'text');
  def = setLabel(notes.def, notes.key, 'Notes');
  return { def, pain: pain.key, notes: notes.key };
}

async function open(def: FormDefinition) {
  TestBed.resetTestingModule();
  const api = new MockStudioApi();
  TestBed.configureTestingModule({
    providers: [provideFormsEngine(), StudioSession, EditorStore, FieldActions, { provide: StudioApi, useValue: api }, DialogService],
  });
  const id = api.seed('ENT', def);
  const store = TestBed.inject(EditorStore);
  await store.session.load(id);
  await store.loadCatalogue();
  store.selectPage('history');
  return { api, store };
}

const settle = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
};

describe('Studio editor', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says-on-field: editing the sentence on the card changes the definition', async () => {
    const { def, notes } = form();
    const { store } = await open(def);
    const f = TestBed.createComponent(FieldCardComponent);
    f.componentRef.setInput('field', findField(store.def()!, notes)!);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    // reads as words with the answer as a chip, never {value}
    expect(el.querySelector('[data-line="says"]')!.textContent).toContain('the answer');
    expect(el.textContent).not.toContain('{value}');
    (el.querySelector('[data-line="says"] .sn-read') as HTMLElement).click();
    await settle(f);
    const box = el.querySelector('[data-line="says"] textarea') as HTMLTextAreaElement;
    box.value = 'The patient says {value}.';
    box.dispatchEvent(new Event('input'));
    [...el.querySelectorAll('[data-line="says"] button')].find((b) => /Done/.test(b.textContent ?? ''))!.dispatchEvent(new Event('click'));
    await settle(f);
    expect(findField(store.def()!, notes)!.says!.sentence).toBe('The patient says {value}.');
  });

  it('a Yes / No card edits what Yes and No say, on the card', async () => {
    const { def, pain } = form();
    const { store } = await open(def);
    const f = TestBed.createComponent(FieldCardComponent);
    f.componentRef.setInput('field', findField(store.def()!, pain)!);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-line="says"] dt')!.textContent).toBe('If Yes, says');
    expect(el.querySelector('[data-line="if-none"] dt')!.textContent).toBe('If No, says');
    (el.querySelector('[data-line="if-none"] .sn-read') as HTMLElement).click();
    await settle(f);
    const box = el.querySelector('[data-line="if-none"] textarea') as HTMLTextAreaElement;
    box.value = 'No pain.';
    box.dispatchEvent(new Event('input'));
    [...el.querySelectorAll('[data-line="if-none"] button')].find((b) => /Done/.test(b.textContent ?? ''))!.dispatchEvent(new Event('click'));
    await settle(f);
    expect(findField(store.def()!, pain)!.options![1].says).toBe('No pain.');
  });

  it('the condition builder writes the rule by taps and reads it as a sentence', async () => {
    const { def, pain, notes } = form();
    TestBed.resetTestingModule();
    const f = TestBed.createComponent(ConditionsComponent);
    f.componentRef.setInput('definition', def);
    f.componentRef.setInput('selfKey', notes);
    f.componentRef.setInput('value', null);
    const out: unknown[] = [];
    f.componentInstance.changed.subscribe((v) => out.push(v));
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.cb-say')!.textContent).toBe('Always shown');
    [...el.querySelectorAll('button')].find((b) => /Show only when/.test(b.textContent ?? ''))!.click();
    await settle(f);
    expect(el.querySelector('.cb-say')!.textContent).toBe('Shown when Pain is Yes');
    [...el.querySelectorAll('.cb-vals button')].find((b) => b.textContent!.trim() === 'No')!.dispatchEvent(new Event('click'));
    await settle(f);
    expect(out.at(-1)).toEqual({ logic: 'and', visibility: 'show', conditions: [{ field: pain, op: 'equals', value: 'no' }] });
    expect(el.querySelector('.cb-say')!.textContent).toBe('Shown when Pain is No');
  });

  it('the palette is the API catalogue in plain names; tapping adds the question there', async () => {
    const { def } = form();
    const { store, api } = await open(def);
    // pretend the catalogue offers only three kinds
    store.catalogue.set((await api.components()).filter((k) => ['text', 'yesno', 'repeat'].includes(k.name)));
    const f = TestBed.createComponent(PaletteComponent);
    f.componentRef.setInput('slot', { pageKey: 'history', at: 0 });
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    const names = [...el.querySelectorAll('.pal-name')].map((n) => n.textContent);
    expect(names).toEqual(['Text', 'Yes / No', 'Repeating group']);
    (el.querySelector('[data-kind="yesno"]') as HTMLElement).click();
    expect(store.def()!.pages[0].fields[0].kind).toBe('yesno');
    expect(store.editing()).toMatchObject({ area: 'label' });
    // a follow-up can't be a repeating group
    f.componentRef.setInput('slot', { option: { fieldKey: store.def()!.pages[0].fields[0].key, optionKey: 'yes' } });
    await settle(f);
    expect([...el.querySelectorAll('.pal-name')].map((n) => n.textContent)).toEqual(['Text', 'Yes / No']);
  });

  it('a publish problem jumps to its page and question', async () => {
    let def = addPage(form().def, 'Exam').def;
    const side = addField(def, { pageKey: 'exam' }, 'choice');
    def = updateField(side.def, side.key, (x) => (x.options = []));
    const { store } = await open(def);
    expect(store.page()?.key).toBe('history');
    store.jumpTo(side.key, 'exam', 'showWhen');
    expect(store.page()?.key).toBe('exam');
    expect(store.selectedKey()).toBe(side.key);
    expect(store.editing()).toEqual({ key: side.key, area: 'showWhen' });
  });

  it('reorder by the actions (drag or menu) moves the question in the definition', async () => {
    const { def, pain, notes } = form();
    const { store } = await open(def);
    TestBed.inject(FieldActions).reorder('page', 1, 0);
    expect(store.def()!.pages[0].fields.map((x) => x.key)).toEqual([notes, pain]);
  });

  it('multi-select: ⌘-click, Shift range and ⌘A read ONE selection list in page order', async () => {
    const { def, pain, notes } = form();
    let d = def;
    const third = addField(d, { pageKey: 'history' }, 'text');
    d = third.def;
    const { store } = await open(d);
    store.select(pain);
    expect(store.selection()).toEqual([pain]);
    store.togglePick(third.key);
    expect(store.selection()).toEqual([pain, third.key]);
    store.togglePick(pain);
    expect(store.selection()).toEqual([third.key]);
    store.clearPicks();
    store.select(pain);
    store.pickRange(third.key);
    expect(store.selection()).toEqual([pain, notes, third.key]);
    store.selectPage('history'); // a page change clears it
    expect(store.picked().size).toBe(0);
    store.pickAll();
    expect(store.selection()).toEqual([pain, notes, third.key]);
  });

  it('bulk: copy, move and remove several questions — one undo step each, remove offers Undo', async () => {
    const { def, pain, notes } = form();
    const { store } = await open(def);
    const actions = TestBed.inject(FieldActions);
    const keys = () => store.def()!.pages[0].fields.map((x) => x.key);
    const copies = actions.duplicateMany([pain, notes]);
    expect(keys()).toEqual([pain, copies[0], notes, copies[1]]);
    expect(store.selection()).toEqual(copies);
    store.session.undo();
    expect(keys()).toEqual([pain, notes]);
    actions.moveMany([notes], -1);
    expect(keys()).toEqual([notes, pain]);
    actions.moveMany([notes], -1); // already at the top: nothing
    expect(keys()).toEqual([notes, pain]);
    actions.removeMany([notes, pain]);
    expect(keys()).toEqual([]);
    expect(actions.undoable()).toBe('Removed 2 questions.');
    actions.undoLast();
    expect(keys()).toEqual([notes, pain]);
    expect(actions.undoable()).toBeNull();
  });

  it('move to another page (menu or drop on a page): the questions go to the end of that page', async () => {
    const { def, pain, notes } = form();
    const { store } = await open(addPage(def, 'Exam').def);
    const actions = TestBed.inject(FieldActions);
    actions.moveToPageNow([pain, notes], 'exam');
    expect(store.def()!.pages[0].fields).toEqual([]);
    expect(store.def()!.pages[1].fields.map((x) => x.key)).toEqual([pain, notes]);
    expect(store.page()?.key).toBe('exam');
    expect(actions.undoable()).toContain('Exam');
  });
});

describe('Studio editor page providers (WP11)', () => {
  it('provides the kinds itself: the cards preview each control and app.config has no forms engine', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/features/casesheets/studio/editor/editor.page.ts'), 'utf8');
    expect(src).toMatch(/providers:\s*\[[^\]]*\{ provide: FE_KINDS, useValue: KIND_SPECS \}/);
    const cfg = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/app.config.ts'), 'utf8');
    expect(cfg).not.toContain('provideFormsEngine');
  });
});

