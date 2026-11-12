import { casesheetLinks } from '../../casesheets.routes';
import { FE_ASSETS, FE_KINDS, KIND_SPECS } from '@prefrontal/forms-engine';
import { HttpAssetStore } from '../../data/assets/http-asset-store';
import { AuthService } from '../../../../core/auth/auth.service';
import { CASESHEET_FORMS_MANAGE } from '../../shared/casesheet-permissions';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  FieldDef,
  IconName,
  PageDef,
  addGroup,
  addPage,
  allFields,
  describeShowWhen,
  edit,
  insertPageTemplate,
  kindBuild,
  medicalIcon,
  movePage,
  placeProblem,
  removeGroup,
  removePage,
  renamePage,
  setPageGroup,
} from '@prefrontal/forms-engine';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SkeletonFormComponent } from '@prefrontal/shared';
import { DialogService } from '../../../../core/services/dialog.service';
import { HeroBandComponent } from '../../../../shared/components/hero-band/hero-band.component';
import { StudioApi } from '../data/studio-api';
import { DraftConflict, Problem, PublishRefused, plainError } from '../data/studio-models';
import { StudioSession } from '../data/studio-session';
import { whenText as when } from '../shared/when';
import { deskSignal, isMac, isTyping, mediaSignal } from '../shared/desk';
import { PhoneNoteComponent } from '../shared/phone-note.component';
import { commandFor, tip } from '../shared/shortcuts';
import { ShortcutsPanelComponent } from '../shared/shortcuts-panel.component';
import { PreviewComponent } from '../preview/preview.component';
import { EditorStore } from './editor-store';
import { FieldActions } from './field-actions';
import { CsStylesComponent } from '../../styles/cs-styles.component';
import { checkNoteOf } from '../shared/check-marks';
import { ComponentsPanelComponent } from './components-panel.component';
import { ConfigPanelComponent } from './config-panel.component';
import { FormSettingsComponent } from './form-settings.component';
import { LinksTabComponent } from './links-tab.component';
import { NarrativeTabComponent } from './narrative-tab.component';
import { PageSettingsComponent } from './page-settings.component';
import { BuilderDrawerComponent, BuilderTab } from '../builder/builder-drawer.component';
import { BuilderStatusService } from '../builder/builder-status.service';
import { ChatStore } from '../builder/chat.store';
import { ChecksStore } from '../builder/checks.store';
import { failsWords } from '../builder/builder-models';

type MainTab = 'pages' | 'narrative' | 'links';

/**
 * Studio's editor, the way the legacy "Prefrontal Studio" works (owner 2026-11-12):
 *  - the header: back, the case sheet's name (editable), department / status / version, then Settings, Preview, Save, Publish;
 *  - the tabs: Pages and Fields, Narrative Sections, Conditional Links;
 *  - Pages and Fields is three panes: PAGES (with sections) | the page and its fields | the Components palette, which
 *    becomes "Configure Field" (General, Validation, Options, Narrative, Conditions …) when a field is selected.
 * Kept from before, by the owner's answer: undo / redo, bulk select and the keyboard shortcuts. Saves itself (Save saves
 * now); tells you when someone else saved first or is also editing.
 */
