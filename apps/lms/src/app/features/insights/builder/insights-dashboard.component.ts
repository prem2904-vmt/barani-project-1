import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, debounceTime, map, of, switchMap } from 'rxjs';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import { DialogService } from '../../../core/services/dialog.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { AssistantPanelComponent } from '../../../shared/assistant/assistant-panel.component';
import type {
  AssistantPageContext, AssistantProviderId, AssistantReply, AssistantTurn, ProposalStatus,
} from '../../../shared/assistant/assistant.models';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { DeltaView, deltaView } from '../../../shared/utils/insights-view';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import { InsightsChartComponent } from '../insights-chart.component';
import { InsightsBuilderApiService } from './insights-builder-api.service';
import {
  BandFilters, CHART_LABELS, KpiView, PERIOD_LABELS, SIZE_LABELS, TableView, VISIBILITY_OPTIONS, WIDGET_PERIOD_OPTIONS, addWidget,
  applyBand, chartOptions, emptyRecipe, kpiView, moveWidget, recipesEqual, removeWidget, statusLine, tableView, updateWidget,
  widgetChartHeight, widgetChartOption, widgetIsEmpty, widgetPeriodLabel, widgetPeriodValue,
} from './insights-builder-logic';
import {
  ChartKind, DashboardVisibility, InsightsDashboard, InsightsDashboardSummary, InsightsDashboardVersion, InsightsMetric, InsightsRecipe,
  RecipePeriodPreset, RecipeWidget, WIDGET_SIZES, WidgetData, WidgetSize,
} from './insights-builder.models';

interface Proposal { ref: string; recipe: InsightsRecipe; }

/** Everything one widget card renders, computed once per change. */
interface WidgetVm {
  w: RecipeWidget;
  index: number;
  metric: InsightsMetric | undefined;
  metricLabel: string;
  periodLabel: string;
  data: WidgetData | undefined;
  state: 'loading' | 'ok' | 'hidden' | 'empty' | 'error';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  option: any | null;
  height: string;
  kpi: (KpiView & { delta: DeltaView }) | null;
  table: (TableView & { colDefs: ColDef[] }) | null;
  chartOpts: PfSelectOption<ChartKind>[];
  periodOpts: PfSelectOption<RecipePeriodPreset | 'custom'>[];
  periodValue: RecipePeriodPreset | 'custom';
}

/**
 * "My dashboards" (BETA `assistant`) — one dashboard of the Insights page.
 *
 * View: the widget cards, drawn with the shared business-chart builders (KPI
 * tile, AG-Grid table). The band's period / branch apply to every widget
 * (`applyBand`, preview only — the saved recipe is untouched). A money widget
 * the viewer may not see comes back `hidden` from the server and says so.
 *
 * Edit: plain per-widget controls (chart type limited to the metric's
 * allowed kinds, period, size, move, remove), an "Add a chart" pick, and the
 * shared assistant panel (page 'insights') on the right: a PF Sense answer
 * with a recipe becomes a LIVE PREVIEW plus a plain "changes" list, and the
 * person presses Keep or Undo. Save draft / Publish (visibility Just me /
 * Roles / Whole lab, DialogService confirm); version history with Restore.
 */
