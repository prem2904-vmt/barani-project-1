import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AllCommunityModule,
  ColDef,
  GridApi,
  GridReadyEvent,
  GetRowIdParams,
  ICellRendererParams,
  ModuleRegistry,
  CellValueChangedEvent,
  colorSchemeDark,
  colorSchemeLight,
  themeQuartz,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Test } from '../../../shared/models/test.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

// AG Grid v33+ requires explicit module registration (once per app).
ModuleRegistry.registerModules([AllCommunityModule]);

type TestType = 'individual' | 'profile' | 'package';

/**
 * A grid row view-model. In the Individual view rows are plain `Test`s (the
 * tree-meta fields stay undefined). In the Profiles/Packages views each row is
 * a `Test` decorated with manual-tree metadata so a Community grid can render
 * expandable/collapsible nested bundles without Enterprise treeData.
 */
type TestRow = Test & {
  /** Stable PATH key: top-level = `id`; child = `${parentKey}>${id}` (so the
   *  same test under different parents is a distinct, animatable row). */
  _key?: string;
  /** Nesting depth: 0 for a top-level bundle, +1 per level of descent. */
  _level?: number;
  /** True when this row is a bundle (profile/package) that has resolvable members. */
  _hasChildren?: boolean;
  /** True when `_hasChildren` and the key is in the expanded set. */
  _expanded?: boolean;
};

const UNASSIGNED = 'Unassigned';

/** A department bucket derived from the loaded catalogue (deduped by name). */
interface DeptBucket {
  key: string;   // department name, or UNASSIGNED
  name: string;
  code: string;
  count: number;
}

// ── Theme variants (Theming API, no legacy CSS files) ──────────────────
const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: '#14141f',
  foregroundColor: 'rgba(255,255,255,0.9)',
  headerTextColor: 'rgba(255,255,255,0.55)',
  headerBackgroundColor: 'rgba(255,255,255,0.03)',
  oddRowBackgroundColor: 'rgba(255,255,255,0.015)',
  rowHoverColor: 'rgba(168,85,247,0.10)',
  borderColor: 'rgba(255,255,255,0.08)',
  accentColor: '#a855f7',
  headerFontWeight: 700,
  borderRadius: 12,
  wrapperBorderRadius: 14,
});

const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  backgroundColor: '#f4f2fa',
  foregroundColor: '#262536',
  headerTextColor: '#6d6b84',
  headerBackgroundColor: 'rgba(124,58,237,0.06)',
  oddRowBackgroundColor: 'rgba(124,58,237,0.03)',
  rowHoverColor: 'rgba(124,58,237,0.08)',
  borderColor: 'rgba(124,58,237,0.15)',
  accentColor: '#7c3aed',
  headerFontWeight: 700,
  borderRadius: 12,
  wrapperBorderRadius: 14,
});

/**
 * Admin Test Master — two-panel catalogue.
 *   LEFT  : departments (with per-department counts) + an "All" bucket.
 *   RIGHT : an AG Grid of tests with column filters, an inline-editable Price
 *           cell and click-to-edit Name/Short/Section/Unit cells.
 * Three views (Individual / Profiles / Packages) via a segmented control,
 * plus Create-Profile and Create-Package flows. Full parameter editing still
 * lives in the dedicated test editor (/admin/tests/:id/edit).
 */
