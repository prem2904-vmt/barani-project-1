import { SkelGridComponent } from '../../../shared/components/skeleton-frame/skeleton-frame.component';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import {
  AllCommunityModule, CellValueChangedEvent, ColDef, GetRowIdParams, ICellRendererParams, ModuleRegistry,
} from 'ag-grid-community';
import { AgGridAngular, ICellRendererAngularComp } from 'ag-grid-angular';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { plural } from '../../../shared/utils/plural';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { bandFilter } from '../../../shared/utils/band-search';
import { OPD_API } from '../shared/opd-api';
import { OpdAdminApi, OpdDoctorAdminRow, OpdDoctorLite, OpdServiceRow } from './opd-admin.api';
import { numberCol, textCol } from '../../../shared/utils/work-grid';
import { rawChoiceCol } from '../shared/opd-grid-cols';
import { WEEK_DAYS, daysText, inr, opdGridDark, opdGridLight } from './opd-admin.util';

ModuleRegistry.registerModules([AllCommunityModule]);

/** A grid row: the doctor (GET /api/doctors — the existing list: name, reg.
 *  no., fee) + the OPD Master extras (room, prefix, days, per-service fees as
 *  `fee:<serviceId>` keys). `id` = the doctor's user id. */
interface DoctorRow extends OpdDoctorAdminRow { id: string; assistantUserId?: string | null; [feeKey: `fee:${string}`]: number | null | undefined; }

/** The server's "clear the assistant" value (PATCH: null = unchanged). */
export const CLEAR_ASSISTANT = '00000000-0000-0000-0000-000000000000';

type AssistantParams = ICellRendererParams<DoctorRow> & { options: PfSelectOption<string>[]; onPick: (row: DoctorRow, userId: string) => void };