@Component({
  selector: 'app-studio-editor',
  standalone: true,
  imports: [
    RouterLink,
    HeroBandComponent,
    PfIconComponent,
    SkeletonFormComponent,
    NgTemplateOutlet,
    ComponentsPanelComponent,
    ConfigPanelComponent,
    NarrativeTabComponent,
    LinksTabComponent,
    PageSettingsComponent,
    FormSettingsComponent,
    PreviewComponent,
    PhoneNoteComponent,
    ShortcutsPanelComponent,
    CsStylesComponent,
    BuilderDrawerComponent,
  ],
  // Template pictures: Studio uploads / shows them through the same session-only store as the filler (bytes as blobs, no links).
  // FE_KINDS: every question card previews its control (<fe-field>) and the preview fills the case sheet; the kinds are not
  // in app.config (case-sheet code stays out of the lab's first download), so the page provides them (WP11: NG0201).
  providers: [
    StudioSession, EditorStore, FieldActions, HttpAssetStore, { provide: FE_ASSETS, useExisting: HttpAssetStore },
    { provide: FE_KINDS, useValue: KIND_SPECS },
    ChecksStore, ChatStore,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor.page.html',
  styleUrls: ['../shared/page.scss', '../shared/lg-form.scss', './editor.page.scss'],
})
export class StudioEditorPage {
  /** Route param. */
  readonly id = input.required<string>();
  /** ?field=<key>: open on that question (from history, the import report or a link). */
  readonly field = input<string | undefined>();

  protected readonly store = inject(EditorStore);
  protected readonly session = inject(StudioSession);
  protected readonly actions = inject(FieldActions);
  private readonly dialog = inject(DialogService);
  private readonly api = inject(StudioApi);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly def = this.store.def;
  protected readonly page = this.store.page;
  protected readonly previewOpen = signal(false);
  protected readonly problemsOpen = signal(false);
  protected readonly publishing = signal(false);
  protected readonly publishProblems = signal<Problem[] | null>(null);
  protected readonly published = signal<string | null>(null);
  protected readonly pageSettingsOpen = signal(false);
  protected readonly formSettingsOpen = signal(false);
  /** The legacy main tabs. */
  protected readonly tab = signal<MainTab>('pages');
  protected readonly mainTabs: { id: MainTab; label: string; icon: IconName }[] = [
    { id: 'pages', label: 'Pages & Fields', icon: 'forms' },
    { id: 'narrative', label: 'Narrative Sections', icon: 'text' },
    { id: 'links', label: 'Conditional Links', icon: 'link' },
  ];
  protected readonly helpOpen = signal(false);

  // ---------------- Cortex + Checks (dev beta: pf.cortexBuilder() + the server's status) ----------------
  protected readonly builder = inject(BuilderStatusService);
  protected readonly checks = inject(ChecksStore);
  /** Which builder tool the drawer shows (null = closed). */
  protected readonly builderTab = signal<BuilderTab | null>(null);
  protected readonly failsText = computed(() => failsWords(this.checks.failing()));

  protected openBuilder(tab: BuilderTab): void {
    this.builderTab.set(this.builderTab() === tab ? null : tab);
  }

  // ---------------- desktop ----------------
  protected readonly desk = deskSignal();
  private readonly mac = isMac();
  protected readonly tips = {
    undo: tip('undo', 'Undo', this.mac),
    redo: tip('redo', 'Redo', this.mac),
    preview: tip('preview', 'Try it as a doctor', this.mac),
    keys: tip('help', 'Keyboard shortcuts', this.mac),
    add: tip('add', 'Add a question', this.mac),
    up: tip('moveUp', 'Move up', this.mac),
    down: tip('moveDown', 'Move down', this.mac),
    dup: tip('duplicate', 'Make copies', this.mac),
    rm: tip('remove', 'Remove (you can undo it)', this.mac),
  };

  constructor() {
    void this.builder.load();
    void this.api
      .departments()
      .then((d) => this.deptNames.set(new Map(d.map((x) => [x.key, x.name]))))
      .catch(() => undefined);
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    inject(DestroyRef).onDestroy(() => this.session.close());
  }

  protected setTab(t: MainTab): void {
    this.tab.set(t);
  }

  private async load(id: string): Promise<void> {
    void this.store.loadCatalogue();
    await this.session.load(id);
    const d = this.def();
    if (d?.pages[0]) this.store.selectPage(d.pages[0].key);
    const f = untracked(() => this.field());
    if (f) this.store.jumpTo(f);
  }

  protected readonly links = casesheetLinks;
  protected readonly forking = signal(false);
  protected readonly canManage = computed(() => this.auth.hasPermission(CASESHEET_FORMS_MANAGE));
  protected readonly title = computed(() => this.def()?.title || 'Untitled case sheet');
  protected readonly version = this.session.version;

  protected readonly status = computed(() => {
    const v = this.version();
    if (!v) return '';
    if (this.session.onLive()) return `Live · version ${v.versionNo}`;
    return v.state === 'in_review' ? `In review · version ${v.versionNo}` : `Draft · version ${v.versionNo}`;
  });

  protected readonly saveWords = computed(() => {
    switch (this.session.saveState()) {
      case 'saving':
        return 'Saving…';
      case 'dirty':
        return 'Changes not saved yet';
      case 'offline':
        return "Can't reach the server — kept on this screen";
      case 'error':
        return this.session.saveMessage() || "Couldn't save";
      case 'conflict':
        return 'Someone else saved first';
      default: {
        const at = this.session.savedAt();
        return this.session.onLive() ? 'Edits start a new draft' : at ? `Saved ${when(at)}` : 'Saved';
      }
    }
  });

  protected readonly alsoEditing = computed(() => {
    const e = this.session.editors();
    if (!e.length) return '';
    return e.length === 1 ? `${e[0].name} is also editing` : `${e[0].name} and ${e.length - 1} more are also editing`;
  });

  protected readonly pageRule = computed(() => {
    const d = this.def();
    const p = this.page();
    return d && p ? describeShowWhen(d, p.showWhen) : '';
  });

  protected readonly pageFields = computed(() => this.page()?.fields ?? []);
  protected readonly count = computed(() => {
    const n = this.pageFields().length;
    return `${n} ${n === 1 ? 'question' : 'questions'}`;
  });

  protected fieldsIn(p: PageDef): number {
    return p.fields.length;
  }

  // ---------------- pages ----------------

  protected async addPage(groupKey?: string): Promise<void> {
    const name = await this.dialog.prompt({
      title: 'Add New Page',
      message: 'Each page is one step for the doctor, with its own section in the narrative.',
      placeholder: 'e.g., Patient Information',
      confirmLabel: 'Add Page',
      required: true,
    });
    if (!name?.trim()) return;
    let key = '';
    const at = this.def() ? this.def()!.pages.findIndex((p) => p.key === this.page()?.key) + 1 : undefined;
    this.store.edit((d) => {
      const r = addPage(d, name.trim(), groupKey ? undefined : at || undefined);
      key = r.key;
      return groupKey ? setPageGroup(r.def, r.key, groupKey) : r.def;
    });
    this.store.selectPage(key);
  }

  // ---------------- sections (legacy: groups of pages) ----------------

  private readonly collapsed = signal<ReadonlySet<string>>(new Set());

  /** Pages with their index in the definition (the drag lists and the wizard order are by that index). */
  private readonly indexed = computed(() => (this.def()?.pages ?? []).map((page, index) => ({ page, index })));

  protected readonly groupViews = computed(() => {
    const d = this.def();
    const groups = d?.groups ?? [];
    return groups.map((g) => ({
      key: g.key,
      title: g.title,
      collapsed: this.collapsed().has(g.key),
      pages: this.indexed().filter((v) => v.page.group === g.key),
    }));
  });

  protected readonly rootViews = computed(() => {
    const keys = new Set((this.def()?.groups ?? []).map((g) => g.key));
    return this.indexed().filter((v) => !v.page.group || !keys.has(v.page.group));
  });

  protected toggleGroup(key: string): void {
    const next = new Set(this.collapsed());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsed.set(next);
  }

  protected async addSection(): Promise<void> {
    const title = await this.dialog.prompt({
      title: 'Add Section',
      message: 'A section groups pages in the list, for example “History” or “Examination”.',
      placeholder: 'Section name',
      confirmLabel: 'Add Section',
      required: true,
    });
    if (title?.trim()) this.store.edit((d) => addGroup(d, title.trim()).def);
  }

  protected async removeSection(key: string, title: string): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Delete the section “${title}”?`,
      message: 'Its pages stay, uncategorized. You can undo this.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (ok) this.store.edit((d) => removeGroup(d, key));
  }

  protected pageIcon(p: PageDef): IconName {
    return medicalIcon(p.icon) ?? 'k-pages';
  }

  protected async savePage(p: PageDef): Promise<void> {
    const name = await this.dialog.prompt({ title: 'Save as Template', message: 'Anyone can add a saved page to a case sheet.', initialValue: p.title, confirmLabel: 'Save', required: true });
    if (!name?.trim()) return;
    try {
      await this.api.saveTemplate('page', name.trim(), p);
      this.actions.notice.set(`Saved “${name.trim()}”. Add it to any case sheet with “Add a saved page”.`);
    } catch (e) {
      this.actions.notice.set(plainError(e, "Couldn't save the page."));
    }
  }

  // ---------------- the header ----------------

  private readonly deptNames = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly departmentName = computed(() => {
    const f = this.session.form();
    return (f?.departmentKey ? this.deptNames().get(f.departmentKey) : '') || f?.specialty || f?.departmentKey || '';
  });

  /** Nothing waits to be saved. */
  protected readonly saveIdle = computed(() => this.session.saveState() === 'saved');

  protected saveNow(): void {
    void this.session.flush();
  }

  protected renameTitle(name: string): void {
    const t = name.trim();
    if (!t || t === this.title()) return;
    this.store.edit((d) => edit(d, (x) => (x.title = t)));
  }

  protected onSettingsSaved(note: string): void {
    if (note) this.actions.notice.set(note);
  }

  // ---------------- the page header on the canvas ----------------

  protected renameCurrentPage(title: string): void {
    const p = this.page();
    const t = title.trim();
    if (p && t && t !== p.title) this.store.edit((d) => renamePage(d, p.key, t));
  }

  protected setSubtitle(v: string): void {
    const key = this.page()?.key;
    if (!key) return;
    this.store.edit((d) =>
      edit(d, (x) => {
        const p = x.pages.find((y) => y.key === key);
        if (p) p.subtitle = v.trim() || undefined;
      }),
    );
  }

  protected async deletePage(p: PageDef): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Delete the page “${p.title}”?`,
      message: `Its ${p.fields.length} field${p.fields.length === 1 ? '' : 's'} go with it. You can undo this.`,
      confirmLabel: 'Delete Page',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    this.store.edit((x) => removePage(x, p.key));
    const first = this.def()?.pages[0];
    if (first) this.store.selectPage(first.key);
  }

  // ---------------- a field's row on the canvas ----------------

  protected kindName(kind: string): string {
    return kindBuild(kind).name;
  }

  protected kindIcon(kind: string): IconName {
    return kindBuild(kind).icon as IconName;
  }

  protected checkNote(f: FieldDef): string {
    return checkNoteOf(f);
  }

  protected hasError(key: string): boolean {
    return (this.store.problemsByField().get(key) ?? []).some((p) => p.severity === 'error');
  }

  protected rowClick(e: MouseEvent, f: FieldDef): void {
    const t = e.target as HTMLElement;
    if (t.closest('button, input, textarea, pf-select, a')) return;
    if (this.desk()) {
      if (e.metaKey || e.ctrlKey) {
        this.store.togglePick(f.key);
        return;
      }
      if (e.shiftKey) {
        this.store.pickRange(f.key);
        return;
      }
    }
    this.store.select(f.key, true);
  }

  /** Shift / ⌘-click picks questions; it must not select the page's text too. */
  protected noTextSelect(e: MouseEvent): void {
    if (this.desk() && (e.shiftKey || e.metaKey || e.ctrlKey) && !(e.target as HTMLElement).closest('input, textarea')) e.preventDefault();
  }

  /** The questions a quick action works on: the whole selection when this row is in it, else this one. */
  private targets(key: string): string[] {
    return this.store.picked().has(key) ? this.store.selection() : [key];
  }

  protected duplicateRow(key: string): void {
    this.actions.duplicateMany(this.targets(key));
  }

  protected removeRow(key: string): void {
    this.actions.removeMany(this.targets(key));
  }

  /** A long press on touch opens the row's menu (the same menu as ⋯). */
  protected menuLater(key: string): () => void {
    return () => void this.actions.menu(key);
  }

  /** Wide enough that the right pane is a column, not a sheet. */
  protected readonly wide = mediaSignal('(min-width: 1024px)');

  protected async addSavedPage(): Promise<void> {
    let list;
    try {
      list = await this.api.templates('page');
    } catch (e) {
      this.actions.notice.set(plainError(e, "Can't load the saved pages."));
      return;
    }
    if (!list.length) {
      await this.dialog.alert({ title: 'No saved pages yet', message: 'Open a page’s ⋯ and choose “Save for other case sheets” to keep one here.', confirmLabel: 'OK' });
      return;
    }
    const pick = await this.dialog.choose({
      title: 'Add a saved page',
      choices: list.map((t) => ({ value: t.id, label: t.title, hint: t.category ?? undefined })),
      confirmLabel: 'Add',
      cancelLabel: 'Cancel',
    });
    if (!pick) return;
    const d = this.def()!;
    const ex = await this.api.expandTemplate(pick, allFields(d).map((f) => f.key), d.pages.map((p) => p.key));
    let key = '';
    this.store.edit((x) => {
      const at = x.pages.findIndex((p) => p.key === this.page()?.key) + 1;
      const r = insertPageTemplate(x, ex.body as PageDef, at || undefined);
      key = r.key;
      return r.def;
    });
    this.store.selectPage(key);
  }

  protected async pageMenu(p: PageDef): Promise<void> {
    const d = this.def()!;
    const i = d.pages.findIndex((x) => x.key === p.key);
    const pick = await this.dialog.choose({
      title: p.title,
      choices: [
        { value: 'rename', label: 'Rename' },
        ...(i > 0 ? [{ value: 'up', label: 'Move earlier' }] : []),
        ...(i < d.pages.length - 1 ? [{ value: 'down', label: 'Move later' }] : []),
        ...((d.groups ?? []).length ? [{ value: 'section', label: 'Move to a section' }] : []),
        { value: 'save', label: 'Save for other case sheets', hint: 'A saved page anyone can add' },
        { value: 'remove', label: 'Remove this page' },
      ],
      confirmLabel: 'Do it',
      cancelLabel: 'Close',
    });
    if (pick === 'rename') {
      const name = await this.dialog.prompt({ title: 'Rename the page', initialValue: p.title, confirmLabel: 'Rename', required: true });
      if (name?.trim()) this.store.edit((x) => renamePage(x, p.key, name.trim()));
    } else if (pick === 'up' || pick === 'down') {
      this.store.edit((x) => movePage(x, i, pick === 'up' ? i - 1 : i + 1));
    } else if (pick === 'section') {
      const to = await this.dialog.choose({
        title: `Move “${p.title}” to a section`,
        choices: [...(d.groups ?? []).map((g) => ({ value: g.key, label: g.title })), { value: '-', label: 'Uncategorized' }],
        initialChoice: p.group ?? '-',
        confirmLabel: 'Move',
        cancelLabel: 'Cancel',
      });
      if (to) this.store.edit((x) => setPageGroup(x, p.key, to === '-' ? null : to));
    } else if (pick === 'save') {
      const name = await this.dialog.prompt({ title: 'Save this page', initialValue: p.title, confirmLabel: 'Save', required: true });
      if (!name?.trim()) return;
      try {
        await this.api.saveTemplate('page', name.trim(), p);
        this.actions.notice.set(`Saved “${name.trim()}”. Add it to any case sheet with “Add a saved page”.`);
      } catch (e) {
        this.actions.notice.set(plainError(e, "Couldn't save the page."));
      }
    } else if (pick === 'remove') {
      const ok = await this.dialog.confirm({
        title: `Remove the page “${p.title}”?`,
        message: `Its ${p.fields.length} question${p.fields.length === 1 ? '' : 's'} go with it. You can undo this.`,
        confirmLabel: 'Remove',
        cancelLabel: 'Keep it',
        tone: 'danger',
      });
      if (!ok) return;
      this.store.edit((x) => removePage(x, p.key));
      const first = this.def()?.pages[0];
      if (first) this.store.selectPage(first.key);
    }
  }

  protected pageGrip(e: PointerEvent, i: number): void {
    this.actions.drag.start(e, 'pages', i);
  }

  // drag of the page's questions
  protected gripFor(i: number): (e: PointerEvent) => void {
    return (e) => this.actions.drag.start(e, 'page', i);
  }
  protected keyFor(i: number): (e: KeyboardEvent) => void {
    return (e) => this.actions.drag.keyMove(e, 'page', i, this.pageFields().length);
  }

  // ---------------- add a question / multi-select ----------------

  /** "N" / "/": the palette (nothing selected) takes the right pane, ready to add at the end of the page. */
  protected addAfterSelection(): void {
    if (!this.page()) return;
    this.store.editing.set(null);
    this.store.select(null);
    if (!this.wide()) this.store.settingsOpen.set(true);
  }

  protected removeSelection(): void {
    this.actions.removeMany(this.store.selection());
  }

  protected readonly selCount = computed(() => this.store.picked().size);

  /** Select the question above / below (and with Shift, take it into the selection too). */
  private step(dir: -1 | 1, extend: boolean): void {
    const keys = this.store.pageKeys();
    if (!keys.length) return;
    const cur = this.store.selectedKey();
    const i = cur ? keys.indexOf(cur) : -1;
    const j = i < 0 ? (dir > 0 ? 0 : keys.length - 1) : Math.max(0, Math.min(keys.length - 1, i + dir));
    const next = keys[j];
    if (extend && cur && keys.includes(cur)) {
      const picked = new Set(this.store.picked().size ? this.store.picked() : [cur]);
      picked.add(next);
      this.store.picked.set(picked);
      this.store.selectedKey.set(next);
    } else {
      this.store.select(next);
    }
    this.store.focusCard(next);
  }

  private stepPage(dir: -1 | 1): void {
    const pages = this.def()?.pages ?? [];
    const i = pages.findIndex((p) => p.key === this.page()?.key);
    const p = pages[i + dir];
    if (p) this.store.selectPage(p.key);
  }

  /** Something on screen that Esc should close first; true when it closed something. */
  private closeOne(): boolean {
    if (this.helpOpen()) return this.helpOpen.set(false), true;
    if (this.builderTab()) return this.builderTab.set(null), true;
    if (this.previewOpen()) return this.previewOpen.set(false), true;
    if (this.store.paletteAt()) return this.store.paletteAt.set(null), true;
    if (this.store.editing()) return this.store.editing.set(null), true;
    if (this.pageSettingsOpen()) return this.pageSettingsOpen.set(false), true;
    if (this.formSettingsOpen()) return this.formSettingsOpen.set(false), true;
    if (this.store.picked().size) return this.store.clearPicks(), true;
    if (this.problemsOpen()) return this.problemsOpen.set(false), true;
    if (this.store.settingsOpen() && !this.wide()) return this.store.settingsOpen.set(false), true;
    return false;
  }

  /**
   * The keyboard (desktop; harmless with a tablet keyboard too). The table is
   * shortcuts.ts; a box being typed in keeps its keys (only ⌘S and Esc act).
   * A dialog from DialogService owns the keyboard while it is open.
   */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || !this.def()) return;
    if (document.querySelector('.pf-dh-backdrop, [role="alertdialog"], app-dialog-host [role="dialog"], pf-dialog-host [role="dialog"]')) return;
    const typing = isTyping(e.target);
    const cmd = commandFor(e, typing);
    if (!cmd) return;
    // the preview and the shortcuts panel take only Esc
    if ((this.previewOpen() || this.helpOpen()) && cmd !== 'escape') return;
    const sel = this.store.selection();
    const act = () => e.preventDefault();
    switch (cmd) {
      case 'save':
        act();
        (document.activeElement as HTMLElement | null)?.blur?.();
        void this.session.flush();
        return;
      case 'escape':
        if (typing) {
          (e.target as HTMLElement).blur?.();
          if (this.store.editing()) this.store.editing.set(null);
          act();
          return;
        }
        if (this.closeOne()) act();
        return;
      case 'undo':
        act();
        this.session.undo();
        return;
      case 'redo':
        act();
        this.session.redo();
        return;
      case 'add':
      case 'search':
        act();
        this.addAfterSelection();
        return;
      case 'help':
        act();
        this.helpOpen.set(true);
        return;
      case 'preview':
        act();
        void this.preview();
        return;
      case 'prevPage':
      case 'nextPage':
        act();
        this.stepPage(cmd === 'prevPage' ? -1 : 1);
        return;
      case 'selectAll':
        act();
        this.store.pickAll();
        return;
      case 'prev':
      case 'next':
      case 'extendUp':
      case 'extendDown':
        // arrows on a button / segmented control / list keep their own meaning
        if ((e.target as HTMLElement)?.closest?.('[role="radiogroup"], [role="listbox"], [role="menu"], [role="tablist"], .ed-grip, .fc-grip, .fs-grip')) return;
        act();
        this.step(cmd === 'prev' || cmd === 'extendUp' ? -1 : 1, cmd === 'extendUp' || cmd === 'extendDown');
        return;
    }
    if (!sel.length) return;
    switch (cmd) {
      case 'duplicate':
        act();
        this.actions.duplicateMany(sel);
        return;
      case 'remove':
        act();
        this.actions.removeMany(sel);
        return;
      case 'moveUp':
      case 'moveDown':
        act();
        this.actions.moveMany(sel, cmd === 'moveUp' ? -1 : 1);
        return;
      case 'rename': {
        // Enter on a focused button is the button's own
        const t = e.target as HTMLElement;
        if (t && t !== document.body && t.closest('button, a, [role="switch"], [role="radio"], [role="checkbox"]')) return;
        act();
        this.store.open(this.store.selectedKey() ?? sel[0], 'label');
        return;
      }
    }
  }

  // ---------------- band actions ----------------

  protected async preview(): Promise<void> {
    await this.session.flush();
    this.previewOpen.set(true);
  }

  protected async publish(): Promise<void> {
    if (this.publishing()) return;
    const v = this.version();
    const ok = await this.dialog.confirm({
      title: `Publish version ${v?.versionNo ?? ''}?`,
      message:
        'Doctors get this version for new case sheets. Case sheets already started keep the version they began with.' +
        (this.builder.available() && this.checks.failing() ? ` ${this.failsText()} right now. You can still publish, but look at it first.` : ''),
      confirmLabel: 'Publish',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    this.publishing.set(true);
    this.publishProblems.set(null);
    try {
      const done = await this.session.publish();
      this.published.set(`Version ${done.versionNo} is live. New case sheets use it.`);
      this.problemsOpen.set(false);
    } catch (e) {
      if (e instanceof PublishRefused) {
        const d = this.def();
        this.publishProblems.set(
          e.problems.filter((p) => p.severity === 'error').map((p) => (d ? { ...p, message: placeProblem(d, p).text } : p)),
        );
        this.problemsOpen.set(true);
      } else if (!(e instanceof DraftConflict)) {
        this.actions.notice.set(plainError(e, "Couldn't publish just now."));
      }
    } finally {
      this.publishing.set(false);
    }
  }

  protected readonly listedProblems = computed(() => {
    const listed = this.publishProblems() ?? this.store.problems().filter((p) => p.severity === 'error');
    return listed;
  });

  protected jump(p: Problem): void {
    const area = /show/i.test(p.path) ? 'showWhen' : /says|sentence/i.test(p.path) ? 'says' : /options/i.test(p.path) ? 'options' : undefined;
    this.store.jumpTo(p.fieldKey, p.pageKey, area);
    if (area === 'options') this.store.revealSettings();
    if (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 1023px)').matches) this.problemsOpen.set(false);
  }

  protected async more(): Promise<void> {
    const pick = await this.dialog.choose({
      title: this.title(),
      choices: [
        { value: 'history', label: 'Version history', hint: 'Who changed what, and compare versions' },
        { value: 'rename', label: 'Rename the case sheet' },
        { value: 'dup', label: 'Make a copy of this case sheet' },
        ...(!this.session.onLive() ? [{ value: 'discard', label: 'Discard this draft' }] : []),
      ],
      confirmLabel: 'Open',
      cancelLabel: 'Close',
    });
    if (pick === 'history') {
      await this.session.flush();
      await this.router.navigate([casesheetLinks.adminFormHistory(this.id())]);
    } else if (pick === 'rename') {
      const name = await this.dialog.prompt({ title: 'Rename the case sheet', initialValue: this.title(), confirmLabel: 'Rename', required: true });
      if (name?.trim()) this.store.edit((d) => edit(d, (x) => (x.title = name.trim())));
    } else if (pick === 'dup') {
      const name = await this.dialog.prompt({ title: 'Make a copy', initialValue: `Copy of ${this.title()}`, confirmLabel: 'Make the copy', required: true });
      if (!name?.trim()) return;
      try {
        await this.session.flush();
        const r = await this.api.duplicate(this.id(), name.trim());
        await this.router.navigate([casesheetLinks.adminForm(r.id)]);
      } catch (e) {
        this.actions.notice.set(plainError(e));
      }
    } else if (pick === 'discard') {
      await this.discard();
    }
  }

  /** "Edit" on a master case sheet: this lab's own copy (a fork) with an open draft, then open it. */
  protected async forkMaster(): Promise<void> {
    if (this.forking() || !this.session.readOnly()) return;
    const ok = await this.dialog.confirm({
      title: `Make your lab's copy of ${this.title()}?`,
      message: 'You edit and publish your lab\'s copy. The master stays as it is, and your copy is the one your doctors use.',
      confirmLabel: 'Make my copy',
      cancelLabel: 'Not now',
    });
    if (!ok) return;
    this.forking.set(true);
    try {
      const r = await this.api.fork(this.id());
      await this.router.navigate([casesheetLinks.adminForm(r.id)]);
    } catch (e) {
      this.actions.notice.set(plainError(e, "Couldn't make your copy just now."));
    } finally {
      this.forking.set(false);
    }
  }

  /** Discard the open draft Asks first. */
  protected async discard(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Discard this draft?',
      message:
        this.version()?.versionNo === 1 && !this.version()?.publishedAt
          ? 'This case sheet was never published, so it goes away completely.'
          : 'The live version stays as it is.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.session.discard();
      await this.router.navigate([casesheetLinks.adminHome()]);
    } catch (e) {
      this.actions.notice.set(plainError(e));
    }
  }

  protected async resolve(choice: 'theirs' | 'mine'): Promise<void> {
    await this.session.resolve(choice);
  }

  protected readonly saveTip = computed(() => (this.mac ? 'Saves by itself; ⌘S saves now' : 'Saves by itself; Ctrl+S saves now'));

  protected readonly conflictWho = computed(() => {
    const c = this.session.conflict();
    return c?.savedBy?.name || c?.savedBy?.email || 'Someone else';
  });
}
