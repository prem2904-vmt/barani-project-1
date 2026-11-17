import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, TemplateRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ReferralLab } from '../../../shared/models/referral-lab.model';
import { Department } from '../../../shared/models/tenant.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SettingsSiblingsComponent } from '../settings/settings-siblings.component';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { heldFlag } from '../../../shared/utils/min-duration';
import { AllCommunityModule, ColDef, GetRowIdParams, ICellRendererParams, ModuleRegistry } from 'ag-grid-community';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import {
  SG_ICON, SG_NARROW_MQ, SG_PHONE_MQ, SgAction, SgStatus, sgActions, sgActionsCol, sgByStatus, sgCell, sgChips, sgGridTheme, sgMedia,
  sgPillCol, sgRowOff, sgStatusOptions, sgBare } from '../../../shared/settings-grid/settings-grid';

ModuleRegistry.registerModules([AllCommunityModule]);

interface LabDraft {
  id?: string;
  name: string;
  code: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  departmentCodes: string[];
}

const EMPTY: LabDraft = {
  name: '', code: '', contactName: '', contactPhone: '', contactEmail: '', address: '', departmentCodes: [],
};

/**
 * Admin master for outsourced / referral labs (e.g. Apollo). A test marked
 * "outsourced" in the test editor points at one of these; at sample collection
 * its tests form their own vials grouped by (referral lab + department).
 */
