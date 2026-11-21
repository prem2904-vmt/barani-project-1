import { ViewStateService } from '../../../shared/services/view-state.service';
import { stableJson } from '../../../shared/utils/dirty-snapshot';
import { SkelGridComponent } from '../../../shared/components/skeleton-frame/skeleton-frame.component';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { HomeCollectionAgent } from '../../../shared/models/appointment.model';
import { User, userDisplayName } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { AllCommunityModule, ColDef, GetRowIdParams, ICellRendererParams, ModuleRegistry } from 'ag-grid-community';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { HomeCollectionSwitchCardComponent } from '../lab-pages/home-collection-switch-card.component';
import { SG_ICON, SG_NARROW_MQ, SG_PHONE_MQ, SgAction, sgActions, sgActionsCol, sgCell, sgGridTheme, sgMedia, sgPillCol, sgRowOff, sgBare } from '../../../shared/settings-grid/settings-grid';

ModuleRegistry.registerModules([AllCommunityModule]);

type AreaMode = 'pincode' | 'radius';
interface Draft {
  userId: string;
  areaMode: AreaMode;
  pincodes: string;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
  weightage: number;
}
const EMPTY: Draft = { userId: '', areaMode: 'pincode', pincodes: '', centerLat: null, centerLng: null, radiusKm: 5, weightage: 1 };

