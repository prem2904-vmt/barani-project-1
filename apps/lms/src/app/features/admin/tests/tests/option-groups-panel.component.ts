import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, RowClickedEvent } from 'ag-grid-community';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { Test } from '../../../../shared/models/test.model';
import { gridThemeDark, gridThemeLight } from './grid-theme';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { SkeletonCardComponent, SkeletonTableComponent } from '../../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../../shared/utils/min-duration';
import { prefetch } from '../../../../shared/utils/prefetch';
import { TEST_EDITOR_PREFETCH_KEY, loadTestEditor } from '../test-editor/test-editor.loader';
import { TM_NARROW, TM_TWO_PANEL_STYLES, mediaSignal } from './tm-two-panel';

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
  imports: [AgGridAngular, FormsModule, BusyDirective, SkeletonTableComponent, SkeletonCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-og">
      @if (bandQuery() === null) {
        <!-- Classic only: Test Master's band pill carries search + "New" in the new design. -->
        <div class="pf-og__bar">
          <input type="search" class="pf-input pf-og__search" placeholder="Search values, tests, parameters…" aria-label="Search option groups"
                 [ngModel]="query()" (ngModelChange)="query.set($event)" />
          <span class="pf-og__spacer"></span>
          <button type="button" class="pf-btn pf-og__new press" [class.pf-btn--primary]="!sheetOpen()"
                  [class.pf-btn--secondary]="sheetOpen()" (click)="startCreate()">+ New option group</button>
        </div>
      }

      <!-- Test Master's two-panel (owner 2026-11-17): LEFT side card = the selected group's detail / editor,
           RIGHT main card = the groups grid, flush. Same height; only the bodies scroll. Narrow: the side card
           is a sheet opened by a row click. -->
      <div class="pf-2p pf-og__cols" [class.pf-2p--narrow]="narrow()">
        @if (narrow() && sideShown()) { <div class="pf-2p__backdrop" (click)="closeSide()" aria-hidden="true"></div> }
        @if (!narrow() || sideShown()) {
        <aside class="pf-card pf-2p__side pf-og__side" [class.pf-2p__sheet]="narrow()" data-testid="og-side"
               [attr.role]="narrow() ? 'dialog' : null" [attr.aria-modal]="narrow() ? 'true' : null"
               [attr.aria-label]="mode() === 'create' ? 'New option group' : 'Option group'" (keydown.escape)="closeSide()">
          <span class="pf-2p__handle" aria-hidden="true"></span>
          @if (listSkeleton() && mode() !== 'create') {
            <pf-skeleton-card [lines]="5" [boxed]="false" label="Loading option group…"></pf-skeleton-card>
          }
          @else if (mode() === 'create') {
            <div class="pf-card__head">
              <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span>
              <span class="pf-card__label">New option group</span>
              <span class="pf-card__spacer"></span>
              <button type="button" class="pf-btn pf-btn--tertiary pf-2p__hbtn press" (click)="mode.set('idle')">Cancel</button>
              <!-- Actions in the head (owner 2026-11-17: nothing clickable at the bottom). -->
              <button type="button" class="pf-btn pf-btn--primary pf-2p__hbtn pf-og__save press" [disabled]="saving() || !draftValid() || !targets().length"
                      [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="create()">{{ saving() ? 'Saving…' : 'Create & map' }}</button>
            </div>
            <div class="pf-card__body">
              @if (warnCount() > 0) {
                <span class="pf-og__warn pf-og__warn--amber">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                  {{ warnCount() }} parameter{{ warnCount() === 1 ? ' is' : 's are' }} already mapped — saving replaces the existing table.</span>
              }
              <div class="pf-og__slabel">Values</div>
              @for (r of draft(); track $index) {
                <div class="pf-og__row">
                  <input type="text" class="pf-input pf-input--sm pf-og__rowval" [ngModel]="r.value" aria-label="Value"
                         (ngModelChange)="patchRow($index, { value: $event })" placeholder="Value" />
                  <button type="button" class="pf-toggle pf-og__flag" role="switch" [attr.aria-checked]="r.normal"
                        (click)="patchRow($index, { normal: !r.normal })"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Normal</button>
                  <button type="button" class="pf-og__rowdel press" (click)="removeRow($index)" aria-label="Remove value" title="Remove value"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                </div>
              }
              <button type="button" class="pf-btn pf-btn--tertiary pf-og__addrow press" (click)="addRow()">+ Add value</button>

              <div class="pf-og__slabel">Map into tests</div>
              <input type="search" class="pf-input pf-og__search--full" placeholder="Search a test…" aria-label="Search a test"
                     [ngModel]="pickQuery()" (ngModelChange)="pickQuery.set($event)" />
              @if (pickQuery().trim()) {
                <div class="pf-og__picklist">
                  @for (p of pickable(); track p.testId + p.paramName) {
                    <label class="pf-row pf-og__pick" [class.pf-row--in]="isTargeted(p)">
                      <input type="checkbox" class="pf-og__srcheck" [checked]="isTargeted(p)" (change)="toggleTarget(p)" />
                      <span class="pf-row__check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                      <span class="pf-row__name pf-og__picktest"><span class="pf-num pf-og__pcode">{{ p.testCode || '—' }}</span> {{ p.testName }}
                        <span class="pf-og__pickparam">{{ p.paramTitle }}</span></span>
                      @if (p.mappedTo) { <span class="pf-og__pickwarn">already mapped: {{ p.mappedTo }}</span> }
                    </label>
                  } @empty {
                    <div class="pf-og__note">No matching parameters.</div>
                  }
                </div>
              }
              @if (targets().length) {
                <div class="pf-og__slabel">Selected (<span class="pf-num">{{ targets().length }}</span>)</div>
                <div class="pf-og__chips">
                  @for (t of targets(); track t.testId + t.paramName) {
                    <span class="pf-og__chip" [class.pf-og__chip--warnmap]="t.mappedTo"
                          [title]="t.mappedTo ? 'Already mapped to: ' + t.mappedTo : ''">
                      {{ t.testCode || t.testName }} · {{ t.paramTitle }}
                      <button type="button" class="pf-og__chipx" (click)="toggleTarget(t)" aria-label="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                    </span>
                  }
                </div>
              }
            </div>
          }

          @else if (selected(); as g) {
            <div class="pf-card__head">
              <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span>
              <span class="pf-card__label pf-2p__name pf-og__sname">{{ g.name }}</span>
              <span class="pf-card__spacer"></span>
              @if (editing()) {
                <button type="button" class="pf-btn pf-btn--tertiary pf-2p__hbtn press" (click)="editing.set(false)">Cancel</button>
                <!-- Actions in the head (owner 2026-11-17: nothing clickable at the bottom). -->
                <button type="button" class="pf-btn pf-btn--primary pf-2p__hbtn pf-og__save press" [disabled]="saving() || !draftValid()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save(g)">
                  {{ saving() ? 'Saving…' : 'Save everywhere' }}
                </button>
              } @else {
                <button type="button" class="pf-btn pf-btn--secondary pf-2p__hbtn pf-og__edit press" (click)="startEdit(g)">Edit values</button>
              }
              @if (narrow()) {
                <button type="button" class="pf-btn pf-btn--icon pf-2p__hbtn" (click)="closeSide()" aria-label="Close option group"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
              }
            </div>
            <div class="pf-card__body">
              <div class="pf-og__chips">
                @for (v of g.values; track v.value) {
                  <span class="pf-og__chip" [class.pf-og__chip--normal]="v.normal" [class.pf-og__chip--off]="!v.active"
                        [title]="v.normal ? 'Normal (expected) value' : ''">
                    @if (v.normal) { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> }
                    {{ v.value }}</span>
                }
              </div>

              @if (editing()) {
                <span class="pf-og__warn">Updates <span class="pf-num">{{ g.links.length }}</span> parameter{{ g.links.length === 1 ? '' : 's' }} across <span class="pf-num">{{ testsOf(g).length }}</span> test{{ testsOf(g).length === 1 ? '' : 's' }}.</span>
                <div class="pf-og__slabel">Values</div>
                @for (r of draft(); track $index) {
                  <div class="pf-og__row">
                  <input type="text" class="pf-input pf-input--sm pf-og__rowval" [ngModel]="r.value" aria-label="Value"
                         (ngModelChange)="patchRow($index, { value: $event })" placeholder="Value" />
                  <button type="button" class="pf-toggle pf-og__flag" role="switch" [attr.aria-checked]="r.normal"
                        (click)="patchRow($index, { normal: !r.normal })"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Normal</button>
                  <button type="button" class="pf-toggle pf-og__flag" role="switch" [attr.aria-checked]="r.active"
                        (click)="patchRow($index, { active: !r.active })"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Active</button>
                  <button type="button" class="pf-og__rowdel press" (click)="removeRow($index)" aria-label="Remove value" title="Remove value"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                </div>
                }
                <button type="button" class="pf-btn pf-btn--tertiary pf-og__addrow press" (click)="addRow()">+ Add value</button>
              }

              <div class="pf-og__slabel">Linked tests (<span class="pf-num">{{ testsOf(g).length }}</span>)</div>
              <div class="pf-og__tests">
                @for (t of testsOf(g); track t.testId) {
                  <button type="button" class="pf-row pf-og__test press" (click)="openTest(t.testId)"
                          (pointerenter)="warmEditor()" (focus)="warmEditor()"
                          [attr.aria-label]="'Open ' + (t.testCode || t.testName) + ' in the test editor'">
                    <span class="pf-num pf-og__tcode">{{ t.testCode || '—' }}</span>
                    <span class="pf-row__name pf-og__tname">{{ t.testName }}</span>
                    @if (paramsHint(t); as hint) {
                      <span class="pf-row__meta pf-og__tparams">{{ hint }}</span>
                    }
                  </button>
                }
              </div>
            </div>
          }

          @else {
            <div class="pf-og__note">Select an option group to see its values and linked tests — or create a new one.</div>
          }
        </aside>
        }

        <section class="pf-card pf-2p__main pf-og__main" aria-label="Option groups" data-testid="og-main">
          <header class="pf-card__head pf-2p__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span>
            <span class="pf-card__label">Option groups</span>
            <span class="pf-card__note">Edit once — every linked parameter changes</span>
            <span class="pf-2p__count pf-og__count"><span class="pf-num">{{ rows().length }}</span> group{{ rows().length === 1 ? '' : 's' }}</span>
          </header>
          <div class="pf-2p__body">
            @if (listSkeleton()) {
              <!-- First load: the grid's shape over the mounted grid (PF-PATTERN "Loading feedback"). -->
              <pf-skeleton-table class="pf-2p__skel" [rows]="8" [cols]="5" label="Loading option groups…"></pf-skeleton-table>
            }
            <ag-grid-angular
              class="pf-2p__grid"
              [theme]="gridTheme()"
              [rowData]="rows()"
              [columnDefs]="columnDefs"
              [defaultColDef]="defaultColDef"
              [getRowClass]="rowClass"
              [animateRows]="true"
              [suppressCellFocus]="true"
              (rowClicked)="onRowClicked($event)">
            </ag-grid-angular>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
    .pf-og { display: flex; flex-direction: column; gap: 12px; flex: 1 1 auto; min-height: 0; }
    .pf-og__bar { display: flex; align-items: center; gap: 12px; flex: none; }
    .pf-og__main ::ng-deep .ag-row.pf-og__row--sel { background: var(--pf-sel-bg); }
    .pf-og__spacer { flex: 1; }
    .pf-og__search { flex: 0 1 320px; }
    .pf-og__search--full { margin-bottom: 6px; }
    .pf-og__note { padding: 28px 12px; text-align: center; font-size: 12.5px; color: var(--text-tertiary); }

    .pf-og__side .pf-card__body { gap: 8px; }
    .pf-og__count { font-size: 12.5px; }

    .pf-og__slabel { font-size: 12px; font-weight: 500; color: var(--text-secondary); margin: 10px 0 2px; }
    .pf-og__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-og__chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 500; padding: 4px 10px;
      border-radius: var(--pf-radius-chip, 8px); color: var(--text-secondary); background: var(--pf-chip-bg); border: 1px solid var(--pf-line); }
    /* Normal = the neutral selected state + a violet check (never green). */
    .pf-og__chip--normal { color: var(--text-primary); border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-og__chip--normal svg { color: var(--violet-text, #7c3aed); }
    .pf-og__chip--off { opacity: .45; text-decoration: line-through; }
    .pf-og__chip--warnmap { border-style: dashed; }
    .pf-og__chipx { display: inline-flex; border: none; background: transparent; color: inherit; cursor: pointer; padding: 0; }

    .pf-og__row { display: flex; align-items: center; gap: 10px; padding: 2px 0; flex-wrap: wrap; }
    .pf-og__rowval { flex: 1 1 160px; min-width: 0; }
    .pf-og__flag { font-size: 12.5px; }
    .pf-og__rowdel { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 32px; height: 32px;
      border-radius: 8px; border: 1px solid transparent; cursor: pointer; color: var(--text-tertiary); background: transparent; }
    .pf-og__rowdel:hover { color: var(--red-text, #b91c1c); border-color: var(--pf-line); }
    .pf-og__addrow { align-self: flex-start; height: 34px; min-height: 34px; }
    .pf-og__editact { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 14px 14px;
      border-top: 1px solid var(--pf-line); background: var(--pf-card-bg); }
    .pf-og__warn { flex: 1; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-tertiary); }
    .pf-og__warn--amber { color: var(--text-secondary); font-weight: 500; }

    .pf-og__picklist { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    .pf-og__pick { position: relative; cursor: pointer; min-height: 44px; font-size: 12.5px; }
    .pf-og__srcheck { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
    .pf-og__pick:has(.pf-og__srcheck:focus-visible) { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-og__pcode { color: var(--text-tertiary); margin-right: 4px; }
    .pf-og__pickparam { display: block; font-size: 12px; font-weight: 400; color: var(--text-tertiary); }
    .pf-og__pickwarn { flex: none; font-size: 11.5px; color: var(--text-secondary); }

    /* Linked tests: compact flush rows (hairline between), each opens the test editor. */
    .pf-og__tests { display: flex; flex-direction: column; }
    .pf-og__test { width: 100%; cursor: pointer; min-height: 40px; padding: 8px 4px; text-align: left;
      border: 0; border-bottom: 1px solid var(--pf-line); border-radius: 0; background: transparent; box-shadow: none; }
    .pf-og__test:hover { background: var(--pf-sel-bg); }
    .pf-og__tcode { flex-shrink: 0; font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
  `, TM_TWO_PANEL_STYLES],
})
export class OptionGroupsPanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly theme = inject(ThemeService);
  private readonly dialog = inject(DialogService);

  // Exact same theme objects as the tests grid — one look, two views.
  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));

  readonly saving = signal(false);
  readonly query = signal('');
  /** Bound by a host that owns the search (Test Master's band pill): it
   *  replaces this panel's own search box and "+ New" button (the band
   *  carries both). null = standalone, the panel shows its own. */
  readonly bandQuery = input<string | null>(null);
  private readonly effectiveQuery = computed(() => this.bandQuery() ?? this.query());
  readonly groups = signal<OgGroup[]>([]);
  /** First load of the groups: skeleton grid + side card (held, no flash). */
  private readonly listHold = createLoadHold(true);
  readonly listSkeleton = this.listHold.active;
  /** Hover / focus of a linked test: warm the test editor's code. */
  warmEditor(): void { void prefetch(TEST_EDITOR_PREFETCH_KEY, loadTestEditor); }
  readonly selected = signal<OgGroup | null>(null);
  readonly editing = signal(false);
  readonly mode = signal<'idle' | 'create'>('idle');
  readonly draft = signal<OgRow[]>([]);
  readonly pickQuery = signal('');
  readonly targets = signal<PickParam[]>([]);
  private readonly allParams = signal<PickParam[]>([]);
  /** Creating / editing: the side card is an editor (a sheet on phones). */
  readonly sheetOpen = computed(() => this.mode() === 'create' || this.editing());
  /** Tells the host (Test Master's band) an editor is open, so the band's
   *  "New option group" steps down and this card's save is the ONE primary. */
  readonly editingChange = output<boolean>();
  constructor() {
    effect(() => this.editingChange.emit(this.sheetOpen()));
    inject(DestroyRef).onDestroy(() => this.listHold.cancel());
  }
  closeEditor() { this.mode.set('idle'); this.editing.set(false); }

  /** ≤900px: one column; the side card is a sheet opened by a row click. */
  readonly narrow = mediaSignal(TM_NARROW, inject(DestroyRef));
  private readonly detailOpen = signal(false);
  readonly sideShown = computed(() => this.detailOpen() || this.sheetOpen());
  closeSide() { this.closeEditor(); this.detailOpen.set(false); }
  readonly rowClass = (p: { data?: OgGridRow }) => (p.data && p.data.group.code === this.selected()?.code ? 'pf-og__row--sel' : '');

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
    const q = this.effectiveQuery().trim().toLowerCase();
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
    // Desktop: the side card always shows a group (never toggled empty); narrow: the row opens the sheet.
    if (g) this.selected.set(g);
    this.editing.set(false);
    if (this.narrow()) this.detailOpen.set(true);
    e.api?.redrawRows?.();
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
        this.saving.set(false); this.editing.set(false);
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
        this.listHold.done();
        // Deep link (?og=<code>) wins; otherwise default-select the top
        // group so the side panel is never an empty "select one" placeholder.
        const cur = this.selected();
        if (cur) this.selected.set((gs ?? []).find(g => g.code === cur.code) ?? (gs?.[0] ?? null));
        else if (this.mode() === 'idle' && gs?.length) {
          const wanted = this.route.snapshot.queryParamMap.get('og');
          this.selected.set(gs.find(g => g.code === wanted) ?? gs[0]);
        }
      },
      error: () => { this.listHold.done(); this.toasts.error('Could not load option groups'); },
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
