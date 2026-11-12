import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FormDefinition, addField, addPage, emptyDefinition, findField, provideFormsEngine, setLabel, updateField } from '@prefrontal/forms-engine';
import { AuthService } from '../../../../core/auth/auth.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { MockStudioApi } from '../data/mock-studio-api';
import { StudioApi } from '../data/studio-api';
import { StudioSession } from '../data/studio-session';
import { ComponentsPanelComponent } from './components-panel.component';
import { ConfigPanelComponent } from './config-panel.component';
import { EditorStore } from './editor-store';
import { StudioEditorPage } from './editor.page';
import { FieldActions } from './field-actions';
import { FormSettingsComponent, renameConfirmWords, renameResultWords } from './form-settings.component';
import { LINK_OPERATORS, LinksTabComponent, operatorWords } from './links-tab.component';
import { MODE_WORDS, NarrativeTabComponent } from './narrative-tab.component';

const settle = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
};
const click = (el: Element | null) => (el as HTMLElement).click();

function sheet(): { def: FormDefinition; pain: string; notes: string; side: string; tags: string } {
  let def = addPage(emptyDefinition('ENT'), 'History').def;
  def = addPage(def, 'Nose').def;
  const pain = addField(def, { pageKey: 'history' }, 'yesno');
  def = setLabel(pain.def, pain.key, 'Pain');
  const notes = addField(def, { pageKey: 'history' }, 'text');
  def = setLabel(notes.def, notes.key, 'Notes');
  const side = addField(def, { pageKey: 'history' }, 'choice');
  def = setLabel(side.def, side.key, 'Side');
  const tags = addField(def, { pageKey: 'history' }, 'multi');
  def = setLabel(tags.def, tags.key, 'Complaints');
  return { def, pain: pain.key, notes: notes.key, side: side.key, tags: tags.key };
}

async function open(def: FormDefinition) {
  TestBed.resetTestingModule();
  const api = new MockStudioApi();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideFormsEngine(), StudioSession, EditorStore, FieldActions, { provide: StudioApi, useValue: api }, DialogService, { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } }],
  });
  const id = api.seed('ENT', def);
  const store = TestBed.inject(EditorStore);
  await store.session.load(id);
  await store.loadCatalogue();
  store.selectPage('history');
  return { api, store, id };
}

async function mountPage(def: FormDefinition) {
  TestBed.resetTestingModule();
  const api = new MockStudioApi();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideFormsEngine(), { provide: StudioApi, useValue: api }, DialogService, { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } }],
  });
  const id = api.seed('ENT', def);
  const f = TestBed.createComponent(StudioEditorPage);
  f.componentRef.setInput('id', id);
  const el = f.nativeElement as HTMLElement;
  await vi.waitFor(async () => {
    await settle(f);
    expect(el.querySelector('[data-main-tab]'), el.textContent ?? '').not.toBeNull();
  });
  const store = f.debugElement.injector.get(EditorStore);
  return { f, el, api, id, store };
}

describe('Studio editor, as the legacy Studio: header and tabs', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('has the three legacy tabs in order, and no JSON tab', async () => {
    const { el } = await mountPage(sheet().def);
    const tabs = [...el.querySelectorAll('[data-main-tab]')].map((t) => t.textContent!.trim());
    expect(tabs).toEqual(['Pages & Fields', 'Narrative Sections', 'Conditional Links']);
    expect(el.textContent).not.toContain('JSON');
  });

  it('the header has the name, Settings, Preview, Save and Publish, and no Import / Export JSON or Manage editors', async () => {
    const { el } = await mountPage(sheet().def);
    expect((el.querySelector('[data-title]') as HTMLInputElement).value).toBe('ENT');
    for (const act of ['settings', 'preview', 'save', 'publish']) expect(el.querySelector(`[data-act="${act}"]`), act).not.toBeNull();
    expect(el.textContent).not.toMatch(/Export JSON|Import JSON|Manage editors|Editors/);
  });

  it('renaming in the header changes the case sheet name', async () => {
    const { el, store, f } = await mountPage(sheet().def);
    const input = el.querySelector('[data-title]') as HTMLInputElement;
    input.value = 'Ear, nose and throat';
    input.dispatchEvent(new Event('change'));
    await settle(f);
    expect(store.def()!.title).toBe('Ear, nose and throat');
  });

  it('switching tabs shows the Narrative Sections and the Conditional Links', async () => {
    const { el, f } = await mountPage(sheet().def);
    click(el.querySelector('[data-main-tab="narrative"]'));
    await settle(f);
    expect(el.querySelector('[data-narrative-tab]')).not.toBeNull();
    click(el.querySelector('[data-main-tab="links"]'));
    await settle(f);
    expect(el.querySelector('[data-links-tab]')).not.toBeNull();
    expect(el.querySelector('[data-narrative-tab]')).toBeNull();
  });
});

