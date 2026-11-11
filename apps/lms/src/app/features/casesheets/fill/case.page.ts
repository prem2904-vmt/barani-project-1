import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  Answers,
  FE_KINDS,
  FE_SUGGESTIONS,
  preloadKinds,
  FE_WIZARD,
  HoldDirective,
  FieldDef,
  FieldHostComponent,
  allFields,
  applyChange,
  patientLabelOf,
  isShown,
  linkDisabledKeys,
  missingRequired,
  pageLookup,
  pageScope,
  setInScope,
  tapCompletes,
} from '@prefrontal/forms-engine';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SkeletonFormComponent } from '@prefrontal/shared';
import { DialogService } from '../../../core/services/dialog.service';
import { CasesheetNav } from '../data/casesheet-nav';
import { CsStylesComponent } from '../styles/cs-styles.component';
import { CASESHEETS_DATA_PROVIDERS } from '../data/casesheets-data.providers';
import { FinishRefused, MissingAnswer } from '../data/cases/case-models';
import { CaseSession } from '../data/cases/case-session';
import { HttpAssetStore } from '../data/assets/http-asset-store';
import { FormBarService } from '../data/form-bar/form-bar.service';
import { ReadAloud, listenScript } from '../data/voice/read-aloud';
import { CaseSuggestions } from '../data/suggestions/case-suggestions';
import { NarrativeSection } from '../data/cases/case-models';
import { FinalViewComponent } from './final-view.component';
import { NarrativeCardComponent, SectionEditEvent } from './narrative-card.component';
import { SaveStateComponent } from './save-state.component';
import { WizardController } from './wizard';

/** How long after the last one-tap answer of a page the wizard moves on (legacy behaviour doctors liked). */
export const AUTO_ADVANCE_MS = 500;
/** Hold Next this long (after a short still press) to finish from any page (legacy tab-nav.ts:139-140: 200 ms + 1.5 s). */
export const HOLD_FINISH = { delay: 200, fill: 1500 };
/** Hold Pages to go back to Departments (legacy tab-nav "hold step indicator to exit": 200 ms + 800 ms). */
export const HOLD_LEAVE = { delay: 200, fill: 800 };
/** Hold the PF logo (or Narrative) for a voice note / a section of your own (legacy navbar.ts:117-118, PF Circle: 300 ms + 1.2 s). */
export const HOLD_NOTE = { delay: 300, fill: 1200 };

/** The PF glyph (two paths, viewBox 0 0 228 292), as in the legacy form header and the LMS brand mark. */
export const PF_GLYPH: readonly [string, string] = [
  'M0 131.126V292H30.1634C29.572 247.788 28.744 156.113 30.1634 143.106C31.5829 130.099 40.2179 118.861 44.358 114.867C79.8444 80.639 117.696 104.599 132.187 120.857V81.4947C125.799 74.649 101.136 70.0852 89.6031 68.659C39.9222 63.1824 9.16731 108.022 0 131.126Z',
  'M99 204C76.2887 212.215 47.6109 193.023 38.1479 182.469V220.976C126.154 259.996 162.35 199.583 169.447 164.499H227.113V136.26L171.222 137.116V72.0819C177.609 35.1151 211.735 26.4439 228 26.7291V0.201972C161.463 -4.07659 142.833 60.9576 140.171 68.659C137.51 76.3604 141.058 161.932 136.623 172.2L136.585 172.287C132.16 182.532 127.31 193.76 99 204Z',
];

/** A page's own colour for the case sheet header (legacy: page.color), only when it is a plain hex colour. */
export function headerColor(color: string | null | undefined): string | null {
  return color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim()) ? color.trim() : null;
}

/** The keyboard shortcuts (legacy dynamic-form.ts:78-106 + keyboard-shortcuts.ts), shown by "?". */
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: '→  or  Ctrl + Enter', does: 'Next page' },
  { keys: '←  or  Ctrl + Backspace', does: 'Previous page' },
  { keys: 'Ctrl + Shift + Enter', does: 'Finish' },
  { keys: 'N', does: 'Open or close the narrative' },
  { keys: '?', does: 'This list' },
  { keys: 'Esc', does: 'Close a list or a dialog' },
];
const SWIPE_MIN_PX = 80;

