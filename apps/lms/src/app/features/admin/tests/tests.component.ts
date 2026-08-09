import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TubeColorEditorComponent } from './tube-color-editor.component';
import { PfSelectOption } from '../../../shared/primitives/select.component';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
import { describeAllRanges } from '../../../shared/utils/reference-range';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
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

/** Tube/vial colour → swatch hex, keyed by the row's `tubeColor` value. */
const TUBE_HEX: Record<string, string> = {
  sst: '#eab308', plain: '#ef4444', edta: '#a855f7', fluoride: '#9ca3af',
  heparin: '#22c55e', citrate: '#38bdf8', esr: '#1f2937', trace: '#1d4ed8',
  sterile: '#e5e7eb', urine: '#facc15', multiple: '#6366f1',
  red: '#ef4444', lavender: '#a855f7', grey: '#9ca3af', blue: '#38bdf8',
};

/** Tube colour key → human container label shown in the Container column. */
const TUBE_LABEL: Record<string, string> = {
  sst: 'SST', plain: 'Plain', edta: 'EDTA', fluoride: 'Fluoride',
  heparin: 'Lithium Heparin', citrate: 'Citrate', esr: 'ESR', trace: 'Trace metal',
  sterile: 'Sterile', urine: 'Urine', multiple: 'Multiple',
  red: 'Plain', lavender: 'EDTA', grey: 'Fluoride', blue: 'Citrate',
};

/** The container choices offered in the grid's Container dropdown. Deliberately
 *  excludes the legacy aliases (red/lavender/grey/blue) — those still RENDER via
 *  TUBE_LABEL for old rows, but picking one again would re-introduce a
 *  duplicate spelling of a colour that already has a canonical key. */
const TUBE_CHOICES = ['sst', 'plain', 'edta', 'fluoride', 'heparin', 'citrate',
                      'esr', 'trace', 'sterile', 'urine', 'multiple'] as const;

/** A department bucket for the left panel. `id`/`isActive` come from the real
 *  departments API (null id = a synthesised bucket, e.g. Unassigned). */
interface DeptBucket {
  key: string;   // department name, or UNASSIGNED
  id: string | null;
  name: string;
  code: string;
  count: number;
  isActive: boolean;
}