describe('Studio editor, as the legacy Studio: the three panes', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('with nothing selected the right pane is the Components palette: legacy groups, then Department', async () => {
    const { el, store, f } = await mountPage(sheet().def);
    store.select(null);
    await settle(f);
    const groups = [...el.querySelectorAll('st-components-panel [data-group]')].map((g) => g.getAttribute('data-group'));
    expect(groups.slice(0, 4)).toEqual(['Input Fields', 'Selection Fields', 'Special Fields', 'Department']);
    expect(el.querySelector('[data-component="toggle"]')).not.toBeNull();
    expect(el.querySelector('[data-component="toothChart"]')).not.toBeNull();
  });

  it('a click on a tile adds the question at the end of the page and opens its settings', async () => {
    const { store } = await open(sheet().def);
    const f = TestBed.createComponent(ComponentsPanelComponent);
    await settle(f);
    const before = store.page()!.fields.length;
    click((f.nativeElement as HTMLElement).querySelector('[data-component="toggle"]'));
    const fields = store.page()!.fields;
    expect(fields.length).toBe(before + 1);
    const added = fields.at(-1)!;
    expect(added.kind).toBe('yesno');
    expect(added.config).toMatchObject({ display: 'switch', labelFallback: true });
    expect(store.selectedKey()).toBe(added.key);
  });

  it('a checkbox tile is a multiple choice; a Text Area is a text with several lines', async () => {
    const { store } = await open(sheet().def);
    const f = TestBed.createComponent(ComponentsPanelComponent);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    click(el.querySelector('[data-component="checkbox"]'));
    click(el.querySelector('[data-component="textarea"]'));
    const [cb, ta] = store.page()!.fields.slice(-2);
    expect(cb.kind).toBe('multi');
    expect(ta.kind).toBe('text');
    expect(ta.config).toMatchObject({ multiline: true });
  });

  it('the canvas rows are compact legacy cards: type, Required and Conditional, no live preview', async () => {
    let { def } = sheet();
    const first = def.pages[0].fields[0].key;
    def = updateField(def, first, (f) => {
      f.required = true;
    });
    def = { ...def };
    const { el } = await mountPage(def);
    const row = el.querySelector(`[data-card="${first}"]`)!;
    expect(row.textContent).toContain('Pain');
    expect(row.textContent).toContain('Yes / No');
    expect(row.textContent).toContain('Required');
    expect(row.querySelector('fe-field')).toBeNull();
  });

  it('the page header edits the title and subtitle, and has Page Settings and Delete Page', async () => {
    const { el, store, f } = await mountPage(sheet().def);
    const sub = el.querySelector('[data-page-subtitle]') as HTMLInputElement;
    sub.value = 'Basic details';
    sub.dispatchEvent(new Event('change'));
    await settle(f);
    expect(store.page()!.subtitle).toBe('Basic details');
    expect(el.querySelector('[data-act="page-settings"]')).not.toBeNull();
    expect(el.querySelector('[data-act="delete-page"]')).not.toBeNull();
  });

  it('Page Settings picks a medical icon (SVG, from the set) and saves it on the page', async () => {
    const { el, store, f } = await mountPage(sheet().def);
    click(el.querySelector('[data-act="page-settings"]'));
    await settle(f);
    const box = el.querySelector('[data-page-settings]')!;
    click(box.querySelector('[data-act="browse-icons"]'));
    await settle(f);
    expect(box.querySelectorAll('st-icon-picker svg').length).toBeGreaterThan(15);
    click(box.querySelector('[data-icon="heart"]'));
    await settle(f);
    click(box.querySelector('[data-act="save-page-settings"]'));
    await settle(f);
    expect(store.page()!.icon).toBe('heart');
    expect(el.querySelector('[data-page-settings]')).toBeNull();
  });

  it('sections group pages: add one, put a page in it, and it lists with its count', async () => {
    const { el, store, f } = await mountPage(sheet().def);
    const dialog = TestBed.inject(DialogService);
    vi.spyOn(dialog, 'prompt').mockResolvedValue('Examination');
    click(el.querySelector('[data-act="add-section"]'));
    await vi.waitFor(() => expect(store.def()!.groups?.length).toBe(1));
    const g = store.def()!.groups![0];
    store.edit((d) => ({ ...d, pages: d.pages.map((p) => (p.key === 'nose' ? { ...p, group: g.key } : p)) }));
    await settle(f);
    expect(el.querySelector(`[data-section="${g.key}"]`)!.textContent).toContain('1 pages');
  });
});