@Component({
  selector: 'pf-home-collection-agents',
  standalone: true,
  imports: [SkelGridComponent, NgTemplateOutlet, SkeletonTableComponent, BusyDirective, FormsModule, ScreenHeaderComponent, SelectComponent, TouchButtonComponent, NumberInputComponent, HeroBandComponent,
    DataGridComponent, HomeCollectionSwitchCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  styles: [`
    .pf-hc-lbl { display: block; margin-bottom: 6px; }
    .pf-hc-hint { margin-top: 6px; }
    .pf-hc-body { gap: 12px; }
    .pf-hc-panels { grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); }
    .pf-hc-panels.pf-sg-panels--single, .pf-hc-panels.pf-sg-panels--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-hc-strip { flex: none; display: block; }
    .pf-hc-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    /* Phone: page inputs >=16px so iOS Safari does not zoom on focus (scoped to this page). */
    @media (max-width: 640px) {
      :host input.pf-input { font-size: 16px; }
      :host ::ng-deep pf-number-input .field { font-size: 16px; }
    }
  `],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill: agent search (name, pincodes, area); "Add agent" is the ONE primary. -->
        <pf-hero-band [back]="true" placeholder="Search agents — name, pincode, area…"
                      [value]="q()" (valueChange)="q.set($event)">
          
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Home-collection agents"
        subtitle="Assign staff as home-collection agents and define the area they cover. Requests are auto-routed by area, load-balanced by weight.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="toggleForm()">
          {{ formOpen() ? 'Cancel' : '+ Add agent' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill pf-hc-body">
        <!-- The branch switch + status: ONE compact row spanning the grid's width. -->
        @if (showSwitch()) {
          <pf-home-collection-switch-card class="pf-hc-strip" variant="strip"></pf-home-collection-switch-card>
        }
        <div class="pf-sg-panels pf-hc-panels" [class.pf-sg-panels--single]="!formOpen()" [class.pf-sg-panels--narrow]="narrow()">
          @if (formOpen()) {
            @if (narrow()) { <div class="pf-sheet-backdrop" (click)="toggleForm()"></div> }
            <aside class="pf-card pf-sg-side pf-hc-form" [class.pf-sg-side--sheet]="narrow()" [attr.role]="narrow() ? 'dialog' : null"
                   [attr.aria-modal]="narrow() ? 'true' : null" [attr.aria-label]="editing() ? 'Edit area' : 'New agent'"
                   (keydown.escape)="toggleForm()">
              @if (narrow()) { <span class="pf-sg-sheet-handle" aria-hidden="true"></span> }
              <div class="pf-card__head">
                <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6"/></svg></span>
                <h3 class="pf-card__label">{{ editing() ? 'Edit area' : 'New agent' }}</h3>
                <span class="pf-card__spacer"></span>
                <!-- Actions in the head (owner 2026-11-17: nothing clickable at the bottom). -->
                <button type="button" class="pf-btn pf-btn--primary press" [disabled]="!draft().userId || saving() || !draftChanged()" [pfBusyInactive]="!draft().userId || saving() || !draftChanged()"
                        [attr.title]="draftChanged() || saving() ? null : 'No changes to save'" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">
                  {{ saving() ? 'Saving…' : 'Save agent' }}
                </button>
<button type="button" class="pf-btn pf-btn--icon" (click)="toggleForm()" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </div>
              <div class="pf-card__body">
                <div>
                  <label class="pf-field__lbl pf-hc-lbl">Agent (staff member)</label>
                  <pf-select [options]="userOptions()" [value]="draft().userId" [disabled]="editing()" [searchable]="userOptions().length > 8"
                    placeholder="Pick a user" (valueChange)="patch({ userId: $any($event) })"></pf-select>
                </div>
                <div>
                  <label class="pf-field__lbl pf-hc-lbl">Coverage</label>
                  <span class="pf-seg" role="radiogroup" aria-label="Coverage">
                    @for (o of modeOptions; track o.value) {
                      <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="draft().areaMode === o.value"
                              (click)="patch({ areaMode: o.value })">{{ o.label }}</button>
                    }
                  </span>
                </div>
                @if (draft().areaMode === 'pincode') {
                  <div>
                    <label class="pf-field__lbl pf-hc-lbl">Pincodes — list and/or ranges</label>
                    <input type="text" class="pf-input pf-num" [ngModel]="draft().pincodes"
                      (ngModelChange)="patch({ pincodes: $event })" placeholder="600001, 600028, 600001-600050" />
                    <p class="pf-field__hint pf-hc-hint">
                      Comma-separated. Use a range with a dash or "to": <span class="pf-num">600001-600050</span> or <span class="pf-num">600001 to 600050</span>.
                    </p>
                  </div>
                } @else {
                  <div class="pf-hc-row2">
                    <div>
                      <label class="pf-field__lbl pf-hc-lbl">Centre latitude</label>
                      <pf-number-input [value]="draft().centerLat" [step]="0.001" [allowEmpty]="true"
                        (valueChange)="patch({ centerLat: $event })"></pf-number-input>
                    </div>
                    <div>
                      <label class="pf-field__lbl pf-hc-lbl">Centre longitude</label>
                      <pf-number-input [value]="draft().centerLng" [step]="0.001" [allowEmpty]="true"
                        (valueChange)="patch({ centerLng: $event })"></pf-number-input>
                    </div>
                  </div>
                  <div>
                    <label class="pf-field__lbl pf-hc-lbl">Radius (km)</label>
                    <pf-number-input [value]="draft().radiusKm" [step]="1" [min]="1" [allowEmpty]="true"
                      (valueChange)="patch({ radiusKm: $event })"></pf-number-input>
                  </div>
                }
                <div>
                  <label class="pf-field__lbl pf-hc-lbl">Weight (share of work)</label>
                  <pf-number-input [value]="draft().weightage" [step]="1" [min]="1"
                    (valueChange)="patch({ weightage: $event ?? 1 })"></pf-number-input>
                </div>
              </div>
              
            </aside>
          }

          <section class="pf-card pf-sg-main pf-hc-main" [class.pf-sg-main--bare]="bare" aria-label="Home-collection agents">
            <header class="pf-card__head pf-sg-main__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span>
              <span class="pf-card__label">Agents</span>
              <span class="pf-card__note pf-sg-hint">Requests are routed by area and shared by weight</span>
              <ng-container *ngTemplateOutlet="headTools"></ng-container>
            </header>
            <div class="pf-sg-main__body">
              @if (listSkeleton()) {
                <pf-skel-grid class="pf-sg-skel" [rows]="30" [columns]="4" label="Loading agents…"></pf-skel-grid>
              }
              <pf-data-grid viewStateKey="admin.hc-agents.g1" [rowData]="visibleAgents()" [columnDefs]="colDefs()" [defaultColDef]="defaultColDef" [getRowId]="getRowId" [getRowClass]="rowClass" [suppressCellFocus]="true"></pf-data-grid>
              @if (!listSkeleton() && visibleAgents().length === 0) {
                <div class="pf-sg-empty pf-band-empty">
                  <p class="pf-sg-empty__title">{{ agents().length === 0 ? 'No home-collection agents yet.' : 'No agents match "' + q() + '".' }}</p>
                  @if (agents().length === 0) { <p class="pf-sg-empty__body">Add agent to assign a staff member and the area they cover.</p> }
                </div>
              }
            </div>
          </section>
        </div>
      </div>
    </section>

    <!-- The grid card's head tools (count): exposed so a host can project them into its own head. -->
    <ng-template #headTools>
      <span class="pf-sg-count pf-num">{{ visibleAgents().length }} {{ visibleAgents().length === 1 ? 'agent' : 'agents' }}</span>
          <!-- The page's action, IN the pane (owner: no band buttons in Settings), after the head tools. -->
            <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press" (click)="toggleForm()"
                    [attr.aria-label]="formOpen() ? 'Cancel' : 'Add agent'">
              @if (formOpen()) {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              } @else {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              }
              {{ formOpen() ? 'Cancel' : 'Add agent' }}
            </button>
    </ng-template>
  `
})
export class HomeCollectionAgentsComponent implements OnInit {
  /** Hosted in the Settings shell: the grid card renders BARE (ONE card, ONE head). */
  protected readonly bare = sgBare();
  /** Count, for a host that projects head tools into its own head. */
  readonly headTools = viewChild<TemplateRef<unknown>>('headTools');
  private readonly api = inject(ApiService);
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (PF-PATTERN). */
  protected readonly web = webPointerSignal();

  /** Band pill search: agent name/email and the area they cover. */
  readonly q = signal('');
  readonly visibleAgents = computed(() => bandFilter(this._agents(), this.q(),
    a => [this.agentName(a), a.user?.email, this.areaSummary(a)]));

  readonly modeOptions: SegmentedOption<AreaMode>[] = [
    { value: 'pincode', label: 'Pincode list' },
    { value: 'radius', label: 'Geo radius' }
  ];

  private readonly _agents = signal<HomeCollectionAgent[]>([]);
  private readonly _users = signal<User[]>([]);
  private readonly _draft = signal<Draft>({ ...EMPTY });
  private readonly _formOpen = signal(false);
  private readonly _editing = signal(false);
  private readonly _saving = signal(false);

  readonly agents = this._agents.asReadonly();
  readonly draft = this._draft.asReadonly();
  readonly formOpen = this._formOpen.asReadonly();
  readonly editing = this._editing.asReadonly();
  readonly saving = this._saving.asReadonly();

  readonly userOptions = computed<PfSelectOption<string>[]>(() =>
    this._users().filter(u => u.isActive).map(u => ({ value: u.id, label: `${userDisplayName(u)} · ${u.email}` })));

  /** First load: skeleton cards until the agents land (held, no flash). */
  private readonly listHold = createLoadHold(true);
  readonly listSkeleton = this.listHold.active;
  /** The agent whose Remove is running. */
  readonly removingId = signal<string | null>(null);
  private readonly destroyRef = inject(DestroyRef);

  /** The branch switch strip above the grid (Lab › Home collection › Agents); off where a host shows its own. */
  readonly showSwitch = input(true);

  // ── Test Master grid ──
  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly phone = sgMedia(SG_PHONE_MQ);
  readonly gridTheme = sgGridTheme();
  readonly getRowId = (p: GetRowIdParams<HomeCollectionAgent>) => p.data.id;
  readonly rowClass = sgRowOff<HomeCollectionAgent>(a => a.isActive !== false);
  readonly defaultColDef: ColDef<HomeCollectionAgent> = { sortable: true, resizable: true, filter: false, minWidth: 90, wrapText: true, autoHeight: true };
  actionsFor(a: HomeCollectionAgent): SgAction[] {
    const name = this.agentName(a);
    return [
      { label: 'Edit', aria: `Edit area of ${name}`, icon: true, path: SG_ICON.edit, run: () => this.edit(a) },
      { label: this.removingId() === a.id ? 'Removing…' : 'Remove', aria: `Remove agent ${name}`, path: SG_ICON.trash, icon: true, danger: true, run: () => this.remove(a) },
    ];
  }
  readonly colDefs = computed<ColDef<HomeCollectionAgent>[]>(() => {
    const web = this.web() && !this.phone();
    this.removingId(); this._users();
    const cols: ColDef<HomeCollectionAgent>[] = [
      { colId: 'agent', headerName: 'Agent', flex: 1.1, minWidth: 180, sort: 'asc', valueGetter: p => (p.data ? this.agentName(p.data) : ''),
        cellRenderer: (p: ICellRendererParams<HomeCollectionAgent>) => sgCell(p.data ? this.agentName(p.data) : '', p.data?.user?.email ?? null, true) },
      { colId: 'coverage', headerName: 'Coverage', flex: 2, minWidth: 220, valueGetter: p => (p.data ? this.coverageText(p.data) : ''),
        cellRenderer: (p: ICellRendererParams<HomeCollectionAgent>) => {
          const t = p.data ? this.coverageText(p.data) : '';
          const unset = !!p.data && this.coverageUnset(p.data);
          const el = sgCell(unset ? null : t, unset ? t : null);
          if (unset) el.firstElementChild?.remove();
          return el;
        } },
      { colId: 'weight', headerName: 'Share of work', width: 140, minWidth: 120, flex: 0, type: 'rightAligned', cellClass: 'pf-num',
        valueGetter: p => p.data?.weightage ?? 1 },
      sgPillCol<HomeCollectionAgent>(a => a.isActive !== false),
      sgActionsCol<HomeCollectionAgent>(web, [], 2, p => (p.data ? sgActions(web, this.actionsFor(p.data)) : document.createElement('span'))),
    ];
    if (!this._agents().some(a => a.isActive === false)) cols.splice(3, 1);
    if (this.phone()) return cols.filter(c => ['agent', 'coverage', 'actions'].includes(c.colId ?? ''));
    return cols;
  });
  /** Coverage in the grid: pincodes / ranges, or "radius 5 km around …"; muted "none set". */
  coverageText(a: HomeCollectionAgent): string {
    if (a.areaMode === 'radius') {
      if (a.centerLat == null || a.centerLng == null) return 'Radius — centre not set';
      return `Radius ${a.radiusKm ?? '?'} km around ${a.centerLat.toFixed(3)}, ${a.centerLng.toFixed(3)}`;
    }
    const pins = this.parsePincodes(a.pincodesJson);
    return pins.length ? pins.join(', ') : 'None set';
  }
  coverageUnset(a: HomeCollectionAgent): boolean {
    return a.areaMode === 'radius' ? (a.centerLat == null || a.centerLng == null) : this.parsePincodes(a.pincodesJson).length === 0;
  }

  ngOnInit() {
    this.destroyRef.onDestroy(() => this.listHold.cancel());
    this.load();
    this.api.get<User[]>('/api/users/').subscribe({ next: l => this._users.set(l ?? []) });
  }

  private load() {
    this.svc.listAgents().subscribe({
      next: l => { this._agents.set(l ?? []); this.listHold.done(); },
      error: () => this.listHold.done(),
    });
  }

  toggleForm() {
    if (this._formOpen()) { this._formOpen.set(false); return; }
    this._draft.set({ ...EMPTY });
    this._editing.set(false);
    this._formOpen.set(true);
  }
  patch(p: Partial<Draft>) { this._draft.update(d => ({ ...d, ...p })); }

  edit(a: HomeCollectionAgent) {
    this._draft.set({
      userId: a.userId,
      areaMode: a.areaMode,
      pincodes: this.parsePincodes(a.pincodesJson).join(', '),
      centerLat: a.centerLat ?? null,
      centerLng: a.centerLng ?? null,
      radiusKm: a.radiusKm ?? 5,
      weightage: a.weightage
    });
    this._draftBase.set(stableJson(this._draft()));
    this._editing.set(true);
    this._formOpen.set(true);
  }
  /** Save only when something changed (owner 2026-11-19): an agent being EDITED is compared with how it was opened;
   *  a new agent has nothing saved yet (Save follows the picked person). */
  private readonly _draftBase = signal('');
  readonly draftChanged = computed(() => !this._editing() || stableJson(this._draft()) !== this._draftBase());

  save() {
    const d = this._draft();
    if (!d.userId) return;
    this._saving.set(true);
    this.svc.upsertAgent({
      userId: d.userId,
      areaMode: d.areaMode,
      centerLat: d.areaMode === 'radius' ? d.centerLat : null,
      centerLng: d.areaMode === 'radius' ? d.centerLng : null,
      radiusKm: d.areaMode === 'radius' ? d.radiusKm : null,
      pincodes: d.areaMode === 'pincode' ? d.pincodes.split(',').map(p => p.trim()).filter(Boolean) : [],
      weightage: Math.max(1, d.weightage),
      isActive: true
    }).subscribe({
      next: () => { this._saving.set(false); this._formOpen.set(false); this.toast.success('Saved.'); this.load(); },
      error: e => { this._saving.set(false); this.toast.error(ApiError.from(e).message); }
    });
  }

  remove(a: HomeCollectionAgent) {
    if (this.removingId() === a.id) return;
    this.removingId.set(a.id);
    this.svc.removeAgent(a.id).subscribe({
      next: () => { this.removingId.set(null); this.toast.success('Removed.'); this.load(); },
      error: e => { this.removingId.set(null); this.toast.error(ApiError.from(e).message); }
    });
  }

  agentName(a: HomeCollectionAgent): string {
    return a.user?.name || this._users().find(u => u.id === a.userId)?.displayName || a.user?.email || a.userId.slice(0, 8);
  }
  areaSummary(a: HomeCollectionAgent): string {
    if (a.areaMode === 'radius') {
      if (a.centerLat == null || a.centerLng == null) return 'Radius area — coordinates not set';
      return `${a.radiusKm ?? '?'} km around ${a.centerLat.toFixed(3)}, ${a.centerLng.toFixed(3)}`;
    }
    const pins = this.parsePincodes(a.pincodesJson);
    return pins.length ? `Pincodes: ${pins.join(', ')}` : 'Pincode area — none set';
  }
  private parsePincodes(json?: string | null): string[] {
    if (!json) return [];
    try { return JSON.parse(json) as string[]; } catch { return []; }
  }

  // Screen view state (owner 2026-11-21): filters / tab / search come back as left after in-app navigation;
  // fresh on reload, sign-out and branch switch.
  private readonly _viewState = inject(ViewStateService).bind('admin.hc-agents', { q: this.q });
}
