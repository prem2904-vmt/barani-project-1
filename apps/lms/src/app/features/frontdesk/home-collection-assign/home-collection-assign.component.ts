import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AllCommunityModule, ColDef, GetRowIdParams, ModuleRegistry, RowClickedEvent } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { busyIdWhile } from '../busy-id';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { Appointment, HomeCollectionAgent } from '../../../shared/models/appointment.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { SkelGridComponent } from '../../../shared/components/skeleton-frame/skeleton-frame.component';
import { WorkListComponent } from '../../../shared/components/work-list/work-list.component';
import { WORK_LIST_MQ, WorkListItem } from '../../../shared/components/work-list/work-list';
import { mediaSignal } from '../../../shared/utils/media-query';
import { ndGridDark, ndGridLight } from '../../../shared/utils/pf-grid-theme';
import { textCol } from '../../../shared/utils/work-grid';
import { plural } from '../../../shared/utils/plural';
import {
  agentOptions, filterVisits, visitAddress, visitItem, visitName, visitPhone, visitPin, visitSlot,
} from './home-collection-view';

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * Front desk → Unassigned home collections (owner 2026-11-22: "follow our theme"). ND frame (docs/PF-PATTERN.md):
 * band (back · tenant · Refresh, search in the pill) → the visits as the MAIN card (AG-Grid ≥1024px, the shared
 * pf-work-list below) + the ASSIGN side card (the picked visit's details, the agent picker, ONE Assign). Below
 * 1024px the side card appears once a visit is picked (a bottom sheet on phones). Same calls as before:
 * GET unassigned + agents, PATCH assign → reload.
 */
@Component({
  selector: 'pf-home-collection-assign',
  standalone: true,
  imports: [AgGridAngular, HeroBandComponent, ScreenHeaderComponent, SelectComponent, SkelGridComponent, WorkListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-hc pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search patient, address, PIN, phone…" [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="hc-refresh"
                    [disabled]="loading()" (click)="load()" aria-label="Refresh" title="Refresh the list">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
              <span class="pf-hc__btntext">{{ loading() ? 'Refreshing…' : 'Refresh' }}</span>
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Front desk" title="Unassigned home collections"
                        subtitle="Requests no agent's area covers. Pick an agent to assign each one.">
        <div actions><button type="button" class="pf-btn pf-btn--secondary" [disabled]="loading()" (click)="load()">Refresh</button></div>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-body pf-body--split pf-hc__body" [class.pf-hc__body--picked]="!!selected()">
          <!-- MAIN: the visits (DOM first so phones stack it first; wide places the side card left). -->
          <section class="pf-card pf-hc__main" data-testid="hc-main" aria-label="Unassigned visits">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>
              </span>
              <h2 class="pf-card__label">Unassigned visits</h2>
              <span class="pf-hc__count pf-num" aria-live="polite">{{ countLabel() }}</span>
            </header>
            <div class="pf-hc__wrap">
              @if (loading() && items().length === 0) {
                <pf-skel-grid class="pf-hc__skel" [rows]="8" [columns]="5" label="Loading visits…"></pf-skel-grid>
              } @else if (items().length === 0) {
                <div class="pf-empty pf-empty--compact" data-testid="hc-empty">
                  <span class="pf-empty__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="m9 15 2 2 4-4"/></svg>
                  </span>
                  <p class="pf-empty__title">Nothing waiting</p>
                  <p class="pf-empty__body">Every home-collection request has an agent.</p>
                </div>
              } @else if (visible().length === 0) {
                <div class="pf-empty pf-empty--compact">
                  <p class="pf-empty__title">No visits match "{{ q().trim() }}"</p>
                  <p class="pf-empty__body">Try a patient name, area, PIN or phone.</p>
                </div>
              } @else if (listMode()) {
                <div class="pf-hc__listscroll pf-wl-scroll">
                  <pf-work-list data-testid="hc-list" label="Unassigned visits" [items]="listItems()" [loading]="loading()"
                                emptyTitle="Nothing waiting" (open)="select($any($event.data))" (primary)="select($any($event.data))" />
                </div>
              } @else {
                <ag-grid-angular class="pf-hc__grid" data-testid="hc-grid" [theme]="gridTheme()" [rowData]="visible()" [columnDefs]="cols"
                                 [defaultColDef]="defaultColDef" [getRowId]="rowId" [rowClassRules]="rowRules()" [suppressCellFocus]="true"
                                 [animateRows]="true" (rowClicked)="onRow($event)"></ag-grid-angular>
              }
            </div>
          </section>

          <!-- SIDE: ASSIGN — what the main card doesn't show: the agent picker + the one action. -->
          @if (!listMode() || selected()) {
            @if (listMode()) { <div class="pf-sheet-backdrop" (click)="clear()"></div> }
            <aside class="pf-card pf-hc__side" [class.pf-sheet]="listMode()" data-testid="hc-side" aria-label="Assign"
                   [attr.role]="listMode() ? 'dialog' : null" [attr.aria-modal]="listMode() ? 'true' : null" (keydown.escape)="clear()">
              @if (listMode()) { <span class="pf-sheet__handle" aria-hidden="true"></span> }
              <header class="pf-card__head">
                <span class="pf-card__icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/></svg>
                </span>
                <h2 class="pf-card__label">Assign</h2>
                @if (listMode()) {
                  <span class="pf-card__spacer"></span>
                  <button type="button" class="pf-btn pf-btn--secondary pf-btn--sm" (click)="clear()" aria-label="Close">Close</button>
                }
              </header>
              <div class="pf-card__body pf-hc__sidebody">
                @if (agents().length === 0) {
                  <p class="pf-hc__warn" role="status">No home-collection agents exist yet. Add some in Settings → Lab → Home collection.</p>
                }
                @if (selected(); as a) {
                  <dl class="pf-hc__facts" data-testid="hc-picked">
                    <div><dt>Patient</dt><dd class="pf-hc__name">{{ name(a) }}</dd></div>
                    <div><dt>Address</dt><dd>{{ address(a) || 'No address' }}</dd></div>
                    <div><dt>PIN</dt><dd class="pf-num">{{ pin(a) || '—' }}</dd></div>
                    <div><dt>Slot</dt><dd class="pf-num">{{ slot(a) || '—' }}</dd></div>
                    <div><dt>Phone</dt><dd class="pf-num">{{ phone(a) || '—' }}</dd></div>
                  </dl>
                  <label class="pf-hc__label" for="hc-agent">Agent</label>
                  <pf-select id="hc-agent" [options]="options()" [value]="pick()[a.id]" placeholder="Choose agent" (valueChange)="setPick(a.id, $any($event))"></pf-select>
                } @else {
                  <p class="pf-hc__hint">Pick a visit to assign it to an agent.</p>
                }
              </div>
              @if (selected(); as a) {
                <footer class="pf-card__foot">
                  <button type="button" class="pf-btn pf-btn--primary pf-span" data-testid="hc-assign"
                          [disabled]="!pick()[a.id] || assigningId() === a.id" (click)="assign(a)">
                    {{ assigningId() === a.id ? 'Assigning…' : 'Assign' }}
                  </button>
                </footer>
              }
            </aside>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-hc__body { padding: 12px 0 0; }
    .pf-hc__count { margin-left: auto; font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
    .pf-hc__main { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
    .pf-hc__wrap { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-hc__grid { flex: 1 1 auto; min-height: 0; width: 100%; }
    .pf-hc__skel { flex: 1 1 auto; }
    .pf-hc__listscroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    .pf-hc__side { display: flex; flex-direction: column; min-height: 0; }
    .pf-hc__sidebody { display: flex; flex-direction: column; gap: 12px; }
    .pf-hc__facts { display: grid; gap: 10px; margin: 0; }
    .pf-hc__facts > div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; align-items: baseline; }
    .pf-hc__facts dt { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-hc__facts dd { margin: 0; font-size: 14px; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-hc__name { font-weight: 600; }
    .pf-hc__label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .pf-hc__hint { margin: 0; font-size: 13px; color: var(--text-tertiary); }
    .pf-hc__warn { margin: 0; font-size: 13px; color: var(--text-secondary); }
    /* Below the grid (one column): the main card fills; the picked visit's ASSIGN card sits under it (a sheet on phones). */
    @media (max-width: 1023.98px) {
      .pf-hc__side:not(.pf-sheet) { flex: none; }
    }
    /* Touch widths: the band's Refresh is icon-only (aria-label + title keep its name). */
    @media (max-width: 1023.98px) {
      .pf-hc__btntext { display: none; }
    }
  `]
})
export class HomeCollectionAssignComponent implements OnInit {
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  private readonly _items = signal<Appointment[]>([]);
  private readonly _agents = signal<HomeCollectionAgent[]>([]);
  private readonly _pick = signal<Record<string, string>>({});
  private readonly _loading = signal(false);
  private readonly _selectedId = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly agents = this._agents.asReadonly();
  readonly pick = this._pick.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly q = signal('');
  readonly listMode = mediaSignal(WORK_LIST_MQ);

  readonly options = computed<PfSelectOption<string>[]>(() => agentOptions(this._agents()));
  readonly visible = computed(() => filterVisits(this._items(), this.q()));
  readonly selected = computed(() => this._items().find(a => a.id === this._selectedId()) ?? null);
  readonly listItems = computed<WorkListItem<Appointment>[]>(() => this.visible().map(a => visitItem(a, this._selectedId())));
  readonly countLabel = computed(() => {
    const all = this._items().length, shown = this.visible().length;
    return shown === all ? plural(all, 'visit') : `${shown} of ${plural(all, 'visit')}`;
  });

  readonly gridTheme = computed(() => (this.theme.isDark() ? ndGridDark : ndGridLight));
  readonly defaultColDef: ColDef = { sortable: true, resizable: true, filter: false, minWidth: 100, autoHeight: true, wrapText: true };
  /** Each column displays, sorts and filters on ONE getter; a blank shows "—" (sorted last both ways). */
  private static readonly dash = (f: (a: Appointment) => string) => (a: Appointment) => f(a) || '—';
  readonly cols: ColDef<Appointment>[] = [
    textCol<Appointment>({ colId: 'patient', headerName: 'Patient', flex: 1.4, minWidth: 180 }, visitName),
    textCol<Appointment>({ colId: 'address', headerName: 'Address', flex: 2, minWidth: 200 }, HomeCollectionAssignComponent.dash(visitAddress)),
    textCol<Appointment>({ colId: 'pin', headerName: 'PIN', width: 110 }, HomeCollectionAssignComponent.dash(visitPin)),
    textCol<Appointment>({ colId: 'slot', headerName: 'Slot', width: 100 }, HomeCollectionAssignComponent.dash(visitSlot)),
    textCol<Appointment>({ colId: 'phone', headerName: 'Phone', width: 140 }, HomeCollectionAssignComponent.dash(visitPhone)),
  ];
  readonly rowId = (p: GetRowIdParams<Appointment>) => p.data.id;
  readonly rowRules = computed(() => {
    const id = this._selectedId();
    return { 'ag-row-selected': (p: { data?: Appointment }) => !!id && p.data?.id === id };
  });

  readonly name = visitName;
  readonly address = visitAddress;
  readonly pin = visitPin;
  readonly slot = visitSlot;
  readonly phone = visitPhone;

  ngOnInit() {
    this.load();
    this.svc.listAgents().subscribe({ next: l => this._agents.set(l ?? []) });
  }

  load() {
    this._loading.set(true);
    this.svc.unassignedHomeCollections().subscribe({
      next: l => {
        this._items.set(l ?? []);
        this._loading.set(false);
        if (this._selectedId() && !this._items().some(a => a.id === this._selectedId())) this._selectedId.set(null);
      },
      error: e => { this._loading.set(false); this.toast.error(ApiError.from(e).message); }
    });
  }

  select(a: Appointment | null | undefined) { if (a) this._selectedId.set(a.id); }
  clear() { this._selectedId.set(null); }
  onRow(e: RowClickedEvent<Appointment>) { this.select(e.data); }

  setPick(apptId: string, agentUserId: string) {
    this._pick.update(m => ({ ...m, [apptId]: agentUserId }));
  }

  /** Visit whose Assign request is in flight. */
  readonly assigningId = signal<string | null>(null);
  assign(a: Appointment) {
    const agentUserId = this._pick()[a.id];
    if (!agentUserId || this.assigningId() === a.id) return;
    this.svc.assignAgent(a.id, agentUserId).pipe(busyIdWhile(this.assigningId, a.id)).subscribe({
      next: () => { this.toast.success('Assigned.'); this._selectedId.set(null); this.load(); },
      error: e => this.toast.error(ApiError.from(e).message)
    });
  }
}
