import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import {
  AllCommunityModule, CellValueChangedEvent, ColDef, GetRowIdParams, ICellRendererParams, ModuleRegistry,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
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
import { WEEK_DAYS, inr, opdGridDark, opdGridLight } from './opd-admin.util';

ModuleRegistry.registerModules([AllCommunityModule]);

/** A grid row: the doctor (GET /api/doctors — the existing list: name, reg.
 *  no., fee) + the OPD Master extras (room, prefix, days, per-service fees as
 *  `fee:<serviceId>` keys). `id` = the doctor's user id. */
interface DoctorRow extends OpdDoctorAdminRow { id: string; [feeKey: `fee:${string}`]: number | null | undefined; }

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
  imports: [AgGridAngular, ScreenHeaderComponent, HeroBandComponent, BusyDirective, SkeletonTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./opd-admin.shared.scss'],
  template: `
    <section class="pf-da pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/admin/opd" placeholder="Search doctors — name, department, room…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="!dirty() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()"
                    aria-label="Save" title="Save">
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
          <button type="button" class="pf-da__save press" [disabled]="!dirty() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <section class="nd-card oa-main" aria-label="Doctors" style="flex:1 1 auto">
          <header class="nd-card__head oa-main__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg></span>
            <span class="nd-card__label">Doctors</span>
            <span class="nd-card__note oa-hint">Double-click a cell to edit · tap a day to switch it · a blank fee = not offered</span>
            <span class="oa-count nd-num">{{ plural(visibleRows().length, 'doctor') }}</span>
          </header>
          <div class="oa-main__body">
            @if (listSkeleton()) {
              <pf-skeleton-table class="oa-grid-skel" [rows]="8" [cols]="6" label="Loading doctors…"></pf-skeleton-table>
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
    :host ::ng-deep .pf-da-day { min-width: 34px; height: 30px; padding: 0 4px; border-radius: 8px; border: 1px solid var(--nd-line); background: transparent;
      color: var(--text-tertiary); font: inherit; font-size: 11.5px; cursor: pointer; }
    :host ::ng-deep .pf-da-day[aria-pressed='true'] { border-color: var(--nd-sel-border); background: var(--nd-sel-bg); color: var(--text-primary); font-weight: 600; }
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
    { field: 'name', headerName: 'Doctor', flex: 1.4, minWidth: 170, pinned: 'left' },
    { headerName: 'Department', minWidth: 140, valueGetter: (p) => p.data?.specializations?.[0] || p.data?.department || '—' },
    // The ONE registration number (users.RegistrationId) — what prints under the signature.
    { field: 'regNo', headerName: 'Registration no.', editable: true, minWidth: 150, cellClass: 'nd-num',
      valueParser: (p) => String(p.newValue ?? '').trim().slice(0, 64), valueFormatter: (p) => p.value || '—' },
    { field: 'room', headerName: 'Room', editable: true, minWidth: 110,
      valueParser: (p) => String(p.newValue ?? '').trim().slice(0, 40) || null, valueFormatter: (p) => p.value || '—' },
    { field: 'tokenPrefix', headerName: 'Token prefix', editable: true, width: 120, flex: 0, cellClass: 'nd-num',
      valueParser: (p) => { const s = String(p.newValue ?? '').trim().toUpperCase(); return /^[A-Z0-9]{0,4}$/.test(s) ? (s || null) : p.oldValue; },
      valueFormatter: (p) => p.value || '—' },
    { field: 'days', headerName: 'Sits on', minWidth: 290, flex: 1.6, sortable: false,
      cellRenderer: (p: ICellRendererParams<DoctorRow>) => this.daysCell(p.data) },
    ...this.perDoctorServices().map<ColDef<DoctorRow>>((s) => ({
      colId: `fee:${s.id}`, headerName: `${s.name} (₹)`, headerTooltip: `${s.code} — per-doctor fee; blank = not offered`,
      editable: true, width: 150, flex: 0, type: 'rightAligned', cellClass: 'nd-num',
      valueGetter: (p) => p.data?.[`fee:${s.id}`] ?? null,
      valueSetter: (p) => {
        if (!p.data) return false;
        const t = String(p.newValue ?? '').trim();
        const n = t === '' ? null : Number(t);
        if (n != null && (!Number.isFinite(n) || n < 0)) return false;
        p.data[`fee:${s.id}`] = n;
        return true;
      },
      valueFormatter: (p) => (p.value == null ? 'Not offered' : inr(p.value)),
    })),
    { field: 'fee', headerName: 'Default consult fee (₹)', editable: true, width: 190, flex: 0, headerTooltip: 'Legacy desk consult fee (pre-OPD Master)',
      cellClass: 'nd-num', type: 'numericColumn',
      valueParser: p => { const n = Number(p.newValue); return Number.isFinite(n) && n >= 0 ? n : (p.oldValue ?? 0); },
      valueFormatter: p => '₹' + (p.value ?? 0) },
  ]);

  constructor() { this.load(); }

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
      regNo: d.regNo ?? null, fee: d.fee ?? 0, room: x?.room ?? null, tokenPrefix: x?.tokenPrefix ?? null,
      days: x?.days ?? [], prices: x?.prices ?? [],
    } as DoctorRow;
    for (const p of r.prices) r[`fee:${p.serviceId}`] = p.isActive ? p.price : null;
    return r;
  }
  private legacyKey(r: DoctorRow): string { return `${r.regNo ?? ''}|${r.fee ?? 0}`; }

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
      .map((r) => this.api.patch(`${OPD_API.doctors}/${r.id}`, { fee: r.fee, regNo: r.regNo ?? '' }).pipe(map(() => true), catchError(() => of(false))));
    forkJoin({ extras: this.admin.saveDoctors(extras), legacy: legacyCalls.length ? forkJoin(legacyCalls) : of([] as boolean[]) }).subscribe({
      next: ({ extras: rows, legacy }) => {
        this.saving.set(false);
        this._dirty.set(new Set());
        const byId = new Map(rows.map((d) => [d.userId, d] as const));
        this.rowData.update((list) => list.map((r) => {
          const fresh = byId.get(r.id);
          return fresh ? this.toRow({ id: r.id, name: r.name, department: r.department, specializations: r.specializations, regNo: r.regNo, fee: r.fee }, fresh) : r;
        }));
        this.legacy = new Map(this.rowData().map((r) => [r.id, this.legacyKey(r)]));
        const failed = legacy.filter((ok) => !ok).length;
        if (failed) this.toasts.error(`${plural(failed, 'registration number')} failed to save`);
        else this.toasts.success('Doctors saved');
      },
      error: (e: Error) => { this.saving.set(false); this.toasts.error(e.message || 'Could not save doctors'); },
    });
  }
}
