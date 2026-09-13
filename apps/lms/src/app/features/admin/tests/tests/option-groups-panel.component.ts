import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ColDef, RowClickedEvent, colorSchemeDark, colorSchemeLight, themeQuartz,
} from 'ag-grid-community';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';

interface OgRow { code: string | null; value: string; normal: boolean; active: boolean; }
interface OgLink { testId: string; testCode: string | null; testName: string; paramName: string; paramTitle: string; }
interface OgGroup { code: string; name: string; values: OgRow[]; links: OgLink[]; }

/** One distinct test a group is linked into (a test may use it on several parameters). */
interface OgTestRef { testId: string; testCode: string | null; testName: string; params: string[]; }

interface OgGridRow {
  group: OgGroup;
  name: string;
  code: string;
  valuesJoined: string;
  normalsJoined: string;
  testCount: number;
  paramCount: number;
  testCodesJoined: string;
}

// Mirrors the Tests grid theme so the two views read as one screen.
const ogThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13, rowHeight: 44, headerHeight: 40,
  borderRadius: 12, accentColor: '#7c3aed',
});
const ogThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13, rowHeight: 44, headerHeight: 40,
  borderRadius: 12, accentColor: '#a78bfa', backgroundColor: 'transparent',
});

/**
 * Test Master → OPTION GROUPS: every shared result vocabulary exactly ONCE,
 * in the same AG-Grid language as the tests view. Linked tests appear as a
 * deduped comma list on the row; clicking a row opens the detail below —
 * the distinct tests it is mapped into (each opens the test editor) and the
 * edit-once value editor whose save rewrites every linked parameter.
 */
