import { ChangeDetectionStrategy, Component, ViewChild, OnInit, computed, inject, signal } from '@angular/core';
import { TubeColorEditorComponent } from '../tube-color-editor.component';
import { PfSelectOption } from '../../../../shared/primitives/select.component';
import { FormsModule } from '@angular/forms';
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
  RowStyle,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { ApiError } from '../../../../shared/models/api-response.model';
import { Test } from '../../../../shared/models/test.model';
import { describeAllRanges } from '../../../../shared/utils/reference-range';
import { tubeColor, TUBE_COLORS } from '../../../../shared/utils/tube-colors';
import { ScreenHeaderComponent } from '../../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../../shared/primitives/touch-button.component';
import { OptionGroupsPanelComponent } from './option-groups-panel.component';
import { MicroMastersPanelComponent } from './micro-masters-panel.component';
import { PricingComponent } from '../../pricing/pricing.component';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { notOfferedElement, priceFlagElement } from '../../../../shared/primitives/price-flag.component';
import { isOffered, isPriceDefault } from '../../../../shared/utils/test-pricing';
import { originBadgeElement } from '../../../../shared/primitives/origin-badge.component';
import {
  canRevertToMaster, originLabel, restoreDefaultsMessage, restoreDefaultsSummary, revertToMasterPath,
} from '../../../../shared/utils/test-origin';
import { compareTestCodes } from '../../../../shared/utils/test-code';
import { pendingProposalIds } from '../../../../shared/utils/catalog-proposals';
import { CatalogProposal } from '../../../../shared/models/test.model';
import { CatalogProposalsPanelComponent } from './catalog-proposals-panel.component';
import { HeroBandComponent } from '../../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../../shared/primitives/segmented.component';
import { webPointerSignal } from '../../../../shared/utils/pointer-mode';
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

/** Extended row model supporting manual tree hierarchy for profiles/packages. */
export type TestRow = Test & {
  _key?: string;
  _level?: number;
  _hasChildren?: boolean;
  _expanded?: boolean;
};

/** Views the band pill's switch can select. */
type TmView = TestType | 'og' | 'micro' | 'pricing';

