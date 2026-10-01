import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Signal, computed, effect, inject, signal, viewChild } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, ModuleRegistry, colorSchemeDark, colorSchemeLight, themeQuartz } from 'ag-grid-community';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ANALYTICS_PERMS, FINANCIAL_ANALYTICS_PERMS, PATIENT_DATA_EXPORT_PERMS } from '../../core/auth/route-access';
import { ThemeService } from '../../core/services/theme.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../shared/primitives/select.component';
import { SkeletonCardComponent, SkeletonTableComponent, SkeletonTilesComponent } from '../../shared/primitives/skeleton-kit.component';
import { ANALYTICS_PERIOD_OPTIONS, AnalyticsPeriod, AnalyticsPeriodPreset, resolveAnalyticsPeriod } from '../../shared/utils/analytics-period';
import { Branch } from '../../shared/models/tenant.model';
import { ndTrendSkin } from '../frontdesk/patient-profile/lab-trends.component';
import { buildBusinessLineOption, buildHorizontalBarOption, buildStackedBarOption, rupeeFormatter } from '../../shared/utils/business-chart';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  fontFamily: 'inherit', fontSize: 13, rowHeight: 44, headerHeight: 40, borderRadius: 12, accentColor: '#7c3aed',
});
const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: 'inherit', fontSize: 13, rowHeight: 44, headerHeight: 40, borderRadius: 12, accentColor: '#a855f7',
});

type InsightsTab = 'analytics' | 'operations';
type AnalyticsSubTab = 'overview' | 'volume' | 'revenue' | 'tests-depts' | 'referrals' | 'lab-ops';

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

interface VolumeTrendPoint { bucket: string; patients: number; newPatients: number; returningPatients: number; tests: number; testsPerPatient: number; }
interface RevenueTrendPoint { bucket: string; gross: number; discount: number; refund: number; net: number; collected: number; avgBillValue: number; }
interface DeptRevenueRow { departmentName: string; revenue: number; }
interface TopTestRow { testName: string; orders: number; revenue: number; }

// Phase 2
interface TestVolumeByDeptRow { departmentName: string; inHouse: number; outsourced: number; }
interface TopTestVolumeRow { testName: string; count: number; pctOfTotal: number; }
interface ReferralVolumeTrendPoint { bucket: string; orders: number; }
interface TopReferringDoctorRow { doctorName: string; patients: number; orders: number; revenue: number; }
interface SourceTypeRevenueRow { sourceType: string; revenue: number; }
interface TatByDeptRow { departmentName: string; medianMinutes: number; p90Minutes: number; pctWithinTarget: number; count: number; }
interface PendingByStageRow { stage: string; count: number; overdue: number; }
interface RejectionReasonRow { reason: string; count: number; }
interface StaffProductivityRow { userName: string; entered: number; validated: number; }
interface ReportDeliveryRow { status: string; count: number; }
interface CriticalValuesSummary { count: number; medianMinutesToAcknowledge: number | null; medianMinutesToCommunicate: number | null; }

/** A Phase-1 KPI card: value + optional Δ, with a money flag so the template
 *  hides the whole tile (never a blank/garbled number) when the field was
 *  withheld server-side (no view_financial_analytics), and the Operations
 *  list it clicks through to. */
interface KpiCard {
  id: string; label: string; value: string; deltaPct: number | null; money: boolean; opsKey: string;
}

/** One Operations Insights list, driven entirely by this config — the SAME
 *  shape of request (period/branch/.../page) the Analytics half already
 *  uses, so a list's total and its matching chart/KPI never disagree. */
interface OpsColumn { field: string; headerName: string; money?: boolean; date?: boolean; }
interface OpsListConfig {
  key: string; label: string; endpoint: string;
  /** Viewing (not just exporting) this list needs export_patient_data — every column is PII (Patients). */
  requiresExportPatientData?: boolean;
  /** Exporting this list needs export_patient_data (it carries a patient name/phone/DOB column). */
  patientExport?: boolean;
  /** The whole list is money — needs view_financial_analytics to view at all. */
  financialOnly?: boolean;
  columns: OpsColumn[];
}