@Component({
  selector: 'pf-referral-labs',
  standalone: true,
  imports: [SettingsSiblingsComponent, NgTemplateOutlet, BusyDirective, SkeletonTableComponent, SegmentedComponent, DataGridComponent, FormsModule, ScreenHeaderComponent, TouchButtonComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Test Master frame: search in the band pill; "Add referral lab" is the ONE primary. -->
        <pf-hero-band [back]="true" placeholder="Search referral labs — name, code, contact, department…"
                      [value]="q()" (valueChange)="q.set($event)">
          
          <ng-container band-tools><pf-settings-siblings></pf-settings-siblings></ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Referral / outsourced labs"
        subtitle="External labs you subcontract tests to. Mark a test as outsourced in the test editor and pick one of these — its samples form their own vials per (lab + department).">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="toggleForm()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </span>
          {{ formOpen() ? 'Cancel' : 'Add referral lab' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-sg-panels pf-rl-panels" [class.pf-sg-panels--single]="!formOpen()" [class.pf-sg-panels--narrow]="narrow()">
          @if (formOpen()) {
            @if (narrow()) { <div class="pf-sheet-backdrop" (click)="toggleForm()"></div> }
            <aside class="pf-card pf-sg-side pf-rl-form" [class.pf-sg-side--sheet]="narrow()" [attr.role]="narrow() ? 'dialog' : null"
                   [attr.aria-modal]="narrow() ? 'true' : null" [attr.aria-label]="draft().id ? 'Edit referral lab' : 'New referral lab'"
                   (keydown.escape)="toggleForm()">
              @if (narrow()) { <span class="pf-sg-sheet-handle" aria-hidden="true"></span> }
              <div class="pf-card__head">
                <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M7.5 14h9"/></svg></span>
                <h3 class="pf-card__label">{{ draft().id ? 'Edit referral lab' : 'New referral lab' }}</h3>
                <span class="pf-card__spacer"></span>
                <!-- Actions in the head (owner 2026-11-17: nothing clickable at the bottom). -->
                <button type="button" class="pf-btn pf-btn--primary press" (click)="save()" [disabled]="!draft().name.trim() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…">
                  {{ saving() ? 'Saving…' : (draft().id ? 'Save changes' : 'Create referral lab') }}
                </button>
<button type="button" class="pf-btn pf-btn--icon" (click)="toggleForm()" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </div>
              <div class="pf-card__body pf-rl-form__body">
                <div><label class="pf-field__lbl pf-rl-lbl">Name *</label>
                  <input type="text" class="pf-input" [class.pf-input--error]="nameError()" [ngModel]="draft().name" (ngModelChange)="patch({ name: $event })" placeholder="Apollo Diagnostics"/>
                  @if (nameError()) { <p class="pf-field-err">{{ nameError() }}</p> }</div>
                <div><label class="pf-field__lbl pf-rl-lbl">Code</label>
                  <input type="text" class="pf-input pf-num uppercase" [class.pf-input--error]="codeError()" [ngModel]="draft().code" (ngModelChange)="patch({ code: $event.toUpperCase() })" placeholder="APOLLO"/>
                  @if (codeError()) { <p class="pf-field-err">{{ codeError() }}</p> }</div>
                <div><label class="pf-field__lbl pf-rl-lbl">Contact name</label>
                  <input type="text" class="pf-input" [ngModel]="draft().contactName" (ngModelChange)="patch({ contactName: $event })"/></div>
                <div><label class="pf-field__lbl pf-rl-lbl">Contact phone</label>
                  <input type="tel" class="pf-input" [ngModel]="draft().contactPhone" (ngModelChange)="patch({ contactPhone: $event })"/></div>
                <div><label class="pf-field__lbl pf-rl-lbl">Contact email</label>
                  <input type="email" class="pf-input" [ngModel]="draft().contactEmail" (ngModelChange)="patch({ contactEmail: $event })"/></div>
                <div><label class="pf-field__lbl pf-rl-lbl">Address</label>
                  <input type="text" class="pf-input" [ngModel]="draft().address" (ngModelChange)="patch({ address: $event })"/></div>
                <div>
                  <label class="pf-field__lbl pf-rl-lbl">Departments handled</label>
                  <div class="flex flex-wrap gap-2">
                    @for (d of deptOptions(); track d.code) {
                      <button type="button" class="pf-chip pf-dept-chip" [attr.aria-pressed]="draft().departmentCodes.includes(d.code)"
                              (click)="toggleDept(d.code)">{{ d.name }}</button>
                    } @empty {
                      <span class="pf-field__hint">No departments configured yet.</span>
                    }
                  </div>
                  <p class="pf-field__hint pf-rl-hint">Optional — scopes the department picker on outsourced tests.</p>
                </div>
              </div>
              
            </aside>
          }

          <section class="pf-card pf-sg-main pf-rl-main" [class.pf-sg-main--bare]="bare" aria-label="Referral labs">
            <header class="pf-card__head pf-sg-main__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M7.5 14h9"/></svg></span>
              <span class="pf-card__label">Referral labs</span>
              <span class="pf-card__note pf-sg-hint">Outsourced tests form their own vials per lab + department</span>
              <ng-container *ngTemplateOutlet="headTools"></ng-container>
            </header>
            <div class="pf-sg-main__body">
              @if (loadingShown()) {
                <pf-skeleton-table class="pf-sg-skel" [rows]="5" [cols]="5" label="Loading referral labs…"></pf-skeleton-table>
              }
              <pf-data-grid [rowData]="visibleLabs()" [columnDefs]="colDefs()" [defaultColDef]="defaultColDef" [getRowId]="getRowId" [getRowClass]="rowClass" [suppressCellFocus]="true"></pf-data-grid>
              @if (!loading() && visibleLabs().length === 0) {
                <div class="pf-sg-empty pf-band-empty">
                  @if (labs().length === 0) {
                    <p class="pf-sg-empty__title">No referral labs yet. Add one to start outsourcing tests.</p>
                  } @else {
                    <p class="pf-sg-empty__title">No referral labs match{{ q() ? ' "' + q() + '"' : ' this filter' }}.</p>
                  }
                </div>
              }
            </div>
          </section>
        </div>
      </div>
    </section>

    <!-- The grid card's head tools (count + status filter): exposed so a host can project them into its own head. -->
    <ng-template #headTools>
              <span class="pf-sg-count pf-num">{{ visibleLabs().length }} {{ visibleLabs().length === 1 ? 'lab' : 'labs' }}</span>
              <pf-segmented class="pf-sg-status-filter" size="sm" [options]="statusOptions()" [value]="status()"
                            (valueChange)="status.set($event)" aria-label="Filter by status"></pf-segmented>
          <!-- The page's action, IN the pane (owner: no band buttons in Settings), after the head tools. -->
            <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press" (click)="toggleForm()"
                    [attr.aria-label]="formOpen() ? 'Cancel' : 'Add referral lab'">
              @if (formOpen()) {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              } @else {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              }
              {{ formOpen() ? 'Cancel' : 'Add referral lab' }}
            </button>
    </ng-template>
  `,
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;
    .pf-section-title { font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted); }
    .pf-label { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 4px; }
    .pf-input { width: 100%; padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--input-text); border-radius: 10px; font-size: 13px; outline: none; }
    .pf-input:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18); }
    .pf-input--error { border-color: #f43f5e; }
    .pf-input--error:focus { box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.18); }
    .pf-field-err { margin: 4px 0 0; font-size: 11.5px; color: var(--red-text); }
    /* Dept chips: kit .pf-chip with the NEUTRAL selected state (aria-pressed). */
    .pf-dept-chip { height: 32px; }
    .pf-rl-form__body { gap: 12px; }
    .pf-rl-panels { grid-template-columns: 380px minmax(0, 1fr); }
    .pf-rl-panels.pf-sg-panels--single, .pf-rl-panels.pf-sg-panels--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-rl-lbl { display: block; margin-bottom: 6px; }
    .pf-rl-hint { margin-top: 6px; }
    .pf-rl__name { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
    .pf-rl__code { height: 24px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .pf-rl__meta { margin: 2px 0 0; font-size: 12px; color: var(--text-secondary); }
    .pf-rl__dept { padding: 2px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 600; background: var(--pf-chip-bg); color: var(--text-secondary); border: 1px solid var(--pf-line); }

    /* ===== Additive cross-platform overrides (do not affect desktop-web >=1280px) ===== */

    /* Touch devices: enlarge dept chips to a comfortable >=44px tap target (incl. iPad/tablet
       where the pointer is coarse but the viewport is wide) without changing the desktop look. */
    @media (pointer: coarse) {
      .pf-dept-chip { padding: 10px 14px; min-height: 44px; display: inline-flex; align-items: center; }
    }

    /* Phone (<=640): prevent iOS focus-zoom (needs >=16px) and give the form action row room.
       The page itself has no fixed chrome; only widen tap targets and stop zoom. */
    @media (max-width: 640px) {
      .pf-input { font-size: 16px; padding: 10px 12px; }
      .pf-dept-chip { min-height: 44px; }
      /* Card header: action buttons drop to their own full-width row under the meta block. */
      .pf-rl-actions { width: 100%; }
      /* Long lab names + code chip must wrap, not overflow, in the narrow card header. */
      .pf-rl__name { overflow-wrap: anywhere; word-break: break-word; }
      .pf-rl__code { flex-shrink: 0; }
    }

    /* Web-below-desktop band (641–1279px): /admin renders with the fixed 64px left
       icon rail and no top chrome. The section's px-4 md:px-8 gutter already aligns
       the screen-header and the body to the same left edge, so no container fix is
       needed here. Only safeguard against a long, unbreakable lab name overflowing
       its flex column in the card header (which would otherwise push card width and
       force horizontal scroll against the rail). */
    @include dt.tablet-band {
      .pf-rl__name { overflow-wrap: anywhere; word-break: break-word; }
      .pf-rl__code { flex-shrink: 0; }
    }
  `]
})
export class ReferralLabsComponent implements OnInit {
  /** Hosted in the Settings shell: the grid card renders BARE (ONE card, ONE head). */
  protected readonly bare = sgBare();
  /** Count + status filter, for a host that projects head tools into its own head. */
  readonly headTools = viewChild<TemplateRef<unknown>>('headTools');
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  protected readonly labs = signal<ReferralLab[]>([]);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (PF-PATTERN). */
  protected readonly web = webPointerSignal();

  /** Band pill search: name, code, contact, address and handled departments; card-head status filter. */
  readonly q = signal('');
  readonly status = signal<SgStatus>('all');
  readonly statusOptions = computed(() => sgStatusOptions(this.labs().length, this.labs().filter(l => !l.isActive).length));
  readonly visibleLabs = computed(() => bandFilter(sgByStatus(this.labs(), this.status(), l => l.isActive), this.q(), l => [
    l.name, l.code, l.contactName, l.contactPhone, l.contactEmail, l.address,
    ...this.deptCodesOf(l).flatMap(c => [c, this.deptName(c)]),
  ]));
  protected readonly loading = signal<boolean>(true);
  readonly loadingShown = heldFlag(this.loading);

  // ── Test Master grid ──
  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly phone = sgMedia(SG_PHONE_MQ);
  readonly gridTheme = sgGridTheme();
  readonly getRowId = (p: GetRowIdParams<ReferralLab>) => p.data.id;
  readonly rowClass = sgRowOff<ReferralLab>(l => l.isActive);
  readonly defaultColDef: ColDef<ReferralLab> = { sortable: true, resizable: true, filter: false, minWidth: 90, wrapText: true, autoHeight: true };
  actionsFor(l: ReferralLab): SgAction[] {
    return [
      { label: 'Edit', aria: `Edit ${l.name}`, icon: true, path: SG_ICON.edit, run: () => this.edit(l) },
      { label: l.isActive ? 'Deactivate' : 'Reactivate', aria: `${l.isActive ? 'Deactivate' : 'Reactivate'} ${l.name}`, path: SG_ICON.power, icon: true, run: () => this.toggleActive(l) },
    ];
  }
  readonly colDefs = computed<ColDef<ReferralLab>[]>(() => {
    const web = this.web() && !this.phone();
    this._departments();
    const cols: ColDef<ReferralLab>[] = [
      { colId: 'name', headerName: 'Lab', flex: 1.3, minWidth: 180, sort: 'asc', valueGetter: p => p.data?.name ?? '',
        cellRenderer: (p: ICellRendererParams<ReferralLab>) => sgCell(p.data?.name, p.data?.address || null, true) },
      { colId: 'code', headerName: 'Code', width: 110, minWidth: 90, flex: 0, cellClass: 'pf-num', valueGetter: p => p.data?.code || '—' },
      { colId: 'contact', headerName: 'Contact', flex: 1, minWidth: 160, valueGetter: p => p.data?.contactName ?? '',
        cellRenderer: (p: ICellRendererParams<ReferralLab>) => sgCell(p.data?.contactName || '—', [p.data?.contactPhone, p.data?.contactEmail].filter(Boolean).join(' · ') || null) },
      { colId: 'departments', headerName: 'Departments handled', flex: 1.4, minWidth: 180, sortable: false,
        valueGetter: p => (p.data ? this.deptCodesOf(p.data).map(c => this.deptName(c)).join(', ') : ''),
        cellRenderer: (p: ICellRendererParams<ReferralLab>) => sgChips(p.data ? this.deptCodesOf(p.data).map(c => this.deptName(c)) : [], 'Any department') },
      sgPillCol<ReferralLab>(l => l.isActive),
      sgActionsCol<ReferralLab>(web, [], 2, p => (p.data ? sgActions(web, this.actionsFor(p.data)) : document.createElement('span'))),
    ];
    if (this.phone()) return cols.filter(c => ['name', 'departments', 'actions'].includes(c.colId ?? ''));
    return cols;
  });
  protected readonly saving = signal<boolean>(false);
  protected readonly formOpen = signal<boolean>(false);
  protected readonly draft = signal<LabDraft>({ ...EMPTY });
  protected readonly nameError = signal<string | null>(null);
  protected readonly codeError = signal<string | null>(null);
  private readonly _departments = signal<Department[]>([]);

  /** Distinct department code→name options for the picker. */
  protected readonly deptOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const d of this._departments()) {
      const code = (d.code ?? '').trim().toUpperCase();
      if (code && !seen.has(code)) seen.set(code, d.name ?? code);
    }
    return Array.from(seen.entries()).map(([code, name]) => ({ code, name }));
  });

  ngOnInit() {
    this.refresh();
    this.api.get<Department[]>('/api/tenants/departments').subscribe({ next: l => this._departments.set(l ?? []) });
  }

  refresh() {
    this.loading.set(true);
    this.api.get<ReferralLab[]>('/api/referral-labs?includeInactive=true').subscribe({
      next: l => { this.labs.set(l ?? []); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toasts.error(e?.message ?? 'Could not load referral labs'); }
    });
  }

  toggleForm() {
    this.formOpen.update(v => !v);
    if (!this.formOpen()) { this.draft.set({ ...EMPTY }); this.clearFieldErrors(); }
  }
  patch(p: Partial<LabDraft>) {
    if ('name' in p) this.nameError.set(null);
    if ('code' in p) this.codeError.set(null);
    this.draft.update(d => ({ ...d, ...p }));
  }
  private clearFieldErrors() { this.nameError.set(null); this.codeError.set(null); }
  toggleDept(code: string) {
    this.draft.update(d => ({
      ...d,
      departmentCodes: d.departmentCodes.includes(code)
        ? d.departmentCodes.filter(c => c !== code)
        : [...d.departmentCodes, code],
    }));
  }

  deptCodesOf(l: ReferralLab): string[] {
    if (!l.departmentCodesJson) return [];
    try { const a = JSON.parse(l.departmentCodesJson); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  deptName(code: string): string {
    return this.deptOptions().find(o => o.code === code)?.name ?? code;
  }

  edit(l: ReferralLab) {
    this.draft.set({
      id: l.id, name: l.name, code: l.code ?? '',
      contactName: l.contactName ?? '', contactPhone: l.contactPhone ?? '',
      contactEmail: l.contactEmail ?? '', address: l.address ?? '',
      departmentCodes: this.deptCodesOf(l),
    });
    this.clearFieldErrors();
    this.formOpen.set(true);
  }

  save() {
    const d = this.draft();
    if (!d.name.trim()) return;
    this.clearFieldErrors();
    this.saving.set(true);
    const body = {
      name: d.name.trim(),
      code: d.code.trim() || null,
      contactName: d.contactName.trim() || null,
      contactPhone: d.contactPhone.trim() || null,
      contactEmail: d.contactEmail.trim() || null,
      address: d.address.trim() || null,
      departmentCodesJson: d.departmentCodes.length ? JSON.stringify(d.departmentCodes) : null,
    };
    const req = d.id
      ? this.api.put<ReferralLab>(`/api/referral-labs/${d.id}`, body)
      : this.api.post<ReferralLab>('/api/referral-labs', body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(d.id ? 'Referral lab updated' : 'Referral lab created');
        this.formOpen.set(false);
        this.draft.set({ ...EMPTY });
        this.refresh();
      },
      error: e => {
        this.saving.set(false);
        const err = ApiError.from(e);
        if (err.field === 'name') this.nameError.set(err.message);
        else if (err.field === 'code') this.codeError.set(err.message);
        else this.toasts.error(err.message);
      }
    });
  }

  toggleActive(l: ReferralLab) {
    this.api.put<ReferralLab>(`/api/referral-labs/${l.id}`, {
      name: l.name, code: l.code ?? null,
      contactName: l.contactName ?? null, contactPhone: l.contactPhone ?? null,
      contactEmail: l.contactEmail ?? null, address: l.address ?? null,
      departmentCodesJson: l.departmentCodesJson ?? null,
      isActive: !l.isActive,
    }).subscribe({
      next: () => { this.toasts.success(l.isActive ? 'Deactivated' : 'Reactivated'); this.refresh(); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
}