@Component({
  selector: 'pf-ins-dashboard',
  standalone: true,
  imports: [AgGridAngular, AssistantPanelComponent, InsightsChartComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insights-dashboard.component.html',
  styleUrl: './insights-dashboard.component.scss',
})
export class InsightsDashboardComponent {
  private readonly api = inject(InsightsBuilderApiService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  /** null = a new dashboard (opens in edit mode). */
  readonly dashboardId = input<string | null>(null);
  readonly band = input<BandFilters>({ period: 'own' });
  readonly saved = output<InsightsDashboardSummary>();
  readonly created = output<string>();
  readonly deleted = output<string>();

  protected readonly sizes = WIDGET_SIZES;
  protected readonly sizeLabels = SIZE_LABELS;
  protected readonly visibilityOptions = VISIBILITY_OPTIONS;

  // ── Layout ───────────────────────────────────────────────────────────
  /** Room for the assistant as a docked column beside the dashboard. */
  readonly dock = signal(this.mq('(min-width: 1100px)', (v) => this.dock.set(v)));

  // ── Data ─────────────────────────────────────────────────────────────
  readonly metrics = signal<InsightsMetric[]>([]);
  private readonly metricById = computed(() => new Map(this.metrics().map((m) => [m.id, m])));
  readonly metricOptions = computed<PfSelectOption<string>[]>(() =>
    this.metrics().map((m) => ({ value: m.id, label: m.label, hint: m.description || undefined })));

  readonly dashboard = signal<InsightsDashboard | null>(null);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly editing = signal(false);
  readonly working = signal<InsightsRecipe>(emptyRecipe());
  readonly visibility = signal<DashboardVisibility>('private');
  readonly roleIds = signal<string[]>([]);
  readonly roles = signal<{ id: string; name: string }[]>([]);
  private rolesAsked = false;
  readonly roleOptions = computed<PfSelectOption<string>[]>(() => this.roles().map((r) => ({ value: r.id, label: r.name })));

  // ── PF Sense proposals ───────────────────────────────────────────────
  readonly proposal = signal<Proposal | null>(null);
  readonly proposals = signal<Record<string, ProposalStatus>>({});
  private propSeq = 0;
  readonly assistantOpen = signal(false);

  /** What the canvas shows: the pending proposal (live preview), the edit, or the saved dashboard. */
  readonly shown = computed<InsightsRecipe>(() =>
    this.proposal()?.recipe ?? (this.editing() ? this.working() : this.dashboard()?.recipe ?? this.working()));

  readonly dirty = computed(() => this.editing() && (
    !this.dashboard() ? this.working().widgets.length > 0 || this.working().title !== emptyRecipe().title
      : !recipesEqual(this.working(), this.dashboard()!.recipe)
        || this.visibility() !== this.dashboard()!.visibility
        || [...this.roleIds()].sort().join() !== [...this.dashboard()!.roleIds].sort().join()));

  readonly statusText = computed(() => {
    const d = this.dashboard();
    return d ? statusLine(d.status, d.visibility) : 'New · not saved yet';
  });
  readonly canEdit = computed(() => this.dashboard()?.canEdit ?? true);

  // ── Preview ──────────────────────────────────────────────────────────
  readonly data = signal<Map<string, WidgetData>>(new Map());
  readonly notes = signal<string[]>([]);
  readonly previewing = signal(false);
  readonly previewError = signal<string | null>(null);
  private readonly preview$ = new Subject<InsightsRecipe>();

  // ── Save / publish / history ─────────────────────────────────────────
  readonly saving = signal(false);
  readonly historyOpen = signal(false);
  readonly versions = signal<InsightsDashboardVersion[]>([]);
  readonly versionsState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly restoring = signal<number | null>(null);

  readonly widgets = computed<WidgetVm[]>(() => {
    const r = this.shown();
    const data = this.data();
    const byId = this.metricById();
    const theme = this.theme.isDark() ? 'dark' : 'light';
    const band = this.band();
    const bandLabel = band.period === 'own' ? null
      : band.period === 'custom' ? 'Custom dates' : PERIOD_LABELS[band.period as RecipePeriodPreset] ?? null;
    return r.widgets.map((w, index) => {
      const d = data.get(w.id);
      const metric = byId.get(w.metric);
      const state: WidgetVm['state'] = !d ? (this.previewError() ? 'error' : 'loading')
        : d.state === 'hidden' ? 'hidden' : d.state === 'error' ? 'error' : widgetIsEmpty(d) ? 'empty' : 'ok';
      const ok = state === 'ok' && d;
      const periodValue = widgetPeriodValue(w);
      return {
        w, index, metric, data: d, state,
        metricLabel: metric?.label ?? humanise(w.metric),
        periodLabel: bandLabel ?? widgetPeriodLabel(w.period),
        option: ok && w.chart !== 'kpi' && w.chart !== 'table' ? widgetChartOption(w.chart, d, theme) : null,
        height: widgetChartHeight(w.chart, d),
        kpi: ok && w.chart === 'kpi' ? { ...kpiView(d, theme), delta: deltaView(d.total ?? null, d.deltaPct ?? null) } : null,
        table: ok && w.chart === 'table' ? this.tableVm(w, d) : null,
        chartOpts: chartOptions(metric, w.chart),
        periodOpts: periodValue === 'custom'
          ? [...WIDGET_PERIOD_OPTIONS, { value: 'custom' as const, label: widgetPeriodLabel(w.period), disabled: true }]
          : WIDGET_PERIOD_OPTIONS,
        periodValue,
      };
    });
  });

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  readonly defaultColDef: ColDef = { sortable: true, resizable: true, flex: 1, minWidth: 90 };

  // ── Assistant hand-off ───────────────────────────────────────────────
  readonly asstContext = computed<AssistantPageContext>(() => ({
    page: 'insights',
    subject: this.shown().title,
    proposals: this.proposals(),
    chat: (req) => this.chat(req),
  }));

  constructor() {
    this.api.metrics().pipe(takeUntilDestroyed()).subscribe({ next: (m) => this.metrics.set(m), error: () => this.metrics.set([]) });

    this.preview$.pipe(
      debounceTime(150),
      switchMap((recipe) => {
        if (!recipe.widgets.length) return of({ widgets: [], notes: [] as string[], error: null as string | null });
        this.previewing.set(true);
        return this.api.preview(recipe).pipe(
          map((p) => ({ ...p, error: null as string | null })),
          catchError((e) => of({ widgets: [], notes: [] as string[], error: messageOf(e, 'The charts couldn’t load. Try again.') })),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe((p) => {
      this.previewing.set(false);
      this.previewError.set(p.error);
      this.data.set(new Map(p.widgets.map((w) => [w.id, w])));
      this.notes.set(p.notes);
    });

    // Which dashboard: load it (or start a new one in edit mode).
    effect(() => {
      const id = this.dashboardId();
      untracked(() => this.open(id));
    });
    // Any change to what's shown or to the band → one preview (debounced).
    effect(() => {
      const r = applyBand(this.shown(), this.band());
      untracked(() => this.preview$.next(r));
    });
  }

  // ═══ Load ═══════════════════════════════════════════════════════════

  private open(id: string | null): void {
    // A new dashboard that was just saved gets its id: same dashboard, keep going.
    if (id && this.dashboard()?.id === id) return;
    this.proposal.set(null);
    this.proposals.set({});
    this.historyOpen.set(false);
    this.data.set(new Map());
    if (!id) {
      this.dashboard.set(null);
      this.working.set(emptyRecipe());
      this.visibility.set('private');
      this.roleIds.set([]);
      this.editing.set(true);
      this.assistantOpen.set(this.dock());
      this.loadState.set('ready');
      return;
    }
    this.loadState.set('loading');
    this.editing.set(false);
    this.api.get(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => { this.setDashboard(d); this.loadState.set('ready'); },
      error: () => this.loadState.set('error'),
    });
  }

  retryLoad(): void { this.open(this.dashboardId()); }

  private setDashboard(d: InsightsDashboard): void {
    this.dashboard.set(d);
    this.working.set(d.recipe);
    this.visibility.set(d.visibility);
    this.roleIds.set([...d.roleIds]);
    if (d.visibility === 'roles') this.loadRoles();
  }

  // ═══ Edit mode ══════════════════════════════════════════════════════

  startEdit(): void {
    const d = this.dashboard();
    if (!d || !d.canEdit) return;
    this.working.set(d.recipe);
    this.visibility.set(d.visibility);
    this.roleIds.set([...d.roleIds]);
    this.editing.set(true);
    this.assistantOpen.set(this.dock());
  }

  async cancelEdit(): Promise<void> {
    if (this.dirty() || this.proposal()) {
      const ok = await this.dialog.confirm({
        title: 'Discard your changes?', message: 'The dashboard goes back to how it was last saved.',
        confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger',
      });
      if (!ok) return;
    }
    this.proposal.set(null);
    const d = this.dashboard();
    if (!d) { this.working.set(emptyRecipe()); return; }
    this.working.set(d.recipe);
    this.visibility.set(d.visibility);
    this.roleIds.set([...d.roleIds]);
    this.editing.set(false);
    this.assistantOpen.set(false);
  }

  /** Manual controls wait while a PF Sense preview is up (Keep or Undo first). */
  readonly locked = computed(() => !!this.proposal());

  private edit(fn: (r: InsightsRecipe) => InsightsRecipe): void {
    if (!this.editing() || this.locked()) return;
    this.working.update(fn);
  }

  setTitle(t: string): void { this.edit((r) => ({ ...r, title: t.slice(0, 120) })); }
  setChart(id: string, chart: ChartKind): void {
    const w = this.working().widgets.find((x) => x.id === id);
    const allowed = this.metricById().get(w?.metric ?? '')?.charts;
    if (allowed?.length && !allowed.includes(chart)) return;
    this.edit((r) => updateWidget(r, id, { chart }));
  }
  setPeriod(id: string, p: RecipePeriodPreset | 'custom'): void {
    if (p === 'custom') return;
    this.edit((r) => updateWidget(r, id, { period: { preset: p } }));
  }
  setSize(id: string, size: WidgetSize): void { this.edit((r) => updateWidget(r, id, { size })); }
  move(id: string, dir: -1 | 1): void { this.edit((r) => moveWidget(r, id, dir)); }
  remove(id: string): void { this.edit((r) => removeWidget(r, id)); }
  /** Bumped after each pick so the "Add a chart" control resets to its placeholder. */
  readonly addKey = signal(0);
  add(metricId: string | null): void {
    const m = metricId ? this.metricById().get(metricId) : undefined;
    if (m) this.edit((r) => addWidget(r, m));
    setTimeout(() => this.addKey.update((k) => k + 1), 0);
  }

  // ═══ PF Sense ═══════════════════════════════════════════════════════

  toggleAssistant(): void { this.assistantOpen.update((v) => !v); }

  /** The panel's transport: send the recipe on screen with the turns; a
   *  proposed recipe becomes the live preview + a changes card. */
  private chat(req: { provider: AssistantProviderId; messages: AssistantTurn[] }): Observable<AssistantReply> {
    return this.api.chat({ provider: req.provider, recipe: this.shown(), messages: req.messages }).pipe(
      map((r) => {
        const out: AssistantReply = { reply: r.reply, suggestions: [], provider: r.provider, model: r.model };
        if (r.recipe && !recipesEqual(r.recipe, this.shown())) {
          const ref = `p${++this.propSeq}`;
          const prev = this.proposal();
          this.proposals.update((s) => ({ ...s, ...(prev ? { [prev.ref]: 'replaced' as const } : {}), [ref]: 'pending' as const }));
          this.proposal.set({ ref, recipe: r.recipe });
          out.suggestions = [{ kind: 'changes', ref, changes: r.changes.length ? r.changes : ['Updated the dashboard'] }];
        }
        return out;
      }),
    );
  }

  keepProposal(ref: string): void {
    const p = this.proposal();
    if (!p || p.ref !== ref) return;
    this.working.set(p.recipe);
    this.proposal.set(null);
    this.proposals.update((s) => ({ ...s, [ref]: 'kept' }));
  }

  undoProposal(ref: string): void {
    const p = this.proposal();
    if (!p || p.ref !== ref) return;
    this.proposal.set(null);
    this.proposals.update((s) => ({ ...s, [ref]: 'undone' }));
  }

  // ═══ Save / publish ═════════════════════════════════════════════════

  setVisibility(v: DashboardVisibility): void {
    this.visibility.set(v);
    if (v === 'roles') this.loadRoles();
  }

  private loadRoles(): void {
    if (this.rolesAsked) return;
    this.rolesAsked = true;
    this.api.roles().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: (r) => this.roles.set(r), error: () => { this.rolesAsked = false; } });
  }

  readonly visibilityBlocked = computed(() => this.visibility() === 'roles' && !this.roleIds().length);
  readonly canSave = computed(() => this.editing() && !this.saving() && !this.locked() && !!this.working().title.trim());

  private body() {
    const r = this.working();
    return {
      title: r.title.trim() || 'Untitled dashboard',
      recipe: { ...r, title: r.title.trim() || 'Untitled dashboard' },
      visibility: this.visibility(),
      roleIds: this.visibility() === 'roles' ? this.roleIds() : [],
      ...(this.dashboard() ? { version: this.dashboard()!.version } : {}),
    };
  }

  /** Create or update; resolves to the saved dashboard (null on failure). */
  private persist(): Promise<InsightsDashboard | null> {
    const d = this.dashboard();
    const req$ = d ? this.api.update(d.id, this.body()) : this.api.create(this.body());
    return new Promise((resolve) => {
      req$.subscribe({
        next: (saved) => resolve(saved),
        error: (e) => { this.toasts.error(messageOf(e, 'Couldn’t save the dashboard. Try again.')); resolve(null); },
      });
    });
  }

  async saveDraft(): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    const wasNew = !this.dashboard();
    const saved = await this.persist();
    this.saving.set(false);
    if (!saved) return;
    this.setDashboard(saved);
    this.toasts.success('Draft saved');
    this.saved.emit(saved);
    if (wasNew) this.created.emit(saved.id);
  }

  async publish(): Promise<void> {
    if (!this.canSave() || this.visibilityBlocked()) return;
    const v = this.visibility();
    const names = this.roles().filter((r) => this.roleIds().includes(r.id)).map((r) => r.name);
    const message = v === 'private' ? 'Only you will see it, under My dashboards.'
      : v === 'roles' ? `People with ${names.length === 1 ? 'the role' : 'these roles'} ${names.join(', ') || 'you picked'} will see it under My dashboards.`
        : 'Everyone in the lab who can open Insights will see it under My dashboards.';
    const ok = await this.dialog.confirm({
      title: `Publish “${this.working().title.trim() || 'Untitled dashboard'}”?`,
      message: `${message} Money charts stay hidden for anyone without “View financial analytics”.`,
      confirmLabel: 'Publish', cancelLabel: 'Not yet', tone: 'primary',
    });
    if (!ok) return;
    this.saving.set(true);
    const wasNew = !this.dashboard();
    const saved = this.dirty() || wasNew ? await this.persist() : this.dashboard();
    if (!saved) { this.saving.set(false); return; }
    this.api.publish(saved.id, { visibility: v, roleIds: v === 'roles' ? this.roleIds() : [] }).subscribe({
      next: (pub) => {
        this.saving.set(false);
        this.setDashboard(pub);
        this.editing.set(false);
        this.assistantOpen.set(false);
        this.toasts.success('Published');
        this.saved.emit(pub);
        if (wasNew) this.created.emit(pub.id);
      },
      error: (e) => {
        this.saving.set(false);
        // The draft did save: keep the screen in step with it.
        this.setDashboard(saved);
        if (wasNew) { this.saved.emit(saved); this.created.emit(saved.id); }
        this.toasts.error(messageOf(e, 'Saved as a draft, but publishing failed. Try Publish again.'));
      },
    });
  }

  async deleteDashboard(): Promise<void> {
    const d = this.dashboard();
    if (!d) return;
    const ok = await this.dialog.confirm({
      title: `Delete “${d.title}”?`, message: 'It disappears for everyone it was shared with. Its history goes too.',
      confirmLabel: 'Delete', cancelLabel: 'Keep it', tone: 'danger',
    });
    if (!ok) return;
    this.api.remove(d.id).subscribe({
      next: () => { this.toasts.success('Dashboard deleted'); this.deleted.emit(d.id); },
      error: (e) => this.toasts.error(messageOf(e, 'Couldn’t delete the dashboard. Try again.')),
    });
  }

  // ═══ History ════════════════════════════════════════════════════════

  openHistory(): void {
    const d = this.dashboard();
    if (!d) return;
    this.historyOpen.set(true);
    this.versionsState.set('loading');
    this.api.versions(d.id).subscribe({
      next: (v) => { this.versions.set(v); this.versionsState.set('ready'); },
      error: () => this.versionsState.set('error'),
    });
  }

  async restore(v: InsightsDashboardVersion): Promise<void> {
    const d = this.dashboard();
    if (!d || this.restoring() != null) return;
    const ok = await this.dialog.confirm({
      title: `Restore version ${v.version}?`,
      message: `The dashboard goes back to “${v.title || d.title}” as saved then. What it shows now stays in the history.`,
      confirmLabel: 'Restore', cancelLabel: 'Cancel', tone: 'primary',
    });
    if (!ok) return;
    this.restoring.set(v.version);
    this.api.restore(d.id, v.version).subscribe({
      next: (r) => {
        this.restoring.set(null);
        this.proposal.set(null);
        this.setDashboard(r);
        this.editing.set(false);
        this.historyOpen.set(false);
        this.toasts.success(`Version ${v.version} restored`);
        this.saved.emit(r);
      },
      error: (e) => { this.restoring.set(null); this.toasts.error(messageOf(e, 'Couldn’t restore that version. Try again.')); },
    });
  }

  versionWhen(v: InsightsDashboardVersion): string {
    if (!v.savedAt) return '';
    const t = new Date(v.savedAt);
    if (Number.isNaN(t.getTime())) return '';
    return t.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  chartLabel(c: ChartKind): string { return CHART_LABELS[c]; }

  // ═══ helpers ════════════════════════════════════════════════════════

  private tableVm(w: RecipeWidget, d: WidgetData): TableView & { colDefs: ColDef[] } {
    const t = tableView(w, d);
    return {
      ...t,
      colDefs: t.columns.map((c) => ({
        field: c.field, headerName: c.headerName, ...(c.num ? { type: 'rightAligned', cellClass: 'pf-num' } : { minWidth: 140, flex: 1.4 }),
      })),
    };
  }

  private mq(query: string, set: (v: boolean) => void): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    const m = window.matchMedia(query);
    const on = (ev: MediaQueryListEvent) => set(ev.matches);
    try { m.addEventListener('change', on); this.destroyRef.onDestroy(() => m.removeEventListener('change', on)); } catch { /* old Safari */ }
    return !!m.matches;
  }
}

/** A metric the viewer's menu doesn't list (e.g. money without permission): "outsourcing_cost" → "Outsourcing cost". */
function humanise(id: string): string {
  const t = id.replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : id;
}

function messageOf(e: unknown, fallback: string): string {
  const m = (e as { message?: unknown })?.message;
  return typeof m === 'string' && m.trim() && !/^Http failure/i.test(m) ? m.slice(0, 200) : fallback;
}
