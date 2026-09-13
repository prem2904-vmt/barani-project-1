import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TubeColorEditorComponent } from '../tube-color-editor.component';
import { PfSelectOption } from '../../../../shared/primitives/select.component';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
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
  colorSchemeDark,
  colorSchemeLight,
  themeQuartz,
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

/** AG Grid theme rules matching our dark/light tokens. */
const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 13,
  rowHeight: 44,
  headerHeight: 40,
  borderRadius: 12,
  accentColor: '#7c3aed',
});

const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 13,
  rowHeight: 44,
  headerHeight: 40,
  borderRadius: 12,
  accentColor: '#a855f7',
});

/** Extended row model supporting manual tree hierarchy for profiles/packages. */
export type TestRow = Test & {
  _key?: string;
  _level?: number;
  _hasChildren?: boolean;
  _expanded?: boolean;
};

@Component({
  selector: 'pf-tests',
  standalone: true,
  imports: [
    AgGridAngular,
    FormsModule,
    ScreenHeaderComponent,
    TouchButtonComponent,
    OptionGroupsPanelComponent,
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
  private readonly theme = inject(ThemeService);
  private readonly dialog = inject(DialogService);

  readonly views: { value: TestType; label: string }[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'profile',    label: 'Profiles' },
    { value: 'package',    label: 'Packages' },
  ];

  /** Option-groups view — the shared vocabularies panel replaces the grid. */
  readonly ogView = signal(false);
  private readonly _type = signal<TestType>('individual');
  private readonly _tests = signal<Test[]>([]);
  private readonly _depts = signal<DeptRecord[]>([]);
  private readonly _selectedDept = signal<string | null>(null);
  readonly saving = signal(false);
  readonly restoring = signal(false);

  /**
   * Replace the tenant's whole catalogue with a fresh clone of the platform
   * default. One explicit danger-toned confirmation — the backend guarantees
   * patient data survives (tests used by orders/bills are parked, never
   * deleted), but the catalogue itself cannot be brought back.
   */
  protected async restoreDefaults(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Restore the default Test Master?',
      message: 'Your entire catalogue — tests, profiles, packages, prices and reference-range edits — is replaced with the platform default. Tests already used by orders or bills are kept for history but deactivated; everything else is deleted, and all prices reset to 0. This cannot be undone.',
      confirmLabel: 'Restore to default',
      cancelLabel: 'Keep my catalogue',
      tone: 'danger',
    });
    if (!ok) return;
    this.restoring.set(true);
    this.api.post<{ deleted: number; parked: number; cloned: number }>('/api/tests/restore-defaults', {}).subscribe({
      next: r => {
        this.restoring.set(false);
        this._dirty.set(new Map());
        this.toasts.success(`Catalogue restored — ${r.cloned} default tests loaded (${r.deleted} removed, ${r.parked} archived).`);
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
  readonly dirtyCount = computed(() => this._dirty().size);

  /** Effective (pending-edit-aware) trimmed test code for a row. */
  private effectiveCode(t: Test): string {
    const pending = this._dirty().get(t.id)?.['testCode'];
    return (pending !== undefined ? String(pending) : (t.testCode ?? '')).trim();
  }
  /** Codes used by more than one loaded test (case-insensitive), after pending
   *  edits — drives the red "duplicate code" cell highlight. */
  readonly dupCodes = computed<Set<string>>(() => {
    const counts = new Map<string, number>();
    for (const t of this._tests()) {
      const c = this.effectiveCode(t).toLowerCase();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([c]) => c));
  });
  private isDupCode(t?: Test): boolean {
    if (!t) return false;
    const c = this.effectiveCode(t).toLowerCase();
    return !!c && this.dupCodes().has(c);
  }

  readonly isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
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

  protected getRowStyle = (): RowStyle | undefined => undefined;

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
    roots = [...roots].sort((a, b) =>
      (a.testCode || a.name).localeCompare(b.testCode || b.name));

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
          headerName: 'Code', field: 'testCode', editable: true, minWidth: 120, maxWidth: 160, sort: 'asc', pinned: 'left',
          cellRenderer: this.codeCellRenderer,
          cellStyle: (p) => {
            const isDup = this.isDupCode(p.data);
            if (isDup) {
              return { backgroundColor: 'rgba(239,68,68,0.28)', color: '#fecaca', fontWeight: '600' };
            }
            return { backgroundColor: '', color: '', fontWeight: '' };
          },
          tooltipValueGetter: p => {
            const tColor = tubeColor(p.data?.tubeColor);
            return tColor ? `Container: ${tColor.label}` : undefined;
          },
        },
        { headerName: 'Name', field: 'name', editable: true, minWidth: 180, flex: 2, pinned: 'left' },
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
        {
          headerName: 'Reference range', colId: 'referenceRange',
          field: 'adultReferenceRange', minWidth: 165,
          editable: p => !this.hasMultipleBands(p.data),
          valueGetter: p => this.hasMultipleBands(p.data)
            ? this.referenceRange(p.data)
            : (p.data?.adultReferenceRange ?? '').trim() || this.referenceRange(p.data),
          tooltipValueGetter: p => this.hasMultipleBands(p.data)
            ? 'Sex/age-specific ranges — edit them in the test editor'
            : undefined,
        },
        { headerName: 'Unit', field: 'unit', editable: true, minWidth: 100 },
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
      {
        headerName: 'Reference range', colId: 'referenceRange', minWidth: 150, sortable: false, filter: false,
        valueGetter: p => this.referenceRange(p.data),
      },
      { headerName: 'Unit', field: 'unit', minWidth: 100, sortable: false, filter: false },
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
    btn.setAttribute('aria-pressed', String(isActive));
    btn.title = isActive ? 'Deactivate' : 'Activate';
    btn.setAttribute('aria-label', (isActive ? 'Deactivate ' : 'Activate ') + (data.name || 'test'));
    btn.style.cssText = 'position:relative;flex-shrink:0;width:36px;height:20px;border-radius:999px;padding:0;cursor:pointer;'
      + 'transition:background 0.15s, border-color 0.15s;outline:none;'
      + (isActive
          ? 'background:#10b981;border:1px solid #059669;'
          : 'background:rgba(148,163,184,0.22);border:1px solid rgba(148,163,184,0.35);');

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

  private priceColDef(editable: boolean): ColDef<TestRow> {
    return {
      headerName: 'Price (₹)', field: 'price', editable, minWidth: 110, maxWidth: 150,
      cellEditor: 'agNumberCellEditor',
      valueParser: p => { const n = Number(p.newValue); return Number.isFinite(n) ? Math.max(0, n) : p.oldValue; },
      valueFormatter: p => (p.value == null ? '' : '₹' + Number(p.value).toLocaleString('en-IN')),
      cellStyle: { fontWeight: '600' },
    };
  }

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
    wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Edit test';
    btn.setAttribute('aria-label', 'Edit test');
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;'
      + 'border-radius:8px;border:1px solid rgba(148,163,184,0.28);background:transparent;'
      + 'color:var(--text-secondary,#94a3b8);cursor:pointer;';
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (data?.id) this.editTest(data.id);
    });
    wrap.appendChild(btn);
    return wrap;
  };

  private actionsColDef(): ColDef<TestRow> {
    return {
      headerName: '', colId: 'actions', cellRenderer: this.actionsRenderer,
      editable: false, sortable: false, filter: false, resizable: false,
      minWidth: 60, maxWidth: 64, pinned: 'right',
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
    return wrap;
  };

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const t = params['type'];
      if (t === 'individual' || t === 'profile' || t === 'package') {
        this._type.set(t);
      }
    });
    this.loadTests();
    this.loadDepartments();
  }

  onGridReady(e: GridReadyEvent<TestRow>) {
    this.gridApi = e.api;
  }

  setType(t: TestType) {
    this.ogView.set(false);
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

  private hasMultipleBands(t?: Test): boolean {
    if (!t?.parameters) return false;
    try {
      const blob = JSON.parse(t.parameters);
      const ps = Array.isArray(blob?.parameters) ? blob.parameters : [];
      return ps.length === 1 && Array.isArray(ps[0]?.referenceRanges)
        && ps[0].referenceRanges.length > 1;
    } catch { return false; }
  }

  onCellValueChanged(e: CellValueChangedEvent<TestRow>) {
    const field = e.colDef.field;
    if (!field) return;
    if (e.newValue === e.oldValue) return;

    const id = e.data.id;
    const value = field === 'price' || field === 'tatHours' ? Number(e.newValue) : e.newValue;

    this._dirty.update(prev => {
      const next = new Map(prev);
      next.set(id, { ...(next.get(id) ?? {}), [field]: value });
      return next;
    });

    if (field === 'testCode') {
      this.gridApi?.refreshCells({ columns: ['testCode'], force: true });
    }
  }

  saveAll() {
    if (this.saving()) return;
    const dirty = this._dirty();
    if (dirty.size === 0) return;

    const seen = new Map<string, string>();
    for (const t of this._tests()) {
      const pending = dirty.get(t.id);
      const raw = pending && 'testCode' in pending ? pending['testCode'] : t.testCode;
      const code = String(raw ?? '').trim();
      if (!code) continue;
      const lc = code.toLowerCase();
      if (seen.has(lc)) {
        this.toasts.error(`Duplicate test code '${code}' — codes must be unique`);
        return;
      }
      seen.set(lc, code);
    }

    const entries = [...dirty.entries()];
    const count = entries.length;
    this.saving.set(true);
    forkJoin(entries.map(([id, fields]) => this.api.patch<Test>(`/api/tests/${id}`, fields))).subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(`Saved ${count} change${count === 1 ? '' : 's'}`);
        this._dirty.set(new Map());
        this.loadTests();
      },
      error: e => {
        this.saving.set(false);
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  discardChanges() {
    this._dirty.set(new Map());
    this.loadTests();
  }

  editTest(id: string) {
    this.router.navigate(['/admin/tests', id, 'edit'], { queryParams: { type: this._type() } });
  }

  openCreate() {
    this.router.navigate(['/admin/tests/new'], { queryParams: { type: this._type() } });
  }

}
