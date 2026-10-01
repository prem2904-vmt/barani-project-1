import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, ModuleRegistry, colorSchemeDark, colorSchemeLight, themeQuartz } from 'ag-grid-community';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ANALYTICS_PERMS, FINANCIAL_ANALYTICS_PERMS, PATIENT_DATA_EXPORT_PERMS } from '../../core/auth/route-access';
import { ThemeService } from '../../core/services/theme.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../shared/primitives/select.component';
import { SkeletonTableComponent, SkeletonTilesComponent } from '../../shared/primitives/skeleton-kit.component';
import { ANALYTICS_PERIOD_OPTIONS, AnalyticsPeriod, AnalyticsPeriodPreset, resolveAnalyticsPeriod } from '../../shared/utils/analytics-period';
import { Branch } from '../../shared/models/tenant.model';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  fontFamily: 'inherit', fontSize: 13, rowHeight: 44, headerHeight: 40, borderRadius: 12, accentColor: '#7c3aed',
});
const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: 'inherit', fontSize: 13, rowHeight: 44, headerHeight: 40, borderRadius: 12, accentColor: '#a855f7',
});

type InsightsTab = 'analytics' | 'operations';

interface OverviewDto {
  patients: number; patientsDeltaPct?: number | null;
  tests: number; testsDeltaPct?: number | null;
  billedNet?: number | null; billedNetDeltaPct?: number | null;
  collected?: number | null; collectedDeltaPct?: number | null;
  avgBillValue?: number | null; avgBillValueDeltaPct?: number | null;
  testsPerPatient: number; testsPerPatientDeltaPct?: number | null;
  outsourcedPct: number; outsourcedPctDeltaPct?: number | null;
  medianTatMinutes?: number | null; medianTatDeltaPct?: number | null;
}

interface PatientRow {
  id: string; mrn?: string; firstName: string; lastName: string;
  age?: number; dob?: string; sex?: string; phone?: string; firstOrderAt: string;
}

/** A Phase-1 KPI card: value + optional Δ, with a money flag so the template
 *  hides the whole tile (never a blank/garbled number) when the field was
 *  withheld server-side (no view_financial_analytics). */
interface KpiCard {
  id: string; label: string; value: string; deltaPct: number | null; money: boolean;
}