@Component({
  selector: 'pf-tests',
  standalone: true,
  imports: [
    AgGridAngular,
    FormsModule,
    ScreenHeaderComponent,
    TouchButtonComponent,
    OptionGroupsPanelComponent,
    MicroMastersPanelComponent,
    PricingComponent,
    CatalogProposalsPanelComponent,
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
  @ViewChild(MicroMastersPanelComponent) private microPanel?: MicroMastersPanelComponent;
  @ViewChild(OptionGroupsPanelComponent) private ogPanel?: OptionGroupsPanelComponent;
  private readonly _type = signal<TestType>('individual');
  private readonly _tests = signal<Test[]>([]);
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
  /** Row actions: TEXT on web, ICON on touch (ND-PATTERN .nd-rowact). */
  readonly web = webPointerSignal();
  readonly isCoarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  readonly sideCollapsed = signal(true);
  toggleSide() { this.sideCollapsed.update(v => !v); }

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

  /** Toggle a test row's active/inactive state immediately via API patch. */
  toggleTestActive(row: TestRow) {
    if (!row.id) return;
    const id = row.id;
    const next = !row.isActive;
    const testName = row.name || 'Test';

    this._tests.update(list => list.map(t => (t.id === id ? { ...t, isActive: next } : t)));
    this.api.patch<Test>(`/api/tests/${id}`, { isActive: next }).subscribe({
      next: () => {
        this.toasts.success(next ? `'${testName}' activated` : `'${testName}' deactivated`);
      },
      error: e => {
        this._tests.update(list => list.map(t => (t.id === id ? { ...t, isActive: !next } : t)));
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  /** Stable row identity keeps expansion state + row animation coherent. */
  readonly getRowId = (p: GetRowIdParams<TestRow>) => p.data._key ?? p.data.id;

  /** A test this tenant/branch doesn't offer stays listed, greyed out. */
  protected getRowStyle = (p: RowClassParams<TestRow>): RowStyle | undefined =>
    p.data && !isOffered(p.data) ? { opacity: '0.55' } : undefined;

  private gridApi?: GridApi<TestRow>;

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));

  readonly showInactive = signal(false);
  readonly inactiveCount = computed(() =>
    this._tests().filter(t => t.type === this._type() && !t.isActive).length);

  readonly typeTests = computed(() => this._tests().filter(t =>
    t.type === this._type() && (this.showInactive() || t.isActive)));

  readonly search = signal('');
  private matchesSearch(t: Test, q: string): boolean {
    return (t.name ?? '').toLowerCase().includes(q)
        || (t.testCode ?? '').toLowerCase().includes(q)
        || ((t as { shortName?: string }).shortName ?? '').toLowerCase().includes(q);
  }

  readonly departments = computed<DeptBucket[]>(() => {
    const countByName = new Map<string, number>();
    let unassigned = 0;
    for (const t of this.typeTests()) {
      const name = t.department?.name?.trim();
      if (name) countByName.set(name, (countByName.get(name) ?? 0) + 1);
      else unassigned++;
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
    if (dep) roots = roots.filter(t => (t.department?.name?.trim() || UNASSIGNED) === dep);
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
    const drop = new Set(['shortName', 'section', 'tubeColor', 'unit', 'tatHours', 'status']);
    return cols.filter(c => !drop.has(String(c.field ?? c.colId ?? '')));
  }

  readonly colDefs = computed<ColDef<TestRow>[]>(() => {
    const view = this._type();

    if (view === 'individual') {
      return [
        {
          // Codes are server-assigned and never change — not editable here.
          headerName: 'Code', field: 'testCode', editable: false, minWidth: 120, maxWidth: 160, sort: 'asc', pinned: 'left',
          comparator: (a: string | null, b: string | null) => compareTestCodes(a, b),
          cellRenderer: this.codeCellRenderer,
          tooltipValueGetter: p => {
            const tColor = tubeColor(p.data?.tubeColor);
            return tColor ? `Container: ${tColor.label}` : undefined;
          },
        },
        // Wide enough that names don't truncate (ND §5); uniform row height.
        { headerName: 'Name', field: 'name', editable: true, width: 300, minWidth: 200, pinned: 'left',
          cellRenderer: this.plainNameRenderer, tooltipField: 'name' },
        this.originColDef(),
        { headerName: 'Short', field: 'shortName', editable: true, minWidth: 120 },
        { headerName: 'Section', field: 'section', editable: true, minWidth: 130 },
        {
          headerName: 'Container', field: 'tubeColor', editable: true, minWidth: 160,
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
        this.priceColDef(true),
        this.statusColDef(),
        this.actionsColDef(),
      ];
    }

    return [
      {
        headerName: 'Name', colId: 'treeName', flex: 3, minWidth: 260, pinned: 'left',
        sortable: false, filter: false, editable: false, sort: null,
        cellRenderer: this.nameCellRenderer,
        valueGetter: p => p.data?.name,
      },
      { headerName: 'Code', field: 'testCode', minWidth: 120, maxWidth: 160, sortable: false, filter: false, sort: null, pinned: 'left', cellRenderer: this.codeCellRenderer },
      { ...this.originColDef(), sortable: false, filter: false },
      {
        headerName: 'Kind', colId: 'kind', minWidth: 110, maxWidth: 140, sortable: false, filter: false,
        valueGetter: p => this.kindLabel(p.data),
      },
      { headerName: 'Short', field: 'shortName', editable: true, minWidth: 110, sortable: false, filter: false },
      {
        headerName: 'Container', field: 'tubeColor', editable: true, minWidth: 160, sortable: false, filter: false,
        cellRenderer: this.containerRenderer,
        cellEditor: TubeColorEditorComponent,
        cellEditorParams: {
          choices: TUBE_COLORS.map(c => ({ key: c.key, label: c.label, hex: c.hex })),
        },
      },
      { ...this.derivedRangeColDef(), minWidth: 150, sortable: false, filter: false },
      { ...this.derivedUnitColDef(), sortable: false, filter: false },
      { ...this.priceColDef(true), sortable: false, filter: false },
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
      headerName: 'Reference range', colId: 'referenceRange', minWidth: 200, flex: 2,
      editable: false,
      valueGetter: p => this.derivedRange(p.data),
      tooltipValueGetter: p => this.derivedRange(p.data) || 'Comes from the test\'s values — edit ranges in the test editor',
    };
  }

  /** Unit = DERIVED from the values (the printed unit), read-only. */
  private derivedUnitColDef(): ColDef<TestRow> {
    return {
      headerName: 'Unit', colId: 'unit', minWidth: 100, editable: false,
      valueGetter: p => this.derivedUnit(p.data),
      tooltipValueGetter: () => 'Comes from the test\'s values — edit it in the test editor',
    };
  }

  /** Master / Customised / Branch / Own test chip (+ a dot when a Test
   *  Master update is waiting for this row). */
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
      valueGetter: p => (p.data?.isActive ? 'Active' : 'Inactive'),
    };
  }

  private statusSwitchRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const data = params.data;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;height:100%;';
    if (!data || !data.id) return wrap;

    const isActive = data.isActive ?? true;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(isActive));
    btn.title = isActive ? 'Deactivate' : 'Activate';
    btn.setAttribute('aria-label', (isActive ? 'Deactivate ' : 'Activate ') + (data.name || 'test'));
    btn.style.cssText = 'position:relative;flex-shrink:0;width:36px;height:20px;border-radius:999px;padding:0;cursor:pointer;'
      + 'transition:background 0.15s, border-color 0.15s;outline:none;'
      + (isActive
          ? 'background:var(--nd-toggle-on, #aeb8c2);border:1px solid var(--nd-toggle-on, #aeb8c2);'
          : 'background:var(--nd-toggle-off, #e3e7eb);border:1px solid var(--nd-toggle-off, #e3e7eb);');

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
   *  price endpoint — never the test row (a price is not a test change). A
   *  test still at the ₹1 default shows the "₹1 · not priced yet" pill. */
  private priceColDef(editable: boolean): ColDef<TestRow> {
    return {
      headerName: 'Price (₹)', field: 'price', editable, minWidth: 150, maxWidth: 190,
      cellEditor: 'agNumberCellEditor',
      valueParser: p => { const n = Number(p.newValue); return Number.isFinite(n) ? Math.max(0, n) : p.oldValue; },
      valueFormatter: p => (p.value == null ? '' : '₹' + Number(p.value).toLocaleString('en-IN')),
      cellStyle: { fontWeight: '600' },
      cellClassRules: { 'pf-not-priced': p => this.showsDefaultPrice(p.data) },
      cellRenderer: this.priceCellRenderer,
    };
  }

  /** Still at the ₹1 default AND not being edited right now. */
  showsDefaultPrice(t?: TestRow): boolean {
    return !!t && isPriceDefault(t) && !this._priceDirty().has(t.id);
  }

  private priceCellRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;height:100%;min-width:0;';
    if (!params.data) return wrap;
    if (this.showsDefaultPrice(params.data)) {
      wrap.appendChild(priceFlagElement());
    } else {
      wrap.textContent = params.valueFormatted ?? String(params.value ?? '');
    }
    return wrap;
  };

  /** Individual-view name cell: the name plus a quiet "Not offered here" tag. */
  private plainNameRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;height:100%;min-width:0;';
    const name = document.createElement('span');
    name.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.textContent = params.value ?? params.data?.name ?? '';
    wrap.appendChild(name);
    if (params.data && !isOffered(params.data)) wrap.appendChild(notOfferedElement());
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
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;height:100%;min-width:0;';

    const dot = document.createElement('span');
    dot.style.cssText = 'flex:0 0 auto;width:11px;height:11px;border-radius:50%;box-sizing:border-box;background:'
      + (tColor ? tColor.hex : 'transparent')
      + (tColor ? ';' : ';border:1px solid rgba(148,163,184,0.5);');
    wrap.appendChild(dot);

    const text = document.createElement('span');
    text.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    text.textContent = tColor ? tColor.label : '—';
    wrap.appendChild(text);
    return wrap;
  };

  private actionsRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const data = params.data;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:6px;height:100%;';
    const web = this.web();
    // Kit row action: compact TEXT button on web, a 44px neutral ICON on touch
    // (label kept for AT via aria-label + the visually-hidden .nd-rowact__t).
    const act = (label: string, aria: string, path: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nd-rowact' + (web ? '' : ' nd-rowact--icon');
      b.title = aria;
      b.setAttribute('aria-label', aria);
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
      const t = document.createElement('span');
      t.className = 'nd-rowact__t';
      t.textContent = label;
      b.appendChild(t);
      b.addEventListener('click', e => { e.stopPropagation(); run(); });
      return b;
    };
    wrap.appendChild(act('Edit', 'Edit ' + (data?.name || 'test'),
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
      () => { if (data?.id) this.editTest(data.id); }));
    if (data && canRevertToMaster(data)) {
      wrap.appendChild(act('Revert', 'Revert ' + (data.name || 'test') + ' to master',
        '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>',
        () => (params.context as { revert?: (row: TestRow) => void })?.revert?.(data)));
    }
    return wrap;
  };

  private actionsColDef(): ColDef<TestRow> {
    return {
      headerName: '', colId: 'actions', cellRenderer: this.actionsRenderer,
      editable: false, sortable: false, filter: false, resizable: false,
      // Web: "Edit" / "Revert" text buttons; touch: two 44px icons.
      minWidth: this.web() ? 170 : 110, maxWidth: this.web() ? 190 : 120, pinned: 'right',
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
    if (data && !isOffered(data)) wrap.appendChild(notOfferedElement());
    return wrap;
  };

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const t = params['type'];
      if (t === 'individual' || t === 'profile' || t === 'package') {
        this._type.set(t);
      }
      // Deep link from the test editor's "Edit group…" prompt.
      if (params['view'] === 'option-groups') this.ogView.set(true);
      if (params['view'] === 'microbiology') this.microView.set(true);
      if (params['view'] === 'pricing') this.pricingView.set(true);
    });
    this.loadTests();
    this.loadDepartments();
    this.loadProposals();
    this.pricing.ensureLoaded();
  }

  onGridReady(e: GridReadyEvent<TestRow>) {
    this.gridApi = e.api;
  }

  openOgView() { this.panelEditing.set(false); this.panelQuery.set(''); this.microView.set(false); this.pricingView.set(false); this.ogView.set(true); }
  openMicroView() { this.panelEditing.set(false); this.panelQuery.set(''); this.ogView.set(false); this.pricingView.set(false); this.microView.set(true); }
  openPricingView() { this.panelEditing.set(false); this.panelQuery.set(''); this.ogView.set(false); this.microView.set(false); this.pricingView.set(true); }

  // ── Band pill (owner, "band pill everywhere") ──────────────────────────
  /** The ONE view switch in the pill: the three catalogue types plus the
   *  side views that replace the grid. */
  readonly viewOptions: SegmentedOption<TmView>[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'profile', label: 'Profiles' },
    { value: 'package', label: 'Packages' },
    { value: 'og', label: 'Option groups' },
    { value: 'micro', label: 'Microbiology' },
    { value: 'pricing', label: 'Pricing' },
  ];
  readonly view = computed<TmView>(() =>
    this.ogView() ? 'og' : this.microView() ? 'micro' : this.pricingView() ? 'pricing' : this._type());
  /** True while the tests/profiles/packages grid (not a side view) shows. */
  readonly gridView = computed(() => !this.ogView() && !this.microView() && !this.pricingView());
  setView(v: TmView) {
    this.panelEditing.set(false);
    if (v === 'og') this.openOgView();
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
  /** The band's Create / New steps down to secondary when another primary
   *  owns the view (pending grid edits, or an open panel editor). */
  readonly bandPrimaryElsewhere = computed(() =>
    this.dirtyCount() > 0 || ((this.ogView() || this.microView() || this.pricingView()) && this.panelEditing()));

  setType(t: TestType) {
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

  private loadTests() {
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: l => this._tests.set(l ?? []),
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }

  private loadDepartments() {
    this.api.get<DeptRecord[]>('/api/tenants/departments').subscribe({
      next: l => this._depts.set(l ?? []),
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }

  toggleDept(d: DeptBucket) {
    if (!d.id) return;
    const id = d.id;
    const next = !d.isActive;
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
      const bands = describeAllRanges(p.referenceRanges);
      if (bands.length) {
        const unit = p.unit ? ` ${p.unit}` : '';
        return bands.join(' · ') + unit;
      }
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
    const calls: Observable<unknown>[] = entries.map(([id, fields]) => this.api.patch<Test>(`/api/tests/${id}`, fields));
    if (prices.size > 0) {
      calls.push(this.pricing.save([...prices.entries()].map(([testId, price]) => ({ testId, price }))));
    }
    this.saving.set(true);
    forkJoin(calls).subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(`Saved ${count} change${count === 1 ? '' : 's'}`);
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