describe('Studio editor, as the legacy Studio: Configure Field', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function panel(kind: 'pain' | 'notes' | 'side' | 'tags') {
    const s = sheet();
    const { store } = await open(s.def);
    store.select(s[kind]);
    const f = TestBed.createComponent(ConfigPanelComponent);
    await settle(f);
    return { f, el: f.nativeElement as HTMLElement, store, key: s[kind] };
  }
  const tabs = (el: HTMLElement) => [...el.querySelectorAll('[data-tab]')].map((t) => t.getAttribute('data-tab'));

  it('has the legacy tabs: General, Validation, Options (when it has options), Narrative, Conditions', async () => {
    expect(tabs((await panel('side')).el)).toEqual(['general', 'validation', 'options', 'narrative', 'conditions']);
    expect(tabs((await panel('notes')).el)).toEqual(['general', 'validation', 'narrative', 'conditions']);
  });

  it('a multiple choice also has Chronological (the order of its linked pages)', async () => {
    expect(tabs((await panel('tags')).el)).toContain('chronological');
  });

  it('General edits the label, helper text, width and Required', async () => {
    const { f, el, store, key } = await panel('notes');
    const label = el.querySelector('#cfg-label') as HTMLInputElement;
    label.value = 'Clinical notes';
    label.dispatchEvent(new Event('change'));
    (el.querySelector('#cfg-help') as HTMLInputElement).value = 'Shown under';
    el.querySelector('#cfg-help')!.dispatchEvent(new Event('change'));
    click(el.querySelector('[data-flag="required"]'));
    await settle(f);
    const fld = findField(store.def()!, key)!;
    expect(fld.label).toBe('Clinical notes');
    expect(fld.helper).toBe('Shown under');
    expect(fld.required).toBe(true);
    expect(el.querySelector('code')!.textContent).toContain(`{{${key}}}`);
  });

  it('Validation checks the length and the pattern of a text, with the builder\'s own error words', async () => {
    const { f, el, store, key } = await panel('notes');
    click(el.querySelector('[data-tab="validation"]'));
    await settle(f);
    const set = (id: string, v: string) => {
      const i = el.querySelector(id) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('change'));
    };
    set('#v-min', '3');
    set('#v-max', '40');
    set('#v-pat', '[A-Za-z ]+');
    set('#v-msg', 'Letters only, please.');
    await settle(f);
    expect(findField(store.def()!, key)!.config).toMatchObject({ minLength: 3, maxLength: 40, pattern: '[A-Za-z ]+', errorMessage: 'Letters only, please.' });
  });

  it('a question with no checks says so plainly', async () => {
    const { f, el } = await panel('pain');
    click(el.querySelector('[data-tab="validation"]'));
    await settle(f);
    expect(el.querySelector('[data-empty="validation"]')).not.toBeNull();
  });

  it('Options: add, expand, give a narrative text; only a multiple choice has the Page Linker (reorder only)', async () => {
    const side = await panel('side');
    click(side.el.querySelector('[data-tab="options"]'));
    await settle(side.f);
    click(side.el.querySelector('[data-act="add-option"]'));
    await settle(side.f);
    const n = findField(side.store.def()!, side.key)!.options!.length;
    expect(n).toBe(3);
    expect(side.el.querySelector('[data-pagelinker]')).toBeNull();

    const tags = await panel('tags');
    click(tags.el.querySelector('[data-tab="options"]'));
    await settle(tags.f);
    const first = findField(tags.store.def()!, tags.key)!.options![0].key;
    click(tags.el.querySelector(`[data-choice="${first}"] .opt-t`));
    await settle(tags.f);
    expect(tags.el.querySelector('[data-pagelinker]')!.textContent).toContain('Nothing is hidden');
    click(tags.el.querySelector('[data-act="new-linked-page"]'));
    await settle(tags.f);
    expect(tags.store.def()!.pages.length).toBe(3);
    expect(findField(tags.store.def()!, tags.key)!.options![0].linkedPage).toBe(tags.store.def()!.pages[2].key);
  });

  it('an option can carry a medical icon, a colour and a description', async () => {
    const { f, el, store, key } = await panel('side');
    click(el.querySelector('[data-tab="options"]'));
    await settle(f);
    const first = findField(store.def()!, key)!.options![0].key;
    click(el.querySelector(`[data-choice="${first}"] .opt-t`));
    await settle(f);
    const box = el.querySelector(`[data-choice="${first}"]`)!;
    click([...box.querySelectorAll('button')].find((b) => /Browse/.test(b.textContent ?? ''))!);
    await settle(f);
    click(box.querySelector('[data-icon="ear"]'));
    await settle(f);
    expect(findField(store.def()!, key)!.options![0].icon).toBe('ear');
  });

  it('Narrative: include, subheading and the paragraph the answer writes into', async () => {
    const { f, el, store, key } = await panel('notes');
    click(el.querySelector('[data-tab="narrative"]'));
    await settle(f);
    click(el.querySelector('[data-flag="subheading"]'));
    await settle(f);
    expect(findField(store.def()!, key)!.says!.subheading).toBe(true);
    expect(el.querySelector('[data-line="writes-into"]')).not.toBeNull();
    click(el.querySelector('[data-flag="include"]'));
    await settle(f);
    expect(findField(store.def()!, key)!.says!.include).toBe(false);
  });

  it('Conditions: the show / hide builder is always open, no Done button', async () => {
    const { f, el } = await panel('notes');
    click(el.querySelector('[data-tab="conditions"]'));
    await settle(f);
    expect(el.querySelector('st-conditions')).not.toBeNull();
    expect([...el.querySelectorAll('st-conditions button')].some((b) => /Done/.test(b.textContent ?? ''))).toBe(false);
  });

  it('Type switches between the legacy variants of one kind (a text can become a phone or a text area)', async () => {
    const { f, el, store, key } = await panel('notes');
    const typeSel = el.querySelector('pf-select') as HTMLElement;
    expect(typeSel).not.toBeNull();
    const c = f.componentInstance as unknown as { setType(id: string): void };
    c.setType('phone');
    await settle(f);
    expect(findField(store.def()!, key)!.config).toMatchObject({ format: 'phone' });
    c.setType('textarea');
    await settle(f);
    expect(findField(store.def()!, key)!.config).toMatchObject({ multiline: true });
    expect(findField(store.def()!, key)!.config?.['format']).toBeUndefined();
  });
});