const OPS_LISTS: OpsListConfig[] = [
  { key: 'patients', label: 'Patients', endpoint: 'patients', requiresExportPatientData: true, columns: [
    { field: 'mrn', headerName: 'MRN' }, { field: 'firstName', headerName: 'First name' }, { field: 'lastName', headerName: 'Last name' },
    { field: 'age', headerName: 'Age' }, { field: 'sex', headerName: 'Sex' }, { field: 'phone', headerName: 'Phone' },
    { field: 'firstOrderAt', headerName: 'First order', date: true },
  ] },
  { key: 'orders', label: 'Orders', endpoint: 'orders', patientExport: true, columns: [
    { field: 'branchName', headerName: 'Branch' }, { field: 'orderNumber', headerName: 'Order #' }, { field: 'patientName', headerName: 'Patient' },
    { field: 'mrn', headerName: 'MRN' }, { field: 'orderValue', headerName: 'Order value', money: true }, { field: 'createdAt', headerName: 'Created', date: true },
  ] },
  { key: 'test-volume', label: 'Test volume', endpoint: 'test-volume', columns: [
    { field: 'branchName', headerName: 'Branch' }, { field: 'testName', headerName: 'Test' },
    { field: 'orders', headerName: 'Orders' }, { field: 'value', headerName: 'Value', money: true },
  ] },
  { key: 'outsourced-tests', label: 'Outsourced tests', endpoint: 'outsourced-tests', columns: [
    { field: 'branchName', headerName: 'Branch' }, { field: 'vendorName', headerName: 'Partner' }, { field: 'testName', headerName: 'Test' },
    { field: 'value', headerName: 'Value', money: true }, { field: 'orderId', headerName: 'Order ID' }, { field: 'createdAt', headerName: 'Created', date: true },
  ] },
  { key: 'referrals', label: 'Referral', endpoint: 'referrals', columns: [
    { field: 'branchName', headerName: 'Branch' }, { field: 'doctorName', headerName: 'Doctor' },
    { field: 'orders', headerName: 'Orders' }, { field: 'orderValue', headerName: 'Order value', money: true },
  ] },
  { key: 'monthly-financial', label: 'Monthly financial', endpoint: 'monthly-financial', financialOnly: true, columns: [
    { field: 'orderId', headerName: 'Order ID' }, { field: 'value', headerName: 'Value', money: true },
    { field: 'paymentMode', headerName: 'Payment mode' }, { field: 'status', headerName: 'Status' }, { field: 'at', headerName: 'Paid at', date: true },
  ] },
  { key: 'outstanding', label: 'Outstanding payments', endpoint: 'outstanding', financialOnly: true, patientExport: true, columns: [
    { field: 'orderId', headerName: 'Order ID' }, { field: 'value', headerName: 'Value', money: true },
    { field: 'patientName', headerName: 'Patient' }, { field: 'at', headerName: 'Date', date: true },
  ] },
  { key: 'discounts', label: 'Discounts', endpoint: 'discounts', financialOnly: true, patientExport: true, columns: [
    { field: 'orderId', headerName: 'Order ID' }, { field: 'patientName', headerName: 'Patient' },
    { field: 'orderValue', headerName: 'Order value', money: true }, { field: 'discount', headerName: 'Discount', money: true },
  ] },
  { key: 'refunds', label: 'Refunds', endpoint: 'refunds', financialOnly: true, patientExport: true, columns: [
    { field: 'orderId', headerName: 'Order ID' }, { field: 'patientName', headerName: 'Patient' },
    { field: 'orderValue', headerName: 'Order value', money: true }, { field: 'refund', headerName: 'Refund', money: true },
    { field: 'refundedAt', headerName: 'Refunded at', date: true },
  ] },
];

const REVENUE_SERIES = ['gross', 'discount', 'refund', 'net', 'collected', 'avgBillValue'] as const;
type RevenueSeriesKey = typeof REVENUE_SERIES[number];
const REVENUE_SERIES_LABEL: Record<RevenueSeriesKey, string> = {
  gross: 'Gross', discount: 'Discount', refund: 'Refund', net: 'Net', collected: 'Collected', avgBillValue: 'Avg bill value',
};