/** Raw department record from `/api/tenants/departments`. */
interface DeptRecord { id: string; name: string; code: string; isActive?: boolean; }

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
    TouchButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-tm px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin"
        title="Test Master"
        subtitle="Master catalogue of tests, profiles and packages — filter, and edit prices inline.">
        <div actions class="flex flex-wrap items-center gap-2 justify-end">
          @if (dirtyCount() > 0) {
            <pf-touch-btn size="sm" variant="secondary" [disabled]="saving()" (pressed)="discardChanges()">Discard</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary" [disabled]="saving()" (pressed)="saveAll()">Save changes ({{ dirtyCount() }})</pf-touch-btn>
          }
          <pf-touch-btn size="sm" variant="primary" (pressed)="openCreate()">
            <span icon-left aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"/><path d="M5 12h14"/>
              </svg>
            </span>
            Create
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
              <li class="pf-tm-dept-row" [class.pf-tm-dept-row--off]="!!d.id && !d.isActive">
                <button type="button" class="pf-tm-dept" [class.pf-tm-dept--active]="selectedDept() === d.key"
                        (click)="selectDept(d.key)">
                  <span class="pf-tm-dept-name">
                    {{ d.name }}
                    @if (d.code) { <span class="pf-tm-dept-code">{{ d.code }}</span> }
                  </span>
                  <span class="pf-tm-dept-count">{{ d.count }}</span>
                </button>
                @if (d.id) {
                  <button type="button" class="pf-tm-dept-switch" [class.pf-tm-dept-switch--on]="d.isActive"
                          (click)="toggleDept(d)" [attr.aria-pressed]="d.isActive"
                          [title]="d.isActive ? 'Disable department' : 'Enable department'"
                          [attr.aria-label]="(d.isActive ? 'Disable ' : 'Enable ') + d.name">
                    <span class="pf-tm-dept-switch-knob"></span>
                  </button>
                }
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
            <div class="pf-tm-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input type="text" class="pf-tm-search__input"
                     [placeholder]="'Search ' + (type() === 'package' ? 'packages' : type() === 'profile' ? 'profiles' : 'tests') + '…'"
                     [ngModel]="search()" (ngModelChange)="search.set($event)" />
              @if (search()) {
                <button type="button" class="pf-tm-search__clear" (click)="search.set('')" aria-label="Clear search">×</button>
              }
            </div>
            <span>{{ rowData().length }} {{ type() === 'package' ? 'packages' : type() === 'profile' ? 'profiles' : 'tests' }}</span>
            <span class="pf-tm-hint">Double-click a cell to edit · Save changes to persist</span>
          </div>
          <ag-grid-angular
        [singleClickEdit]="isCoarse"
            class="pf-tm-grid"
            [theme]="gridTheme()"
            [rowData]="rowData()"
            [columnDefs]="phoneTrim(colDefs())"
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

    <!-- The separate "Create profile" / "Create package" dialogs are gone.
         One Create button routes to the editor, whose Identity section already
         has a Type dropdown (individual / profile / package) — so there is a
         single path for making anything, instead of three entry points with
         two different UIs. -->
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

    /* Department row + enable/disable switch */
    .pf-tm-dept-row { display: flex; align-items: center; gap: 6px; }
    .pf-tm-dept-row .pf-tm-dept { flex: 1; min-width: 0; }
    .pf-tm-dept-row--off .pf-tm-dept { opacity: 0.5; }
    .pf-tm-dept-switch { flex-shrink: 0; width: 34px; height: 20px; border-radius: 999px; padding: 0;
      border: 1px solid var(--glass-border); background: var(--glass-bg); position: relative; cursor: pointer;
      transition: background .15s, border-color .15s; }
    .pf-tm-dept-switch:hover { border-color: rgba(168,85,247,0.5); }
    .pf-tm-dept-switch--on { background: rgba(168,85,247,0.35); border-color: rgba(168,85,247,0.5); }
    .pf-tm-dept-switch-knob { position: absolute; top: 1px; left: 1px; width: 16px; height: 16px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.3); transition: transform .15s; }
    .pf-tm-dept-switch--on .pf-tm-dept-switch-knob { transform: translateX(14px); }

    /* Individual Name cell: tube-colour swatch + name */
    .pf-tm-name-cell { display: flex; align-items: center; gap: 8px; height: 100%; min-width: 0; }
    .pf-tm-tube-dot { flex-shrink: 0; width: 10px; height: 10px; border-radius: 50%; }
    .pf-tm-tube-dot--empty { border: 1px solid var(--glass-border); }
    .pf-tm-name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Duplicate test code — flag the cell red the instant it collides. */
    .pf-tm-cell-dup { background: rgba(239, 68, 68, 0.24) !important; color: #fecaca !important; font-weight: 600; }

    /* Grid */
    .pf-tm-main { min-width: 0; }
    .pf-tm-grid-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-bottom: 8px; font-size: 12px; color: var(--text-tertiary); }
    .pf-tm-hint { color: var(--text-muted); }
    @media (max-width: 640px) { .pf-tm-hint { display: none; } }
    .pf-tm-grid { display: block; width: 100%; height: calc(100dvh - 260px); min-height: 420px; }

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

    .pf-tm-search {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 0 10px; height: 34px; min-width: 220px;
      border-radius: 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-muted);
    }
    .pf-tm-search:focus-within { border-color: rgba(139, 92, 246, 0.55); }
    .pf-tm-search__input {
      flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
      font-size: 13px; color: var(--text-primary);
    }
    .pf-tm-search__input::placeholder { color: var(--text-muted); }
    .pf-tm-search__clear {
      border: 0; background: transparent; cursor: pointer;
      font-size: 16px; line-height: 1; padding: 0 2px;
      color: var(--text-muted);
    }
    .pf-tm-search__clear:hover { color: var(--text-primary); }
    .pf-tm-card { position: relative; width: 100%; max-width: 30rem; max-height: 88dvh; overflow-y: auto;
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
  
    /* The global coarse-pointer 44px button floor inflates the tree
       chevrons, the dept switch and the in-row action buttons into blobs
       that overflow AG-Grid rows. These are secondary controls inside an
       already-large touch row — exempt them and keep their designed size. */
    @media (hover: none) and (pointer: coarse) {
      .pf-tm-tree-toggle, .pf-tm-dept-switch,
      .pf-tm-actions button, .ag-cell button {
        min-width: 0 !important; min-height: 0 !important;
      }
    }
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
  private readonly _depts = signal<DeptRecord[]>([]);
  private readonly _selectedDept = signal<string | null>(null);
  readonly saving = signal(false);

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
  /** Collapse the left department panel to give the grid full width. */
  /** Coarse-pointer / narrow-viewport probe, sampled once — drives the
   *  phone column set, tap-to-edit, and the collapsed department rail. */
  readonly isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
  readonly isCoarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  // Phone: the rail otherwise stacks 260px above the grid and pushes it
  // below the fold on every load.
  readonly sideCollapsed = signal(this.isPhone);
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

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));

  /** All tests of the currently-selected type. */
  readonly typeTests = computed(() => this._tests().filter(t => t.type === this._type()));

  /** Quick search across every tab — matches name, code or short name.
   *  On Profiles/Packages a bundle also matches when one of its MEMBERS
   *  matches (so typing "hemoglobin" surfaces CBC). */
  readonly search = signal('');
  private matchesSearch(t: Test, q: string): boolean {
    return (t.name ?? '').toLowerCase().includes(q)
        || (t.testCode ?? '').toLowerCase().includes(q)
        || ((t as { shortName?: string }).shortName ?? '').toLowerCase().includes(q);
  }

  /**
   * Left-panel buckets. Built from the REAL departments API (so id + active
   * state are available for the enable/disable toggle), with per-department
   * counts computed from the loaded tests (matched by department name, as
   * before). Test-department names not present in the API list, plus tests
   * with no department, still surface as id-less buckets so nothing is hidden.
   */
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

    // Test-department names not covered by the API list → id-less buckets.
    const covered = new Set(this._depts().map(d => d.name));
    for (const [name, count] of countByName) {
      if (!covered.has(name)) buckets.push({ key: name, id: null, name, code: '', count, isActive: true });
    }
    if (unassigned > 0) {
      buckets.push({ key: UNASSIGNED, id: null, name: UNASSIGNED, code: '', count: unassigned, isActive: true });
    }
    return buckets.sort((a, b) => a.name.localeCompare(b.name));
  });

  /**
   * Rows for the grid.
   *   Individual → a flat list (unchanged): current type, filtered by department.
   *   Profile / Package → a flattened manual tree (see `buildTree`) so bundle
   *   rows can expand into indented member rows.
   */
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
  private buildTree(q = ''): TestRow[] {
    const all = this._tests();
    const byId = new Map<string, Test>();
    for (const t of all) byId.set(t.id, t);

    const topType = this._type(); // 'profile' | 'package'
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

  /** On phone the 9-column / ~1,235px individual view is unusable — Name
   *  scrolled off-screen immediately. Pin the name and drop the columns a
   *  phone admin doesn't edit; desktop/iPad keep the full set. */
  protected phoneTrim(cols: ColDef<TestRow>[]): ColDef<TestRow>[] {
    if (!this.isPhone) return cols;
    const drop = new Set(['shortName', 'section', 'tubeColor', 'unit', 'tatHours', 'isActive']);
    return cols
      .filter(c => !drop.has(String(c.field ?? c.colId ?? '')))
      .map(c => (c.field === 'name' ? { ...c, pinned: 'left' as const, minWidth: 150, maxWidth: 190 } : c));
  }

  readonly colDefs = computed<ColDef<TestRow>[]>(() => {
    const view = this._type();

    // Individual view — flat catalogue, all core columns editable into a dirty
    // buffer (see onCellValueChanged / saveAll). Ref-range + Status stay read-only.
    if (view === 'individual') {
      return [
        {
          headerName: 'Code', field: 'testCode', editable: true, minWidth: 120, maxWidth: 160, sort: 'asc',
          // Red highlight the moment a code collides with another row's code.
          // Inline cellStyle (not a CSS class) so it applies to AG Grid's own
          // cell DOM regardless of Angular view encapsulation.
          cellStyle: (p) => this.isDupCode(p.data)
            ? { backgroundColor: 'rgba(239,68,68,0.28)', color: '#fecaca', fontWeight: '600' }
            : { backgroundColor: '', color: '', fontWeight: '' },
        },
        { headerName: 'Name', field: 'name', editable: true, minWidth: 180, flex: 2 },
        { headerName: 'Short', field: 'shortName', editable: true, minWidth: 120 },
        { headerName: 'Section', field: 'section', editable: true, minWidth: 130 },
        {
          // Pick the container/tube colour straight from the grid.
          // MUST bind `field: 'tubeColor'` — onCellValueChanged bails on
          // `if (!field) return`, so a colId-only column would look editable
          // and then drop every change on the floor. The editor works in
          // COLOUR KEYS ('edta'); valueFormatter renders the human label so
          // the cell and the dropdown both read "EDTA".
          headerName: 'Container', colId: 'container', field: 'tubeColor',
          minWidth: 160, editable: true,
          cellRenderer: this.containerRenderer,
          // Custom editor: a native <select> can't show the colour swatch, so
          // the dropdown would list bare names next to a cell showing a dot.
          cellEditor: TubeColorEditorComponent,
          cellEditorPopup: true,
          cellEditorParams: {
            choices: TUBE_CHOICES.map(k => ({ key: k, label: TUBE_LABEL[k], hex: TUBE_HEX[k] })),
          },
          valueFormatter: p => TUBE_LABEL[p.value as string] ?? '',
        },
        { headerName: 'Unit', field: 'unit', editable: true, minWidth: 100 },
        {
          // Editable, and bound to `adultReferenceRange` — the field the
          // backend now mirrors into the test's single parameter on save. It
          // was read-only and derived-only, so typing a range appeared to do
          // nothing. Shows the typed value when set, else the range derived
          // from the parameter JSON.
          // Conditional bands are the exception: one flat string can't hold
          // "13–17 for adult males, 12–15 for adult females", so those cells
          // are read-only and show every band instead.
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
        {
          headerName: 'TAT (h)', field: 'tatHours', editable: true, minWidth: 100, maxWidth: 120,
          cellEditor: 'agNumberCellEditor',
        },
        this.priceColDef(true),
        {
          headerName: 'Status', colId: 'status', minWidth: 100, maxWidth: 120, editable: false,
          valueGetter: p => (p.data?.isActive ? 'Active' : 'Inactive'),
        },
        this.actionsColDef(),
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
      // Short name — the individual grid has always shown it; profiles and
      // packages were missing it, so a bundle's abbreviation was invisible
      // and uneditable here.
      { headerName: 'Short', field: 'shortName', editable: true, minWidth: 110, sortable: false, filter: false },
      { headerName: 'Unit', field: 'unit', minWidth: 100, sortable: false, filter: false },
      {
        headerName: 'Reference range', colId: 'referenceRange', minWidth: 150, sortable: false, filter: false,
        valueGetter: p => this.referenceRange(p.data),
      },
      // Price stays editable — the PATCH targets the row's real test id, so
      // editing a bundle's price updates that bundle, not a synthetic key.
      { ...this.priceColDef(true), sortable: false, filter: false },
      this.actionsColDef(),
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
   * Individual Name cell: a small round tube-colour swatch (from `tubeColor`)
   * to the LEFT of the name. Display-only — AG Grid swaps in the text editor on
   * edit, so the name stays double-click editable.
   */
  /**
   * Container cell: the tube-colour swatch (from `tubeColor`, sourced from the
   * catalogue's Container) + its human label. Styles are INLINE because AG Grid
   * renders this cell DOM outside Angular's template, so view-encapsulated
   * classes never match here.
   */
  private containerRenderer = (params: ICellRendererParams<TestRow>): HTMLElement => {
    const key = params.data?.tubeColor ?? '';
    const hex = key ? TUBE_HEX[key] : undefined;
    const label = key ? (TUBE_LABEL[key] ?? key) : '—';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;height:100%;min-width:0;';

    const dot = document.createElement('span');
    dot.style.cssText = 'flex:0 0 auto;width:11px;height:11px;border-radius:50%;box-sizing:border-box;background:'
      + (hex ?? 'transparent')
      + (hex ? ';' : ';border:1px solid rgba(148,163,184,0.5);');
    wrap.appendChild(dot);

    const text = document.createElement('span');
    text.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    text.textContent = label;
    wrap.appendChild(text);
    return wrap;
  };

  /**
   * Row actions cell: an Edit (pencil) button that opens the full test editor.
   * Inline styles + a manual click listener, since AG Grid renders this DOM
   * outside Angular's template.
   */
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

  /** Shared pinned-right Edit column for every view. */
  private actionsColDef(): ColDef<TestRow> {
    return {
      headerName: '', colId: 'actions', cellRenderer: this.actionsRenderer,
      editable: false, sortable: false, filter: false, resizable: false,
      minWidth: 60, maxWidth: 64, pinned: 'right',
    };
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

  ngOnInit() {
    this.loadTests();
    this.loadDepartments();
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

  private loadDepartments() {
    this.api.get<DeptRecord[]>('/api/tenants/departments').subscribe({
      next: l => this._depts.set(l ?? []),
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }

  /** Enable/disable a real department (id-less buckets have no toggle). */
  toggleDept(d: DeptBucket) {
    if (!d.id) return;
    const id = d.id;
    const next = !d.isActive;
    // Optimistic flip; revert on error.
    this._depts.update(list => list.map(x => (x.id === id ? { ...x, isActive: next } : x)));
    this.api.patch(`/api/tenants/departments/${id}`, { isActive: next }).subscribe({
      next: () => {
        this.toasts.success(next ? 'Department enabled' : 'Department disabled');
        // Disabling a department takes all its tests out of service — reload so
        // the grid's Status column reflects the cascade.
        this.loadTests();
      },
      error: e => {
        this._depts.update(list => list.map(x => (x.id === id ? { ...x, isActive: !next } : x)));
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  /**
   * Readable reference range for the grid — EVERY band on one row.
   *
   * This used to show `referenceRanges[0]` alone, so a test configured with a
   * male and a female band displayed only the male one and looked as though
   * the other had been lost. Bands are labelled and joined with a middot
   * ("Adult Male 13–17 · Adult Female 12–15") rather than expanding into extra
   * grid rows: the row is the TEST, and a test doesn't become several rows
   * just because its range is conditional.
   */
  private referenceRange(t?: Test): string {
    if (!t?.parameters) return '';
    try {
      const blob = JSON.parse(t.parameters);
      const p = Array.isArray(blob?.parameters) ? blob.parameters[0] : undefined;
      if (!p) return '';
      const bands = describeAllRanges(p.referenceRanges);
      if (bands.length) {
        // The unit is stated once at the end; repeating it per band turns a
        // three-band test into an unreadable row.
        const unit = p.unit ? ` ${p.unit}` : '';
        return bands.join(' · ') + unit;
      }
      if (p.normalValue) return String(p.normalValue);
      return '';
    } catch { return ''; }
  }

  /**
   * True when the single analyte carries more than one band. The inline editor
   * writes ONE flat string, which cannot express conditional bands — so rather
   * than let a quick grid edit silently flatten a male/female pair into one
   * range, those cells are read-only and the admin edits them in the test
   * editor. (The backend refuses the same overwrite; this stops the UI from
   * offering an edit the API will ignore.)
   */
  private hasMultipleBands(t?: Test): boolean {
    if (!t?.parameters) return false;
    try {
      const blob = JSON.parse(t.parameters);
      const ps = Array.isArray(blob?.parameters) ? blob.parameters : [];
      return ps.length === 1 && Array.isArray(ps[0]?.referenceRanges)
        && ps[0].referenceRanges.length > 1;
    } catch { return false; }
  }

  /** Inline-edit committed → record it in the dirty buffer (no API call yet). */
  onCellValueChanged(e: CellValueChangedEvent<TestRow>) {
    const field = e.colDef.field;
    if (!field) return;
    if (e.newValue === e.oldValue) return;

    // Buffer against the row's REAL test id (never the synthetic `_key`) so a
    // bundle row's edit targets that bundle test, not a path key.
    const id = e.data.id;
    const value = field === 'price' || field === 'tatHours' ? Number(e.newValue) : e.newValue;

    this._dirty.update(prev => {
      const next = new Map(prev);
      next.set(id, { ...(next.get(id) ?? {}), [field]: value });
      return next;
    });

    // A code edit can create/clear a duplicate on this row AND its twin, so
    // re-evaluate the red-highlight class across the whole Code column.
    if (field === 'testCode') {
      this.gridApi?.refreshCells({ columns: ['testCode'], force: true });
    }
  }

  /** Flush every buffered edit as a PATCH per test id; reload on success. */
  saveAll() {
    if (this.saving()) return;
    const dirty = this._dirty();
    if (dirty.size === 0) return;

    // Early duplicate-code guard: compute each loaded test's EFFECTIVE code
    // (applying any pending testCode edit) and reject a case-insensitive clash
    // before touching the API. The backend also 409s on this.
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
        // Keep the dirty buffer so the user can fix and retry.
        this.saving.set(false);
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  /** Drop all buffered edits and revert the grid to server state. */
  discardChanges() {
    this._dirty.set(new Map());
    this.loadTests();
  }

  // ── Create test (routes to the full editor) ──────────────────
  /** Open the full test editor (same screen used to create a test). */
  editTest(id: string) {
    this.router.navigate(['/admin/tests', id, 'edit']);
  }

  openCreate() {
    this.router.navigate(['/admin/tests/new'], { queryParams: { type: this._type() } });
  }

}