describe('Studio editor, as the legacy Studio: Narrative Sections', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function tab() {
    const s = sheet();
    const { store } = await open(s.def);
    const f = TestBed.createComponent(NarrativeTabComponent);
    await settle(f);
    return { f, el: f.nativeElement as HTMLElement, store, s };
  }

  it('lists the sections as cards with their template written with its {{variables}}', async () => {
    const { el, store, s } = await tab();
    expect(el.querySelectorAll('.nt-sec').length).toBe(2);
    const tpl = store.def()!.narrative!.sections[0].template!;
    expect(tpl).toContain(`{{${s.pain}}}`);
    expect(el.querySelector('.nt-sec[data-section="history"] .nt-tpl')!.textContent).toContain(`{{${s.pain}}}`);
    expect(el.querySelector('[data-template-vars]')!.textContent).toContain(`{{${s.notes}}}`);
    expect(el.textContent).toContain('linked fields');
  });

  it('the Legacy / New switch changes narrative.mode and says in plain words what each does', async () => {
    const { f, el, store } = await tab();
    expect(el.querySelector('[data-mode-words]')!.textContent).toContain(MODE_WORDS.new.body);
    click(el.querySelector('[data-mode="legacy"]'));
    await settle(f);
    expect(store.def()!.narrative!.mode).toBe('legacy');
    expect(el.querySelector('[data-mode-words]')!.textContent).toContain(MODE_WORDS.legacy.body);
    click(el.querySelector('[data-mode="new"]'));
    await settle(f);
    expect(store.def()!.narrative!.mode).toBe('new');
  });

  it('Add Section, Edit (template with a variable chip) and Delete', async () => {
    const { f, el, store } = await tab();
    const dialog = TestBed.inject(DialogService);
    vi.spyOn(dialog, 'prompt').mockResolvedValue('Plan');
    click(el.querySelector('[data-act="add-section"]'));
    await vi.waitFor(() => expect(store.def()!.narrative!.sections.length).toBe(3));
    await settle(f);
    const key = store.def()!.narrative!.sections[2].key;
    click(el.querySelector(`.nt-sec[data-section="${key}"] [data-act="edit-section"]`));
    await settle(f);
    const box = el.querySelector('[data-section-editor]')!;
    expect(box).not.toBeNull();
    click(box.querySelector('[data-insert] button'));
    await settle(f);
    click(box.querySelector('[data-act="save-section"]'));
    await settle(f);
    expect(store.def()!.narrative!.sections[2].template).toMatch(/^\{\{\w+\}\}$/);
    vi.spyOn(dialog, 'confirm').mockResolvedValue(true);
    click(el.querySelector(`.nt-sec[data-section="${key}"] [data-act="delete-section"]`));
    await vi.waitFor(() => expect(store.def()!.narrative!.sections.length).toBe(2));
  });
});