/** The Assistant cell: a searchable pf-select of the tenant's users (no native select). */
@Component({
  selector: 'pf-da-assistant-cell',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-select size="sm" [searchable]="true" [options]="opts" [value]="value" placeholder="None" (valueChange)="pick($event)"></pf-select>`,
})
export class AssistantCellComponent implements ICellRendererAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  opts: PfSelectOption<string>[] = [];
  value = '';
  private params: AssistantParams | null = null;
  agInit(p: AssistantParams): void { this.params = p; this.opts = p.options; this.value = p.data?.assistantUserId ?? ''; this.cdr.markForCheck(); }
  refresh(p: AssistantParams): boolean { this.agInit(p); return true; }
  pick(v: string) { this.value = v; if (this.params?.data) this.params.onPick(this.params.data, v); }
}

/**
 * OPD → Doctors (admin). Same AG-Grid + theme as Test Master. The EXISTING
 * DoctorProfile grid (registration number = the user's one RegistrationId,
 * the legacy consultation fee) extended for OPD Master: room, token prefix,
 * the days a doctor sits (tap a day), and one fee column per PER-DOCTOR
 * service (blank = not offered — never a fallback price). One batch Save:
 * PATCH /api/doctors/{id} for reg. no. / fee, PUT /api/opd/admin/doctors for
 * the rest.
 */
@Component({
  selector: 'pf-doctors-admin',
  standalone: true,
  imports: [AgGridAngular, ScreenHeaderComponent, HeroBandComponent, BusyDirective, SkeletonTableComponent, SkelGridComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./opd-admin.shared.scss'],
  template: `
    <section class="pf-da pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/admin/opd" placeholder="Search doctors — name, department, room…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="!dirty() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()"
                    aria-label="Save" [pfBusyInactive]="!dirty() || saving()" [attr.title]="(!dirty() && !saving()) ? 'No changes to save' : 'Save'">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>
              </svg>
              {{ saving() ? 'Saving…' : dirty() ? 'Save changes (' + dirtyCount() + ')' : 'Save' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="OPD" title="Doctors" subtitle="Fee per service, room, token prefix and availability"
        parentRoute="/admin/opd">
        <div actions>
          <button type="button" class="pf-da__save press" [disabled]="!dirty() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()" [pfBusyInactive]="!dirty() || saving()" [attr.title]="(!dirty() && !saving()) ? 'No changes to save' : null">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <section class="pf-card oa-main" aria-label="Doctors" style="flex:1 1 auto">
          <header class="pf-card__head oa-main__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg></span>
            <span class="pf-card__label">Doctors</span>
            <span class="pf-card__note oa-hint">Double-click a cell to edit · tap a day to switch it · a blank fee = not offered</span>
            <span class="oa-count pf-num">{{ plural(visibleRows().length, 'doctor') }}</span>
          </header>
          <div class="oa-main__body">
            @if (listSkeleton()) {
              <pf-skel-grid class="oa-grid-skel" [rows]="30" [columns]="6" label="Loading doctors…"></pf-skel-grid>
            }
            @if (!loading() && rowData().length === 0) {
              <div class="oa-empty">
                <p style="font-weight:600;color:var(--text-primary);margin:0">No doctors yet</p>
                <p style="margin:4px 0 0">Create a user with a Doctor-type role — they'll appear here.</p>
              </div>
            } @else {
              <ag-grid-angular class="oa-grid pf-da-grid" [theme]="gridTheme()" [rowData]="visibleRows()" [columnDefs]="colDefs()"
                               [defaultColDef]="defaultColDef" [getRowId]="getRowId" [animateRows]="true" [singleClickEdit]="true"
                               [stopEditingWhenCellsLoseFocus]="true" (cellValueChanged)="onCellValueChanged($event)"></ag-grid-angular>
              @if (q().trim() && visibleRows().length === 0) { <p class="pf-band-empty">No doctors match "{{ q() }}".</p> }
            }
          </div>
        </section>
      </div>
    </section>
  `,
  styles: [`
    .pf-da__save { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700;
      color: #fff; background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-da__save:disabled { opacity: .5; cursor: default; }
    :host ::ng-deep .pf-da-days { display: inline-flex; gap: 3px; flex-wrap: wrap; padding: 4px 0; }
    :host ::ng-deep .pf-da-day { min-width: 34px; height: 30px; padding: 0 4px; border-radius: 8px; border: 1px solid var(--pf-line); background: transparent;
      color: var(--text-tertiary); font: inherit; font-size: 11.5px; cursor: pointer; }
    :host ::ng-deep .pf-da-day[aria-pressed='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); color: var(--text-primary); font-weight: 600; }
    :host ::ng-deep .pf-da-day:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
  `],
})
export class DoctorsAdminComponent {
  private readonly api = inject(ApiService);
  private readonly admin = inject(OpdAdminApi);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  protected readonly plural = plural;

  readonly rowData = signal<DoctorRow[]>([]);
  /** The tenant's users (GET /api/users/picker) — the Assistant choices. */
  readonly users = signal<{ id: string; displayName: string; isActive?: boolean }[]>([]);
  readonly userOpts = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'None' },
    ...this.users().filter(u => u.isActive !== false).map(u => ({ value: u.id, label: u.displayName })),
  ]);
  readonly services = signal<OpdServiceRow[]>([]);
  readonly q = signal('');
  readonly visibleRows = computed(() =>
    bandFilter(this.rowData(), this.q(), d => [d.name, d.department, d.regNo, d.room, ...(d.specializations ?? [])]));
  readonly loading = signal(true);
  readonly saving = signal(false);
  private readonly listHold = createLoadHold(true);
  readonly listSkeleton = this.listHold.active;
  private readonly _dirty = signal<Set<string>>(new Set());
  readonly dirty = computed(() => this._dirty().size > 0);
  readonly dirtyCount = computed(() => this._dirty().size);
  /** Reg. no. / fee as loaded — only a change there goes to PATCH /api/doctors. */
  private legacy = new Map<string, string>();

  readonly gridTheme = computed(() => (this.theme.isDark() ? opdGridDark : opdGridLight));
  readonly getRowId = (p: GetRowIdParams<DoctorRow>) => p.data.id;
  readonly defaultColDef: ColDef<DoctorRow> = { sortable: true, resizable: true, flex: 1, minWidth: 110, wrapText: true, autoHeight: true };
  readonly perDoctorServices = computed(() => this.services().filter((s) => s.priceMode === 'per_doctor' && s.isActive));

  readonly colDefs = computed<ColDef<DoctorRow>[]>(() => [
    textCol<DoctorRow>({ field: 'name', headerName: 'Doctor', flex: 1.4, minWidth: 170, pinned: 'left' }, (r) => r.name ?? ''),
    textCol<DoctorRow>({ colId: 'department', headerName: 'Department', minWidth: 140, valueFormatter: (p) => p.value || '—' }, (r) => r.department ?? ''),
    textCol<DoctorRow>({ colId: 'qualifications', headerName: 'Qualifications', minWidth: 160, valueFormatter: (p) => p.value || '—' }, (r) => (r.specializations ?? []).join(', ')),
    // The ONE registration number (users.RegistrationId) — what prints under the signature.
    textCol<DoctorRow>({ field: 'regNo', headerName: 'Registration no.', editable: true, minWidth: 150, cellClass: 'pf-num',
      valueParser: (p) => String(p.newValue ?? '').trim().slice(0, 64), valueFormatter: (p) => p.value || '—' }, (r) => r.regNo ?? ''),
    textCol<DoctorRow>({ field: 'room', headerName: 'Room', editable: true, minWidth: 110,
      valueParser: (p) => String(p.newValue ?? '').trim().slice(0, 40) || null, valueFormatter: (p) => p.value || '—' }, (r) => r.room ?? ''),
    textCol<DoctorRow>({ field: 'tokenPrefix', headerName: 'Token prefix', editable: true, width: 120, flex: 0, cellClass: 'pf-num',
      valueParser: (p) => { const s = String(p.newValue ?? '').trim().toUpperCase(); return /^[A-Z0-9]{0,4}$/.test(s) ? (s || null) : p.oldValue; },
      valueFormatter: (p) => p.value || '—' }, (r) => r.tokenPrefix ?? ''),
    // The doctor's assistant (consult v6 Page) — a tenant user; blank = none.
    rawChoiceCol<DoctorRow>({ colId: 'assistant', headerName: 'Assistant', minWidth: 200, autoHeight: false,
      cellRenderer: AssistantCellComponent,
      cellRendererParams: { options: this.userOpts(), onPick: (r: DoctorRow, id: string) => { r.assistantUserId = id || null; this.markDirty(r.id); } } },
      (r) => r.assistantUserId ?? '', (r) => this.userOpts().find((o) => o.value === (r.assistantUserId ?? ''))?.label ?? 'None'),
    textCol<DoctorRow>({ field: 'days', headerName: 'Sits on', minWidth: 290, flex: 1.6,
      cellRenderer: (p: ICellRendererParams<DoctorRow>) => this.daysCell(p.data) }, (r) => daysText(r.days)),
    ...this.perDoctorServices().map<ColDef<DoctorRow>>((s) => numberCol<DoctorRow>({
      colId: `fee:${s.id}`, headerName: `${s.name} (₹)`, headerTooltip: `${s.code} — per-doctor fee; blank = not offered`,
      editable: true, width: 150, flex: 0, type: 'rightAligned', cellClass: 'pf-num',
      valueSetter: (p) => {
        if (!p.data) return false;
        const t = String(p.newValue ?? '').trim();
        const n = t === '' ? null : Number(t);
        if (n != null && (!Number.isFinite(n) || n < 0)) return false;
        p.data[`fee:${s.id}`] = n;
        return true;
      },
      valueFormatter: (p) => (p.value == null ? 'Not offered' : inr(p.value)),
    }, (r) => r[`fee:${s.id}`] ?? null, 'right')),
    numberCol<DoctorRow>({ field: 'fee', headerName: 'Default consult fee (₹)', editable: true, width: 190, flex: 0, headerTooltip: 'Legacy desk consult fee (pre-OPD Master)',
      cellClass: 'pf-num', type: 'numericColumn',
      valueParser: p => { const n = Number(p.newValue); return Number.isFinite(n) && n >= 0 ? n : (p.oldValue ?? 0); },
      valueFormatter: p => '₹' + (p.value ?? 0) }, (r) => r.fee ?? null, 'right'),
  ]);

  constructor() {
    this.load();
    this.api.get<{ id: string; displayName: string; isActive?: boolean }[]>('/api/users/picker').subscribe({
      next: l => this.users.set(l ?? []), error: () => { /* the Assistant column then offers "None" only */ },
    });
  }

  private load(): void {
    forkJoin({
      docs: this.api.get<OpdDoctorLite[]>(OPD_API.doctors),
      extras: this.admin.doctors().pipe(catchError(() => of([] as OpdDoctorAdminRow[]))),
      services: this.admin.services().pipe(catchError(() => of([] as OpdServiceRow[]))),
    }).subscribe({
      next: ({ docs, extras, services }) => {
        this.listHold.done();
        this.services.set(services ?? []);
        const byId = new Map((extras ?? []).map((x) => [x.userId, x] as const));
        this.rowData.set((docs ?? []).map((d) => this.toRow(d, byId.get(d.id))));
        this.legacy = new Map(this.rowData().map((r) => [r.id, this.legacyKey(r)]));
        this.loading.set(false);
      },
      error: () => { this.listHold.done(); this.loading.set(false); this.toasts.error('Could not load doctors'); },
    });
  }

  private toRow(d: OpdDoctorLite, x?: OpdDoctorAdminRow): DoctorRow {
    const r = {
      id: d.id, userId: d.id, name: d.name, department: d.department ?? null, specializations: d.specializations ?? [],
      regNo: d.regNo ?? null, fee: d.fee ?? 0, assistantUserId: d.assistantUserId ?? null, room: x?.room ?? null, tokenPrefix: x?.tokenPrefix ?? null,
      days: x?.days ?? [], prices: x?.prices ?? [],
    } as DoctorRow;
    for (const p of r.prices) r[`fee:${p.serviceId}`] = p.isActive ? p.price : null;
    return r;
  }
  private legacyKey(r: DoctorRow): string { return `${r.regNo ?? ''}|${r.fee ?? 0}|${r.assistantUserId ?? ''}`; }
  /** The PATCH /api/doctors body: the assistant only when it changed (null = unchanged; the empty Guid clears). */
  private legacyBody(r: DoctorRow): Record<string, unknown> {
    const was = (this.legacy.get(r.id) ?? '').split('|')[2] ?? '';
    const now = r.assistantUserId ?? '';
    return { fee: r.fee, regNo: r.regNo ?? '', ...(was !== now ? { assistantUserId: now || CLEAR_ASSISTANT } : {}) };
  }

  /** The seven day toggles in the cell (whole-cell editing without a native control). */
  private daysCell(r: DoctorRow | undefined): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'pf-da-days';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', `Days ${r?.name ?? ''} sits`);
    if (!r) return wrap;
    for (const d of WEEK_DAYS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pf-da-day';
      b.textContent = d.label;
      b.setAttribute('aria-pressed', String(r.days.includes(d.value)));
      b.setAttribute('aria-label', `${d.label} for ${r.name}`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const on = !r.days.includes(d.value);
        r.days = on ? WEEK_DAYS.map((w) => w.value).filter((v) => v === d.value || r.days.includes(v)) : r.days.filter((v) => v !== d.value);
        b.setAttribute('aria-pressed', String(on));
        this.markDirty(r.id);
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  onCellValueChanged(e: CellValueChangedEvent<DoctorRow>) {
    if (e.data?.id) this.markDirty(e.data.id);
  }
  private markDirty(id: string): void { this._dirty.update((s) => new Set(s).add(id)); }

  save() {
    const changed = this.rowData().filter(r => this._dirty().has(r.id));
    if (!changed.length || this.saving()) return;
    this.saving.set(true);
    const svcIds = this.perDoctorServices().map((s) => s.id);
    const extras = changed.map((r) => ({
      userId: r.id, room: r.room ?? null, tokenPrefix: r.tokenPrefix ?? null, days: r.days,
      prices: svcIds.map((sid) => {
        const v = r[`fee:${sid}`];
        const old = r.prices.find((p) => p.serviceId === sid);
        return v == null
          ? (old ? { serviceId: sid, price: old.price, followUpFee: old.followUpFee ?? null, isActive: false } : null)
          : { serviceId: sid, price: v, followUpFee: old?.followUpFee ?? null, isActive: true };
      }).filter((x): x is NonNullable<typeof x> => !!x),
    }));
    const legacyCalls = changed.filter((r) => this.legacy.get(r.id) !== this.legacyKey(r))
      .map((r) => this.api.patch(`${OPD_API.doctors}/${r.id}`, this.legacyBody(r)).pipe(map(() => true), catchError(() => of(false))));
    forkJoin({ extras: this.admin.saveDoctors(extras), legacy: legacyCalls.length ? forkJoin(legacyCalls) : of([] as boolean[]) }).subscribe({
      next: ({ extras: rows, legacy }) => {
        this.saving.set(false);
        this._dirty.set(new Set());
        const byId = new Map(rows.map((d) => [d.userId, d] as const));
        this.rowData.update((list) => list.map((r) => {
          const fresh = byId.get(r.id);
          return fresh ? this.toRow({ id: r.id, name: r.name, department: r.department, specializations: r.specializations, regNo: r.regNo, fee: r.fee, assistantUserId: r.assistantUserId }, fresh) : r;
        }));
        this.legacy = new Map(this.rowData().map((r) => [r.id, this.legacyKey(r)]));
        const failed = legacy.filter((ok) => !ok).length;
        if (failed) this.toasts.error(`${plural(failed, 'doctor')}: registration number / assistant failed to save`);
        else this.toasts.success('Doctors saved');
      },
      error: (e: Error) => { this.saving.set(false); this.toasts.error(e.message || 'Could not save doctors'); },
    });
  }
}