@Component({
  selector: 'pf-option-groups-panel',
  standalone: true,
  imports: [AgGridAngular, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-og">
      <div class="pf-og__bar">
        <input type="text" class="pf-og__search" placeholder="Search values, tests, parameters…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
        <span class="pf-og__count">{{ rows().length }} option group{{ rows().length === 1 ? '' : 's' }}</span>
      </div>

      <div class="pf-og__grid">
        <ag-grid-angular
          style="width: 100%; height: 46vh;"
          [theme]="gridTheme()"
          [rowData]="rows()"
          [columnDefs]="columnDefs"
          [defaultColDef]="defaultColDef"
          [animateRows]="true"
          [suppressCellFocus]="true"
          (rowClicked)="onRowClicked($event)">
        </ag-grid-angular>
      </div>

      @if (selected(); as g) {
        <div class="pf-og__detail">
          <div class="pf-og__dhead">
            <div class="pf-og__dtitles">
              <span class="pf-og__dname">{{ g.name }}</span>
              <span class="pf-og__dcode">{{ g.code }}</span>
            </div>
            <div class="pf-og__dchips">
              @for (v of g.values; track v.value) {
                <span class="pf-og__chip" [class.pf-og__chip--normal]="v.normal" [class.pf-og__chip--off]="!v.active">{{ v.value }}</span>
              }
            </div>
            @if (editing()) {
              <button type="button" class="pf-og__ghost" (click)="editing.set(false)">Cancel</button>
            } @else {
              <button type="button" class="pf-og__edit" (click)="startEdit(g)">Edit values</button>
            }
          </div>

          @if (editing()) {
            <div class="pf-og__editor">
              @for (r of draft(); track $index) {
                <div class="pf-og__row">
                  <span class="pf-og__rowcode">{{ r.code || '—' }}</span>
                  <input type="text" class="pf-og__rowval" [ngModel]="r.value"
                         (ngModelChange)="patchRow($index, { value: $event })" placeholder="Value" />
                  <label class="pf-og__flag"><input type="checkbox" [checked]="r.normal"
                         (change)="patchRow($index, { normal: !r.normal })" /> Normal</label>
                  <label class="pf-og__flag"><input type="checkbox" [checked]="r.active"
                         (change)="patchRow($index, { active: !r.active })" /> Active</label>
                  <button type="button" class="pf-og__rowdel" (click)="removeRow($index)" aria-label="Remove value">×</button>
                </div>
              }
              <button type="button" class="pf-og__addrow" (click)="addRow()">+ Add value</button>
              <div class="pf-og__editact">
                <span class="pf-og__warn">Saving updates {{ g.links.length }} parameter{{ g.links.length === 1 ? '' : 's' }} across {{ testsOf(g).length }} test{{ testsOf(g).length === 1 ? '' : 's' }}.</span>
                <button type="button" class="pf-og__save" [disabled]="saving() || !draftValid()" (click)="save(g)">
                  {{ saving() ? 'Saving…' : 'Save everywhere' }}
                </button>
              </div>
            </div>
          }

          <!-- Distinct linked tests — one chip per test, parameters inline. -->
          <div class="pf-og__tests">
            @for (t of testsOf(g); track t.testId) {
              <button type="button" class="pf-og__test press" (click)="openTest(t.testId)"
                      [title]="'Open ' + (t.testCode || t.testName) + ' in the test editor'">
                <span class="pf-og__tcode">{{ t.testCode || '—' }}</span>
                <span class="pf-og__tname">{{ t.testName }}</span>
                @if (t.params.length > 1 || t.params[0] !== g.name) {
                  <span class="pf-og__tparams">{{ t.params.join(', ') }}</span>
                }
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .pf-og { display: flex; flex-direction: column; gap: 12px; }
    .pf-og__bar { display: flex; align-items: center; gap: 12px; }
    .pf-og__search { flex: 0 1 340px; padding: 9px 12px; border-radius: 10px; font-size: 13px;
      color: var(--text-primary); background: var(--input-bg); border: 1px solid var(--input-border); outline: none; }
    .pf-og__search:focus { border-color: var(--input-border-focus); }
    .pf-og__count { font-size: 12px; font-weight: 600; color: var(--text-tertiary); }
    .pf-og__grid { border-radius: 12px; overflow: hidden; }

    .pf-og__detail { border: 1px solid rgba(139,92,246,.4); border-radius: 14px; background: var(--glass-bg); padding: 14px 16px; }
    .pf-og__dhead { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .pf-og__dtitles { flex-shrink: 0; }
    .pf-og__dname { display: block; font-size: 14px; font-weight: 700; color: var(--text-primary); }
    .pf-og__dcode { font-size: 10.5px; font-weight: 600; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-og__dchips { flex: 1; display: flex; flex-wrap: wrap; gap: 4px; min-width: 200px; }
    .pf-og__chip { font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-og__chip--normal { color: #34d399; border-color: rgba(34,197,94,.45); background: rgba(34,197,94,.08); }
    .pf-og__chip--off { opacity: .45; text-decoration: line-through; }
    .pf-og__edit { padding: 6px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--violet-text, #a78bfa); background: rgba(124,58,237,.1); border: 1px solid rgba(124,58,237,.35); }
    .pf-og__ghost { padding: 6px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }

    .pf-og__editor { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--glass-border); }
    .pf-og__row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
    .pf-og__rowcode { flex-shrink: 0; width: 52px; font-size: 11px; font-weight: 600; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-og__rowval { flex: 0 1 280px; padding: 7px 10px; border-radius: 8px; font-size: 13px;
      color: var(--text-primary); background: var(--input-bg); border: 1px solid var(--input-border); outline: none; }
    .pf-og__flag { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); }
    .pf-og__rowdel { flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%; border: none; cursor: pointer;
      color: var(--text-tertiary); background: transparent; font-size: 15px; line-height: 1; }
    .pf-og__rowdel:hover { color: #ef4444; background: rgba(239,68,68,.12); }
    .pf-og__addrow { margin-top: 6px; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: transparent; border: 1px dashed var(--glass-border); }
    .pf-og__editact { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
    .pf-og__warn { flex: 1; font-size: 11.5px; color: var(--text-tertiary); }
    .pf-og__save { padding: 7px 16px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: #fff; cursor: pointer;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; }
    .pf-og__save:disabled { opacity: .5; cursor: default; }

    .pf-og__tests { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .pf-og__test { display: inline-flex; align-items: baseline; gap: 7px; max-width: 100%; cursor: pointer;
      padding: 6px 12px; border-radius: 10px; text-align: left;
      background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-og__test:hover { border-color: rgba(139,92,246,.5); }
    .pf-og__tcode { font-size: 12px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-og__tname { font-size: 12px; color: var(--text-secondary); }
    .pf-og__tparams { font-size: 11px; color: var(--text-tertiary); }
  `],
})
export class OptionGroupsPanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly theme = inject(ThemeService);

  readonly gridTheme = computed(() => (this.theme.isDark() ? ogThemeDark : ogThemeLight));

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly query = signal('');
  readonly groups = signal<OgGroup[]>([]);
  readonly selected = signal<OgGroup | null>(null);
  readonly editing = signal(false);
  readonly draft = signal<OgRow[]>([]);

  readonly defaultColDef: ColDef = { sortable: true, resizable: true, filter: false, suppressMovable: true };
  readonly columnDefs: ColDef<OgGridRow>[] = [
    { headerName: 'Option group', field: 'name', minWidth: 190, flex: 1.1,
      cellStyle: { fontWeight: '600' } },
    { headerName: 'Code', field: 'code', minWidth: 120, maxWidth: 130 },
    { headerName: 'Values', field: 'valuesJoined', minWidth: 220, flex: 1.4 },
    { headerName: 'Normal', field: 'normalsJoined', minWidth: 110, maxWidth: 160 },
    { headerName: 'Tests', field: 'testCount', minWidth: 90, maxWidth: 100, sort: 'desc' },
    { headerName: 'Linked tests', field: 'testCodesJoined', minWidth: 240, flex: 1.6,
      tooltipField: 'testCodesJoined' },
  ];

  /** One grid row per group; linked tests deduped into a comma list. */
  readonly rows = computed<OgGridRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    return this.groups()
      .filter(g => !q
        || g.name.toLowerCase().includes(q)
        || g.values.some(v => v.value.toLowerCase().includes(q))
        || g.links.some(l => l.testName.toLowerCase().includes(q)
          || (l.testCode ?? '').toLowerCase().includes(q)
          || l.paramTitle.toLowerCase().includes(q)))
      .map(g => {
        const tests = this.testsOf(g);
        return {
          group: g,
          name: g.name,
          code: g.code,
          valuesJoined: g.values.filter(v => v.active).map(v => v.value).join(', '),
          normalsJoined: g.values.filter(v => v.normal && v.active).map(v => v.value).join(', '),
          testCount: tests.length,
          paramCount: g.links.length,
          testCodesJoined: tests.map(t => t.testCode || t.testName).join(', '),
        };
      });
  });

  ngOnInit() { this.load(); }

  /** Distinct tests of a group, each with the parameter titles it maps to. */
  testsOf(g: OgGroup): OgTestRef[] {
    const byId = new Map<string, OgTestRef>();
    for (const l of g.links) {
      const t = byId.get(l.testId);
      if (t) t.params.push(l.paramTitle);
      else byId.set(l.testId, { testId: l.testId, testCode: l.testCode, testName: l.testName, params: [l.paramTitle] });
    }
    return [...byId.values()];
  }

  onRowClicked(e: RowClickedEvent<OgGridRow>) {
    const g = e.data?.group ?? null;
    this.selected.set(this.selected()?.code === g?.code ? null : g);
    this.editing.set(false);
  }

  startEdit(g: OgGroup) {
    this.draft.set(g.values.map(v => ({ ...v })));
    this.editing.set(true);
  }
  patchRow(ix: number, patch: Partial<OgRow>) {
    this.draft.update(rows => rows.map((r, i) => i === ix ? { ...r, ...patch } : r));
  }
  removeRow(ix: number) { this.draft.update(rows => rows.filter((_, i) => i !== ix)); }
  addRow() { this.draft.update(rows => [...rows, { code: null, value: '', normal: false, active: true }]); }
  draftValid(): boolean { return this.draft().some(r => r.value.trim().length > 0); }

  save(g: OgGroup) {
    this.saving.set(true);
    this.api.put<{ updatedTests: number }>(`/api/option-groups/${g.code}`, {
      values: this.draft().filter(r => r.value.trim()),
    }).subscribe({
      next: res => {
        this.saving.set(false);
        this.editing.set(false);
        this.selected.set(null);
        this.toasts.success(`Option group updated across ${res.updatedTests} test${res.updatedTests === 1 ? '' : 's'}`);
        this.load();
      },
      error: () => { this.saving.set(false); this.toasts.error('Could not update the option group'); },
    });
  }

  openTest(testId: string) {
    this.router.navigate(['/admin/tests', testId, 'edit']);
  }

  private load() {
    this.loading.set(true);
    this.api.get<OgGroup[]>('/api/option-groups').subscribe({
      next: gs => { this.groups.set(gs ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); this.toasts.error('Could not load option groups'); },
    });
  }
}