@Component({
  selector: 'pf-insights',
  standalone: true,
  imports: [HeroBandComponent, SegmentedComponent, SelectComponent, SkeletonTableComponent, SkeletonTilesComponent, AgGridAngular],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="nd-page px-4 md:px-8 pt-6">
      <pf-hero-band [back]="true">
        <ng-container band-tools>
          <pf-select class="ins-filter" size="sm" [options]="periodOptions" [value]="period()"
                     (valueChange)="period.set($event)"></pf-select>
          @if (branchOptions().length > 1) {
            <pf-select class="ins-filter" size="sm" [options]="branchOptions()" [value]="branchId()"
                       (valueChange)="branchId.set($event)"></pf-select>
          }
        </ng-container>
      </pf-hero-band>

      <div class="nd-body">
        <div class="ins-tabs">
          <pf-segmented size="sm" [options]="tabOptions" [value]="tab()" (valueChange)="tab.set($event)"></pf-segmented>
        </div>

        @if (!canSeeAnalytics()) {
          <div class="nd-card">
            <div class="nd-card__body" style="padding: 24px;">
              <p style="color: var(--text-secondary);">You don't have access to Analytics / Lab Insights.</p>
            </div>
          </div>
        } @else if (tab() === 'analytics') {
          <div class="nd-card">
            <div class="nd-card__head">
              <span class="nd-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>
                </svg>
              </span>
              <span class="nd-card__label">Overview</span>
              <span class="nd-card__spacer"></span>
              <span class="nd-card__note">{{ periodLabel() }}</span>
            </div>
            <div class="nd-card__body">
              @if (overviewLoading() && !overview()) {
                <pf-skeleton-tiles [count]="8"></pf-skeleton-tiles>
              } @else if (overview()) {
                <div class="ins-kpi-grid">
                  @for (card of kpiCards(); track card.id) {
                    <button type="button" class="ins-kpi" (click)="openPatientsForKpi(card.id)">
                      <span class="ins-kpi__label">{{ card.label }}</span>
                      <span class="ins-kpi__value">{{ card.value }}</span>
                      @if (card.deltaPct !== null) {
                        <span class="ins-kpi__delta" [class.up]="card.deltaPct >= 0" [class.down]="card.deltaPct < 0">
                          {{ card.deltaPct >= 0 ? '+' : '' }}{{ card.deltaPct }}% vs previous period
                        </span>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          </div>
        } @else {
          <!-- Operations Insights: Patients list (export_patient_data gated end to end). -->
          <div class="nd-card">
            <div class="nd-card__head">
              <span class="nd-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                </svg>
              </span>
              <span class="nd-card__label">Patients</span>
              <span class="nd-card__spacer"></span>
              @if (canExportPatients()) {
                <button type="button" class="nd-btn nd-btn--secondary" [disabled]="exporting()" (click)="exportPatients()">
                  {{ exporting() ? 'Exporting…' : 'Export CSV' }}
                </button>
              }
            </div>
            <div class="nd-card__body">
              @if (!canExportPatients()) {
                <p style="padding: 16px; color: var(--text-secondary);">
                  The Patients list needs the export_patient_data permission.
                </p>
              } @else if (patientsLoading() && patientsRows().length === 0) {
                <pf-skeleton-table [rows]="8" [cols]="6"></pf-skeleton-table>
              } @else {
                <ag-grid-angular style="width: 100%; height: 520px;"
                  [theme]="gridTheme()" [rowData]="patientsRows()" [columnDefs]="patientColDefs"
                  [defaultColDef]="defaultColDef"></ag-grid-angular>
              }
            </div>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .ins-filter { min-width: 140px; }
    .ins-tabs { margin: 16px 0; }
    .ins-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 12px;
      padding: 16px;
    }
    .ins-kpi {
      text-align: left;
      border: 1px solid var(--nd-line, var(--border-default));
      border-radius: var(--nd-radius-card, 12px);
      background: var(--nd-card-bg, transparent);
      padding: 14px 16px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .ins-kpi:hover { border-color: #7c3aed; }
    .ins-kpi__label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }
    .ins-kpi__value {
      font-size: 22px;
      font-weight: 600;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
    }
    .ins-kpi__delta { font-size: 12px; color: var(--text-tertiary); }
    .ins-kpi__delta.up { color: #10b981; }
    .ins-kpi__delta.down { color: #ef4444; }
    @media (max-width: 640px) {
      .ins-kpi-grid { grid-template-columns: repeat(2, 1fr); padding: 12px; gap: 8px; }
    }
  `],
})
export class InsightsComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  readonly canSeeAnalytics = computed(() => this.auth.hasAnyPermission(ANALYTICS_PERMS));
  readonly canSeeMoney = computed(() => this.auth.hasAnyPermission(FINANCIAL_ANALYTICS_PERMS));
  readonly canExportPatients = computed(() => this.auth.hasAnyPermission(PATIENT_DATA_EXPORT_PERMS));

  readonly periodOptions = ANALYTICS_PERIOD_OPTIONS as unknown as PfSelectOption<AnalyticsPeriodPreset>[];
  readonly period = signal<AnalyticsPeriodPreset>('today');
  readonly resolvedPeriod = computed<AnalyticsPeriod>(() => resolveAnalyticsPeriod(this.period()));
  readonly periodLabel = computed(() => {
    const p = this.resolvedPeriod();
    return p.fromYmd === p.toYmd ? p.fromYmd : `${p.fromYmd} → ${p.toYmd}`;
  });

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<string>('');
  readonly branchOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All branches' },
    ...this.branches().map(b => ({ value: b.id, label: b.name })),
  ]);

  readonly tabOptions: SegmentedOption<InsightsTab>[] = [
    { value: 'analytics', label: 'Analytics' },
    { value: 'operations', label: 'Operations' },
  ];
  readonly tab = signal<InsightsTab>('analytics');

  readonly gridTheme = computed(() => this.theme.isDark() ? gridThemeDark : gridThemeLight);

  readonly overview = signal<OverviewDto | null>(null);
  readonly overviewLoading = signal(false);

  readonly patientsRows = signal<PatientRow[]>([]);
  readonly patientsLoading = signal(false);
  readonly exporting = signal(false);

  readonly defaultColDef: ColDef = { filter: true, sortable: true, resizable: true, flex: 1, minWidth: 110 };
  readonly patientColDefs: ColDef<PatientRow>[] = [
    { field: 'mrn', headerName: 'MRN', minWidth: 140 },
    { field: 'firstName', headerName: 'First name' },
    { field: 'lastName', headerName: 'Last name' },
    { field: 'age', headerName: 'Age', maxWidth: 90 },
    { field: 'sex', headerName: 'Sex', maxWidth: 90 },
    { field: 'phone', headerName: 'Phone' },
    { field: 'firstOrderAt', headerName: 'First order', valueFormatter: p => p.value ? new Date(p.value).toLocaleString() : '' },
  ];

  readonly kpiCards = computed<KpiCard[]>(() => {
    const o = this.overview();
    if (!o) return [];
    const money = this.canSeeMoney();
    const pct = (n?: number | null) => n == null ? '—' : `${n}%`;
    const cards: KpiCard[] = [
      { id: 'patients', label: 'Patients', value: String(o.patients), deltaPct: o.patientsDeltaPct ?? null, money: false },
      { id: 'tests', label: 'Tests', value: String(o.tests), deltaPct: o.testsDeltaPct ?? null, money: false },
      { id: 'testsPerPatient', label: 'Tests per patient', value: o.testsPerPatient.toFixed(2), deltaPct: o.testsPerPatientDeltaPct ?? null, money: false },
      { id: 'outsourcedPct', label: 'Outsourced %', value: pct(o.outsourcedPct), deltaPct: o.outsourcedPctDeltaPct ?? null, money: false },
      { id: 'medianTat', label: 'Median TAT', value: o.medianTatMinutes != null ? `${Math.round(o.medianTatMinutes)} min` : '—', deltaPct: o.medianTatDeltaPct ?? null, money: false },
    ];
    if (money) {
      cards.splice(2, 0,
        { id: 'billedNet', label: 'Billed (net)', value: this.rupee(o.billedNet), deltaPct: o.billedNetDeltaPct ?? null, money: true },
        { id: 'collected', label: 'Collected', value: this.rupee(o.collected), deltaPct: o.collectedDeltaPct ?? null, money: true },
        { id: 'avgBillValue', label: 'Avg bill value', value: this.rupee(o.avgBillValue), deltaPct: o.avgBillValueDeltaPct ?? null, money: true },
      );
    }
    return cards;
  });

  constructor() {
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({ next: b => this.branches.set(b ?? []) });

    // Any filter change reloads both halves — they share ONE filter band, so
    // a chart's numbers and the operations list behind it never disagree.
    effect(() => {
      const q = this.query();
      this.overviewLoading.set(true);
      this.api.get<OverviewDto>(`/api/analytics/overview${q}`).subscribe({
        next: d => { this.overview.set(d); this.overviewLoading.set(false); },
        error: () => this.overviewLoading.set(false),
      });

      if (this.canExportPatients()) {
        this.patientsLoading.set(true);
        this.api.get<{ total: number; rows: PatientRow[] }>(`/api/analytics/lists/patients${q}`).subscribe({
          next: d => { this.patientsRows.set(d?.rows ?? []); this.patientsLoading.set(false); },
          error: () => this.patientsLoading.set(false),
        });
      }
    });
  }

  private query(): string {
    const p = this.resolvedPeriod();
    const params = new URLSearchParams({ period: this.period(), from: p.fromYmd, to: p.toYmd });
    if (this.branchId()) params.set('branchId', this.branchId());
    return `?${params.toString()}`;
  }

  private rupee(v?: number | null): string {
    return v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  /** Every chart element clicks through to its matching list, pre-filtered
   *  by the SAME filter band (owner spec). Phase 1: the Patients KPI opens
   *  the Patients operations list (the filter band is already shared, so no
   *  extra params are needed); other KPIs fall through to Operations too. */
  openPatientsForKpi(_cardId: string): void {
    this.tab.set('operations');
  }

  exportPatients(): void {
    this.exporting.set(true);
    const p = this.resolvedPeriod();
    const params = new URLSearchParams({ period: this.period(), from: p.fromYmd, to: p.toYmd });
    if (this.branchId()) params.set('branchId', this.branchId());
    this.api.getBlob(`/api/analytics/lists/patients/export.csv?${params.toString()}`).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `insights-patients-${p.fromYmd}-${p.toYmd}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => this.exporting.set(false),
    });
  }
}
