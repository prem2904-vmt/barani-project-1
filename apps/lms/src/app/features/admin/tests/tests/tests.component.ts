import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { TubeColorEditorComponent } from '../tube-color-editor.component';
import { PfSelectOption } from '../../../../shared/primitives/select.component';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';
import {
  AllCommunityModule,
  ColDef,
  GridApi,
  GridReadyEvent,
  GetRowIdParams,
  ICellRendererParams,
  ModuleRegistry,
  CellValueChangedEvent,
  RowClassParams,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { TEST_PRICING_PERMS } from '../../../../core/auth/route-access';
import { ApiError } from '../../../../shared/models/api-response.model';
import { Test } from '../../../../shared/models/test.model';
import { summarizeRanges } from '../../../../shared/utils/reference-range';
import { tubeColor, TUBE_COLORS } from '../../../../shared/utils/tube-colors';
import { containerFlag, MISSING_CONTAINER_URL, MissingContainerResponse, missingContainerIndex } from '../../../../shared/utils/container-check';
import { ScreenHeaderComponent } from '../../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../../shared/primitives/touch-button.component';
import { OptionGroupsPanelComponent } from './option-groups-panel.component';
import { MicroMastersPanelComponent } from './micro-masters-panel.component';
import { PricingComponent } from '../../pricing/pricing.component';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { inactiveElement } from '../../../../shared/primitives/price-flag.component';
import { isTestEnabled } from '../../../../shared/utils/test-pricing';
import { originBadgeElement } from '../../../../shared/primitives/origin-badge.component';
import {
  canRevertToMaster, originLabel, restoreDefaultsMessage, restoreDefaultsSummary, revertToMasterPath,
} from '../../../../shared/utils/test-origin';
import { compareTestCodes } from '../../../../shared/utils/test-code';
import { departmentKeys, shownDepartmentName } from '../../../../shared/utils/package-department';
import { pendingProposalIds } from '../../../../shared/utils/catalog-proposals';
import { CatalogProposal } from '../../../../shared/models/test.model';
import { CatalogProposalsPanelComponent } from './catalog-proposals-panel.component';
import { PendingChangesPanelComponent } from './pending-changes-panel.component';
import { BetaFeaturesService } from '../../../../core/services/beta-features.service';
import { TmContributorService } from '../../../../core/services/tm-contributor.service';
import { TmProposalsService } from '../../../../core/services/tm-proposals.service';
import { AssistantButtonComponent } from '../../../../shared/assistant/assistant-button.component';
import { AssistantPanelComponent } from '../../../../shared/assistant/assistant-panel.component';
import type { AssistantPageContext } from '../../../../shared/assistant/assistant.models';
import { TM_ALL_PERMS } from '../../../../shared/utils/tm-proposals';
import { HeroBandComponent } from '../../../../shared/components/hero-band/hero-band.component';
import { lineDefaultPartners, type PartnerRow } from '../../../../shared/utils/order-outsourcing';
import { SegmentedComponent, SegmentedOption } from '../../../../shared/primitives/segmented.component';
import { webPointerSignal } from '../../../../shared/utils/pointer-mode';
import { SKELETON_KIT } from '../../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../../shared/utils/min-duration';
import { prefetch, prefetchWhenIdle } from '../../../../shared/utils/prefetch';
import { PageOpenService } from '../../../../core/navigation/page-open.service';
import { afterNextPaint } from '../../../../shared/utils/busy';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { TEST_EDITOR_PREFETCH_KEY, loadTestEditor } from '../test-editor/test-editor.loader';
// (ViewChild refs let the header Create button drive the active panel)

// AG Grid v33+ requires explicit module registration (once per app).
ModuleRegistry.registerModules([AllCommunityModule]);

export type TestType = 'individual' | 'profile' | 'package';

/** Sentinel name for tests without a department assignment. */
const UNASSIGNED = 'Unassigned';

interface DeptBucket {
  key: string;
  id: string | null;
  name: string;
  code: string;
  count: number;
  isActive: boolean;
}

interface DeptRecord {
  id: string;
  name: string;
  code?: string;
  isActive?: boolean;
}

/** AG Grid themes live in ./grid-theme (re-exported for existing importers). */
export { gridThemeDark, gridThemeLight } from './grid-theme';
import { gridThemeDark, gridThemeLight } from './grid-theme';
import { testListUrl } from '../../../../shared/utils/test-list-url';

/** Extended row model supporting manual tree hierarchy for profiles/packages. */
export type TestRow = Test & {
  _key?: string;
  _level?: number;
  _hasChildren?: boolean;
  _expanded?: boolean;
};

/** A reactive media query: returns the current match and calls `on` on
 *  change until the owner is destroyed. Safe where matchMedia is missing. */
function mq(query: string, ref: DestroyRef, on: (m: boolean) => void): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const m = window.matchMedia(query);
  const fn = (e: MediaQueryListEvent) => on(e.matches);
  try { m.addEventListener?.('change', fn); ref.onDestroy(() => m.removeEventListener?.('change', fn)); } catch { /* old engines */ }
  return !!m.matches;
}

/** The side card's remembered state ('1' = collapsed); expanded by default. */
function readCollapsed(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

/** Long text WRAPS to at most two lines with the row growing to fit
 *  (ND §5 "no truncation when there is room"); `.pf-tm-clamp2` caps it at
 *  two lines and the column's tooltip keeps the full text. */
const WRAP2: Pick<ColDef, 'wrapText' | 'autoHeight' | 'cellClass'> = {
  wrapText: true, autoHeight: true, cellClass: 'pf-tm-wrap',
};

/** Plain text cell that wraps to two lines (reference range). A typed
 *  multi-line report text keeps its line breaks (`.pf-tm-lines`); the
 *  tooltip shows every line. */
function clampRenderer(p: ICellRendererParams): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pf-tm-wrapcell';
  const t = document.createElement('span');
  t.className = 'pf-tm-clamp2 pf-tm-lines';
  t.textContent = p.valueFormatted ?? (p.value == null ? '' : String(p.value));
  wrap.appendChild(t);
  return wrap;
}

/** The actions column fits its content: web "Edit" (+ a 28px Revert icon
 *  where one applies); touch 44px icons. */
export function actionsWidth(web: boolean, revert: boolean): { width: number; minWidth: number; maxWidth: number } {
  const w = web ? (revert ? 112 : 84) : (revert ? 112 : 64);
  return { width: w, minWidth: w, maxWidth: w };
}

/** Views the band pill's switch can select. */
type TmView = TestType | 'og' | 'micro' | 'pricing' | 'pending';
/** Test Master status filter (the Active/Inactive switch). */
type TmStatus = 'all' | 'active' | 'inactive';