/**
 * A case sheet (plan §6). Draft → the page wizard: one page at a time,
 * big touch controls, every change saved as you go, the narrative writing
 * itself beside the page (a sheet on portrait tablets and phones), Finish
 * → plain-words check → PDF. Final → the PDF view (FinalViewComponent).
 */
@Component({
  selector: 'app-case-page',
  standalone: true,
  imports: [
    PfIconComponent,
    SkeletonFormComponent,
    FieldHostComponent,
    NarrativeCardComponent,
    SaveStateComponent,
    FinalViewComponent,
    HoldDirective,
    CsStylesComponent,
  ],
  providers: [
    ...CASESHEETS_DATA_PROVIDERS,
    CaseSession,
    WizardController,
    CaseSuggestions,
    { provide: FE_WIZARD, useExisting: WizardController },
    { provide: FE_SUGGESTIONS, useExisting: CaseSuggestions },
  ],
  host: { '(document:keydown)': 'onKey($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './case.page.html',
  styleUrls: ['../styles/_page.scss', './case.page.scss'],
})
export class CasePage {
  /** Route param. */
  readonly id = input.required<string>();

  protected readonly session = inject(CaseSession);
  protected readonly wiz = inject(WizardController);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  /** Where Departments / the list are in this app mode (public site vs the lab; Prepare: /forms, /cases). */
  protected readonly nav = inject(CasesheetNav);
  /** Photos (image kinds) are uploaded to the draft sheet that is open. */
  private readonly pictures = inject(HttpAssetStore, { optional: true });

  protected readonly sheet = this.session.sheet;
  protected readonly def = this.session.definition;
  protected readonly isFinal = computed(() => this.sheet()?.state === 'final');
  protected readonly narrativeOpen = signal(false);
  /** A section just added: the narrative card opens it for typing / dictation. */
  protected readonly openSection = signal<string | null>(null);
  protected readonly holds = { finish: HOLD_FINISH, leave: HOLD_LEAVE, note: HOLD_NOTE };
  /** Next is being held: its label says what will happen. */
  protected readonly holdingNext = signal(false);
  /** The page list over the bar (legacy tab-nav "Navigate to Step"). */
  protected readonly menuOpen = signal(false);
  protected readonly glyph = PF_GLYPH;
  protected readonly finishing = signal(false);
  /** Edit your report (legacy chief-complaints PDF modal): open, and which tab. */
  protected readonly reportOpen = signal(false);
  protected readonly reportTab = signal<'edit' | 'listen' | 'pdf'>('edit');
  protected readonly listen = inject(ReadAloud);
  protected readonly listenParts = computed(() => listenScript(this.session.narrative()?.sections ?? []));
  protected readonly listenSections = computed(() =>
    (this.session.narrative()?.sections ?? []).filter((s) => s.content.trim()),
  );
  protected readonly missingKeys = signal<ReadonlySet<string>>(new Set());
  protected readonly lockedKeys = computed(() => {
    const d = this.def();
    return d ? linkDisabledKeys(d) : new Set<string>();
  });

  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private readonly formBarTpl = viewChild<TemplateRef<unknown>>('formBarTpl');
  private readonly formBar = inject(FormBarService);
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly page = this.wiz.page;
  protected readonly scope = computed<Answers>(() => {
    const wp = this.page();
    return wp ? pageScope(wp, this.wiz.answers()) : {};
  });
  protected readonly lookup = computed(() => {
    const wp = this.page();
    const a = this.wiz.answers();
    return wp ? pageLookup(wp, a) : () => undefined;
  });
  protected readonly fields = computed<FieldDef[]>(() => {
    const wp = this.page();
    const get = this.lookup();
    return wp ? wp.page.fields.filter((f) => isShown(f.showWhen, get)) : [];
  });
  protected readonly patient = computed(() => {
    const n = this.session.narrative();
    const s = this.sheet();
    const name = s?.patient.name || n?.patientName || '';
    const bits = [s?.patient.age || n?.age, (s?.patient.sex || n?.sex || '').charAt(0).toUpperCase()].filter(Boolean);
    return { name, meta: bits.join(' ') };
  });
  protected readonly loadMessage = computed(() => {
    const e = this.session.loadError() as { status?: number } | null;
    if (!e) return '';
    if (e.status === 404) return 'This case sheet was not found. It may have been deleted.';
    if (e.status === 0) return "Can't reach Prefrontal, and this case sheet isn't saved on this device yet.";
    return "Can't open this case sheet right now. Please try again.";
  });
  protected readonly percent = computed(() => Math.round(this.wiz.progress().ratio * 100));
  /** Header title: the page's title while filling (legacy navbar form mode), the case sheet's title when finished. */
  protected readonly headTitle = computed(() =>
    this.isFinal() || !this.page() ? (this.sheet()?.formTitle ?? 'Case sheet') : this.page()!.title,
  );
  /** The case sheet has its own patient-name field: the header shows the name, it never asks for it. */
  protected readonly hasNameField = computed(() => {
    const d = this.def();
    if (!d) return true;
    const probe: Answers = {};
    for (const f of allFields(d)) if (f.kind === 'text') probe[f.key] = 'x';
    return !!patientLabelOf(d, probe);
  });
  protected readonly pageColor = computed(() => headerColor(this.page()?.page.color));
  /** The page list (rail on desktop, the Pages menu elsewhere): visited pages tick, the current one is marked. */
  protected readonly steps = computed(() => {
    const seen = new Set(this.sheet()?.visitedPages ?? []);
    const cur = this.page()?.id;
    return this.wiz.progress().per.map((p) => ({
      id: p.page.id,
      key: p.page.page.key,
      title: p.page.title,
      answered: p.answered,
      total: p.total,
      current: p.page.id === cur,
      done: p.page.id !== cur && (seen.has(p.page.page.key) || (p.total > 0 && p.answered >= p.total)),
    }));
  });
  protected readonly visitedCount = computed(() => this.steps().filter((s) => s.done || s.current).length);
  protected readonly stepPercent = computed(() => {
    const n = this.wiz.pages().length;
    return n ? Math.round(((this.wiz.index() + 1) / n) * 100) : 0;
  });

  /**
   * On a repeated page ("Ulcer 2"), its sister pages as chips (plan §4 repeatPages): the one open is marked, the
   * ones with answers carry a tick. Shown at the top of the page (the legacy header has no context bar).
   */
  protected readonly repeats = computed(() => {
    const wp = this.page();
    if (!wp?.instance) return [];
    const field = wp.instance.fieldKey;
    return this.wiz
      .progress()
      .per.filter((p) => p.page.instance?.fieldKey === field)
      .map((p, i) => ({ id: p.page.id, title: p.page.title, n: i + 1, current: p.page.id === wp.id, answered: p.answered > 0 }));
  });

  protected readonly setter = (key: string, value: unknown) => this.set(key, value);

  constructor() {
    // Load the sheet whenever the route id changes.
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    // Fetch the heavy controls this case sheet uses (pictures, grids) as soon as it opens, so turning a page never waits.
    const kinds = inject(FE_KINDS);
    effect(() => {
      const d = this.def();
      if (d) untracked(() => void preloadKinds(kinds, allFields(d).map((f) => f.kind)));
    });
    // Keep the wizard's answers in step with the session (links / triggers / conflicts).
    effect(() => {
      const a = this.session.answers();
      untracked(() => this.wiz.answers.set(a));
    });
    // Remember the pages reached (page KEYS; the current one last).
    effect(() => {
      const wp = this.wiz.page();
      if (!wp || this.isFinal()) return;
      untracked(() => {
        const seen = (this.sheet()?.visitedPages ?? []).filter((k) => k !== wp.page.key);
        this.session.setVisited([...this.visitedSoFar(seen), wp.page.key]);
        this.body()?.nativeElement.scrollTo?.({ top: 0 });
      });
    });
    // One bottom bar: while the sheet is open (not loading, not finished) its Back · Pages · Next replace the
    // LMS bar's work areas; leaving the sheet (or finishing it) gives the bar back.
    effect(() => {
      const tpl = this.formBarTpl();
      const open = !!this.sheet() && !!this.def() && !this.isFinal() && !this.loadMessage();
      untracked(() => (open && tpl ? this.formBar.show(this, tpl) : this.formBar.clear(this)));
    });
    // case photos go to the draft that is open, and only while it is open
    effect(() => {
      const s = this.sheet();
      this.pictures?.forSheet(s && s.state === 'draft' ? s.id : null);
    });
    inject(DestroyRef).onDestroy(() => {
      this.cancelAdvance();
      this.formBar.clear(this);
      this.listen.stop();
      this.pictures?.forSheet(null);
    });
  }

  private visited = new Set<string>();
  private visitedSoFar(seen: string[]): string[] {
    for (const k of seen) this.visited.add(k);
    return [...this.visited];
  }

  private async load(id: string): Promise<void> {
    await this.session.open(id);
    const d = this.def();
    const s = this.sheet();
    if (d && s) {
      const last = s.visitedPages[s.visitedPages.length - 1] ?? null;
      this.wiz.start(d, this.session.answers(), last);
    }
  }

  // ───────────────────────── answers ─────────────────────────

  private set(key: string, value: unknown): void {
    const d = this.def();
    const wp = this.page();
    if (!d || !wp || this.isFinal()) return;
    this.cancelAdvance();
    const prev = this.session.answers();
    const next = applyChange(d, prev, setInScope(wp, prev, key, value));
    this.wiz.answers.set(next);
    this.session.setAnswers(next);
    if (this.missingKeys().has(key)) this.missingKeys.update((s) => new Set([...s].filter((k) => k !== key)));
    const field = d && this.findField(key);
    if (
      field &&
      tapCompletes(field.kind, field.config?.['display'] ?? field.config?.['scale']) &&
      this.wiz.completesPage(key)
    ) {
      this.advanceTimer = setTimeout(() => {
        this.advanceTimer = null;
        this.wiz.forward();
      }, AUTO_ADVANCE_MS);
    }
  }

  private findField(key: string): FieldDef | undefined {
    const walk = (fs: FieldDef[]): FieldDef | undefined => {
      for (const f of fs) {
        if (f.key === key) return f;
        for (const o of f.options ?? []) {
          const hit = walk(o.subFields ?? []);
          if (hit) return hit;
        }
      }
      return undefined;
    };
    return walk(this.page()?.page.fields ?? []);
  }

  private cancelAdvance(): void {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
  }

  // ───────────────────────── navigation ─────────────────────────

  protected next(): void {
    this.cancelAdvance();
    this.wiz.forward();
  }

  protected back(): void {
    this.cancelAdvance();
    this.wiz.back();
  }

  /** Jump to a page from the page list (rail or Pages menu). */
  protected goToPage(id: string): void {
    this.cancelAdvance();
    this.menuOpen.set(false);
    this.wiz.goTo(id);
  }

  /** Tap the PF logo: back to Departments (legacy: the logo goes home). Everything is already saved. */
  protected async goHome(): Promise<void> {
    this.cancelAdvance();
    try {
      await this.session.flush();
    } catch {
      /* kept on this device; it saves when back online */
    }
    const to = this.nav.departments(this.sheet()?.patientId);
    await this.router.navigate([to.path], { queryParams: to.queryParams });
  }

  /** Hold the PF logo: a voice note (legacy PF Circle) — a section of your own, open and ready to dictate. */
  protected holdLogo(): void {
    if (!this.sheet() || this.isFinal()) return;
    void this.addOwnSection('Voice note');
  }

  /** Swipe left / right between pages (touch only; never over sliders, inputs or lists). */
  private swipe: { x: number; y: number; t: number } | null = null;
  protected onPointerDown(e: PointerEvent): void {
    const t = e.target as HTMLElement | null;
    if (e.pointerType !== 'touch' || t?.closest('[data-no-swipe], input, textarea, pf-select, .fe-pad')) {
      this.swipe = null;
      return;
    }
    this.swipe = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  }
  protected onPointerUp(e: PointerEvent): void {
    const s = this.swipe;
    this.swipe = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx) * 0.6 || e.timeStamp - s.t > 700) return;
    if (dx < 0) this.next();
    else this.back();
  }

  // ───────────────────────── narrative ─────────────────────────

  protected async onEdit(e: SectionEditEvent): Promise<void> {
    await this.session.editSection(e.sectionId, e.text);
  }

  protected async onClear(sectionId: string): Promise<void> {
    await this.session.clearSection(sectionId);
  }

  /** Rename a section (legacy: the section title is editable). Empty = the case sheet's own title. */
  protected async onRename(s: NarrativeSection): Promise<void> {
    const title = await this.dialog.prompt({
      title: s.own ? 'Name this section' : 'Rename this section',
      message: s.own
        ? 'It prints above your words.'
        : `It prints instead of the case sheet's title${s.formTitle ? ` (“${s.formTitle}”)` : ''}. Leave it empty to use the case sheet's title.`,
      initialValue: s.title,
      placeholder: s.formTitle ?? s.title,
      confirmLabel: 'Save',
    });
    if (title === null || title === undefined) return;
    if (title.trim() === s.title.trim()) return;
    await this.session.renameSection(s.id, title.trim());
  }

  /** Add a section of your own (legacy "additional sections" + PF Circle voice notes); it opens ready to type or dictate. */
  protected async addOwnSection(title?: string): Promise<void> {
    const t =
      title ??
      (await this.dialog.prompt({
        title: 'Add a section of your own',
        message: 'Give it a title. It prints after the case sheet’s sections.',
        initialValue: '',
        placeholder: 'For example: Plan, Advice, Voice note',
        confirmLabel: 'Add',
        required: true,
      }));
    if (!t?.trim()) return;
    this.narrativeOpen.set(true);
    const ack = await this.session.addOwnSection(t.trim(), '');
    if (ack.sectionId) this.openSection.set(ack.sectionId);
  }

  protected async onRemove(s: NarrativeSection): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Remove “${s.title || 'this section'}”?`,
      message: 'Your words in it will be removed from this case sheet.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (ok) await this.session.clearSection(s.id);
  }

  /** Hold Narrative: straight into a new section of your own, titled "Note", ready for dictation. */
  protected holdNarrative(): void {
    void this.addOwnSection('Note');
  }

  // ───────────────────────── keyboard (legacy shortcuts) ─────────────────────────

  protected onKey(e: KeyboardEvent): void {
    if (!this.sheet() || this.isFinal() || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t?.closest('input, textarea, select, [contenteditable="true"], pf-select, .fe-pad, [role="slider"]');
    if (e.key === 'Escape' && this.reportOpen() && !t?.closest('[role="alertdialog"], .pf-dialog')) {
      e.preventDefault();
      this.closeReport();
      return;
    }
    if (this.reportOpen()) return; // the report has its own buttons; page shortcuts wait
    const inDialog = !!t?.closest('[role="dialog"], [role="alertdialog"], .pf-dialog');
    if (inDialog) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      void this.finish();
    } else if (mod && e.key === 'Enter') {
      e.preventDefault();
      this.next();
    } else if (typing) {
      return;
    } else if (e.key === 'ArrowRight' && !mod && !e.altKey) {
      e.preventDefault();
      this.next();
    } else if ((e.key === 'ArrowLeft' && !mod && !e.altKey) || (mod && e.key === 'Backspace')) {
      e.preventDefault();
      this.back();
    } else if (e.key === 'Escape' && this.menuOpen()) {
      e.preventDefault();
      this.menuOpen.set(false);
    } else if (e.key === '?') {
      e.preventDefault();
      void this.showShortcuts();
    } else if ((e.key === 'n' || e.key === 'N') && !mod && !e.altKey) {
      e.preventDefault();
      this.narrativeOpen.set(!this.narrativeOpen());
    }
  }

  protected closeReport(): void {
    this.listen.stop();
    this.reportOpen.set(false);
  }

  protected async showShortcuts(): Promise<void> {
    await this.dialog.alert({
      title: 'Keyboard shortcuts',
      message: 'With a keyboard attached. Holds work with a finger too: hold Next to finish, hold Pages to go back to Departments, hold the PF logo (or Narrative) for a voice note.',
      items: SHORTCUTS.map((k) => `${k.keys} — ${k.does}`),
      confirmLabel: 'OK',
    });
  }

  /** Hold Pages: back home to Departments (legacy tab-nav navigateHomeWithLoading; everything is already saved). */
  protected async holdLeave(): Promise<void> {
    this.menuOpen.set(false);
    await this.goHome();
  }

  // ───────────────────────── conflict ─────────────────────────

  protected async resolveConflict(): Promise<void> {
    const r = await this.dialog.actions({
      title: 'This case sheet was changed on another device',
      message:
        'Someone (or another tablet) saved a newer copy while you were working. Use their copy, or keep yours and save it over theirs?',
      actions: [
        { value: 'theirs', label: 'Use theirs', variant: 'secondary' },
        { value: 'mine', label: 'Keep mine', variant: 'primary' },
      ],
    });
    if (r.action !== 'theirs' && r.action !== 'mine') return;
    await this.session.resolveConflict(r.action);
    this.wiz.answers.set(this.session.answers());
  }

  // ───────────────────────── finish ─────────────────────────

  protected async finish(): Promise<void> {
    const d = this.def();
    if (!d || this.finishing()) return;
    this.cancelAdvance();
    const local = missingRequired(d, this.session.answers());
    if (local.length) {
      await this.showMissing(
        local.map((m) => ({ page: m.pageId, pageTitle: m.pageTitle, field: m.fieldKey, label: m.label })),
      );
      return;
    }
    // legacy "Edit Your Report": the words to check (Edit narrative · PF Listen · PDF preview) before the PDF
    this.menuOpen.set(false);
    this.narrativeOpen.set(false);
    this.reportTab.set('edit');
    this.reportOpen.set(true);
    // The words to check must be the LATEST answers: an answer given just before Finish is still waiting for the
    // autosave debounce, so save it now and fetch the narrative straight after (WP11: the report opened stale).
    void this.session.flush().then(
      () => this.session.refreshNarrative(),
      () => undefined,
    );
  }

  /** "Finish and make the PDF" on Edit your report: the sheet becomes final and its PDF view opens. */
  protected async finishNow(): Promise<void> {
    if (this.finishing()) return;
    this.listen.stop();
    this.finishing.set(true);
    try {
      await this.session.finish();
      this.narrativeOpen.set(false);
      this.reportOpen.set(false);
    } catch (e) {
      this.reportOpen.set(false);
      if (e instanceof FinishRefused) await this.showMissing(e.missing);
      else
        await this.dialog.alert({
          title: "Couldn't finish just now",
          message:
            this.session.saveState() === 'offline'
              ? 'This tablet is offline. Your answers are kept here; finish again when you are back online.'
              : 'Prefrontal could not make the PDF. Your answers are saved; please try again in a moment.',
          confirmLabel: 'OK',
        });
    } finally {
      this.finishing.set(false);
    }
  }

  private async showMissing(missing: MissingAnswer[]): Promise<void> {
    const needsName = missing.some((m) => m.field === 'patient.name');
    const items = missing.map((m) => (m.pageTitle ? `${m.pageTitle}: ${m.label}` : m.label));
    const r = await this.dialog.actions({
      title: missing.length === 1 ? 'One answer is still needed' : `${missing.length} answers are still needed`,
      message: 'These are marked as required on this case sheet.',
      items,
      cancelLabel: 'Not now',
      actions: [
        {
          value: 'go',
          label: needsName && missing.length === 1 ? "Add the patient's name" : 'Take me there',
          variant: 'primary',
        },
      ],
    });
    this.missingKeys.set(new Set(missing.map((m) => m.field)));
    if (r.action !== 'go') return;
    const first = missing.find((m) => m.field !== 'patient.name');
    if (!first && needsName) return this.askPatientName();
    if (!first) return;
    const target =
      this.wiz.pages().find((p) => p.id === first.page) ?? this.wiz.pages().find((p) => p.page.key === first.page);
    if (target) this.wiz.goTo(target.id);
    setTimeout(() => {
      const el = this.body()?.nativeElement.querySelector<HTMLElement>(`[data-field="${CSS.escape(first.field)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector<HTMLElement>('button, input, textarea')?.focus({ preventScroll: true });
    }, 60);
  }

  protected async askPatientName(): Promise<void> {
    const name = await this.dialog.prompt({
      title: "Patient's name",
      message: 'It prints at the top of the case sheet and helps you find it later.',
      initialValue: this.patient().name,
      placeholder: 'Full name',
      confirmLabel: 'Save',
      required: true,
    });
    if (name?.trim()) this.session.setPatient({ name: name.trim() });
  }

  protected async leave(): Promise<void> {
    await this.router.navigateByUrl(this.nav.list(this.sheet()?.patientId));
  }
}