describe('Studio editor, as the legacy Studio: Conditional Links', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('uses the legacy operator wording', () => {
    expect(LINK_OPERATORS.map((o) => o.label)).toEqual(['equals', 'not equals', 'contains', 'does not contain', 'is empty', 'is not empty', 'greater than', 'less than']);
  });

  it('a trigger imported from the old app keeps its alias words (has value, is selected) on the card', () => {
    expect(operatorWords('hasValue')).toBe('has value');
    expect(operatorWords('isSelected')).toBe('is selected');
    expect(operatorWords('includes')).toBe('contains');
    expect(operatorWords('notContains')).toBe('does not contain');
  });

  it('an empty tab says so; Add Trigger needs a name, a condition and an action; the card reads When … Then', async () => {
    const s = sheet();
    const { store } = await open(s.def);
    const f = TestBed.createComponent(LinksTabComponent);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-empty="links"]')!.textContent).toContain('No conditional links defined yet.');
    click(el.querySelector('[data-act="add-trigger"]'));
    await settle(f);
    const save = () => el.querySelector('[data-act="save-trigger"]') as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    const inst = f.componentInstance as unknown as { patch(c: (d: { name: string; conditions: unknown[]; actions: unknown[] }) => void): void };
    inst.patch((d) => {
      d.name = 'Pain sets side';
      d.conditions.push({ source: s.pain, op: 'equals', value: 'yes' });
      d.actions.push({ target: s.side, action: 'setValue', value: 'first' });
    });
    await settle(f);
    expect(save().disabled).toBe(false);
    click(save());
    await settle(f);
    expect(store.def()!.triggers).toHaveLength(1);
    expect(store.def()!.triggers![0]).toMatchObject({ name: 'Pain sets side', logic: 'and', enabled: true });
    const card = el.querySelector('[data-trigger="0"]')!;
    expect(card.textContent).toContain('1 condition(s) → 1 action(s)');
    expect(card.textContent).toContain('When (AND):');
    expect(card.textContent).toContain('Pain');
    expect(card.textContent).toContain('equals');
    expect(card.textContent).toContain('Then:');
    expect(card.textContent).toContain('Set Side to "first"');
  });
});

