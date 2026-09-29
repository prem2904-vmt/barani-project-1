import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  AllCommunityModule,
  ColDef,
  CellValueChangedEvent,
  GetRowIdParams,
  ModuleRegistry,
  colorSchemeDark,
  colorSchemeLight,
  themeQuartz,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { bandFilter } from '../../../shared/utils/band-search';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  fontFamily: "'Noto Sans', system-ui, sans-serif", fontSize: 13, rowHeight: 44, headerHeight: 40,
  borderRadius: 12, accentColor: '#7c3aed',
});
// Noto Sans only (ND-PATTERN §6) — the app font, never Inter.
const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: "'Noto Sans', system-ui, sans-serif", fontSize: 13, rowHeight: 44, headerHeight: 40,
  borderRadius: 12, accentColor: '#a855f7',
});

interface DoctorRow {
  id: string;
  name: string;
  department?: string | null;
  specializations: string[];
  regNo?: string | null;
  fee: number;
}

/**
 * OPD → Doctors (admin). Same AG-Grid + theme as Test Master, so the look
 * carries across the app. Editable per-doctor consultation fee and
 * registration number (the user's one RegistrationId); edited rows are
 * batch-saved via PATCH /api/doctors/{id}.
 */
@Component({
  selector: 'pf-doctors-admin',
  standalone: true,
  imports: [AgGridAngular, ScreenHeaderComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-da pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): search doctors; Save is the band action. -->
        <pf-hero-band [back]="true" backTo="/admin/opd" placeholder="Search doctors — name, department, specialisation…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="!dirty() || saving()" (click)="save()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>
              </svg>
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="OPD" title="Doctors" subtitle="Consultation fee per doctor"
        parentRoute="/admin/opd">
        <div actions>
          <button type="button" class="pf-da__save press" [disabled]="!dirty() || saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
      @if (!loading() && rowData().length === 0) {
        <div class="pf-da__empty">
          <p class="pf-da__empty-t">No doctors yet</p>
          <p class="pf-da__muted">Create a user with a Doctor-type role — they'll appear here.</p>
        </div>
      } @else {
        <ag-grid-angular
          class="pf-da-grid"
          [theme]="gridTheme()"
          [rowData]="visibleRows()"
          [columnDefs]="colDefs"
          [defaultColDef]="defaultColDef"
          [getRowId]="getRowId"
          [animateRows]="true"
          [singleClickEdit]="true"
          [stopEditingWhenCellsLoseFocus]="true"
          (cellValueChanged)="onCellValueChanged($event)">
        </ag-grid-angular>
        @if (q().trim() && visibleRows().length === 0) {
          <p class="pf-band-empty">No doctors match "{{ q() }}".</p>
        }
      }
      </div>
    </section>
  `,
  styles: [`
    .pf-da__save { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700;
      color: #fff; background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-da__save:disabled { opacity: .5; cursor: default; }
    .pf-da-grid { display: block; width: 100%; height: calc(100dvh - 240px); min-height: 420px; margin-top: 8px; }
    /* New design: the grid fills the band body (no page scroll). */
    :host-context(.design-new) .pf-da-grid { flex: 1 1 auto; height: auto; min-height: 320px; margin-top: 0; }
    .pf-da__empty { margin-top: 16px; padding: 32px; text-align: center; border-radius: var(--nd-radius-card);
      border: 1px dashed var(--nd-line); }
    .pf-da__empty-t { font-weight: 600; color: var(--text-primary); }
    .pf-da__muted { color: var(--text-tertiary, #64748b); font-size: 13px; margin-top: 4px; }
  `],
})
export class DoctorsAdminComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  readonly rowData = signal<DoctorRow[]>([]);
  /** Band pill search; the grid shows the matching rows (same objects, so
   *  fee edits on a filtered view still reach save()). */
  readonly q = signal('');
  readonly visibleRows = computed(() =>
    bandFilter(this.rowData(), this.q(), d => [d.name, d.department, d.regNo, ...(d.specializations ?? [])]));
  readonly loading = signal(true);
  readonly saving = signal(false);
  private readonly _dirty = signal<Set<string>>(new Set());
  readonly dirty = computed(() => this._dirty().size > 0);

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  readonly getRowId = (p: GetRowIdParams<DoctorRow>) => p.data.id;

  readonly defaultColDef: ColDef<DoctorRow> = { filter: true, sortable: true, resizable: true, flex: 1, minWidth: 120 };
  readonly colDefs: ColDef<DoctorRow>[] = [
    { field: 'name', headerName: 'Doctor', flex: 1.4, minWidth: 160 },
    { field: 'department', headerName: 'Department', valueFormatter: p => p.value || '—' },
    { headerName: 'Specialisation', flex: 1.6, minWidth: 180,
      valueGetter: p => p.data?.specializations?.length ? p.data.specializations.join(', ') : '—' },
    // The ONE registration number (users.RegistrationId) — what prints under
    // the doctor's signature. Blank clears it; the doctor can also add it
    // themselves in My signature.
    { field: 'regNo', headerName: 'Registration no.', editable: true, minWidth: 150,
      cellClass: 'nd-num', valueParser: p => String(p.newValue ?? '').trim().slice(0, 64),
      valueFormatter: p => p.value || '—' },
    { field: 'fee', headerName: 'Consultation fee (₹)', editable: true, width: 190, flex: 0,
      cellClass: 'pf-da-fee nd-num', type: 'numericColumn',
      valueParser: p => { const n = Number(p.newValue); return Number.isFinite(n) && n >= 0 ? n : (p.oldValue ?? 0); },
      valueFormatter: p => '₹' + (p.value ?? 0) },
  ];

  constructor() {
    this.api.get<DoctorRow[]>('/api/doctors').subscribe({
      next: docs => { this.rowData.set((docs ?? []).map(d => ({ ...d, fee: d.fee ?? 0 }))); this.loading.set(false); },
      error: () => { this.loading.set(false); this.toasts.error('Could not load doctors'); },
    });
  }

  onCellValueChanged(e: CellValueChangedEvent<DoctorRow>) {
    if (e.data?.id) this._dirty.update(s => new Set(s).add(e.data.id));
  }

  save() {
    const changed = this.rowData().filter(r => this._dirty().has(r.id));
    if (!changed.length || this.saving()) return;
    this.saving.set(true);
    let done = 0, failed = 0;
    for (const r of changed) {
      this.api.patch(`/api/doctors/${r.id}`, { fee: r.fee, regNo: r.regNo ?? '' }).subscribe({
        next: () => { if (++done + failed === changed.length) this.finish(failed); },
        error: () => { failed++; if (done + failed === changed.length) this.finish(failed); },
      });
    }
  }
  private finish(failed: number) {
    this.saving.set(false);
    this._dirty.set(new Set());
    if (failed) this.toasts.error(`${failed} doctor(s) failed to save`);
    else this.toasts.success('Doctors saved');
  }
}