@Component({
  selector: 'pf-tests',
  standalone: true,
  imports: [
    FormsModule,
    AgGridAngular,
    ScreenHeaderComponent,
    SelectComponent,
    TouchButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-tm px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin"
        title="Test Master"
        subtitle="Master catalogue of tests, profiles and packages — filter, and edit prices inline.">
        <div actions class="flex items-center gap-2">
          <pf-touch-btn size="sm" variant="secondary" (pressed)="openProfileDialog()">Create profile</pf-touch-btn>
          <pf-touch-btn size="sm" variant="secondary" (pressed)="openPackageDialog()">Create package</pf-touch-btn>
          <pf-touch-btn size="sm" variant="primary" (pressed)="openCreate()">
            <span icon-left aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"/><path d="M5 12h14"/>
              </svg>
            </span>
            New test
          </pf-touch-btn>
        </div>
      </pf-screen-header>

      <!-- View switch -->
      <div class="pf-tm-tabs mb-4">
        @for (v of views; track v.value) {
          <button type="button"
                  class="pf-tm-tab"
                  [class.pf-tm-tab--active]="type() === v.value"
                  (click)="setType(v.value)">
            {{ v.label }}
          </button>
        }
      </div>

      <div class="pf-tm-panels" [class.pf-tm-panels--collapsed]="sideCollapsed()">
        <!-- ── LEFT: departments ─────────────────────────────── -->
        <aside class="pf-tm-side">
          <div class="pf-tm-side-head">
            <span>Departments</span>
            <button type="button" class="pf-tm-side-toggle" (click)="toggleSide()"
                    title="Collapse panel" aria-label="Collapse department panel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
          </div>
          <ul class="pf-tm-dept-list">
            <li>
              <button type="button" class="pf-tm-dept" [class.pf-tm-dept--active]="!selectedDept()"
                      (click)="selectDept(null)">
                <span class="pf-tm-dept-name">All</span>
                <span class="pf-tm-dept-count">{{ typeTests().length }}</span>
              </button>
            </li>
            @for (d of departments(); track d.key) {
              <li>
                <button type="button" class="pf-tm-dept" [class.pf-tm-dept--active]="selectedDept() === d.key"
                        (click)="selectDept(d.key)">
                  <span class="pf-tm-dept-name">
                    {{ d.name }}
                    @if (d.code) { <span class="pf-tm-dept-code">{{ d.code }}</span> }
                  </span>
                  <span class="pf-tm-dept-count">{{ d.count }}</span>
                </button>
              </li>
            }
            @if (departments().length === 0) {
              <li class="pf-tm-dept-empty">No departments yet.</li>
            }
          </ul>
        </aside>

        <!-- ── RIGHT: grid ───────────────────────────────────── -->
        <div class="pf-tm-main">
          <div class="pf-tm-grid-meta">
            @if (sideCollapsed()) {
              <button type="button" class="pf-tm-side-expand" (click)="toggleSide()"
                      title="Show departments" aria-label="Show department panel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
                Departments
              </button>
            }
            <span>{{ rowData().length }} {{ type() === 'package' ? 'packages' : type() === 'profile' ? 'profiles' : 'tests' }}</span>
            <span class="pf-tm-hint">Double-click a cell to edit · Price saves on change</span>
          </div>
          <ag-grid-angular
            class="pf-tm-grid"
            [theme]="gridTheme()"
            [rowData]="rowData()"
            [columnDefs]="colDefs()"
            [defaultColDef]="defaultColDef"
            [getRowId]="getRowId"
            [context]="gridContext"
            [animateRows]="true"
            [stopEditingWhenCellsLoseFocus]="true"
            (gridReady)="onGridReady($event)"
            (cellValueChanged)="onCellValueChanged($event)">
          </ag-grid-angular>
        </div>
      </div>
    </section>

    <!-- ── Create Profile dialog ─────────────────────────────── -->
    @if (showProfile()) {
      <div class="pf-tm-modal" role="dialog" aria-modal="true" aria-label="Create profile">
        <div class="pf-tm-backdrop" (click)="closeProfileDialog()"></div>
        <div class="pf-tm-card">
          <h2 class="pf-tm-card-title">Create profile</h2>
          <div class="pf-tm-form">
            <label class="pf-tm-field">
              <span class="pf-tm-label">Code <span class="pf-tm-req">*</span></span>
              <input type="text" class="pf-input" [ngModel]="pfCode()" (ngModelChange)="pfCode.set($event)" placeholder="e.g. LFT" />
            </label>
            <label class="pf-tm-field">
              <span class="pf-tm-label">Name <span class="pf-tm-req">*</span></span>
              <input type="text" class="pf-input" [ngModel]="pfName()" (ngModelChange)="pfName.set($event)" placeholder="Liver Function Test" />
            </label>
            <div class="pf-tm-field">
              <span class="pf-tm-label">Department</span>
              <pf-select [options]="deptOptions()" [value]="pfDept()" placeholder="Select department"
                         (valueChange)="pfDept.set($event)"></pf-select>
            </div>
            <label class="pf-tm-field">
              <span class="pf-tm-label">Price (₹) <span class="pf-tm-req">*</span></span>
              <input type="number" class="pf-input" min="0" step="0.01" [ngModel]="pfPrice()" (ngModelChange)="pfPrice.set($any($event))" />
            </label>
            <div class="pf-tm-field pf-tm-field--full">
              <span class="pf-tm-label">Individual tests <span class="pf-tm-req">*</span></span>
              <pf-select [multiple]="true" [options]="individualOptions()" [values]="pfItems()" placeholder="Pick tests…"
                         (valuesChange)="pfItems.set($event)"></pf-select>
            </div>
          </div>
          <div class="pf-tm-card-actions">
            <pf-touch-btn size="sm" variant="ghost" [disabled]="saving()" (pressed)="closeProfileDialog()">Cancel</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary" [disabled]="saving() || !profileValid()" (pressed)="submitProfile()">
              @if (saving()) { Saving… } @else { Create profile }
            </pf-touch-btn>
          </div>
        </div>
      </div>
    }

    <!-- ── Create Package dialog ─────────────────────────────── -->
    @if (showPackage()) {
      <div class="pf-tm-modal" role="dialog" aria-modal="true" aria-label="Create package">
        <div class="pf-tm-backdrop" (click)="closePackageDialog()"></div>
        <div class="pf-tm-card">
          <h2 class="pf-tm-card-title">Create package</h2>
          <div class="pf-tm-form">
            <label class="pf-tm-field">
              <span class="pf-tm-label">Name <span class="pf-tm-req">*</span></span>
              <input type="text" class="pf-input" [ngModel]="pkName()" (ngModelChange)="pkName.set($event)" placeholder="Master Health Checkup" />
            </label>
            <label class="pf-tm-field">
              <span class="pf-tm-label">Price (₹) <span class="pf-tm-req">*</span></span>
              <input type="number" class="pf-input" min="0" step="0.01" [ngModel]="pkPrice()" (ngModelChange)="pkPrice.set($any($event))" />
            </label>
            <div class="pf-tm-field pf-tm-field--full">
              <span class="pf-tm-label">Tests &amp; profiles <span class="pf-tm-req">*</span></span>
              <pf-select [multiple]="true" [options]="testAndProfileOptions()" [values]="pkItems()" placeholder="Pick tests & profiles…"
                         (valuesChange)="pkItems.set($event)"></pf-select>
            </div>
          </div>
          <div class="pf-tm-card-actions">
            <pf-touch-btn size="sm" variant="ghost" [disabled]="saving()" (pressed)="closePackageDialog()">Cancel</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary" [disabled]="saving() || !packageValid()" (pressed)="submitPackage()">
              @if (saving()) { Saving… } @else { Create package }
            </pf-touch-btn>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; max-width: 100%; }
    .pf-tm { overflow-x: clip; }

    /* View switch */
    .pf-tm-tabs { display: inline-flex; gap: 4px; padding: 4px; border-radius: 14px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-tm-tab { height: 36px; padding: 0 16px; border-radius: 10px; font-size: 13.5px; font-weight: 600;
      color: var(--text-tertiary); background: transparent; border: 0; cursor: pointer; transition: all .15s; }
    .pf-tm-tab:hover { color: var(--text-secondary); }
    .pf-tm-tab--active { color: var(--text-primary);
      background: linear-gradient(135deg, rgba(124,58,237,0.22), rgba(168,85,247,0.10));
      box-shadow: inset 0 0 0 1px rgba(168,85,247,0.30); }

    /* Two-panel layout */
    .pf-tm-panels { display: grid; grid-template-columns: 260px 1fr; gap: 16px; align-items: start; }
    @media (max-width: 900px) { .pf-tm-panels { grid-template-columns: 1fr; } }
    .pf-tm-panels--collapsed { grid-template-columns: 1fr; }
    .pf-tm-panels--collapsed .pf-tm-side { display: none; }
    .pf-tm-side-toggle, .pf-tm-side-expand { display: inline-flex; align-items: center; gap: 6px;
      border: 0; background: transparent; color: var(--text-muted); cursor: pointer;
      padding: 3px 7px; border-radius: 8px; transition: all .12s; }
    .pf-tm-side-toggle:hover, .pf-tm-side-expand:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-tm-side-expand { font-size: 12px; font-weight: 600; border: 1px solid var(--glass-border); }

    .pf-tm-side { border: 1px solid var(--glass-border); background: var(--glass-bg);
      border-radius: 16px; padding: 10px; position: sticky; top: 12px; }
    .pf-tm-side-head { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--text-muted); padding: 4px 8px 8px; display: flex; align-items: center; justify-content: space-between; }
    .pf-tm-dept-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px;
      max-height: calc(100vh - 240px); overflow-y: auto; }
    @media (max-width: 900px) { .pf-tm-dept-list { max-height: 260px; } }
    .pf-tm-dept { width: 100%; display: flex; align-items: center; gap: 8px; justify-content: space-between;
      padding: 8px 10px; border-radius: 10px; border: 0; background: transparent; cursor: pointer;
      text-align: left; color: var(--text-secondary); transition: all .12s; }
    .pf-tm-dept:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-tm-dept--active { background: rgba(168,85,247,0.14); color: var(--text-primary);
      box-shadow: inset 0 0 0 1px rgba(168,85,247,0.28); }
    .pf-tm-dept-name { font-size: 13.5px; font-weight: 600; min-width: 0; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
    .pf-tm-dept-code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 10px;
      color: var(--violet-text); background: rgba(124,58,237,0.14); border-radius: 5px; padding: 0 5px; }
    .pf-tm-dept-count { font-size: 12px; font-weight: 600; color: var(--text-muted);
      background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 999px;
      min-width: 26px; text-align: center; padding: 1px 7px; flex-shrink: 0; }
    .pf-tm-dept-empty { padding: 10px; font-size: 12.5px; color: var(--text-tertiary); }

    /* Grid */
    .pf-tm-main { min-width: 0; }
    .pf-tm-grid-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-bottom: 8px; font-size: 12px; color: var(--text-tertiary); }
    .pf-tm-hint { color: var(--text-muted); }
    @media (max-width: 640px) { .pf-tm-hint { display: none; } }
    .pf-tm-grid { display: block; width: 100%; height: calc(100vh - 260px); min-height: 420px; }

    /* Manual tree cell (Profiles / Packages nested rows) */
    .pf-tm-tree-cell { display: flex; align-items: center; gap: 6px; height: 100%; min-width: 0; }
    .pf-tm-tree-toggle { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; padding: 0; border: 0; border-radius: 6px; cursor: pointer;
      background: transparent; color: var(--text-muted); transition: color .12s, background .12s; }
    .pf-tm-tree-toggle:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-tm-tree-toggle svg { transition: transform .15s ease; }
    .pf-tm-tree-toggle.pf-open svg { transform: rotate(90deg); }
    .pf-tm-tree-spacer { flex-shrink: 0; display: inline-block; width: 20px; height: 20px; }
    .pf-tm-tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-tm-tree-name--bundle { font-weight: 700; }

    /* Modals */
    .pf-tm-modal { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center;
      justify-content: center; padding: 20px; }
    .pf-tm-backdrop { position: absolute; inset: 0; background: rgba(5,5,15,0.72);
      backdrop-filter: blur(12px) saturate(1.2); -webkit-backdrop-filter: blur(12px) saturate(1.2); }
    .pf-tm-card { position: relative; width: 100%; max-width: 30rem; max-height: 88vh; overflow-y: auto;
      padding: 22px; border-radius: 20px; background: var(--bg-card-solid);
      border: 1px solid var(--glass-border); box-shadow: 0 30px 70px rgba(0,0,0,0.55); }
    .pf-tm-card-title { font-size: 17px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; }
    .pf-tm-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .pf-tm-field { display: flex; flex-direction: column; gap: 5px; }
    .pf-tm-field--full { grid-column: 1 / -1; }
    .pf-tm-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .pf-tm-req { color: #f472b6; }
    .pf-tm-card-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    @media (max-width: 480px) { .pf-tm-form { grid-template-columns: 1fr; } }
  `]
})
export class TestsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly theme = inject(ThemeService);

  readonly views: { value: TestType; label: string }[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'profile',    label: 'Profiles' },
    { value: 'package',    label: 'Packages' },
  ];

  private readonly _type = signal<TestType>('individual');
  private readonly _tests = signal<Test[]>([]);
  private readonly _selectedDept = signal<string | null>(null);
  readonly saving = signal(false);
  /** Collapse the left department panel to give the grid full width. */
  readonly sideCollapsed = signal(false);
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

  /** Passed to the grid so the tree cell renderer can call back into the component. */
  readonly gridContext = { toggle: (key: string) => this.toggleRow(key) };

  /** Stable row identity keeps expansion state + row animation coherent. */
  readonly getRowId = (p: GetRowIdParams<TestRow>) => p.data._key ?? p.data.id;

  private gridApi?: GridApi<TestRow>;
  /** Guards the revert-on-error path from re-triggering a save loop. */
  private reverting = false;

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));

  /** All tests of the currently-selected type. */
  readonly typeTests = computed(() => this._tests().filter(t => t.type === this._type()));

  /** Departments derived from the current type's tests, deduped by name. */
  readonly departments = computed<DeptBucket[]>(() => {
    const map = new Map<string, DeptBucket>();
    for (const t of this.typeTests()) {
      const name = t.department?.name?.trim() || UNASSIGNED;
      const code = t.department?.code?.trim() || '';
      const g = map.get(name);
      if (g) { g.count++; if (!g.code && code) g.code = code; }
      else map.set(name, { key: name, name, code, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  /**
   * Rows for the grid.
   *   Individual → a flat list (unchanged): current type, filtered by department.
   *   Profile / Package → a flattened manual tree (see `buildTree`) so bundle
   *   rows can expand into indented member rows.
   */
  readonly rowData = computed<TestRow[]>(() => {
    if (this._type() === 'individual') {
      const dep = this._selectedDept();
      const tests = this.typeTests();
      if (!dep) return tests;
      return tests.filter(t => (t.department?.name?.trim() || UNASSIGNED) === dep);
    }
    return this.buildTree();
  });

  /** Member test ids of a bundle (profile/package) from its `parameters` JSON. */
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

  /**
   * Flatten the profile/package hierarchy into an ordered list of `TestRow`s.
   * Top-level rows are the bundles of the current view (filtered by department);
   * an expanded bundle contributes its members immediately after it, indented
   * one level, recursively (a package can hold profiles, which hold tests).
   * A path visited-set guards against cyclic membership.
   */
  private buildTree(): TestRow[] {
    const all = this._tests();
    const byId = new Map<string, Test>();
    for (const t of all) byId.set(t.id, t);

    const topType = this._type(); // 'profile' | 'package'
    const dep = this._selectedDept();
    let roots = all.filter(t => t.type === topType);
    if (dep) roots = roots.filter(t => (t.department?.name?.trim() || UNASSIGNED) === dep);
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
          if (nextPath.has(mid)) continue; // cycle guard: skip a test already on this path
          const child = byId.get(mid);
          if (!child) continue;           // unresolved member id (deleted test) → skip
          emit(child, key, level + 1, nextPath);
        }
      }
    };

    for (const r of roots) emit(r, null, 0, new Set<string>());
    return out;
  }

  // ── Picker / dialog option lists ─────────────────────────────
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

  // ── Grid column definitions ──────────────────────────────────
  readonly defaultColDef: ColDef<TestRow> = {
    filter: true,
    sortable: true,
    resizable: true,
    flex: 1,
    minWidth: 110,
  };

  readonly colDefs = computed<ColDef<TestRow>[]>(() => {
    const view = this._type();

    // Individual view — unchanged flat catalogue.
    if (view === 'individual') {
      return [
        { headerName: 'Code', field: 'testCode', minWidth: 120, maxWidth: 160, sort: 'asc' },
        { headerName: 'Name', field: 'name', editable: true, minWidth: 180, flex: 2 },
        { headerName: 'Short', field: 'shortName', editable: true, minWidth: 120 },
        { headerName: 'Section', field: 'section', editable: true, minWidth: 130 },
        { headerName: 'Specimen', field: 'sampleType', minWidth: 120 },
        { headerName: 'Unit', field: 'unit', editable: true, minWidth: 100 },
        {
          headerName: 'Reference range', colId: 'referenceRange', minWidth: 150,
          valueGetter: p => this.referenceRange(p.data), editable: false,
        },
        { headerName: 'TAT (h)', field: 'tatHours', minWidth: 100, maxWidth: 120 },
        this.priceColDef(true),
        {
          headerName: 'Status', colId: 'status', minWidth: 100, maxWidth: 120, editable: false,
          valueGetter: p => (p.data?.isActive ? 'Active' : 'Inactive'),
        },
      ];
    }

    // Profile / Package views — manual expandable tree.
    return [
      {
        headerName: 'Name', colId: 'treeName', flex: 3, minWidth: 260,
        // Tree order is meaningful (parent → children), so no sort/filter here.
        // `sort: null` clears any sort state inherited from the Individual view.
        sortable: false, filter: false, editable: false, sort: null,
        cellRenderer: this.nameCellRenderer,
        valueGetter: p => p.data?.name,
      },
      // `sort: null` is required: the Individual view's Code column sets
      // `sort: 'asc'` and shares this `testCode` field, so AG Grid would
      // otherwise keep sorting the flattened tree and detach children.
      { headerName: 'Code', field: 'testCode', minWidth: 120, maxWidth: 160, sortable: false, filter: false, sort: null },
      {
        headerName: 'Kind', colId: 'kind', minWidth: 110, maxWidth: 140, sortable: false, filter: false,
        valueGetter: p => this.kindLabel(p.data),
      },
      { headerName: 'Unit', field: 'unit', minWidth: 100, sortable: false, filter: false },
      {
        headerName: 'Reference range', colId: 'referenceRange', minWidth: 150, sortable: false, filter: false,
        valueGetter: p => this.referenceRange(p.data),
      },
      // Price stays editable — the PATCH targets the row's real test id, so
      // editing a bundle's price updates that bundle, not a synthetic key.
      { ...this.priceColDef(true), sortable: false, filter: false },
    ];
  });

  /** Shared editable Price column definition. */
  private priceColDef(editable: boolean): ColDef<TestRow> {
    return {
      headerName: 'Price (₹)', field: 'price', editable, minWidth: 110, maxWidth: 150,
      cellEditor: 'agNumberCellEditor',
      valueParser: p => { const n = Number(p.newValue); return Number.isFinite(n) ? Math.max(0, n) : p.oldValue; },
      valueFormatter: p => (p.value == null ? '' : '₹' + Number(p.value).toLocaleString('en-IN')),
      cellStyle: { fontWeight: '600' },
    };
  }

  /** Human label for a row's kind in the tree views. */
  private kindLabel(t?: TestRow): string {
    if (!t) return '';
    if (t.type === 'profile') return 'Profile';
    if (t.type === 'package') return 'Package';
    return 'Test';
  }

  /**
   * Tree Name cell: indent by depth, then a rotating chevron toggle for bundle
   * rows (leaf rows just indent), then the test name. The chevron calls back via
   * the grid `context` so expansion state lives on the component signal.
   */
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

  // ── Create-Profile dialog state ──────────────────────────────
  readonly showProfile = signal(false);
  readonly pfCode = signal('');
  readonly pfName = signal('');
  readonly pfDept = signal<string>('');
  readonly pfPrice = signal<number>(0);
  readonly pfItems = signal<string[]>([]);
  readonly profileValid = computed(() =>
    this.pfCode().trim().length > 0 && this.pfName().trim().length > 0 && this.pfItems().length > 0);

  // ── Create-Package dialog state ──────────────────────────────
  readonly showPackage = signal(false);
  readonly pkName = signal('');
  readonly pkPrice = signal<number>(0);
  readonly pkItems = signal<string[]>([]);
  readonly packageValid = computed(() => this.pkName().trim().length > 0 && this.pkItems().length > 0);

  ngOnInit() {
    this.loadTests();
  }

  onGridReady(e: GridReadyEvent<TestRow>) {
    this.gridApi = e.api;
  }

  setType(t: TestType) {
    this._type.set(t);
    this._selectedDept.set(null);
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

  /** Derive a readable reference range from the parameters JSON blob. */
  private referenceRange(t?: Test): string {
    if (!t?.parameters) return '';
    try {
      const blob = JSON.parse(t.parameters);
      const p = Array.isArray(blob?.parameters) ? blob.parameters[0] : undefined;
      if (!p) return '';
      const r = Array.isArray(p.referenceRanges) ? p.referenceRanges[0] : undefined;
      if (r && (r.min != null || r.max != null)) {
        const unit = r.unit || p.unit || '';
        return `${r.min ?? ''}–${r.max ?? ''}${unit ? ' ' + unit : ''}`.trim();
      }
      if (p.normalValue) return String(p.normalValue);
      return '';
    } catch { return ''; }
  }

  /** Inline-edit committed → persist the single field; revert the cell on error. */
  onCellValueChanged(e: CellValueChangedEvent<TestRow>) {
    if (this.reverting) return;
    const field = e.colDef.field;
    if (!field) return;
    if (e.newValue === e.oldValue) return;

    // Use the row's REAL test id (never the synthetic `_key`) so a bundle row's
    // price edit PATCHes that bundle test, not a path key.
    const id = e.data.id;
    const value = field === 'price' ? Number(e.newValue) : e.newValue;

    this.api.patch<Test>(`/api/tests/${id}`, { [field]: value }).subscribe({
      next: () => {
        // Keep the local cache in sync so department counts / pickers stay right.
        this._tests.update(list => list.map(t => (t.id === id ? { ...t, [field]: value } as Test : t)));
        this.toasts.success('Saved');
      },
      error: err => {
        this.reverting = true;
        e.node.setDataValue(field, e.oldValue);
        this.reverting = false;
        this.toasts.error(ApiError.from(err).message);
      },
    });
  }

  // ── Create test (routes to the full editor) ──────────────────
  openCreate() {
    this.router.navigate(['/admin/tests/new'], { queryParams: { type: this._type() } });
  }

  // ── Create Profile ───────────────────────────────────────────
  openProfileDialog() {
    this.pfCode.set(''); this.pfName.set(''); this.pfDept.set(''); this.pfPrice.set(0); this.pfItems.set([]);
    this.showProfile.set(true);
  }
  closeProfileDialog() { this.showProfile.set(false); }

  submitProfile() {
    if (!this.profileValid() || this.saving()) return;
    this.saving.set(true);
    const body: Record<string, unknown> = {
      type: 'profile',
      name: this.pfName().trim(),
      testCode: this.pfCode().trim(),
      price: Number(this.pfPrice()) || 0,
      parametersJson: JSON.stringify({ items: this.pfItems().map(testId => ({ testId })) }),
    };
    if (this.pfDept()) body['departmentId'] = this.pfDept();
    this.api.post<Test>('/api/tests/', body).subscribe({
      next: () => {
        this.saving.set(false);
        this.showProfile.set(false);
        this.toasts.success('Profile created');
        this._type.set('profile');
        this._selectedDept.set(null);
        this.loadTests();
      },
      error: e => { this.saving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  // ── Create Package ───────────────────────────────────────────
  openPackageDialog() {
    this.pkName.set(''); this.pkPrice.set(0); this.pkItems.set([]);
    this.showPackage.set(true);
  }
  closePackageDialog() { this.showPackage.set(false); }

  submitPackage() {
    if (!this.packageValid() || this.saving()) return;
    this.saving.set(true);
    const body: Record<string, unknown> = {
      type: 'package',
      name: this.pkName().trim(),
      price: Number(this.pkPrice()) || 0,
      parametersJson: JSON.stringify({ items: this.pkItems().map(testId => ({ testId })) }),
    };
    this.api.post<Test>('/api/tests/', body).subscribe({
      next: () => {
        this.saving.set(false);
        this.showPackage.set(false);
        this.toasts.success('Package created');
        this._type.set('package');
        this._selectedDept.set(null);
        this.loadTests();
      },
      error: e => { this.saving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