describe('Studio editor, as the legacy Studio: the key', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('the confirm names what follows, for a master and for a lab sheet', () => {
    expect(renameConfirmWords('ent', 'ear-nose-throat', true)).toContain('Every lab’s copy');
    expect(renameConfirmWords('ent', 'ear-nose-throat', true)).toContain('suggested changes');
    expect(renameConfirmWords('ent', 'ear-nose-throat', false)).toContain('saved case sheets keep reading');
    expect(renameResultWords({ from: 'a', to: 'b', labCopies: 3, offers: 1, proposals: 2 })).toBe('The key is now “b”. 3 lab copies, 1 update offer and 2 suggestions followed it.');
    expect(renameResultWords({ from: 'a', to: 'b', labCopies: 0, offers: 0, proposals: 0 })).toBe('The key is now “b”.');
  });

  async function settings() {
    const s = sheet();
    const { store, api, id } = await open(s.def);
    const f = TestBed.createComponent(FormSettingsComponent);
    await settle(f);
    await settle(f);
    return { f, el: f.nativeElement as HTMLElement, store, api, id };
  }

  it('changing the key asks first (DialogService), then renames and tells what followed', async () => {
    const { f, el, store, api, id } = await settings();
    const dialog = TestBed.inject(DialogService);
    const confirm = vi.spyOn(dialog, 'confirm').mockResolvedValue(true);
    const saved: string[] = [];
    f.componentInstance.saved.subscribe((n) => saved.push(n));
    const key = el.querySelector('#fs-key') as HTMLInputElement;
    key.value = 'ear-nose-throat';
    key.dispatchEvent(new Event('input'));
    await settle(f);
    click(el.querySelector('[data-act="save-settings"]'));
    await vi.waitFor(() => expect(saved.length).toBe(1));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0].message).toContain('ear-nose-throat');
    expect(saved[0]).toBe('The key is now “ear-nose-throat”.');
    expect(store.session.form()!.key).toBe('ear-nose-throat');
    expect((await api.form(id)).key).toBe('ear-nose-throat');
  });

  it('declining the confirm changes nothing', async () => {
    const { f, el, store, api, id } = await settings();
    const dialog = TestBed.inject(DialogService);
    vi.spyOn(dialog, 'confirm').mockResolvedValue(false);
    const before = (await api.form(id)).key;
    const key = el.querySelector('#fs-key') as HTMLInputElement;
    key.value = 'another-key';
    key.dispatchEvent(new Event('input'));
    await settle(f);
    click(el.querySelector('[data-act="save-settings"]'));
    await settle(f);
    expect((await api.form(id)).key).toBe(before);
    expect(store.session.form()!.key).toBe(before);
  });

  it('a key another case sheet has (409 key_taken) is said beside the box and nothing changes', async () => {
    const { f, el, api, id, store } = await settings();
    const other = api.seed('Other', sheet().def);
    const otherKey = (await api.form(other)).key;
    const dialog = TestBed.inject(DialogService);
    vi.spyOn(dialog, 'confirm').mockResolvedValue(true);
    const key = el.querySelector('#fs-key') as HTMLInputElement;
    key.value = otherKey;
    key.dispatchEvent(new Event('input'));
    await settle(f);
    click(el.querySelector('[data-act="save-settings"]'));
    await vi.waitFor(() => expect(el.querySelector('[data-error]')).not.toBeNull());
    await settle(f);
    expect(el.querySelector('[data-error]')!.textContent).toContain(`Another case sheet already uses the key “${otherKey}”`);
    expect((await api.form(id)).key).not.toBe(otherKey);
    expect(store.session.form()!.key).not.toBe(otherKey);
  });
});