@Component({
  selector: 'pf-tests',
  standalone: true,
  imports: [
    ...SKELETON_KIT,
    BusyDirective,
    AgGridAngular,
    FormsModule,
    NgTemplateOutlet,
    ScreenHeaderComponent,
    TouchButtonComponent,
    OptionGroupsPanelComponent,
    MicroMastersPanelComponent,
    PricingComponent,
    CatalogProposalsPanelComponent,
    PendingChangesPanelComponent,
    AssistantButtonComponent,
    AssistantPanelComponent,
    HeroBandComponent,
    SegmentedComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tests.component.html',
  styleUrl: './tests.component.scss'
})
export class TestsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  private readonly dialog = inject(DialogService);
  private readonly pricing = inject(TestPricingService);

  readonly views: { value: TestType; label: string }[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'profile',    label: 'Profiles' },
    { value: 'package',    label: 'Packages' },
  ];

  /** Option-groups view — the shared vocabularies panel replaces the grid. */
  readonly ogView = signal(false);
  /** Microbiology view — specimen/antibiotic/CLSI masters replace the grid. */
  readonly microView = signal(false);
  /** Pricing view — the per-tenant pricing table (bulk edit, branch picker
   *  when isolation is ON) replaces the grid. */
  readonly pricingView = signal(false);
  /** Pending view (beta `assistant`, dev only) — changes Cortex / an outside
   *  assistant suggested, reviewed one by one, replace the grid. */
  readonly pendingView = signal(false);
  private readonly beta = inject(BetaFeaturesService);
  private readonly tmProposals = inject(TmProposalsService);
  /** Open suggested changes (pending + changed-since + could-not-apply) — the band badge. */
  readonly pendingCount = signal(0);
  /** A `?view=pending` deep link waits for the beta answer. */
  private wantPending = false;
  @ViewChild(MicroMastersPanelComponent) private microPanel?: MicroMastersPanelComponent;
  @ViewChild(OptionGroupsPanelComponent) private ogPanel?: OptionGroupsPanelComponent;
  private readonly _type = signal<TestType>('individual');
  private readonly _tests = signal<Test[]>([]);
  /** id → problem from GET /api/tests/missing-container (read-only check):
   *  the Container cell flags a test with no usable container as an error to
   *  fix — the tube grouping never guesses one (owner 2026-10-03). */
  private readonly _missingContainer = signal<Map<string, string>>(new Map());
  /** The catalogue's FIRST load has answered (later reloads keep the grid). */
  private _testsLoaded = false;
  private readonly listHold = createLoadHold(true);
  /** Skeleton rows over the grid until the first load lands (held, no flash). */
  readonly listSkeleton = this.listHold.active;
  private readonly pageOpen = inject(PageOpenService);
  private readonly _depts = signal<DeptRecord[]>([]);
  private readonly _selectedDept = signal<string | null>(null);
  readonly saving = signal(false);
  readonly restoring = signal(false);

  // ── Copy-on-write (phase 5): Test Master updates for tests this lab changed ──
  private readonly _proposals = signal<CatalogProposal[]>([]);
  readonly proposals = this._proposals.asReadonly();
  readonly allTests = this._tests.asReadonly();
  /** Distinct pending master updates — from the proposals list and the rows'
   *  own `pendingProposal` markers. */
  readonly pendingProposalCount = computed(() => pendingProposalIds(this._proposals(), this._tests()).size);

  private loadProposals() {
    this.api.get<CatalogProposal[]>('/api/catalog-proposals').subscribe({
      next: l => this._proposals.set(Array.isArray(l) ? l : []),
      // Older servers / no permission: the strip simply stays hidden.
      error: () => this._proposals.set([]),
    });
  }

  /** A proposal was accepted/dismissed: the catalogue and queue both moved. */
  onProposalsChanged() {
    this.loadTests();
    this.loadProposals();
  }

  /** Drop this lab's (or branch's) copy of a master test: the row reads the
   *  Admin Test Master again. Prices are untouched (the pricing table). */
  async revertToMaster(row: TestRow) {
    if (!row?.id || !canRevertToMaster(row)) return;
    const branch = row.origin === 'branch';
    const ok = await this.dialog.confirm({
      title: `Revert ${row.name || 'this test'} to the master?`,
      message: (branch ? 'This branch\'s' : 'Your lab\'s')
        + ' changes to this test are discarded and it reads the Admin Test Master again. Prices stay as they are.',
      confirmLabel: 'Revert to master',
      cancelLabel: 'Keep my changes',
      tone: 'danger',
    });
    if (!ok) return;
    this.api.post(revertToMasterPath(row.id), {}).subscribe({
      next: () => {
        this.toasts.success(`${row.name || 'Test'} now follows the Test Master`);
        this._dirty.update(m => { const n = new Map(m); n.delete(row.id); return n; });
        this.loadTests();
        this.loadProposals();
      },
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }

  /**
   * Replace the tenant's whole catalogue with a fresh clone of the platform
   * default. One explicit danger-toned confirmation — the backend guarantees
   * patient data survives (tests used by orders/bills are parked, never
   * deleted), but the catalogue itself cannot be brought back.
   */
  protected async restoreDefaults(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Restore the default Test Master?',
      message: restoreDefaultsMessage('lab'),
      confirmLabel: 'Restore to default',
      cancelLabel: 'Keep my catalogue',
      tone: 'danger',
    });
    if (!ok) return;
    this.restoring.set(true);
    this.api.post<{ deleted: number; parked: number; cloned: number; mode?: string }>('/api/tests/restore-defaults', {}).subscribe({
      next: r => {
        this.restoring.set(false);
        this._dirty.set(new Map());
        this._priceDirty.set(new Map());
        this.toasts.success(restoreDefaultsSummary(r));
        this.loadTests();
        this.loadDepartments();
      },
      error: (e: unknown) => {
        this.restoring.set(false);
        const msg = (e as ApiError)?.error?.message ?? (e as { message?: string })?.message;
        this.toasts.error(msg ? `Restore failed — ${msg}` : 'Restore failed — nothing was changed.');
      }
    });
  }

  /** Pending edits keyed by the row's REAL test id (`data.id`), each a map of
   *  `{ field: newValue }` merged across cells. Flushed by `saveAll()`. */
  private readonly _dirty = signal<Map<string, Record<string, unknown>>>(new Map());
  /** Pending PRICE edits (testId → ₹). Prices never ride the test PATCH: they
   *  flush through the pricing table's bulk endpoint (single source). */
  private readonly _priceDirty = signal<Map<string, number>>(new Map());
  readonly dirtyCount = computed(() =>
    new Set([...this._dirty().keys(), ...this._priceDirty().keys()]).size);

  readonly isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
  /** Row actions: TEXT on web, ICON on touch (PF-PATTERN .pf-rowact). */
  readonly web = webPointerSignal();
  readonly isCoarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  // ── DEPARTMENTS side card (PF-PATTERN "two jobs on one screen") ────────
  // The departments filter is the SIDE card on the LEFT (a filter companion:
  // filter first, then content; BILLING's anatomy); the grid is the MAIN
  // card on the right. It collapses to a slim strip — remembered
  // per user — and on narrow widths it is a bottom sheet opened from the
  // band pill's "Departments" button.
  private readonly auth = inject(AuthService, { optional: true });
  /** Price cells + the Pricing view are editable only with a pricing grant
   *  (manage_tests / manage_test_pricing — the server enforces the same on
   *  PATCH api/tests/prices/bulk). No session / no permission list (unit
   *  hosts) = unrestricted. */
  readonly canEditPrices = computed(() => {
    const a = this.auth;
    // A Test Master contributor edits prices too; TestPricingService sends them for approval.
    return !a || typeof a.hasAnyPermission !== 'function' || a.hasAnyPermission(TEST_PRICING_PERMS) || this.contributors.isContributor();
  });
  private readonly destroyRef = inject(DestroyRef);
  /** ≤900px: no room for a side column — the card becomes a sheet. */
  readonly narrow = signal(mq('(max-width: 900px)', this.destroyRef, m => this.narrow?.set(m)));
  /** The departments sheet (narrow widths only). */
  readonly deptSheetOpen = signal(false);
  readonly sideCollapsed = signal(readCollapsed(this.collapseKey()));
  toggleSide() {
    const next = !this.sideCollapsed();
    this.sideCollapsed.set(next);
    try { localStorage.setItem(this.collapseKey(), next ? '1' : '0'); } catch { /* private mode */ }
  }
  private collapseKey(): string {
    let uid = '';
    try { uid = this.auth?.user()?.id ?? ''; } catch { /* no session */ }
    return 'pf:tm:depts-collapsed:' + (uid || 'anon');
  }
  openDeptSheet() { this.deptSheetOpen.set(true); }
  closeDeptSheet() { this.deptSheetOpen.set(false); }
  /** Row tap: filter the grid; in the sheet, picking closes it. */
  pickDept(key: string | null) {
    this.selectDept(key);
    if (this.narrow()) this.deptSheetOpen.set(false);
  }

  readonly type = this._type.asReadonly();
  readonly selectedDept = this._selectedDept.asReadonly();

  /** Set of expanded row PATH keys (`_key`) for the manual tree. */
  readonly expanded = signal<Set<string>>(new Set<string>());

  /** Toggle a tree row's expanded state by its stable PATH key. */
  toggleRow(key: string) {
    this.expanded.update(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  /** Passed to the grid so renderers can call back into the component. */
  readonly gridContext = {
    toggle: (key: string) => this.toggleRow(key),
    toggleActive: (row: TestRow) => this.toggleTestActive(row),
    revert: (row: TestRow) => this.revertToMaster(row),
  };

  /** The Active/Inactive switch, saved immediately. It reads and sets the ONE
   *  switch state (`isTestEnabled`: isActive AND offered here) — reference mode
   *  stores "off" as not-offered and keeps isActive true, so flipping only
   *  isActive made the row vanish from the default view and come back as ON.
   *  The row never leaves the list: an inactive test stays listed (greyed,
   *  still editable) and the status filter finds it. The server's row replaces
   *  the optimistic one. */
  toggleTestActive(row: TestRow) {
    if (!row.id) return;
    const id = row.id;
    const prev = this._tests().find(t => t.id === id);
    const next = !isTestEnabled(row);
    const testName = row.name || 'Test';
    const flip = (on: boolean) => (t: Test): Test => ({
      ...t, isEnabled: on,
      // Clone mode: the row itself; reference mode: the pricing flag.
      isActive: on ? true : t.catalogMode === 'reference' ? t.isActive : false,
      isOffered: on ? true : t.catalogMode === 'reference' ? false : t.isOffered,
    });

    this._tests.update(list => list.map(t => (t.id === id ? flip(next)(t) : t)));
    this.api.patch<Test>(`/api/tests/${id}`, { isActive: next }).subscribe({
      next: saved => {
        // Keep the row under its listed id (a reference-mode edit may answer
        // with the effective row); take the server's switch state.
        if (saved && typeof saved === 'object') {
          this._tests.update(list => list.map(t => (t.id === id
            ? { ...t, isActive: saved.isActive ?? t.isActive, isOffered: saved.isOffered ?? t.isOffered,
                isEnabled: isTestEnabled(saved) }
            : t)));
        }
        this.toasts.success(next ? `'${testName}' is active again` : `'${testName}' is inactive — find it under Inactive`);
      },
      error: e => {
        if (prev) this._tests.update(list => list.map(t => (t.id === id ? prev : t)));
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  /** Stable row identity keeps expansion state + row animation coherent. */
  readonly getRowId = (p: GetRowIdParams<TestRow>) => p.data._key ?? p.data.id;

  /** An inactive test stays listed, its data greyed — the switch and Edit
   *  stay at full strength so it can be turned back on (scss: .pf-tm-row--off). */
  protected getRowClass = (p: RowClassParams<TestRow>): string | undefined =>
    p.data && p.data.id && !isTestEnabled(p.data) ? 'pf-tm-row--off' : undefined;

  private gridApi?: GridApi<TestRow>;

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));

  /** Status filter (card header): All (default — inactive tests listed,
   *  greyed, so nothing ever disappears) · Active · Inactive. */
  readonly statusFilter = signal<TmStatus>('all');
  private readonly ofType = computed(() => this._tests().filter(t => t.type === this._type()));
  readonly inactiveCount = computed(() => this.ofType().filter(t => !isTestEnabled(t)).length);
  readonly statusOptions = computed<SegmentedOption<TmStatus>[]>(() => {
    const all = this.ofType().length;
    const off = this.inactiveCount();
    return [
      { value: 'all', label: 'All', count: all, iconPath: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'] },
      { value: 'active', label: 'Active', count: all - off, iconPath: ['M20 6 9 17l-5-5'] },
      { value: 'inactive', label: 'Inactive', count: off, iconPath: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M5.6 5.6l12.8 12.8'] },
    ];
  });

  /** Outsourcing filter (OPS-112): everything, or only rows sent to a partner
   *  lab — the test's own partner, or (profile / package) a member's. */
  readonly outsourcedOnly = signal(false);
  /** Referral labs, for the partner NAME (best-effort; "Partner lab" otherwise). */
  readonly partners = signal<PartnerRow[]>([]);
  private partnerIdsOf(t: Test): string[] {
    const byId = this.byId();
    return lineDefaultPartners(t as never, id => byId.get(id) as never);
  }
  /** "Quest, Metropolis" — read-only text for the Outsourced column / tooltip. */
  readonly partnerLabel = (t: Test | undefined | null): string => {
    if (!t) return '';
    const names = this.partnerIdsOf(t).map(id => this.partners().find(p => p.id === id)?.name ?? 'Partner lab');
    return names.join(', ');
  };
  readonly outsourcedCount = computed(() => this.ofType().filter(t => this.partnerIdsOf(t).length > 0).length);
  readonly outsourcingOptions = computed<SegmentedOption<'all' | 'outsourced'>[]>(() => [
    { value: 'all', label: 'All sources' },
    { value: 'outsourced', label: 'Outsourced only', count: this.outsourcedCount(),
      iconPath: ['M7 17 17 7', 'M8 7h9v9'] },
  ]);

  readonly typeTests = computed(() => {
    const st = this.statusFilter();
    const out = this.outsourcedOnly();
    return this.ofType().filter(t => (st === 'all' || (st === 'active') === isTestEnabled(t))
      && (!out || this.partnerIdsOf(t).length > 0));
  });

  readonly search = signal('');
  private matchesSearch(t: Test, q: string): boolean {
    return (t.name ?? '').toLowerCase().includes(q)
        || (t.testCode ?? '').toLowerCase().includes(q)
        || ((t as { shortName?: string }).shortName ?? '').toLowerCase().includes(q);
  }

  /** Every loaded row by id (package → member department lookups). */
  private readonly byId = computed(() => new Map(this._tests().map(t => [t.id, t] as const)));

  /** Department keys a row counts under. A package has no department of its
   *  own: it is listed under every department its members are in (see
   *  shared/utils/package-department), never under "Unassigned". */
  private deptKeys(t: Test): string[] {
    return departmentKeys(t, this.byId(), UNASSIGNED);
  }

  readonly departments = computed<DeptBucket[]>(() => {
    const countByName = new Map<string, number>();
    let unassigned = 0;
    for (const t of this.typeTests()) {
      for (const name of this.deptKeys(t)) {
        if (name === UNASSIGNED) unassigned++;
        else countByName.set(name, (countByName.get(name) ?? 0) + 1);
      }
    }

    const buckets: DeptBucket[] = this._depts().map(d => ({
      key: d.name,
      id: d.id,
      name: d.name,
      code: d.code?.trim() || '',
      count: countByName.get(d.name) ?? 0,
      isActive: d.isActive ?? true,
    }));

    const covered = new Set(this._depts().map(d => d.name));
    for (const [name, count] of countByName) {
      if (!covered.has(name)) buckets.push({ key: name, id: null, name, code: '', count, isActive: true });
    }
    if (unassigned > 0) {
      buckets.push({ key: UNASSIGNED, id: null, name: UNASSIGNED, code: '', count: unassigned, isActive: true });
    }
    return buckets.sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly rowData = computed<TestRow[]>(() => {
    const q = this.search().trim().toLowerCase();
    if (this._type() === 'individual') {
      const dep = this._selectedDept();
      let tests = this.typeTests();
      if (dep) tests = tests.filter(t => (t.department?.name?.trim() || UNASSIGNED) === dep);
      if (q) tests = tests.filter(t => this.matchesSearch(t, q));
      return tests;
    }
    return this.buildTree(q);
  });

  private memberIds(test: Test): string[] {
    if (!test.parameters) return [];
    try {
      const parsed = JSON.parse(test.parameters) as { items?: Array<{ testId?: string }> };
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      return items.map(it => (it?.testId ?? '').trim()).filter(id => id.length > 0);
    } catch {
      return [];
    }
  }

  private buildTree(q = ''): TestRow[] {
    const all = this._tests();
    const byId = new Map<string, Test>();
    for (const t of all) byId.set(t.id, t);

    const topType = this._type();
    const dep = this._selectedDept();
    let roots = all.filter(t => t.type === topType);
    if (this.outsourcedOnly()) roots = roots.filter(t => this.partnerIdsOf(t).length > 0);
    if (dep) roots = roots.filter(t => this.deptKeys(t).includes(dep));
    if (q) {
      roots = roots.filter(t =>
        this.matchesSearch(t, q)
        || this.memberIds(t).some(id => {
          const m = byId.get(id);
          return !!m && this.matchesSearch(m, q);
        }));
    }
    // Natural code order (BIO002 < BIO010 < BIO901 < BIO1000); codeless rows
    // (packages) after, by name.
    roots = [...roots].sort((a, b) =>
      compareTestCodes(a.testCode, b.testCode) || (a.name ?? '').localeCompare(b.name ?? ''));

    const expanded = this.expanded();
    const out: TestRow[] = [];

    const emit = (test: Test, parentKey: string | null, level: number, path: Set<string>) => {
      const key = parentKey ? `${parentKey}>${test.id}` : test.id;
      const isBundle = test.type === 'profile' || test.type === 'package';
      const members = isBundle ? this.memberIds(test) : [];
      const hasChildren = isBundle && members.length > 0;
      const isExpanded = hasChildren && expanded.has(key);

      out.push({ ...test, _key: key, _level: level, _hasChildren: hasChildren, _expanded: isExpanded });

      if (isExpanded) {
        const nextPath = new Set(path);
        nextPath.add(test.id);
        for (const mid of members) {
          if (nextPath.has(mid)) continue;
          const child = byId.get(mid);
          if (!child) continue;
          emit(child, key, level + 1, nextPath);
        }
      }
    };

    for (const r of roots) emit(r, null, 0, new Set<string>());
    return out;
  }

  readonly deptOptions = computed<PfSelectOption[]>(() => {
    const map = new Map<string, PfSelectOption>();
    for (const t of this._tests()) {
      if (!shownDepartmentName(t)) continue;   // a package carries no department
      if (t.department?.id && !map.has(t.department.id)) {
        map.set(t.department.id, { value: t.department.id, label: t.department.name + (t.department.code ? ' · ' + t.department.code : '') });
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly individualOptions = computed<PfSelectOption[]>(() =>
    this._tests().filter(t => t.type === 'individual')
      .map(t => ({ value: t.id, label: (t.testCode ? t.testCode + ' · ' : '') + t.name }))
      .sort((a, b) => a.label.localeCompare(b.label)));

  readonly testAndProfileOptions = computed<PfSelectOption[]>(() =>
    this._tests().filter(t => t.type === 'individual' || t.type === 'profile')
      .map(t => ({ value: t.id, label: (t.type === 'profile' ? '[Profile] ' : '') + (t.testCode ? t.testCode + ' · ' : '') + t.name }))
      .sort((a, b) => a.label.localeCompare(b.label)));

  readonly defaultColDef: ColDef<TestRow> = {
    filter: true,
    sortable: true,
    resizable: true,
    flex: 1,
    minWidth: 110,
  };

  protected phoneTrim(cols: ColDef<TestRow>[]): ColDef<TestRow>[] {
    if (!this.isPhone) return cols;
    const drop = new Set(['shortName', 'section', 'tubeColor', 'unit', 'tatHours', 'status', 'standardCode', 'outsourced']);
    return cols.filter(c => !drop.has(String(c.field ?? c.colId ?? '')));
  }

  /** Any row of this view offers "Revert to master"? Sizes the actions
   *  column (from the loaded list, not the filtered rows, so typing a
   *  search never re-lays the columns out). */
  readonly anyRevert = computed(() => this._tests().some(t => t.type === this._type() && canRevertToMaster(t as TestRow)));

  readonly colDefs = computed<ColDef<TestRow>[]>(() => {
    const view = this._type();
    this.partners();   // names resolve once the referral labs have loaded

    if (view === 'individual') {
      return [
        {
          // Codes are server-assigned and never change — not editable here.
          headerName: 'Code', field: 'testCode', editable: false, width: 116, minWidth: 100, maxWidth: 130, sort: 'asc', pinned: 'left',
          comparator: (a: string | null, b: string | null) => compareTestCodes(a, b),
          cellRenderer: this.codeCellRenderer,
          tooltipValueGetter: p => {
            const tColor = tubeColor(p.data?.tubeColor);
            return tColor ? `Container: ${tColor.label}` : undefined;
          },
        },
        // Names WRAP (up to 2 lines, auto row height) instead of an ellipsis
        // (ND §5); the full name stays in the tooltip.
        { headerName: 'Name', field: 'name', editable: true, width: 250, minWidth: 200, pinned: 'left',
          ...WRAP2, cellRenderer: this.plainNameRenderer, tooltipField: 'name' },
        this.outsourcedColDef(),
        this.originColDef(),
        { headerName: 'Short', field: 'shortName', editable: true, flex: 1, minWidth: 110 },
        { headerName: 'Section', field: 'section', editable: true, flex: 1, minWidth: 120 },
        {
          headerName: 'Container', field: 'tubeColor', editable: true, flex: 1.3, minWidth: 150,
          ...WRAP2, tooltipValueGetter: p => tubeColor(p.data?.tubeColor)?.label,
          cellRenderer: this.containerRenderer,
          cellEditor: TubeColorEditorComponent,
          cellEditorParams: {
            choices: TUBE_COLORS.map(c => ({ key: c.key, label: c.label, hex: c.hex })),
          },
        },
        this.derivedRangeColDef(),
        this.derivedUnitColDef(),
        {
          headerName: 'TAT (h)', field: 'tatHours', editable: true, minWidth: 100, maxWidth: 120,
          cellEditor: 'agNumberCellEditor',
        },
        this.priceColDef(this.canEditPrices()),
        // Standard code (LOINC) — plain free text like Short / Section, set on the master catalogue.
        { headerName: 'Standard code (LOINC)', field: 'standardCode', editable: true, minWidth: 140, maxWidth: 180 },
        this.statusColDef(),
        this.actionsColDef(),
      ];
    }

    return [
      {
        headerName: 'Name', colId: 'treeName', flex: 3, minWidth: 260, pinned: 'left',
        sortable: false, filter: false, editable: false, sort: null,
        tooltipValueGetter: p => p.data?.name,
        cellRenderer: this.nameCellRenderer,
        valueGetter: p => p.data?.name,
      },
      { headerName: 'Code', field: 'testCode', minWidth: 120, maxWidth: 160, sortable: false, filter: false, sort: null, pinned: 'left', cellRenderer: this.codeCellRenderer },
      { ...this.outsourcedColDef(), sortable: false, filter: false },
      { ...this.originColDef(), sortable: false, filter: false },
      {
        headerName: 'Kind', colId: 'kind', minWidth: 110, maxWidth: 140, sortable: false, filter: false,
        valueGetter: p => this.kindLabel(p.data),
      },
      { headerName: 'Short', field: 'shortName', editable: true, minWidth: 110, sortable: false, filter: false },
      {
        headerName: 'Container', field: 'tubeColor', editable: true, flex: 1.3, minWidth: 150, sortable: false, filter: false,
        ...WRAP2, tooltipValueGetter: p => tubeColor(p.data?.tubeColor)?.label,
        cellRenderer: this.containerRenderer,
        cellEditor: TubeColorEditorComponent,
        cellEditorParams: {
          choices: TUBE_COLORS.map(c => ({ key: c.key, label: c.label, hex: c.hex })),
        },
      },
      { ...this.derivedRangeColDef(), minWidth: 180, sortable: false, filter: false },
      { ...this.derivedUnitColDef(), sortable: false, filter: false },
      { ...this.priceColDef(this.canEditPrices()), sortable: false, filter: false },
      { headerName: 'Standard code (LOINC)', field: 'standardCode', editable: true, minWidth: 140, maxWidth: 180, sortable: false, filter: false },
      this.statusColDef(),
      this.actionsColDef(),
    ];
  });

  private codeCellRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;min-width:0;gap:8px;';
    if (!params.data) return wrap;

    const codeSpan = document.createElement('span');
    codeSpan.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    codeSpan.textContent = params.value ?? params.data.testCode ?? '';
    wrap.appendChild(codeSpan);

    return wrap;
  };

  /** Reference range = DERIVED from the test's values (the bands that drive
   *  flagging) — read-only here; ranges are edited in the test editor. The
   *  server's `derivedReferenceRange` wins; older payloads derive client-side
   *  from the first value's bands. The flat column is never shown. */
  private derivedRangeColDef(): ColDef<TestRow> {
    return {
      headerName: 'Reference range', colId: 'referenceRange', minWidth: 220, flex: 3,
      editable: false, ...WRAP2, cellRenderer: clampRenderer,
      valueGetter: p => this.derivedRange(p.data),
      tooltipValueGetter: p => this.derivedRange(p.data) || 'Comes from the test\'s values — edit ranges in the test editor',
    };
  }

  /** Unit = DERIVED from the values (the printed unit), read-only. */
  private derivedUnitColDef(): ColDef<TestRow> {
    return {
      headerName: 'Unit', colId: 'unit', flex: 0.8, minWidth: 100, editable: false,
      valueGetter: p => this.derivedUnit(p.data),
      tooltipValueGetter: () => 'Comes from the test\'s values — edit it in the test editor',
    };
  }

  /** Master / Customised / Branch / Own test chip (+ a dot when a Test
   *  Master update is waiting for this row). */
  /** Partner lab the test is sent to (Test Master default) — read-only; set in the test editor. */
  private outsourcedColDef(): ColDef<TestRow> {
    return {
      headerName: 'Outsourced to', colId: 'outsourced', minWidth: 160, flex: 1.2, editable: false, ...WRAP2,
      valueGetter: p => this.partnerLabel(p.data) || '',
      tooltipValueGetter: p => this.partnerLabel(p.data) || undefined,
    };
  }

  private originColDef(): ColDef<TestRow> {
    return {
      headerName: 'Origin', colId: 'origin', minWidth: 120, maxWidth: 150, editable: false,
      valueGetter: p => originLabel(p.data),
      cellRenderer: this.originRenderer,
    };
  }

  private originRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;height:100%;min-width:0;';
    if (!params.data) return wrap;
    wrap.appendChild(originBadgeElement(params.data.origin, params.data.catalogMode));
    if (params.data.pendingProposal?.id) {
      const dot = document.createElement('span');
      dot.title = 'A Test Master update is waiting for this test';
      dot.setAttribute('aria-label', dot.title);
      dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#8b5cf6;flex:0 0 auto;';
      wrap.appendChild(dot);
    }
    return wrap;
  };

  private statusColDef(): ColDef<TestRow> {
    return {
      headerName: 'Status', colId: 'status', field: 'isActive',
      minWidth: 95, maxWidth: 110, editable: false, sortable: true, filter: false,
      cellRenderer: this.statusSwitchRenderer,
      valueGetter: p => (p.data && isTestEnabled(p.data) ? 'Active' : 'Inactive'),
    };
  }

  private statusSwitchRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const data = params.data;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;height:100%;';
    if (!data || !data.id) return wrap;

    const isActive = isTestEnabled(data);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(isActive));
    btn.title = isActive ? 'Deactivate' : 'Activate';
    btn.setAttribute('aria-label', (isActive ? 'Deactivate ' : 'Activate ') + (data.name || 'test'));
    btn.style.cssText = 'position:relative;flex-shrink:0;width:36px;height:20px;border-radius:999px;padding:0;cursor:pointer;'
      + 'transition:background 0.15s, border-color 0.15s;outline:none;'
      + (isActive
          ? 'background:var(--pf-switch-on, #7c3aed);border:1px solid var(--pf-switch-on, #7c3aed);'
          : 'background:var(--pf-toggle-off, #e3e7eb);border:1px solid var(--pf-toggle-off, #e3e7eb);');

    const knob = document.createElement('span');
    knob.style.cssText = 'position:absolute;top:1px;left:1px;width:16px;height:16px;border-radius:50%;'
      + 'box-shadow:0 1px 2px rgba(0,0,0,0.3);transition:transform 0.15s, background 0.15s;'
      + (isActive
          ? 'transform:translateX(16px);background:#ffffff;'
          : 'transform:translateX(0px);background:#94a3b8;');
    btn.appendChild(knob);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (data?.id) {
        (params.context as { toggleActive?: (row: TestRow) => void })?.toggleActive?.(data);
      }
    });

    wrap.appendChild(btn);
    return wrap;
  };

  /** Price cell = the acting branch's EFFECTIVE price from the pricing
   *  table. Edits are held in `_priceDirty` and flushed through the bulk
   *  price endpoint — never the test row (a price is not a test change).
   *  Shown as just the price ("₹1"): plain text, right-aligned, tabular. */
  private priceColDef(editable: boolean): ColDef<TestRow> {
    return {
      headerName: 'Price (₹)', field: 'price', editable, minWidth: 110, maxWidth: 140,
      cellEditor: 'agNumberCellEditor',
      valueParser: p => { const n = Number(p.newValue); return Number.isFinite(n) ? Math.max(0, n) : p.oldValue; },
      valueFormatter: p => (p.value == null ? '' : '₹' + Number(p.value).toLocaleString('en-IN')),
      type: 'rightAligned',
      cellStyle: { fontVariantNumeric: 'tabular-nums' },
    };
  }

  /** Individual-view name cell: the name plus a quiet "Not offered here" tag. */
  private plainNameRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'pf-tm-wrapcell';
    const name = document.createElement('span');
    name.className = 'pf-tm-clamp2';
    name.textContent = params.value ?? params.data?.name ?? '';
    wrap.appendChild(name);
    if (params.data && !isTestEnabled(params.data)) wrap.appendChild(inactiveElement());
    return wrap;
  };

  private kindLabel(t?: TestRow): string {
    if (!t) return '';
    if (t.type === 'profile') return 'Profile';
    if (t.type === 'package') return 'Package';
    return 'Test';
  }

  private containerRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const tColor = tubeColor(params.data?.tubeColor);

    const wrap = document.createElement('div');
    wrap.className = 'pf-tm-wrapcell';

    const dot = document.createElement('span');
    // A tube-cap colour is DATA (ND §2 functional exception), not decoration.
    dot.dataset['functional'] = 'tube-cap';
    dot.style.cssText = 'flex:0 0 auto;width:11px;height:11px;border-radius:50%;box-sizing:border-box;background:'
      + (tColor ? tColor.hex : 'transparent')
      + (tColor ? ';' : ';border:1px solid rgba(148,163,184,0.5);');
    wrap.appendChild(dot);

    const text = document.createElement('span');
    text.className = 'pf-tm-clamp2';
    text.textContent = tColor ? tColor.label : '—';
    // Missing / unknown container: an error to fix, shown — never guessed.
    const flag = !tColor && params.data?.id
      ? containerFlag(this._missingContainer().get(params.data.id), params.data.sampleType) : null;
    if (flag) {
      text.textContent = flag.label;
      text.classList.add('pf-tm-container-missing');
      wrap.title = flag.title;
      wrap.setAttribute('aria-label', `${flag.label}. ${flag.title}`);
    }
    wrap.appendChild(text);
    return wrap;
  };

  private actionsRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const data = params.data;
    const wrap = document.createElement('div');
    wrap.className = 'pf-tm-acts';
    const web = this.web();
    // Kit row action: compact TEXT "Edit" on web, a 44px neutral ICON on
    // touch (label kept for AT via aria-label + the visually-hidden
    // .pf-rowact__t). Revert — only where it applies — is always a quiet
    // icon (a compact 28px one on web) with its words in the tooltip.
    const act = (label: string, aria: string, path: string, run: () => void, icon = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pf-rowact' + (!web || icon ? ' pf-rowact--icon' : '') + (web && icon ? ' pf-tm-rowact-sm' : '');
      b.title = aria;
      b.setAttribute('aria-label', aria);
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
      const t = document.createElement('span');
      t.className = 'pf-rowact__t';
      t.textContent = label;
      b.appendChild(t);
      b.addEventListener('click', e => { e.stopPropagation(); run(); });
      return b;
    };
    // "Edit" opens the lazy test editor: warm its code on hover / focus, and
    // mark the pressed button busy in the same frame (cleared when the
    // navigation settles — see PageOpenService.markSource).
    const warm = () => { void prefetch(TEST_EDITOR_PREFETCH_KEY, loadTestEditor); };
    const edit = act('Edit', 'Edit ' + (data?.name || 'test'),
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
      () => {
        if (!data?.id) return;
        const id = data.id;
        // Paint the pressed state FIRST, then navigate: opening the editor
        // is heavy synchronous work that would otherwise swallow the frame.
        this.pageOpen.markSource(edit);
        afterNextPaint(() => this.editTest(id));
      });
    edit.addEventListener('pointerenter', warm);
    edit.addEventListener('focus', warm);
    wrap.appendChild(edit);
    if (data && canRevertToMaster(data)) {
      wrap.appendChild(act('Revert', 'Revert ' + (data.name || 'test') + ' to master',
        '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>',
        () => (params.context as { revert?: (row: TestRow) => void })?.revert?.(data), true));
    }
    return wrap;
  };

  private actionsColDef(): ColDef<TestRow> {
    return {
      headerName: '', colId: 'actions', cellRenderer: this.actionsRenderer, cellClass: 'pf-tm-acts-cell',
      editable: false, sortable: false, filter: false, resizable: false, suppressSizeToFit: true,
      // Fits its content — no empty gap before "Edit".
      ...actionsWidth(this.web(), this.anyRevert()),
      pinned: 'right',
    };
  }

  private nameCellRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const data = params.data;
    const wrap = document.createElement('div');
    wrap.className = 'pf-tm-tree-cell';
    wrap.style.paddingLeft = `${(data?._level ?? 0) * 18}px`;

    if (data?._hasChildren) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pf-tm-tree-toggle' + (data._expanded ? ' pf-open' : '');
      btn.setAttribute('aria-label', data._expanded ? 'Collapse' : 'Expand');
      btn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const key = data._key;
        if (key) (params.context as { toggle?: (k: string) => void })?.toggle?.(key);
      });
      wrap.appendChild(btn);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'pf-tm-tree-spacer';
      wrap.appendChild(spacer);
    }

    const label = document.createElement('span');
    label.className = 'pf-tm-tree-name' + (data?._hasChildren ? ' pf-tm-tree-name--bundle' : '');
    label.textContent = data?.name ?? '';
    wrap.appendChild(label);
    if (data && data.id && !isTestEnabled(data)) wrap.appendChild(inactiveElement());
    return wrap;
  };

  /** The Pending view exists only with beta `assistant` on (console pf.assistant(), server flag, dev)
   *  and a Test Master or pricing permission (price changes are visible to pricing-only roles). */
  readonly pendingOn = computed(() => {
    const a = this.auth;
    if (!this.beta.enabled('assistant')) {
      // Settings access (owner 2026-11-18): contributors' changes wait here for a Test Master admin — no beta needed.
      const lvl = a && typeof a.settingsLevel === 'function' ? a.settingsLevel('test_master') : 'none';
      return lvl === 'contributor' || lvl === 'admin';
    }
    return !a || typeof a.hasAnyPermission !== 'function' || a.hasAnyPermission([...TM_ALL_PERMS]);
  });
  /** Cortex "Read a rate card" + the assistant panel: beta `assistant` only (dev), never through Settings access. */
  readonly assistantOn = computed(() => this.beta.enabled('assistant') && this.pendingOn());
  /** Settings access: a Test Master CONTRIBUTOR — Save sends for approval; no Restore to default, no direct writes. */
  private readonly contributors = inject(TmContributorService);
  readonly contributorMode = this.contributors.isContributor();
  readonly sendWord = this.contributorMode ? 'Send for approval' : 'Save changes';

  /** Department names for the Pending view's before → after. */
  readonly pendingDepartments = computed(() => this._depts().map(d => ({ id: d.id, name: d.name })));

  /** A pending change was approved: the catalogue moved. */
  onPendingApplied() {
    this.loadTests();
    this.loadProposals();
  }

  loadPendingCount() {
    if (!this.pendingOn()) { this.pendingCount.set(0); return; }
    this.tmProposals.openCount().subscribe(n => this.pendingCount.set(n));
  }

  /** Cortex panel (Test Master assistant + "Read a rate card"; beta `assistant`, dev only). */
  readonly assistantOpen = signal(false);
  readonly asstContext = computed<AssistantPageContext>(() => ({ page: 'test-master', subject: 'Tests and prices', attachments: 'rate-card' }));
  /** Pending narrowed to one rate-card read (set by the panel's "Review in Pending"). */
  readonly pendingBatch = signal<string | null>(null);

  /** The assistant's "Review in Pending": close the panel (phones: a full-screen sheet) and show the suggestions it added. */
  onAssistantOpenPending(batch: string | null) {
    this.assistantOpen.set(false);
    this.pendingBatch.set(batch);
    this.openPendingView();
    this.loadPendingCount();
  }

  openPendingView() {
    if (!this.pendingOn()) return;
    this.panelEditing.set(false); this.panelQuery.set('');
    this.ogView.set(false); this.microView.set(false); this.pricingView.set(false); this.pendingView.set(true);
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const t = params['type'];
      if (t === 'individual' || t === 'profile' || t === 'package') {
        this._type.set(t);
      }
      // Deep link from the test editor's "Edit group…" prompt.
      if (params['view'] === 'option-groups') this.ogView.set(true);
      if (params['view'] === 'microbiology') this.microView.set(true);
      if (params['view'] === 'pricing' && this.canEditPrices()) this.pricingView.set(true);
      if (params['view'] === 'pending') { this.wantPending = true; if (this.pendingOn()) this.openPendingView(); }
    });
    this.loadPartners();
    void this.beta.ensureLoaded().then(() => {
      if (!this.pendingOn()) return;
      this.loadPendingCount();
      if (this.wantPending && !this.pendingView()) this.openPendingView();
    });
    this.destroyRef.onDestroy(() => this.listHold.cancel());
    this.loadTests();
    this.loadDepartments();
    this.loadProposals();
    this.pricing.ensureLoaded();
  }

  onGridReady(e: GridReadyEvent<TestRow>) {
    this.gridApi = e.api;
  }

  openOgView() { this.panelEditing.set(false); this.panelQuery.set(''); this.microView.set(false); this.pricingView.set(false); this.pendingView.set(false); this.ogView.set(true); }
  openMicroView() { this.panelEditing.set(false); this.panelQuery.set(''); this.ogView.set(false); this.pricingView.set(false); this.pendingView.set(false); this.microView.set(true); }
  openPricingView() { this.panelEditing.set(false); this.panelQuery.set(''); this.ogView.set(false); this.microView.set(false); this.pendingView.set(false); this.pricingView.set(true); }

  // ── Band pill (owner, "band pill everywhere") ──────────────────────────
  /** The ONE view switch in the pill: the three catalogue types plus the
   *  side views that replace the grid. */
  private readonly allViewOptions: SegmentedOption<TmView>[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'profile', label: 'Profiles' },
    { value: 'package', label: 'Packages' },
    { value: 'og', label: 'Option groups' },
    { value: 'micro', label: 'Microbiology' },
    { value: 'pricing', label: 'Pricing' },
  ];
  /** Pricing (the view) only for someone who may change prices. */
  readonly viewOptions = computed<SegmentedOption<TmView>[]>(() => {
    const base = this.canEditPrices() ? this.allViewOptions : this.allViewOptions.filter(o => o.value !== 'pricing');
    // "Pending (N)": the count IS the badge (plain tabular number, PF-PATTERN).
    return this.pendingOn() ? [...base, { value: 'pending', label: 'Pending', count: this.pendingCount() }] : base;
  });
  readonly view = computed<TmView>(() =>
    this.pendingView() ? 'pending' : this.ogView() ? 'og' : this.microView() ? 'micro' : this.pricingView() ? 'pricing' : this._type());
  /** True while the tests/profiles/packages grid (not a side view) shows. */
  readonly gridView = computed(() => !this.ogView() && !this.microView() && !this.pricingView() && !this.pendingView());
  setView(v: TmView) {
    this.panelEditing.set(false);
    if (v === 'pending') { this.pendingBatch.set(null); this.openPendingView(); }
    else if (v === 'og') this.openOgView();
    else if (v === 'micro') this.openMicroView();
    else if (v === 'pricing') this.openPricingView();
    else this.setType(v);
  }
  /** Search text for the side views (option groups / microbiology / pricing):
   *  the band search drives the open panel's own filter. */
  readonly panelQuery = signal('');
  readonly bandValue = computed(() => (this.gridView() ? this.search() : this.panelQuery()));
  readonly bandPlaceholder = computed(() => {
    switch (this.view()) {
      case 'og': return 'Search option groups — values, tests, parameters…';
      case 'micro': return 'Search microbiology masters…';
      case 'pricing': return 'Search test name…';
      case 'pending': return 'Search pending changes — test, change, who…';
      case 'profile': return 'Search profiles…';
      case 'package': return 'Search packages…';
      default: return 'Search tests — name, code, short name…';
    }
  });
  onBandSearch(v: string) {
    if (this.gridView()) this.search.set(v ?? '');
    else this.panelQuery.set(v ?? '');
  }
  /** Band action for the option-groups view (its own "+ New" moved up here). */
  newOptionGroup() { this.ogPanel?.startCreate(); }
  /** A side-view panel (option groups / microbiology / pricing) has an editor
   *  open or unsaved edits —
   *  its own save is then the view's ONE primary. */
  readonly panelEditing = signal(false);
  /** Pricing view (new design): the band carries the table's Save + Discard. */
  readonly pricingTable = viewChild<PricingComponent>('pricingTable');
  readonly pricingDirty = computed(() => this.pricingTable()?.dirtyCount() ?? 0);
  readonly pricingSaving = computed(() => this.pricingTable()?.saving() ?? false);
  /** The band's Create / New steps down to secondary when another primary
   *  owns the view (pending grid edits, or an open panel editor). */
  readonly bandPrimaryElsewhere = computed(() =>
    this.dirtyCount() > 0 || this.pendingView() || ((this.ogView() || this.microView() || this.pricingView()) && this.panelEditing()));

  setType(t: TestType) {
    this.pendingView.set(false);
    this.ogView.set(false);
    this.microView.set(false);
    this.pricingView.set(false);
    this._type.set(t);
    this._selectedDept.set(null);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { type: t },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  selectDept(key: string | null) {
    this._selectedDept.set(key);
  }

  private loadMissingContainers() {
    this.api.get<MissingContainerResponse>(MISSING_CONTAINER_URL).subscribe({
      next: r => {
        this._missingContainer.set(missingContainerIndex(r));
        this.gridApi?.refreshCells({ columns: ['tubeColor'], force: true });
      },
      error: () => { /* a diagnostic only — the grid works without it */ },
    });
  }

  private loadTests() {
    this.loadMissingContainers();
    // status=all: every test, switched-off ones included (flagged isEnabled).
    this.api.get<Test[]>(testListUrl({ status: 'all' })).subscribe({
      next: l => { this._tests.set(l ?? []); this.onFirstLoad(); },
      error: e => { this._testsLoaded = true; this.listHold.done(); this.toasts.error(ApiError.from(e).message); },
    });
  }

  /** Once the grid is on screen, warm the test editor's code while the
   *  browser is idle, so "Edit" never waits on a chunk download. */
  private onFirstLoad() {
    if (this._testsLoaded) return;
    this._testsLoaded = true;
    this.listHold.done();
    const cancel = prefetchWhenIdle(TEST_EDITOR_PREFETCH_KEY, loadTestEditor);
    this.destroyRef.onDestroy(cancel);
  }

  private loadPartners() {
    this.api.get<PartnerRow[]>('/api/referral-labs?includeInactive=true').subscribe({
      next: rows => this.partners.set((rows ?? []).map(r => ({ id: r.id, name: r.name, isActive: r.isActive ?? true }))),
      error: () => { /* names fall back to "Partner lab" */ },
    });
  }

  private loadDepartments() {
    this.api.get<DeptRecord[]>('/api/tenants/departments').subscribe({
      next: l => this._depts.set(l ?? []),
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }

  /** On/off switch. Turning a department OFF hides it lab-wide, so that
   *  asks first (DialogService); turning it back on doesn't. */
  async toggleDept(d: DeptBucket): Promise<void> {
    if (!d.id) return;
    const id = d.id;
    const next = !d.isActive;
    if (!next) {
      const ok = await this.dialog.confirm({
        title: `Turn off ${d.name}?`,
        message: this.type() === 'package'
          // A package has no department: turning one off never hides a
          // package — only the member tests of that department.
          ? `This hides the department's tests lab-wide until you turn it back on. Packages stay listed.`
          : `This hides the department lab-wide${d.count ? `, with its ${d.count} ${d.count === 1 ? 'test' : 'tests'}` : ''}, until you turn it back on.`,
        confirmLabel: 'Turn off',
        cancelLabel: 'Keep it on',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this._depts.update(list => list.map(x => (x.id === id ? { ...x, isActive: next } : x)));
    this.api.patch(`/api/tenants/departments/${id}`, { isActive: next }).subscribe({
      next: () => {
        this.toasts.success(next ? 'Department enabled' : 'Department disabled');
        this.loadTests();
      },
      error: e => {
        this._depts.update(list => list.map(x => (x.id === id ? { ...x, isActive: !next } : x)));
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  private referenceRange(t?: Test): string {
    if (!t?.parameters) return '';
    try {
      const blob = JSON.parse(t.parameters);
      const p = Array.isArray(blob?.parameters) ? blob.parameters[0] : undefined;
      if (!p) return '';
      const bands = summarizeRanges(p.referenceRanges, p.unit, { keepLines: true });
      if (bands) return bands;
      if (p.normalValue) return String(p.normalValue);
      return '';
    } catch { return ''; }
  }

  /** Server-derived range first, else the first value's bands. */
  private derivedRange(t?: Test): string {
    const d = (t?.derivedReferenceRange ?? '').trim();
    if (d) {
      const u = this.derivedUnit(t);
      return u && !d.endsWith(u) ? `${d} ${u}` : d;
    }
    return this.referenceRange(t);
  }

  /** Server-derived unit first, else the first value's unit. */
  private derivedUnit(t?: Test): string {
    const d = (t?.derivedUnit ?? '').trim();
    if (d) return d;
    if (!t?.parameters) return '';
    try {
      const blob = JSON.parse(t.parameters);
      const p = Array.isArray(blob?.parameters) ? blob.parameters[0] : undefined;
      return (p?.unit ?? '').toString().trim();
    } catch { return ''; }
  }

  onCellValueChanged(e: CellValueChangedEvent<TestRow>) {
    const field = e.colDef.field;
    if (!field) return;
    if (e.newValue === e.oldValue) return;

    const id = e.data.id;
    if (field === 'price') {
      const n = Number(e.newValue);
      this._priceDirty.update(prev => new Map(prev).set(id, Number.isFinite(n) ? Math.max(0, n) : 0));
      this.gridApi?.refreshCells({ columns: ['price'], force: true });
      return;
    }
    const value = field === 'tatHours' ? Number(e.newValue) : e.newValue;

    this._dirty.update(prev => {
      const next = new Map(prev);
      next.set(id, { ...(next.get(id) ?? {}), [field]: value });
      return next;
    });

  }

  saveAll() {
    if (this.saving()) return;
    const dirty = this._dirty();
    const prices = this._priceDirty();
    if (dirty.size === 0 && prices.size === 0) return;

    const entries = [...dirty.entries()];
    const count = this.dirtyCount();
    // Content edits PATCH the test; price edits go to the pricing table in ONE
    // bulk call (acting branch when isolation is ON) — never on the test row.
    // A contributor's edits become pending changes (one per test) — never the direct PATCH.
    const calls: Observable<unknown>[] = entries.map(([id, fields]) => this.contributorMode
      ? this.contributors.proposeUpdate(id, fields)
      : this.api.patch<Test>(`/api/tests/${id}`, fields));
    if (prices.size > 0) {
      calls.push(this.pricing.save([...prices.entries()].map(([testId, price]) => ({ testId, price }))));
    }
    this.saving.set(true);
    forkJoin(calls).subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(this.contributorMode
          ? `Sent ${count} change${count === 1 ? '' : 's'} for approval`
          : `Saved ${count} change${count === 1 ? '' : 's'}`);
        this._dirty.set(new Map());
        this._priceDirty.set(new Map());
        this.loadTests();
      },
      error: e => {
        this.saving.set(false);
        const err = ApiError.from(e);
        this.toasts.error(err.message);
      },
    });
  }

  discardChanges() {
    this._dirty.set(new Map());
    this._priceDirty.set(new Map());
    this.loadTests();
  }

  editTest(id: string) {
    this.router.navigate(['/admin/tests', id, 'edit'], { queryParams: { type: this._type() } });
  }

  /** The ONE Create button reacts to the active view: a new test on the
   *  catalogue tabs, a new master row on the Microbiology tab, a new
   *  vocabulary on Option groups. */
  openCreate() {
    if (this.microView()) { this.microPanel?.startCreate(); return; }
    if (this.ogView()) { this.ogPanel?.startCreate(); return; }
    this.router.navigate(['/admin/tests/new'], { queryParams: { type: this._type() } });
  }

}
