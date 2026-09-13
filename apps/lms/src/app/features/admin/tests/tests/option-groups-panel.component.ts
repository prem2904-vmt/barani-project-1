import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, RowClickedEvent } from 'ag-grid-community';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { Test } from '../../../../shared/models/test.model';
import { gridThemeDark, gridThemeLight } from './tests.component';

interface OgRow { code: string | null; value: string; normal: boolean; active: boolean; }
interface OgLink { testId: string; testCode: string | null; testName: string; paramName: string; paramTitle: string; }
interface OgGroup { code: string; name: string; values: OgRow[]; links: OgLink[]; }

/** One distinct test a group is linked into. */
interface OgTestRef { testId: string; testCode: string | null; testName: string; params: string[]; }

interface OgGridRow {
  group: OgGroup;
  name: string;
  valuesJoined: string;
  normalsJoined: string;
  testCount: number;
  testCodesJoined: string;
}

/** A pickable parameter of a test in the create-mapping flow. */
interface PickParam { testId: string; testCode: string | null; testName: string;
  paramName: string; paramTitle: string; mappedTo: string | null; }

/**
 * Test Master → OPTION GROUPS. Two panels, same grid language as the tests
 * view: the grid lists every shared vocabulary ONCE (linked tests as a
 * deduped comma list); the right panel carries the selected group's detail +
 * edit-once editor, or the create flow — define values, pick the parameters
 * to map them into, with a warning (and explicit confirm) when a target is
 * already mapped to a different vocabulary.
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
        <span class="pf-og__spacer"></span>
        <button type="button" class="pf-og__new press" (click)="startCreate()">+ New option group</button>
      </div>

      <div class="pf-og__cols">
        <!-- ── LEFT: the groups grid ── -->
        <div class="pf-og__grid">
          <ag-grid-angular
            style="width: 100%; height: 62vh;"
            [theme]="gridTheme()"
            [rowData]="rows()"
            [columnDefs]="columnDefs"
            [defaultColDef]="defaultColDef"
            [animateRows]="true"
            [suppressCellFocus]="true"
            (rowClicked)="onRowClicked($event)">
          </ag-grid-angular>
        </div>

        <!-- ── RIGHT: detail / create ── -->
        <aside class="pf-og__side">
          @if (mode() === 'create') {
            <div class="pf-og__shead">
              <span class="pf-og__sname">New option group</span>
              <button type="button" class="pf-og__ghost" (click)="mode.set('idle')">Cancel</button>
            </div>

            <div class="pf-og__slabel">Values</div>
            @for (r of draft(); track $index) {
              <div class="pf-og__row">
                <input type="text" class="pf-og__rowval" [ngModel]="r.value"
                       (ngModelChange)="patchRow($index, { value: $event })" placeholder="Value" />
                <label class="pf-og__flag"><input type="checkbox" [checked]="r.normal"
                       (change)="patchRow($index, { normal: !r.normal })" /> Normal</label>
                <button type="button" class="pf-og__rowdel" (click)="removeRow($index)" aria-label="Remove value">×</button>
              </div>
            }
            <button type="button" class="pf-og__addrow" (click)="addRow()">+ Add value</button>

            <div class="pf-og__slabel">Map into tests</div>
            <input type="text" class="pf-og__search pf-og__search--full" placeholder="Search a test…"
                   [ngModel]="pickQuery()" (ngModelChange)="pickQuery.set($event)" />
            @if (pickQuery().trim()) {
              <div class="pf-og__picklist">
                @for (p of pickable(); track p.testId + p.paramName) {
                  <label class="pf-og__pick" [class.pf-og__pick--warn]="p.mappedTo">
                    <input type="checkbox" [checked]="isTargeted(p)" (change)="toggleTarget(p)" />
                    <span class="pf-og__picktest">{{ p.testCode || '—' }} {{ p.testName }}</span>
                    <span class="pf-og__pickparam">{{ p.paramTitle }}</span>
                    @if (p.mappedTo) { <span class="pf-og__pickwarn">already mapped: {{ p.mappedTo }}</span> }
                  </label>
                } @empty {
                  <div class="pf-og__note">No matching parameters.</div>
                }
              </div>
            }
            @if (targets().length) {
              <div class="pf-og__slabel">Selected ({{ targets().length }})</div>
              <div class="pf-og__chips">
                @for (t of targets(); track t.testId + t.paramName) {
                  <span class="pf-og__chip" [class.pf-og__chip--warnmap]="t.mappedTo"
                        [title]="t.mappedTo ? 'Already mapped to: ' + t.mappedTo : ''">
                    {{ t.testCode || t.testName }} · {{ t.paramTitle }}
                    <button type="button" class="pf-og__chipx" (click)="toggleTarget(t)" aria-label="Remove">×</button>
                  </span>
                }
              </div>
            }
            <div class="pf-og__editact">
              @if (warnCount() > 0) {
                <span class="pf-og__warn pf-og__warn--amber">⚠ {{ warnCount() }} parameter{{ warnCount() === 1 ? ' is' : 's are' }} already mapped — saving replaces the existing table.</span>
              } @else { <span class="pf-og__warn"></span> }
              <button type="button" class="pf-og__save" [disabled]="saving() || !draftValid() || !targets().length"
                      (click)="create()">{{ saving() ? 'Saving…' : 'Create & map' }}</button>
            </div>
          }

          @else if (selected(); as g) {
            <div class="pf-og__shead">
              <span class="pf-og__sname">{{ g.name }}</span>
              @if (editing()) {
                <button type="button" class="pf-og__ghost" (click)="editing.set(false)">Cancel</button>
              } @else {
                <button type="button" class="pf-og__edit" (click)="startEdit(g)">Edit values</button>
              }
            </div>
            <div class="pf-og__chips">
              @for (v of g.values; track v.value) {
                <span class="pf-og__chip" [class.pf-og__chip--normal]="v.normal" [class.pf-og__chip--off]="!v.active">{{ v.value }}</span>
              }
            </div>

            @if (editing()) {
              <div class="pf-og__slabel">Values</div>
              @for (r of draft(); track $index) {
                <div class="pf-og__row">
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
                <span class="pf-og__warn">Updates {{ g.links.length }} parameter{{ g.links.length === 1 ? '' : 's' }} across {{ testsOf(g).length }} test{{ testsOf(g).length === 1 ? '' : 's' }}.</span>
                <button type="button" class="pf-og__save" [disabled]="saving() || !draftValid()" (click)="save(g)">
                  {{ saving() ? 'Saving…' : 'Save everywhere' }}
                </button>
              </div>
            }

            <div class="pf-og__slabel">Linked tests ({{ testsOf(g).length }})</div>
            <div class="pf-og__tests">
              @for (t of testsOf(g); track t.testId) {
                <button type="button" class="pf-og__test press" (click)="openTest(t.testId)"
                        [title]="'Open ' + (t.testCode || t.testName) + ' in the test editor'">
                  <span class="pf-og__tcode">{{ t.testCode || '—' }}</span>
                  <span class="pf-og__tname">{{ t.testName }}</span>
                  @if (paramsHint(t); as hint) {
                    <span class="pf-og__tparams">{{ hint }}</span>
                  }
                </button>
              }
            </div>
          }

          @else {
            <div class="pf-og__note">Select an option group to see its values and linked tests — or create a new one.</div>
          }
        </aside>
      </div>
    </div>
  `,
  styles: [`
    .pf-og { display: flex; flex-direction: column; gap: 12px; }
    .pf-og__bar { display: flex; align-items: center; gap: 12px; }
    .pf-og__spacer { flex: 1; }
    .pf-og__search { flex: 0 1 320px; padding: 9px 12px; border-radius: 10px; font-size: 13px;
      color: var(--text-primary); background: var(--input-bg); border: 1px solid var(--input-border); outline: none; }
    .pf-og__search--full { flex: none; width: 100%; box-sizing: border-box; margin-bottom: 6px; }
    .pf-og__search:focus { border-color: var(--input-border-focus); }
    .pf-og__count { font-size: 12px; font-weight: 600; color: var(--text-tertiary); white-space: nowrap; }
    .pf-og__new { padding: 8px 14px; border-radius: 10px; font-size: 12.5px; font-weight: 700; color: #fff; cursor: pointer;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; }
    .pf-og__note { padding: 28px 12px; text-align: center; font-size: 12.5px; color: var(--text-tertiary); }

    /* Two panels — grid left, detail/create right (mirrors the tests view). */
    .pf-og__cols { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(330px, 0.75fr); gap: 14px; align-items: start; }
    @media (max-width: 980px) { .pf-og__cols { grid-template-columns: 1fr; } }
    .pf-og__grid { border-radius: 12px; overflow: hidden; }
    .pf-og__side { border: 1px solid var(--glass-border); border-radius: 14px; background: var(--glass-bg);
      padding: 14px 16px; max-height: 62vh; overflow-y: auto; }

    .pf-og__shead { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
    .pf-og__sname { font-size: 14px; font-weight: 700; color: var(--text-primary); }
    .pf-og__slabel { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
      color: var(--text-tertiary); margin: 14px 0 6px; }
    .pf-og__chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .pf-og__chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-og__chip--normal { color: #34d399; border-color: rgba(34,197,94,.45); background: rgba(34,197,94,.08); }
    .pf-og__chip--off { opacity: .45; text-decoration: line-through; }
    .pf-og__chip--warnmap { color: #fbbf24; border-color: rgba(245,158,11,.5); background: rgba(245,158,11,.08); }
    .pf-og__chipx { border: none; background: transparent; color: inherit; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
    .pf-og__edit { padding: 6px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--violet-text, #a78bfa); background: rgba(124,58,237,.1); border: 1px solid rgba(124,58,237,.35); }
    .pf-og__ghost { padding: 6px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }

    .pf-og__row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
    .pf-og__rowval { flex: 1; min-width: 0; padding: 7px 10px; border-radius: 8px; font-size: 13px;
      color: var(--text-primary); background: var(--input-bg); border: 1px solid var(--input-border); outline: none; }
    .pf-og__flag { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--text-secondary); white-space: nowrap; }
    .pf-og__rowdel { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; border: none; cursor: pointer;
      color: var(--text-tertiary); background: transparent; font-size: 14px; line-height: 1; }
    .pf-og__rowdel:hover { color: #ef4444; background: rgba(239,68,68,.12); }
    .pf-og__addrow { margin-top: 6px; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: transparent; border: 1px dashed var(--glass-border); }
    .pf-og__editact { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding-top: 10px;
      border-top: 1px solid var(--glass-border); }
    .pf-og__warn { flex: 1; font-size: 11.5px; color: var(--text-tertiary); }
    .pf-og__warn--amber { color: #fbbf24; font-weight: 600; }
    .pf-og__save { padding: 7px 16px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: #fff; cursor: pointer;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; }
    .pf-og__save:disabled { opacity: .5; cursor: default; }

    .pf-og__picklist { max-height: 220px; overflow-y: auto; border: 1px solid var(--glass-border); border-radius: 10px; }
    .pf-og__pick { display: flex; align-items: baseline; gap: 8px; padding: 7px 10px; cursor: pointer;
      border-bottom: 1px solid var(--glass-border); font-size: 12px; }
    .pf-og__pick:last-child { border-bottom: none; }
    .pf-og__pick:hover { background: rgba(124,58,237,.06); }
    .pf-og__picktest { font-weight: 600; color: var(--text-primary); white-space: nowrap; }
    .pf-og__pickparam { color: var(--text-secondary); }
    .pf-og__pickwarn { margin-left: auto; font-size: 10.5px; font-weight: 600; color: #fbbf24; white-space: nowrap; }
    .pf-og__pick--warn { background: rgba(245,158,11,.05); }

    .pf-og__tests { display: flex; flex-direction: column; gap: 6px; }
    .pf-og__test { display: flex; align-items: baseline; gap: 7px; width: 100%; cursor: pointer;
      padding: 7px 11px; border-radius: 10px; text-align: left;
      background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-og__test:hover { border-color: rgba(139,92,246,.5); }
    .pf-og__tcode { flex-shrink: 0; font-size: 12px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-og__tname { font-size: 12px; color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-og__tparams { margin-left: auto; font-size: 11px; color: var(--text-tertiary); white-space: nowrap; }
  `],
})
export class OptionGroupsPanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly theme = inject(ThemeService);
  private readonly dialog = inject(DialogService);

  // Exact same theme objects as the tests grid — one look, two views.
  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));

  readonly saving = signal(false);
  readonly query = signal('');
  readonly groups = signal<OgGroup[]>([]);
  readonly selected = signal<OgGroup | null>(null);
  readonly editing = signal(false);
  readonly mode = signal<'idle' | 'create'>('idle');
  readonly draft = signal<OgRow[]>([]);
  readonly pickQuery = signal('');
  readonly targets = signal<PickParam[]>([]);
  private readonly allParams = signal<PickParam[]>([]);

  readonly defaultColDef: ColDef = { sortable: true, resizable: true, filter: false, suppressMovable: true };
  readonly columnDefs: ColDef<OgGridRow>[] = [
    { headerName: 'Option group', field: 'name', minWidth: 170, flex: 1,
      cellStyle: { fontWeight: '600' } },
    { headerName: 'Values', field: 'valuesJoined', minWidth: 200, flex: 1.4 },
    { headerName: 'Normal', field: 'normalsJoined', minWidth: 100, maxWidth: 150 },
    { headerName: 'Tests', field: 'testCount', minWidth: 84, maxWidth: 95, sort: 'desc' },
    { headerName: 'Linked tests', field: 'testCodesJoined', minWidth: 180, flex: 1.3,
      tooltipField: 'testCodesJoined' },
  ];

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
          valuesJoined: g.values.filter(v => v.active).map(v => v.value).join(', '),
          normalsJoined: g.values.filter(v => v.normal && v.active).map(v => v.value).join(', '),
          testCount: tests.length,
          testCodesJoined: tests.map(t => t.testCode || t.testName).join(', '),
        };
      });
  });

  /** Create-mode picker: parameters matching the search, mapped-state marked. */
  readonly pickable = computed<PickParam[]>(() => {
    const q = this.pickQuery().trim().toLowerCase();
    if (!q) return [];
    return this.allParams()
      .filter(p => p.testName.toLowerCase().includes(q)
        || (p.testCode ?? '').toLowerCase().includes(q)
        || p.paramTitle.toLowerCase().includes(q))
      .slice(0, 60);
  });
  readonly warnCount = computed(() => this.targets().filter(t => t.mappedTo).length);

  ngOnInit() { this.load(); }

  /** Parameter titles worth showing beside a linked test — only the ones
   *  that don't just repeat the test's own name (a single-parameter test
   *  named after its parameter would otherwise read twice). */
  paramsHint(t: OgTestRef): string | null {
    const distinct = t.params.filter(p => p.toLowerCase() !== t.testName.toLowerCase());
    return distinct.length ? distinct.join(', ') : null;
  }

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
    this.mode.set('idle');
    this.selected.set(this.selected()?.code === g?.code ? null : g);
    this.editing.set(false);
  }

  // ── Edit existing ──────────────────────────────────────────────
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
        this.saving.set(false); this.editing.set(false); this.selected.set(null);
        this.toasts.success(`Option group updated across ${res.updatedTests} test${res.updatedTests === 1 ? '' : 's'}`);
        this.load();
      },
      error: () => { this.saving.set(false); this.toasts.error('Could not update the option group'); },
    });
  }

  // ── Create + map ───────────────────────────────────────────────
  startCreate() {
    this.selected.set(null);
    this.editing.set(false);
    this.draft.set([{ code: null, value: '', normal: false, active: true }]);
    this.targets.set([]);
    this.pickQuery.set('');
    this.mode.set('create');
    if (!this.allParams().length) this.loadParams();
  }
  isTargeted(p: PickParam): boolean {
    return this.targets().some(t => t.testId === p.testId && t.paramName === p.paramName);
  }
  toggleTarget(p: PickParam) {
    this.targets.update(ts => this.isTargeted(p)
      ? ts.filter(t => !(t.testId === p.testId && t.paramName === p.paramName))
      : [...ts, p]);
  }

  async create() {
    const warned = this.targets().filter(t => t.mappedTo);
    if (warned.length) {
      const ok = await this.dialog.confirm({
        title: 'Replace existing option tables?',
        message: `${warned.length} of the selected parameter${warned.length === 1 ? ' is' : 's are'} already mapped to another option group (${[...new Set(warned.map(w => w.mappedTo))].join('; ')}). Saving replaces their current values with the new group.`,
        confirmLabel: 'Replace and map',
        cancelLabel: 'Go back',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this.saving.set(true);
    this.api.post<{ updatedTests: number }>('/api/option-groups', {
      values: this.draft().filter(r => r.value.trim()),
      targets: this.targets().map(t => ({ testId: t.testId, paramName: t.paramName })),
      force: warned.length > 0,
    }).subscribe({
      next: res => {
        this.saving.set(false); this.mode.set('idle');
        this.toasts.success(`Option group mapped into ${res.updatedTests} test${res.updatedTests === 1 ? '' : 's'}`);
        this.allParams.set([]);
        this.load();
      },
      error: () => { this.saving.set(false); this.toasts.error('Could not create the option group'); },
    });
  }

  openTest(testId: string) {
    this.router.navigate(['/admin/tests', testId, 'edit']);
  }

  private load() {
    this.api.get<OgGroup[]>('/api/option-groups').subscribe({
      next: gs => {
        this.groups.set(gs ?? []);
        // Default-select the top group (most used) so the side panel is
        // never an empty "select one" placeholder.
        if (this.mode() === 'idle' && !this.selected() && gs?.length) this.selected.set(gs[0]);
      },
      error: () => this.toasts.error('Could not load option groups'),
    });
  }

  /** Flatten the tenant's tests into pickable parameters for the mapper. */
  private loadParams() {
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: tests => {
        const flat: PickParam[] = [];
        for (const t of (tests ?? []).filter(t => t.type === 'individual' && t.isActive !== false)) {
          if (!t.parameters) continue;
          try {
            const blob = JSON.parse(t.parameters) as { parameters?: Array<{
              name?: string; title?: string; optionRows?: Array<{ value?: string }> }> };
            for (const p of blob.parameters ?? []) {
              if (!p.name) continue;
              const mapped = (p.optionRows ?? []).map(r => r.value).filter(Boolean) as string[];
              flat.push({
                testId: t.id, testCode: t.testCode ?? null, testName: t.name,
                paramName: p.name, paramTitle: p.title || p.name,
                mappedTo: mapped.length ? mapped.join(' / ') : null,
              });
            }
          } catch { /* unparseable Parameters — skip */ }
        }
        this.allParams.set(flat);
      },
      error: () => this.toasts.error('Could not load tests for mapping'),
    });
  }
}
