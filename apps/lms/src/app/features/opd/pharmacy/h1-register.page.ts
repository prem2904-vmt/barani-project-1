import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { heldFlag } from '../../../shared/utils/min-duration';
import { labDaysAgo, labToday } from '../../../shared/utils/lab-clock';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import { PharmacyApi, type H1Row } from './pharmacy.api';
import { errText } from './pharmacy-math';
import { PharmacySectionsComponent } from './pharmacy-sections.component';

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * The Schedule H1 register (`/opd/pharmacy/h1-register`) — the legal record of
 * every H1 (and X) sale at this branch: date, drug, batch, quantity, patient,
 * prescriber and reg. no., bill no., pharmacist. Read-only (rows are written
 * at the moment of sale and never deleted); exported as CSV for inspection.
 */
@Component({
  selector: 'pf-pharmacy-h1-register',
  standalone: true,
  imports: [AgGridAngular, HeroBandComponent, PfDateComponent, SkeletonTableComponent, BusyDirective, PharmacySectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" backTo="/opd/pharmacy" [customSearch]="true">
        <label band-search class="ph-search">
          <svg class="ph-search__glass" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="ph-search__input" type="search" placeholder="Search the register — drug, patient, doctor, bill" aria-label="Search the register" [value]="q()" (input)="q.set($any($event.target).value)" />
        </label>
        <pf-pharmacy-sections band-tools active="h1"></pf-pharmacy-sections>
        <ng-container band-actions>
          <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="export()" [disabled]="exporting()" [pfBusy]="exporting()" pfBusyLabel="Exporting…" aria-label="Export CSV">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
            Export CSV
          </button>
        </ng-container>
      </pf-hero-band>
      <div class="ph-body ph-body--one">
        <section class="pf-card" aria-labelledby="ph-h1-t">
          <header class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M8 7h8M8 11h6"/></svg></span>
            <span class="pf-card__label" id="ph-h1-t">{{ reg() === 'X' ? 'Schedule X register' : reg() === 'H1' ? 'H1 register' : 'H1 & X register' }}</span>
            <div class="pf-seg" role="radiogroup" aria-label="Which register">
              @for (o of regs; track o.v) {
                <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="reg() === o.v" [attr.aria-pressed]="reg() === o.v" (click)="setReg(o.v)">{{ o.l }}</button>
              }
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <pf-date label="From" [value]="from()" [max]="to()" (valueChange)="setFrom($event)"></pf-date>
              <span class="ph-sub">to</span>
              <pf-date label="To" [value]="to()" [min]="from()" [max]="today" (valueChange)="setTo($event)"></pf-date>
            </div>
            <span class="pf-card__spacer"></span>
            <span class="ph-sub pf-num">{{ rows().length }} {{ rows().length === 1 ? 'entry' : 'entries' }}</span>
          </header>
          <div class="pf-card__body ph-card-body--flush" style="position:relative">
            @if (showSkeleton()) { <pf-skeleton-table [rows]="8" [cols]="7"></pf-skeleton-table> }
            <ag-grid-angular class="ph-grid" style="height:100%" [theme]="gridTheme()" [rowData]="rows()" [columnDefs]="cols" [overlayNoRowsTemplate]="noRows"></ag-grid-angular>
          </div>
        </section>
      </div>
    </section>
  `,
})
export class PharmacyH1RegisterPage {
  private readonly api = inject(PharmacyApi);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService);
  protected readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  protected readonly today = labToday();
  protected readonly from = signal<string | null>(labDaysAgo(30));
  protected readonly to = signal<string | null>(this.today);
  protected readonly q = signal('');
  /** Which register: both, H1 only or Schedule X only (the row's schedule is snapshotted at sale). */
  protected readonly reg = signal<'' | 'H1' | 'X'>('');
  protected readonly regs: { v: '' | 'H1' | 'X'; l: string }[] = [{ v: '', l: 'All' }, { v: 'H1', l: 'H1' }, { v: 'X', l: 'Schedule X' }];
  protected setReg(v: '' | 'H1' | 'X') { this.reg.set(v); this.load(); }
  private readonly all = signal<H1Row[]>([]);
  private readonly loading = signal(true);
  protected readonly showSkeleton = heldFlag(this.loading);
  protected readonly exporting = signal(false);
  protected readonly noRows = '<span class="ph-sub">No Schedule H1 sales in this period.</span>';
  protected readonly rows = computed(() => {
    const t = this.q().trim().toLowerCase();
    return !t ? this.all() : this.all().filter(r => [r.drugName, r.generic, r.patientName, r.prescriberName, r.prescriberRegNo, r.dispenseNumber, r.batchNo]
      .filter(Boolean).join(' ').toLowerCase().includes(t));
  });
  // Statutory column order (GSR 588(E), Rule 65): serial, date, prescriber
  // name + reg. no. + address, patient name + address, drug, batch, qty.
  protected readonly cols: ColDef<H1Row>[] = [
    { field: 'serial', headerName: 'Sl. no.', width: 90, type: 'rightAligned' },
    { field: 'at', headerName: 'Date', width: 150, valueFormatter: p => new Date(p.value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) },
    { field: 'dispenseNumber', headerName: 'Bill no.', width: 140 },
    { field: 'drugName', headerName: 'Drug', flex: 1.5, minWidth: 160, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'schedule', headerName: 'Sch', width: 70 },
    { field: 'batchNo', headerName: 'Batch', width: 110 },
    { field: 'qty', headerName: 'Qty', width: 80, type: 'rightAligned' },
    { field: 'patientName', headerName: 'Patient', flex: 1.2, minWidth: 150, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'patientAddress', headerName: 'Patient address', flex: 1.4, minWidth: 160, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'prescriberName', headerName: 'Prescriber', flex: 1.2, minWidth: 150, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'prescriberRegNo', headerName: 'Reg. no.', width: 130 },
    { field: 'prescriberAddress', headerName: 'Prescriber address', flex: 1.4, minWidth: 160, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'byName', headerName: 'Pharmacist', width: 140 },
  ];

  constructor() { this.load(); }
  private load() {
    this.loading.set(true);
    this.api.h1(this.from(), this.to(), this.reg() || null).subscribe({
      next: r => { this.all.set(r); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toast.error(errText(e)); },
    });
  }
  protected setFrom(v: string | null) { this.from.set(v); this.load(); }
  protected setTo(v: string | null) { this.to.set(v); this.load(); }
  protected export() {
    this.exporting.set(true);
    this.api.h1Csv(this.from(), this.to(), this.reg() || null).subscribe({
      next: blob => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `h1-register-${this.from() ?? ''}-${this.to() ?? ''}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
      error: e => { this.exporting.set(false); this.toast.error(errText(e, 'Export failed.')); },
    });
  }
}