@Component({
  selector: 'pf-insights',
  standalone: true,
  imports: [HeroBandComponent, SegmentedComponent, SelectComponent, SkeletonCardComponent, SkeletonTableComponent, SkeletonTilesComponent, AgGridAngular, DecimalPipe],
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
          <pf-select class="ins-filter" size="sm" [options]="departmentOptions()" [value]="departmentId()"
                     [searchable]="true" (valueChange)="departmentId.set($event)"></pf-select>
          <pf-select class="ins-filter" size="sm" [options]="testOptions()" [value]="testId()"
                     [searchable]="true" (valueChange)="testId.set($event)"></pf-select>
          <pf-select class="ins-filter" size="sm" [options]="referrerOptions()" [value]="refDoctorId()"
                     [searchable]="true" (valueChange)="refDoctorId.set($event)"></pf-select>
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
          <div class="ins-tabs">
            <pf-segmented size="sm" [options]="analyticsSubTabOptions" [value]="analyticsSubTab()" (valueChange)="analyticsSubTab.set($event)"></pf-segmented>
          </div>

          @if (analyticsSubTab() === 'overview') {
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
                      <button type="button" class="ins-kpi" (click)="openList(card.opsKey)">
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
          } @else if (analyticsSubTab() === 'volume') {
            <div class="ins-chart-grid">
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Patient volume</span></div>
                <div class="nd-card__body">
                  @if (volumeLoading() && !volumeTrend().length) { <pf-skeleton-card></pf-skeleton-card> }
                  <div class="ins-chart-host" #patientVolumeHost></div>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('patients')">View list →</button>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">New vs returning</span></div>
                <div class="nd-card__body">
                  <div class="ins-chart-host" #newReturningHost></div>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('patients')">View list →</button>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Tests volume</span></div>
                <div class="nd-card__body">
                  <div class="ins-chart-host" #testsVolumeHost></div>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('test-volume')">View list →</button>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Tests per patient</span></div>
                <div class="nd-card__body">
                  <div class="ins-chart-host" #testsPerPatientHost></div>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('test-volume')">View list →</button>
                </div>
              </div>
            </div>
          } @else if (analyticsSubTab() === 'revenue') {
            @if (!canSeeMoney()) {
            <div class="nd-card"><div class="nd-card__body" style="padding: 24px;">
              <p style="color: var(--text-secondary);">Revenue needs the view_financial_analytics permission.</p>
            </div></div>
            } @else {
            <div class="ins-chart-grid">
              <div class="nd-card" style="grid-column: 1 / -1;">
                <div class="nd-card__head">
                  <span class="nd-card__label">Revenue trend</span>
                  <span class="nd-card__spacer"></span>
                  <div class="ins-toggles">
                    @for (s of revenueSeriesKeys; track s) {
                      <button type="button" class="nd-chip" [attr.aria-pressed]="revenueSeriesOn().has(s)" (click)="toggleRevenueSeries(s)">
                        {{ revenueSeriesLabel[s] }}
                      </button>
                    }
                  </div>
                </div>
                <div class="nd-card__body">
                  @if (revenueLoading() && !revenueTrend().length) { <pf-skeleton-card></pf-skeleton-card> }
                  <div class="ins-chart-host ins-chart-host--tall" #revenueHost></div>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('monthly-financial')">View list →</button>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Revenue by department</span></div>
                <div class="nd-card__body">
                  <div class="ins-chart-host" #deptRevenueHost></div>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('test-volume')">View list →</button>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Top 10 tests by revenue</span></div>
                <div class="nd-card__body">
                  <table class="ins-table">
                    <thead><tr><th>Test</th><th>Orders</th><th>Revenue</th></tr></thead>
                    <tbody>
                      @for (t of topTests(); track t.testName) {
                        <tr><td>{{ t.testName }}</td><td>{{ t.orders }}</td><td>{{ rupee(t.revenue) }}</td></tr>
                      }
                    </tbody>
                  </table>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('test-volume')">View list →</button>
                </div>
              </div>
            </div>
            }
          } @else if (analyticsSubTab() === 'tests-depts') {
            <div class="ins-chart-grid">
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Test volume by department (in-house vs outsourced)</span></div>
                <div class="nd-card__body">
                  <div class="ins-chart-host" #testsByDeptHost></div>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('test-volume')">View list →</button>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Top tests by volume</span></div>
                <div class="nd-card__body">
                  <table class="ins-table">
                    <thead><tr><th>Test</th><th>Count</th><th>% of total</th></tr></thead>
                    <tbody>
                      @for (t of topTestsByVolume(); track t.testName) {
                        <tr><td>{{ t.testName }}</td><td>{{ t.count }}</td><td>{{ t.pctOfTotal }}%</td></tr>
                      }
                    </tbody>
                  </table>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('test-volume')">View list →</button>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Test mix — in-house vs outsourced</span></div>
                <div class="nd-card__body">
                  <table class="ins-table">
                    <thead><tr><th>Department</th><th>In-house</th><th>Outsourced</th></tr></thead>
                    <tbody>
                      @for (d of testVolumeByDept(); track d.departmentName) {
                        <tr><td>{{ d.departmentName }}</td><td>{{ d.inHouse }}</td><td>{{ d.outsourced }}</td></tr>
                      }
                    </tbody>
                  </table>
                  <p class="ins-note">No Routine vs Specialised split — Test Master carries no such classification today.</p>
                </div>
              </div>
            </div>
          } @else if (analyticsSubTab() === 'referrals') {
            <div class="ins-chart-grid">
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Referral volume trend</span></div>
                <div class="nd-card__body">
                  <div class="ins-chart-host" #referralVolumeHost></div>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('referrals')">View list →</button>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Top referring doctors</span></div>
                <div class="nd-card__body">
                  @if (!canSeeMoney()) {
                    <p class="ins-note">Needs view_financial_analytics.</p>
                  } @else {
                    <table class="ins-table">
                      <thead><tr><th>Doctor</th><th>Patients</th><th>Orders</th><th>Revenue</th></tr></thead>
                      <tbody>
                        @for (d of topReferringDoctors(); track d.doctorName) {
                          <tr><td>{{ d.doctorName }}</td><td>{{ d.patients }}</td><td>{{ d.orders }}</td><td>{{ rupee(d.revenue) }}</td></tr>
                        }
                      </tbody>
                    </table>
                  }
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="openList('referrals')">View list →</button>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Revenue by referral source type</span></div>
                <div class="nd-card__body">
                  @if (!canSeeMoney()) {
                    <p class="ins-note">Needs view_financial_analytics.</p>
                  } @else {
                    <div class="ins-chart-host" #sourceTypeHost></div>
                  }
                </div>
              </div>
            </div>
          } @else {
            <!-- Lab Operations (reuses the SAME calculation layer as Overview/TAT board — never a second definition). -->
            <div class="ins-chart-grid">
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">TAT by department</span></div>
                <div class="nd-card__body">
                  <table class="ins-table">
                    <thead><tr><th>Department</th><th>Median (min)</th><th>P90 (min)</th><th>% within target</th><th>N</th></tr></thead>
                    <tbody>
                      @for (r of tatByDept(); track r.departmentName) {
                        <tr><td>{{ r.departmentName }}</td><td>{{ r.medianMinutes | number:'1.0-0' }}</td><td>{{ r.p90Minutes | number:'1.0-0' }}</td><td>{{ r.pctWithinTarget }}%</td><td>{{ r.count }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Pending / overdue, by stage (live)</span></div>
                <div class="nd-card__body">
                  <table class="ins-table">
                    <thead><tr><th>Stage</th><th>Pending</th><th>Overdue</th></tr></thead>
                    <tbody>
                      @for (r of pendingByStage(); track r.stage) {
                        <tr><td>{{ r.stage }}</td><td>{{ r.count }}</td><td>{{ r.overdue }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Sample rejection rate</span></div>
                <div class="nd-card__body">
                  <p class="ins-stat">{{ rejectionRate() }}%</p>
                  <table class="ins-table">
                    <thead><tr><th>Reason</th><th>Count</th></tr></thead>
                    <tbody>
                      @for (r of rejectionReasons(); track r.reason) {
                        <tr><td>{{ r.reason }}</td><td>{{ r.count }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Staff productivity</span></div>
                <div class="nd-card__body">
                  <table class="ins-table">
                    <thead><tr><th>Staff</th><th>Entered</th><th>Validated</th></tr></thead>
                    <tbody>
                      @for (r of staffProductivity(); track r.userName) {
                        <tr><td>{{ r.userName }}</td><td>{{ r.entered }}</td><td>{{ r.validated }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Home collection volume</span></div>
                <div class="nd-card__body"><p class="ins-stat">{{ homeCollectionVolume() }}</p></div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Report delivery (WhatsApp)</span></div>
                <div class="nd-card__body">
                  <table class="ins-table">
                    <thead><tr><th>Status</th><th>Count</th></tr></thead>
                    <tbody>
                      @for (r of reportDelivery(); track r.status) {
                        <tr><td>{{ r.status }}</td><td>{{ r.count }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="nd-card">
                <div class="nd-card__head"><span class="nd-card__label">Critical values</span></div>
                <div class="nd-card__body">
                  @if (criticalValues(); as cv) {
                    <p class="ins-stat">{{ cv.count }}</p>
                    <p class="ins-note">
                      Median time to acknowledge: {{ cv.medianMinutesToAcknowledge != null ? (cv.medianMinutesToAcknowledge | number:'1.0-0') + ' min' : '—' }}
                      · Median time to inform: {{ cv.medianMinutesToCommunicate != null ? (cv.medianMinutesToCommunicate | number:'1.0-0') + ' min' : '—' }}
                    </p>
                  }
                </div>
              </div>
            </div>
          }
        } @else {
          <!-- Operations Insights: 9 lists, one filter band, one calculation layer. -->
          <div class="ins-tabs">
            <pf-segmented size="sm" [options]="opsListOptions" [value]="opsKey()" (valueChange)="opsKey.set($event)"></pf-segmented>
          </div>
          <div class="nd-card">
            <div class="nd-card__head">
              <span class="nd-card__label">{{ activeOpsConfig().label }}</span>
              <span class="nd-card__spacer"></span>
              <span class="nd-card__note">{{ opsTotal() }} rows</span>
              @if (canExportOps()) {
                <button type="button" class="nd-btn nd-btn--secondary" [disabled]="exporting()" (click)="exportOps()">
                  {{ exporting() ? 'Exporting…' : 'Export CSV' }}
                </button>
              }
            </div>
            <div class="nd-card__body">
              @if (!canViewOps()) {
                <p style="padding: 16px; color: var(--text-secondary);">
                  @if (activeOpsConfig().requiresExportPatientData) { This list needs the export_patient_data permission. }
                  @else { This list needs the view_financial_analytics permission. }
                </p>
              } @else if (opsLoading() && opsRows().length === 0) {
                <pf-skeleton-table [rows]="8" [cols]="6"></pf-skeleton-table>
              } @else {
                <ag-grid-angular style="width: 100%; height: 520px;"
                  [theme]="gridTheme()" [rowData]="opsRows()" [columnDefs]="opsColDefs()"
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
    .ins-chart-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 16px;
    }
    .ins-chart-host { width: 100%; height: 260px; }
    .ins-chart-host--tall { height: 320px; }
    .ins-toggles { display: flex; gap: 6px; flex-wrap: wrap; }
    .ins-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .ins-table th { text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-muted); padding: 6px 8px; }
    .ins-table td { padding: 6px 8px; border-top: 1px solid var(--nd-line, var(--border-default)); }
    .ins-note { font-size: 12px; color: var(--text-tertiary); padding: 8px 2px 0; }
    .ins-stat { font-size: 28px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; margin: 4px 0; }
    @media (max-width: 640px) {
      .ins-kpi-grid { grid-template-columns: repeat(2, 1fr); padding: 12px; gap: 8px; }
      .ins-chart-grid { grid-template-columns: 1fr; }
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

  readonly departments = signal<{ id: string; name: string }[]>([]);
  readonly departmentId = signal<string>('');
  readonly departmentOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All departments' },
    ...this.departments().map(d => ({ value: d.id, label: d.name })),
  ]);

  readonly tests = signal<{ id: string; name: string }[]>([]);
  readonly testId = signal<string>('');
  readonly testOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All tests' },
    ...this.tests().map(t => ({ value: t.id, label: t.name })),
  ]);

  readonly referrers = signal<{ id: string; name: string }[]>([]);
  readonly refDoctorId = signal<string>('');
  readonly referrerOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All referrers' },
    ...this.referrers().map(d => ({ value: d.id, label: d.name })),
  ]);

  readonly tabOptions: SegmentedOption<InsightsTab>[] = [
    { value: 'analytics', label: 'Analytics' },
    { value: 'operations', label: 'Operations' },
  ];
  readonly tab = signal<InsightsTab>('analytics');

  readonly analyticsSubTabOptions: SegmentedOption<AnalyticsSubTab>[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'volume', label: 'Patients & Volume' },
    { value: 'revenue', label: 'Revenue' },
    { value: 'tests-depts', label: 'Tests & Departments' },
    { value: 'referrals', label: 'Referrals' },
    { value: 'lab-ops', label: 'Lab Operations' },
  ];
  readonly analyticsSubTab = signal<AnalyticsSubTab>('overview');

  readonly opsListOptions: SegmentedOption<string>[] = OPS_LISTS.map(c => ({ value: c.key, label: c.label }));
  readonly opsKey = signal<string>('patients');
  readonly activeOpsConfig = computed(() => OPS_LISTS.find(c => c.key === this.opsKey())!);
  readonly canViewOps = computed(() => {
    const c = this.activeOpsConfig();
    if (c.requiresExportPatientData) return this.canExportPatients();
    if (c.financialOnly) return this.canSeeMoney();
    return true;
  });
  readonly canExportOps = computed(() => {
    const c = this.activeOpsConfig();
    if (!this.canViewOps()) return false;
    if (c.requiresExportPatientData) return this.canExportPatients();
    if (c.patientExport) return this.canExportPatients();
    return true;
  });
  readonly opsColDefs = computed<ColDef[]>(() => {
    const money = this.canSeeMoney();
    return this.activeOpsConfig().columns
      .filter(c => !c.money || money)
      .map(c => ({
        field: c.field, headerName: c.headerName, flex: 1, minWidth: 110,
        valueFormatter: c.date ? (p: { value: unknown }) => p.value ? new Date(p.value as string).toLocaleString() : ''
          : c.money ? (p: { value: unknown }) => p.value != null ? this.rupee(p.value as number) : '' : undefined,
      }));
  });

  readonly gridTheme = computed(() => this.theme.isDark() ? gridThemeDark : gridThemeLight);
  readonly defaultColDef: ColDef = { filter: true, sortable: true, resizable: true, flex: 1, minWidth: 110 };

  readonly overview = signal<OverviewDto | null>(null);
  readonly overviewLoading = signal(false);

  readonly opsRows = signal<Record<string, unknown>[]>([]);
  readonly opsTotal = signal(0);
  readonly opsLoading = signal(false);
  readonly exporting = signal(false);

  readonly volumeTrend = signal<VolumeTrendPoint[]>([]);
  readonly volumeLoading = signal(false);
  readonly revenueTrend = signal<RevenueTrendPoint[]>([]);
  readonly revenueLoading = signal(false);
  readonly deptRevenue = signal<DeptRevenueRow[]>([]);
  readonly topTests = signal<TopTestRow[]>([]);

  // Phase 2
  readonly testVolumeByDept = signal<TestVolumeByDeptRow[]>([]);
  readonly topTestsByVolume = signal<TopTestVolumeRow[]>([]);
  readonly referralVolumeTrend = signal<ReferralVolumeTrendPoint[]>([]);
  readonly topReferringDoctors = signal<TopReferringDoctorRow[]>([]);
  readonly sourceTypeRevenue = signal<SourceTypeRevenueRow[]>([]);
  readonly tatByDept = signal<TatByDeptRow[]>([]);
  readonly pendingByStage = signal<PendingByStageRow[]>([]);
  readonly rejectionRate = signal(0);
  readonly rejectionReasons = signal<RejectionReasonRow[]>([]);
  readonly staffProductivity = signal<StaffProductivityRow[]>([]);
  readonly homeCollectionVolume = signal(0);
  readonly reportDelivery = signal<ReportDeliveryRow[]>([]);
  readonly criticalValues = signal<CriticalValuesSummary | null>(null);

  readonly revenueSeriesKeys = REVENUE_SERIES;
  readonly revenueSeriesLabel = REVENUE_SERIES_LABEL;
  readonly revenueSeriesOn = signal<Set<RevenueSeriesKey>>(new Set(['net', 'collected']));

  readonly kpiCards = computed<KpiCard[]>(() => {
    const o = this.overview();
    if (!o) return [];
    const money = this.canSeeMoney();
    const pct = (n?: number | null) => n == null ? '—' : `${n}%`;
    const cards: KpiCard[] = [
      { id: 'patients', label: 'Patients', value: String(o.patients), deltaPct: o.patientsDeltaPct ?? null, money: false, opsKey: 'patients' },
      { id: 'tests', label: 'Tests', value: String(o.tests), deltaPct: o.testsDeltaPct ?? null, money: false, opsKey: 'test-volume' },
      { id: 'testsPerPatient', label: 'Tests per patient', value: o.testsPerPatient.toFixed(2), deltaPct: o.testsPerPatientDeltaPct ?? null, money: false, opsKey: 'test-volume' },
      { id: 'outsourcedPct', label: 'Outsourced %', value: pct(o.outsourcedPct), deltaPct: o.outsourcedPctDeltaPct ?? null, money: false, opsKey: 'outsourced-tests' },
      { id: 'medianTat', label: 'Median TAT', value: o.medianTatMinutes != null ? `${Math.round(o.medianTatMinutes)} min` : '—', deltaPct: o.medianTatDeltaPct ?? null, money: false, opsKey: 'test-volume' },
    ];
    if (money) {
      cards.splice(2, 0,
        { id: 'billedNet', label: 'Billed (net)', value: this.rupee(o.billedNet), deltaPct: o.billedNetDeltaPct ?? null, money: true, opsKey: 'orders' },
        { id: 'collected', label: 'Collected', value: this.rupee(o.collected), deltaPct: o.collectedDeltaPct ?? null, money: true, opsKey: 'monthly-financial' },
        { id: 'avgBillValue', label: 'Avg bill value', value: this.rupee(o.avgBillValue), deltaPct: o.avgBillValueDeltaPct ?? null, money: true, opsKey: 'orders' },
      );
    }
    return cards;
  });

  constructor() {
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({ next: b => this.branches.set(b ?? []) });
    this.api.get<{ id: string; name: string }[]>('/api/tenants/departments').subscribe({ next: d => this.departments.set(d ?? []) });
    this.api.get<{ id: string; name: string }[]>('/api/tests?view=summary&activeOnly=true').subscribe({ next: t => this.tests.set((t ?? []).map(x => ({ id: x.id, name: x.name }))) });
    this.api.get<{ id: string; name: string }[]>('/api/referring-network/doctors').subscribe({ next: d => this.referrers.set(d ?? []) });

    // Any filter change reloads every surface — Analytics and Operations
    // share ONE filter band, so a chart's numbers and the list behind it
    // never disagree.
    effect(() => {
      const q = this.query();
      this.overviewLoading.set(true);
      this.api.get<OverviewDto>(`/api/analytics/overview${q}`).subscribe({
        next: d => { this.overview.set(d); this.overviewLoading.set(false); },
        error: () => this.overviewLoading.set(false),
      });
    });

    effect(() => {
      const q = this.query();
      this.volumeLoading.set(true);
      this.api.get<{ bucketUnit: string; points: VolumeTrendPoint[] }>(`/api/analytics/trends/patients-volume${q}`).subscribe({
        next: d => { this.volumeTrend.set(d?.points ?? []); this.volumeLoading.set(false); },
        error: () => this.volumeLoading.set(false),
      });
    });

    effect(() => {
      const q = this.query();
      if (!this.canSeeMoney()) return;
      this.revenueLoading.set(true);
      this.api.get<{ bucketUnit: string; points: RevenueTrendPoint[] }>(`/api/analytics/trends/revenue${q}`).subscribe({
        next: d => { this.revenueTrend.set(d?.points ?? []); this.revenueLoading.set(false); },
        error: () => this.revenueLoading.set(false),
      });
      this.api.get<DeptRevenueRow[]>(`/api/analytics/revenue-by-department${q}`).subscribe({ next: d => this.deptRevenue.set(d ?? []) });
      this.api.get<TopTestRow[]>(`/api/analytics/top-tests${q}`).subscribe({ next: d => this.topTests.set(d ?? []) });
    });

    // Phase 2: Tests & Departments — fetched only while that sub-tab is open.
    effect(() => {
      const q = this.query();
      if (this.tab() !== 'analytics' || this.analyticsSubTab() !== 'tests-depts') return;
      this.api.get<TestVolumeByDeptRow[]>(`/api/analytics/tests-by-department${q}`).subscribe({ next: d => this.testVolumeByDept.set(d ?? []) });
      this.api.get<TopTestVolumeRow[]>(`/api/analytics/top-tests-by-volume${q}`).subscribe({ next: d => this.topTestsByVolume.set(d ?? []) });
    });

    // Phase 2: Referrals — fetched only while that sub-tab is open.
    effect(() => {
      const q = this.query();
      if (this.tab() !== 'analytics' || this.analyticsSubTab() !== 'referrals') return;
      this.api.get<{ bucketUnit: string; points: ReferralVolumeTrendPoint[] }>(`/api/analytics/trends/referrals${q}`)
        .subscribe({ next: d => this.referralVolumeTrend.set(d?.points ?? []) });
      if (this.canSeeMoney()) {
        this.api.get<TopReferringDoctorRow[]>(`/api/analytics/top-referring-doctors${q}`).subscribe({ next: d => this.topReferringDoctors.set(d ?? []) });
        this.api.get<SourceTypeRevenueRow[]>(`/api/analytics/revenue-by-source-type${q}`).subscribe({ next: d => this.sourceTypeRevenue.set(d ?? []) });
      }
    });

    // Phase 2: Lab Operations — fetched only while that sub-tab is open.
    effect(() => {
      const q = this.query();
      if (this.tab() !== 'analytics' || this.analyticsSubTab() !== 'lab-ops') return;
      this.api.get<TatByDeptRow[]>(`/api/analytics/ops/tat-by-department${q}`).subscribe({ next: d => this.tatByDept.set(d ?? []) });
      const branchQ = this.branchId() ? `?branchId=${this.branchId()}` : '';
      this.api.get<PendingByStageRow[]>(`/api/analytics/ops/pending-by-stage${branchQ}`).subscribe({ next: d => this.pendingByStage.set(d ?? []) });
      this.api.get<{ ratePct: number; topReasons: RejectionReasonRow[] }>(`/api/analytics/ops/rejections${q}`)
        .subscribe({ next: d => { this.rejectionRate.set(d?.ratePct ?? 0); this.rejectionReasons.set(d?.topReasons ?? []); } });
      this.api.get<StaffProductivityRow[]>(`/api/analytics/ops/staff-productivity${q}`).subscribe({ next: d => this.staffProductivity.set(d ?? []) });
      this.api.get<{ volume: number }>(`/api/analytics/ops/home-collection-volume${q}`).subscribe({ next: d => this.homeCollectionVolume.set(d?.volume ?? 0) });
      this.api.get<ReportDeliveryRow[]>(`/api/analytics/ops/report-delivery${q}`).subscribe({ next: d => this.reportDelivery.set(d ?? []) });
      this.api.get<CriticalValuesSummary>(`/api/analytics/ops/critical-values${q}`).subscribe({ next: d => this.criticalValues.set(d ?? null) });
    });

    // Paint (and repaint) the charts whenever their tab is on screen, their
    // data changes, or the theme flips — effects track every signal read
    // during their run, including ones made inside the painters below, so
    // this alone covers "data arrived while not on this tab" (it repaints
    // the moment the tab is opened, because the viewChild host signal only
    // resolves once that @if block is mounted).
    effect(() => {
      if (this.tab() === 'analytics' && this.analyticsSubTab() === 'volume') {
        this.theme.isDark();
        void this.paintVolumeCharts();
      }
    });
    effect(() => {
      if (this.tab() === 'analytics' && this.analyticsSubTab() === 'revenue' && this.canSeeMoney()) {
        this.theme.isDark();
        void this.paintRevenueChart();
        void this.paintDeptChart();
      }
    });
    effect(() => {
      if (this.tab() === 'analytics' && this.analyticsSubTab() === 'tests-depts') {
        this.theme.isDark();
        void this.paintTestsByDeptChart();
      }
    });
    effect(() => {
      if (this.tab() === 'analytics' && this.analyticsSubTab() === 'referrals') {
        this.theme.isDark();
        void this.paintReferralVolumeChart();
        if (this.canSeeMoney()) void this.paintSourceTypeChart();
      }
    });

    effect(() => {
      const q = this.query();
      const cfg = this.activeOpsConfig();
      if (!this.canViewOps()) { this.opsRows.set([]); this.opsTotal.set(0); return; }
      this.opsLoading.set(true);
      this.api.get<{ total: number; rows: Record<string, unknown>[] }>(`/api/analytics/lists/${cfg.endpoint}${q}`).subscribe({
        next: d => { this.opsRows.set(d?.rows ?? []); this.opsTotal.set(d?.total ?? 0); this.opsLoading.set(false); },
        error: () => this.opsLoading.set(false),
      });
    });
  }

  private query(): string {
    const p = this.resolvedPeriod();
    const params = new URLSearchParams({ period: this.period(), from: p.fromYmd, to: p.toYmd });
    if (this.branchId()) params.set('branchId', this.branchId());
    if (this.departmentId()) params.set('departmentId', this.departmentId());
    if (this.testId()) params.set('testId', this.testId());
    if (this.refDoctorId()) params.set('refDoctorId', this.refDoctorId());
    return `?${params.toString()}`;
  }

  rupee(v?: number | null): string {
    return v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  /** Every chart/KPI clicks through to its matching Operations list, scoped
   *  by the SAME filter band (owner spec) — never a re-navigation with its
   *  own copied params. */
  openList(opsKey: string): void {
    this.opsKey.set(opsKey);
    this.tab.set('operations');
  }

  toggleRevenueSeries(key: RevenueSeriesKey): void {
    const next = new Set(this.revenueSeriesOn());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.revenueSeriesOn.set(next); // the revenue paint effect re-runs on its own (it reads this signal)
  }

  exportOps(): void {
    this.exporting.set(true);
    const cfg = this.activeOpsConfig();
    const p = this.resolvedPeriod();
    const params = new URLSearchParams({ period: this.period(), from: p.fromYmd, to: p.toYmd });
    if (this.branchId()) params.set('branchId', this.branchId());
    if (this.departmentId()) params.set('departmentId', this.departmentId());
    if (this.testId()) params.set('testId', this.testId());
    if (this.refDoctorId()) params.set('refDoctorId', this.refDoctorId());
    this.api.getBlob(`/api/analytics/lists/${cfg.endpoint}/export.csv?${params.toString()}`).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `insights-${cfg.key}-${p.fromYmd}-${p.toYmd}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => this.exporting.set(false),
    });
  }

  // ── Charts (ECharts, same engine + theme skin as the Trendogram) ─────
  // Signal viewChild refs: each host only exists once its sub-tab is on
  // screen (OnPush + @if); painting a tab that isn't mounted no-ops.
  private readonly patientVolumeHost = viewChild<ElementRef<HTMLElement>>('patientVolumeHost');
  private readonly newReturningHost = viewChild<ElementRef<HTMLElement>>('newReturningHost');
  private readonly testsVolumeHost = viewChild<ElementRef<HTMLElement>>('testsVolumeHost');
  private readonly testsPerPatientHost = viewChild<ElementRef<HTMLElement>>('testsPerPatientHost');
  private readonly revenueHost = viewChild<ElementRef<HTMLElement>>('revenueHost');
  private readonly deptRevenueHost = viewChild<ElementRef<HTMLElement>>('deptRevenueHost');
  private readonly testsByDeptHost = viewChild<ElementRef<HTMLElement>>('testsByDeptHost');
  private readonly referralVolumeHost = viewChild<ElementRef<HTMLElement>>('referralVolumeHost');
  private readonly sourceTypeHost = viewChild<ElementRef<HTMLElement>>('sourceTypeHost');

  private _echarts: typeof import('echarts') | null = null;
  private async ec(): Promise<typeof import('echarts')> {
    this._echarts ??= await import('echarts');
    return this._echarts;
  }

  private readonly charts = new Map<string, ReturnType<typeof import('echarts').init>>();

  private async paintTo(ref: Signal<ElementRef<HTMLElement> | undefined>, key: string, option: unknown) {
    const el = ref()?.nativeElement;
    if (!el) return;
    const ec = await this.ec();
    let chart = this.charts.get(key);
    if (chart && chart.getDom() !== el) { chart.dispose(); chart = undefined; }
    if (!chart) { chart = ec.init(el, undefined, { renderer: 'canvas' }); this.charts.set(key, chart); }
    chart.setOption(ndTrendSkin(option, this.theme.isDark()));
  }

  private async paintVolumeCharts() {
    const ec = await this.ec();
    const dark = this.theme.isDark();
    const points = this.volumeTrend();
    const categories = points.map(p => p.bucket);
    void this.paintTo(this.patientVolumeHost, 'patient-volume', buildBusinessLineOption(ec, {
      categories, series: [{ name: 'Patients', data: points.map(p => p.patients) }], theme: dark ? 'dark' : 'light',
    }));
    void this.paintTo(this.newReturningHost, 'new-returning', buildStackedBarOption(ec, {
      categories, series: [
        { name: 'New', data: points.map(p => p.newPatients) },
        { name: 'Returning', data: points.map(p => p.returningPatients) },
      ], theme: dark ? 'dark' : 'light',
    }));
    void this.paintTo(this.testsVolumeHost, 'tests-volume', buildBusinessLineOption(ec, {
      categories, series: [{ name: 'Tests', data: points.map(p => p.tests) }], theme: dark ? 'dark' : 'light',
    }));
    void this.paintTo(this.testsPerPatientHost, 'tests-per-patient', buildBusinessLineOption(ec, {
      categories, series: [{ name: 'Tests / patient', data: points.map(p => p.testsPerPatient) }], theme: dark ? 'dark' : 'light',
    }));
  }

  private async paintRevenueChart() {
    const ec = await this.ec();
    const dark = this.theme.isDark();
    const points = this.revenueTrend();
    const categories = points.map(p => p.bucket);
    const on = this.revenueSeriesOn();
    const series = this.revenueSeriesKeys.filter(k => on.has(k)).map(k => ({ name: this.revenueSeriesLabel[k], data: points.map(p => p[k]) }));
    void this.paintTo(this.revenueHost, 'revenue', buildBusinessLineOption(ec, { categories, series, theme: dark ? 'dark' : 'light', valueFormatter: rupeeFormatter }));
  }

  private async paintDeptChart() {
    const ec = await this.ec();
    const dark = this.theme.isDark();
    const rows = this.deptRevenue();
    void this.paintTo(this.deptRevenueHost, 'dept-revenue', buildHorizontalBarOption(ec, {
      categories: rows.map(r => r.departmentName), values: rows.map(r => r.revenue), theme: dark ? 'dark' : 'light', valueFormatter: rupeeFormatter,
    }));
  }

  private async paintTestsByDeptChart() {
    const ec = await this.ec();
    const dark = this.theme.isDark();
    const rows = this.testVolumeByDept();
    void this.paintTo(this.testsByDeptHost, 'tests-by-dept', buildStackedBarOption(ec, {
      categories: rows.map(r => r.departmentName),
      series: [
        { name: 'In-house', data: rows.map(r => r.inHouse) },
        { name: 'Outsourced', data: rows.map(r => r.outsourced) },
      ],
      theme: dark ? 'dark' : 'light',
    }));
  }

  private async paintReferralVolumeChart() {
    const ec = await this.ec();
    const dark = this.theme.isDark();
    const points = this.referralVolumeTrend();
    void this.paintTo(this.referralVolumeHost, 'referral-volume', buildBusinessLineOption(ec, {
      categories: points.map(p => p.bucket), series: [{ name: 'Referred orders', data: points.map(p => p.orders) }], theme: dark ? 'dark' : 'light',
    }));
  }

  private async paintSourceTypeChart() {
    const ec = await this.ec();
    const dark = this.theme.isDark();
    const rows = this.sourceTypeRevenue();
    void this.paintTo(this.sourceTypeHost, 'source-type', buildHorizontalBarOption(ec, {
      categories: rows.map(r => r.sourceType), values: rows.map(r => r.revenue), theme: dark ? 'dark' : 'light', valueFormatter: rupeeFormatter,
    }));
  }
}
