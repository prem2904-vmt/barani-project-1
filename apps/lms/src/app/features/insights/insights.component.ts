import { NgTemplateOutlet, formatDate } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Location } from '@angular/common';
import { Observable, Subscription } from 'rxjs';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, ModuleRegistry } from 'ag-grid-community';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ANALYTICS_PERMS, FINANCIAL_ANALYTICS_PERMS, PATIENT_DATA_EXPORT_PERMS } from '../../core/auth/route-access';
import { ThemeService } from '../../core/services/theme.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { NdDateComponent } from '../../shared/components/nd-date/nd-date.component';
import { SelectComponent, PfSelectOption } from '../../shared/primitives/select.component';
import { SkeletonTableComponent } from '../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../shared/directives/busy.directive';
import { ANALYTICS_PERIOD_OPTIONS, AnalyticsPeriodPreset, previousAnalyticsPeriod, resolveAnalyticsPeriod } from '../../shared/utils/analytics-period';
import { LAB_TIME_ZONE, labToday } from '../../shared/utils/lab-clock';
import { plural } from '../../shared/utils/plural';
import { Branch } from '../../shared/models/tenant.model';
import {
  BuildLineOptionArgs, buildBusinessLineOption, buildDonutOption, buildGroupedHBarOption, buildHorizontalBarOption,
  buildSparklineOption, buildStackedBarOption, rupeeAxisFormatter, rupeeFormatter, seriesColor,
} from '../../shared/utils/business-chart';
import { DeltaView, allZero, bucketAxisLabel, bucketRange, deltaView, formatCount, formatMinutes, formatRupee, rangeLabel, shortDay } from '../../shared/utils/insights-view';
import { gridThemeDark, gridThemeLight } from '../admin/tests/tests/grid-theme';
import { ChartPick, InsightsChartComponent } from './insights-chart.component';
import {
  AnalyticsSection, CriticalValuesSummary, DeptRevenueRow, ICONS, InsightsNavId, ListDrill, OPS_LISTS, OpsListConfig, OpsListKey,
  OutsourcedVolumeTrendPoint, OutsourcingCostResult, OutsourcingCostTrendPoint, OverviewDto, PendingByStageRow, ProfitabilityRow,
  REVENUE_SERIES, REVENUE_SERIES_LABEL, RejectionReasonRow, ReportDeliveryRow, RevenueSeriesKey, ReferralVolumeTrendPoint, RevenueTrendPoint,
  SECTIONS, SectionDef, SourceTypeRevenueRow, StaffProductivityRow, TatByDeptRow, TestVolumeByDeptRow, TestsByVendorRow, TopReferringDoctorRow,
  TopTestRow, TopTestVolumeRow, Trend, VolumeTrendPoint,
} from './insights.config';

ModuleRegistry.registerModules([AllCommunityModule]);

/** A KPI tile on Overview. Money tiles are simply absent without
 *  view_financial_analytics (the server omits the fields). */
export interface KpiTile {
  id: string; label: string; value: string; raw: number; money: boolean;
  delta: DeltaView; list: OpsListKey | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spark: any | null;
  /** Shown instead of a sparkline when there's no per-day series (TAT). */
  caption?: string;
}

/** One ranked row in the side card (top tests, departments, doctors…). */
interface RankRow { name: string; value: string; share: number; meta?: string; drill?: () => void; }

const NAV_KEY = 'pf-insights-nav-collapsed';
const COLS_KEY = 'pf-insights-hidden-cols';
const LIST_PAGE = 100;

function readStore<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeStore(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

/**
 * Insights (Analytics / Lab Insights) — ND pattern, three cards under the band:
 *  LEFT  = SECTIONS (a navigation companion: the 8 analytics sections + the
 *          9 Operations lists), collapsible to a strip, a sheet ≤900px;
 *  MAIN  = the section's KPIs and ECharts (or the list's AG-Grid);
 *  RIGHT = DETAILS (what the main card doesn't show: the selected KPI's
 *          comparison and breakdown, ranked lists, the filters a list
 *          applies, the ONE primary — open the list / Export CSV); folded
 *          into the main card below ~1280px.
 * The band pill holds the shared filters (period, branch, department, test,
 * referrer) + a search over what's on screen. Every number comes from the
 * server's AnalyticsService; a chart element drills to its list, narrowed
 * to that bucket / department / test / doctor without moving the band.
 */
@Component({
  selector: 'pf-insights',
  standalone: true,
  imports: [NgTemplateOutlet, AgGridAngular, HeroBandComponent, NdDateComponent, SelectComponent, SkeletonTableComponent, BusyDirective, InsightsChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insights.component.html',
  styleUrl: './insights.component.scss',
})
export class InsightsComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly location = inject(Location, { optional: true });
  protected readonly theme = inject(ThemeService);

  readonly icons = ICONS;
  readonly fmtCount = formatCount;
  readonly fmtRupee = formatRupee;
  readonly fmtMins = formatMinutes;
  readonly plural = plural;
  private readonly sanitizer = inject(DomSanitizer);
  private readonly svgCache = new Map<string, SafeHtml>();
  /** Trusted, constant icon path data (ICONS / SECTIONS only — never user text). */
  svg(paths: string): SafeHtml {
    let v = this.svgCache.get(paths);
    if (!v) { v = this.sanitizer.bypassSecurityTrustHtml(paths); this.svgCache.set(paths, v); }
    return v;
  }

  // ── Permissions (the server decides; the screen mirrors) ─────────────
  readonly canSeeAnalytics = computed(() => this.auth.hasAnyPermission(ANALYTICS_PERMS));
  readonly canSeeMoney = computed(() => this.auth.hasAnyPermission(FINANCIAL_ANALYTICS_PERMS));
  readonly canExportPatients = computed(() => this.auth.hasAnyPermission(PATIENT_DATA_EXPORT_PERMS));

  // ── Layout ───────────────────────────────────────────────────────────
  readonly narrow = signal(this.mq('(max-width: 900px)', v => this.narrow.set(v)));
  readonly phone = signal(this.mq('(max-width: 640px)', v => this.phone.set(v)));
  /** The DETAILS card gets its own column only when there's room for three. */
  readonly ctxSide = signal(this.mq('(min-width: 1280px)', v => this.ctxSide.set(v)));
  readonly navCollapsed = signal<boolean>(readStore(NAV_KEY, false));
  readonly navSheet = signal(false);
  /** Below 1280px the DETAILS card opens as a sheet. */
  readonly ctxSheet = signal(false);
  readonly colsOpen = signal(false);
  private readonly mainBody = viewChild<ElementRef<HTMLElement>>('mainBody');

  // ── Filter band ──────────────────────────────────────────────────────
  readonly q = signal('');
  readonly periodOptions = ANALYTICS_PERIOD_OPTIONS as unknown as PfSelectOption<AnalyticsPeriodPreset>[];
  /** Default "This month" (owner): "Today" opened on an empty morning. */
  readonly period = signal<AnalyticsPeriodPreset>('month');
  readonly today = labToday();
  readonly customFrom = signal<string>(this.today.slice(0, 8) + '01');
  readonly customTo = signal<string>(this.today);
  /** "All time" lower bound — the scope's first order day, from the server. */
  readonly allFrom = signal<string | null>(null);
  readonly isAll = computed(() => this.period() === 'all');
  readonly resolved = computed(() => {
    const p = this.period();
    try {
      if (p === 'custom') return resolveAnalyticsPeriod('custom', this.customFrom(), this.customTo());
      if (p === 'all') return resolveAnalyticsPeriod('all', undefined, undefined, new Date(), this.allFrom());
      return resolveAnalyticsPeriod(p);
    } catch {
      return resolveAnalyticsPeriod('month');
    }
  });
  readonly periodLabel = computed(() => rangeLabel(this.resolved().fromYmd, this.resolved().toYmd));
  readonly prevLabel = computed(() => {
    const r = this.resolved();
    const p = previousAnalyticsPeriod(r.fromYmd, r.toYmd);
    return rangeLabel(p.fromYmd, p.toYmd);
  });
  /** Under a KPI: "vs 1 – 30 Sep 2026", or "Since 9 Mar 2024" for All time. */
  readonly compareText = computed(() => (this.isAll() ? `Since ${shortDay(this.resolved().fromYmd, true)}` : `vs ${this.prevLabel()}`));
  /** "today" · "this month" · "the last 7 days" — for sentences. */
  readonly periodPhrase = computed(() => ({
    today: 'today', '7d': 'the last 7 days', month: 'this month', lastMonth: 'last month', quarter: 'this quarter', all: 'all time', custom: 'this range',
  } as Record<AnalyticsPeriodPreset, string>)[this.period()]);
  readonly periodName = computed(() => this.periodOptions.find(o => o.value === this.period())?.label ?? 'This period');

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<string>('');
  readonly branchOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All branches' }, ...this.branches().map(b => ({ value: b.id, label: b.name })),
  ]);
  readonly departments = signal<{ id: string; name: string }[]>([]);
  readonly departmentId = signal<string>('');
  readonly departmentOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All departments' }, ...this.departments().map(d => ({ value: d.id, label: d.name })),
  ]);
  readonly tests = signal<{ id: string; name: string }[]>([]);
  readonly testId = signal<string>('');
  readonly testOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All tests' }, ...this.tests().map(t => ({ value: t.id, label: t.name })),
  ]);
  readonly referrers = signal<{ id: string; name: string }[]>([]);
  readonly refDoctorId = signal<string>('');
  readonly referrerOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All referrers' }, ...this.referrers().map(d => ({ value: d.id, label: d.name })),
  ]);
  readonly dimCount = computed(() => [this.branchId(), this.departmentId(), this.testId(), this.refDoctorId()].filter(Boolean).length);
  /** Phones: the four dimension filters live in a bottom sheet, applied together. */
  readonly filtersSheet = signal(false);
  readonly draft = signal({ branch: '', department: '', test: '', referrer: '' });
  openFilters(): void {
    this.draft.set({ branch: this.branchId(), department: this.departmentId(), test: this.testId(), referrer: this.refDoctorId() });
    this.filtersSheet.set(true);
  }
  setDraft(k: 'branch' | 'department' | 'test' | 'referrer', v: string | null): void {
    this.draft.update(d => ({ ...d, [k]: v ?? '' }));
  }
  clearDraft(): void { this.draft.set({ branch: '', department: '', test: '', referrer: '' }); }
  applyFilters(): void {
    const d = this.draft();
    this.branchId.set(d.branch); this.departmentId.set(d.department); this.testId.set(d.test); this.refDoctorId.set(d.referrer);
    this.page.set(0);
    this.filtersSheet.set(false);
  }
  readonly dimsActive = computed(() => !!(this.branchId() || this.departmentId() || this.testId() || this.refDoctorId()));

  // ── Navigation ───────────────────────────────────────────────────────
  readonly sections = computed<SectionDef[]>(() => SECTIONS.filter(s => !s.money || this.canSeeMoney()));
  readonly lists = computed<OpsListConfig[]>(() => OPS_LISTS.filter(l =>
    (!l.requiresExportPatientData || this.canExportPatients()) && (!l.financialOnly || this.canSeeMoney())));
  readonly nav = signal<InsightsNavId>('overview');
  readonly listKey = computed<OpsListKey | null>(() => {
    const n = this.nav();
    return n.startsWith('list:') ? (n.slice(5) as OpsListKey) : null;
  });
  readonly section = computed<AnalyticsSection | null>(() => (this.listKey() ? null : (this.nav() as AnalyticsSection)));
  readonly sectionDef = computed(() => SECTIONS.find(s => s.id === this.section()) ?? null);
  readonly listCfg = computed(() => OPS_LISTS.find(l => l.key === this.listKey()) ?? null);
  readonly navLabel = computed(() => this.sectionDef()?.label ?? this.listCfg()?.label ?? '');
  readonly navIcon = computed(() => this.sectionDef()?.icon ?? ICONS.list);
  readonly drill = signal<ListDrill | null>(null);

  // ── Data ─────────────────────────────────────────────────────────────
  readonly loading = signal(false);
  private inflight = 0;
  readonly overview = signal<OverviewDto | null>(null);
  readonly volume = signal<Trend<VolumeTrendPoint> | null>(null);
  readonly revenue = signal<Trend<RevenueTrendPoint> | null>(null);
  readonly deptRevenue = signal<DeptRevenueRow[]>([]);
  readonly topTests = signal<TopTestRow[]>([]);
  readonly testsByDept = signal<TestVolumeByDeptRow[]>([]);
  readonly topTestsByVolume = signal<TopTestVolumeRow[]>([]);
  readonly referralTrend = signal<Trend<ReferralVolumeTrendPoint> | null>(null);
  readonly topDoctors = signal<TopReferringDoctorRow[]>([]);
  readonly sourceTypes = signal<SourceTypeRevenueRow[]>([]);
  readonly tatByDept = signal<TatByDeptRow[]>([]);
  readonly pendingByStage = signal<PendingByStageRow[]>([]);
  readonly rejection = signal<{ ratePct: number; topReasons: RejectionReasonRow[] } | null>(null);
  readonly staff = signal<StaffProductivityRow[]>([]);
  readonly homeCollection = signal<number | null>(null);
  readonly delivery = signal<ReportDeliveryRow[]>([]);
  readonly critical = signal<CriticalValuesSummary | null>(null);
  readonly outsourcedTrend = signal<Trend<OutsourcedVolumeTrendPoint> | null>(null);
  readonly vendors = signal<TestsByVendorRow[]>([]);
  readonly costTrend = signal<Trend<OutsourcingCostTrendPoint> | null>(null);
  readonly revVsCost = signal<OutsourcingCostResult | null>(null);
  readonly profitByTest = signal<ProfitabilityRow[]>([]);
  readonly profitByDept = signal<ProfitabilityRow[]>([]);
  readonly profitView = signal<'test' | 'department'>('test');

  readonly revenueSeriesKeys = REVENUE_SERIES;
  readonly revenueSeriesLabel = REVENUE_SERIES_LABEL;
  readonly revenueOn = signal<ReadonlySet<RevenueSeriesKey>>(new Set<RevenueSeriesKey>(['net', 'collected']));

  // ── Lists ────────────────────────────────────────────────────────────
  readonly rows = signal<Record<string, unknown>[]>([]);
  readonly total = signal(0);
  readonly page = signal(0);
  readonly listLoading = signal(false);
  readonly exporting = signal(false);
  readonly hiddenCols = signal<Record<string, string[]>>(readStore(COLS_KEY, {}));

  // ── Overview KPI selection ───────────────────────────────────────────
  readonly selectedKpi = signal<string>('patients');

  constructor() {
    this.restoreFromUrl();
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({ next: b => this.branches.set(b ?? []), error: () => undefined });
    this.api.get<{ id: string; name: string }[]>('/api/tenants/departments').subscribe({ next: d => this.departments.set(d ?? []), error: () => undefined });
    this.api.get<{ id: string; name: string }[]>('/api/tests?view=summary&activeOnly=true')
      .subscribe({ next: t => this.tests.set((t ?? []).map(x => ({ id: x.id, name: x.name }))), error: () => undefined });
    this.api.get<{ id: string; name: string }[]>('/api/referring-network/doctors').subscribe({ next: d => this.referrers.set(d ?? []), error: () => undefined });

    // "All time": ask the server where the scope's history starts (per branch).
    effect(() => {
      if (!this.isAll() || !this.canSeeAnalytics()) return;
      const b = this.branchId();
      untracked(() => this.api.get<{ fromIst: string }>(`/api/analytics/period?period=all${b ? '&branchId=' + b : ''}`)
        .subscribe({ next: d => this.allFrom.set(d?.fromIst ?? null), error: () => undefined }));
    });

    // Analytics: one load per (section, filter band). Lists load on their own.
    effect(() => {
      const sec = this.section();
      const q = this.query();
      const money = this.canSeeMoney();
      if (!sec || !this.canSeeAnalytics()) return;
      untracked(() => this.loadSection(sec, q, money));
    });
    effect(() => {
      const cfg = this.listCfg();
      const q = cfg ? this.listQuery(cfg) : '';
      const page = this.page();
      if (!cfg || !this.canSeeAnalytics()) return;
      untracked(() => this.loadList(cfg, q, page));
    });
    // Keep the URL shareable (section + period + branch), never a history entry.
    effect(() => {
      const params: Record<string, string> = { section: this.nav(), period: this.period() };
      if (this.period() === 'custom') { params['from'] = this.customFrom(); params['to'] = this.customTo(); }
      if (this.branchId()) params['branch'] = this.branchId();
      untracked(() => this.writeUrl(params));
    });
  }

  // ═══ Query building ═════════════════════════════════════════════════

  private bandParams(): URLSearchParams {
    const p = this.resolved();
    const params = new URLSearchParams({ period: this.period(), from: p.fromYmd, to: p.toYmd });
    if (this.branchId()) params.set('branchId', this.branchId());
    if (this.departmentId()) params.set('departmentId', this.departmentId());
    if (this.testId()) params.set('testId', this.testId());
    if (this.refDoctorId()) params.set('refDoctorId', this.refDoctorId());
    return params;
  }

  /** The analytics query (every chart/KPI of the section shares it). */
  query(): string {
    return `?${this.bandParams().toString()}`;
  }

  /** A list's query: the band + the drill (a bucket's days, one department / test / doctor). */
  listQuery(cfg: OpsListConfig): string {
    const params = this.bandParams();
    const d = this.drill();
    if (d?.fromYmd && d.toYmd) { params.set('period', 'custom'); params.set('from', d.fromYmd); params.set('to', d.toYmd); }
    if (d?.departmentId) params.set('departmentId', d.departmentId);
    if (d?.testId) params.set('testId', d.testId);
    if (d?.refDoctorId) params.set('refDoctorId', d.refDoctorId);
    for (const k of ['departmentId', 'testId', 'refDoctorId'] as const) {
      if (!cfg.takes.includes(k)) params.delete(k);
    }
    return `?${params.toString()}`;
  }

  // ═══ Loading ════════════════════════════════════════════════════════

  private subs: Subscription[] = [];

  private get$<T>(url: string, sink: (v: T) => void): void {
    this.inflight++;
    this.loading.set(true);
    const done = () => { this.inflight = Math.max(0, this.inflight - 1); if (!this.inflight) this.loading.set(false); };
    const s = (this.api.get<T>(url) as Observable<T>).subscribe({
      next: v => { sink(v); done(); },
      error: () => done(),
    });
    this.subs.push(s);
  }

  private loadSection(sec: AnalyticsSection, q: string, money: boolean): void {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
    this.inflight = 0;
    const g = <T>(path: string, sink: (v: T) => void) => this.get$<T>(`/api/analytics/${path}${q}`, sink);
    const trend = <P>(path: string, sink: (v: Trend<P> | null) => void) => g<Trend<P>>(path, v => sink(v ?? null));
    switch (sec) {
      case 'overview':
        g<OverviewDto>('overview', v => this.overview.set(v ?? null));
        trend<VolumeTrendPoint>('trends/patients-volume', v => this.volume.set(v));
        trend<OutsourcedVolumeTrendPoint>('trends/outsourced-volume', v => this.outsourcedTrend.set(v));
        g<TestVolumeByDeptRow[]>('tests-by-department', v => this.testsByDept.set(v ?? []));
        g<TatByDeptRow[]>('ops/tat-by-department', v => this.tatByDept.set(v ?? []));
        g<TopTestVolumeRow[]>('top-tests-by-volume', v => this.topTestsByVolume.set(v ?? []));
        if (money) {
          trend<RevenueTrendPoint>('trends/revenue', v => this.revenue.set(v));
          g<DeptRevenueRow[]>('revenue-by-department', v => this.deptRevenue.set(v ?? []));
          g<TestsByVendorRow[]>('tests-by-vendor', v => this.vendors.set(v ?? []));
        }
        break;
      case 'volume':
        g<OverviewDto>('overview', v => this.overview.set(v ?? null));
        trend<VolumeTrendPoint>('trends/patients-volume', v => this.volume.set(v));
        g<TopTestVolumeRow[]>('top-tests-by-volume', v => this.topTestsByVolume.set(v ?? []));
        break;
      case 'revenue':
        g<OverviewDto>('overview', v => this.overview.set(v ?? null));
        if (money) {
          trend<RevenueTrendPoint>('trends/revenue', v => this.revenue.set(v));
          g<DeptRevenueRow[]>('revenue-by-department', v => this.deptRevenue.set(v ?? []));
          g<TopTestRow[]>('top-tests', v => this.topTests.set(v ?? []));
        }
        break;
      case 'tests-depts':
        g<OverviewDto>('overview', v => this.overview.set(v ?? null));
        g<TestVolumeByDeptRow[]>('tests-by-department', v => this.testsByDept.set(v ?? []));
        g<TopTestVolumeRow[]>('top-tests-by-volume', v => this.topTestsByVolume.set(v ?? []));
        break;
      case 'referrals':
        trend<ReferralVolumeTrendPoint>('trends/referrals', v => this.referralTrend.set(v));
        g<TopReferringDoctorRow[]>('top-referring-doctors', v => this.topDoctors.set(v ?? []));
        if (money) g<SourceTypeRevenueRow[]>('revenue-by-source-type', v => this.sourceTypes.set(v ?? []));
        break;
      case 'lab-ops': {
        g<OverviewDto>('overview', v => this.overview.set(v ?? null));
        g<TatByDeptRow[]>('ops/tat-by-department', v => this.tatByDept.set(v ?? []));
        const branchQ = this.branchId() ? `?branchId=${this.branchId()}` : '';
        this.get$<PendingByStageRow[]>(`/api/analytics/ops/pending-by-stage${branchQ}`, v => this.pendingByStage.set(v ?? []));
        g<{ ratePct: number; topReasons: RejectionReasonRow[] }>('ops/rejections', v => this.rejection.set(v ?? null));
        g<StaffProductivityRow[]>('ops/staff-productivity', v => this.staff.set(v ?? []));
        g<{ volume: number }>('ops/home-collection-volume', v => this.homeCollection.set(v?.volume ?? 0));
        g<ReportDeliveryRow[]>('ops/report-delivery', v => this.delivery.set(v ?? []));
        g<CriticalValuesSummary>('ops/critical-values', v => this.critical.set(v ?? null));
        break;
      }
      case 'outsourcing':
        g<OverviewDto>('overview', v => this.overview.set(v ?? null));
        trend<OutsourcedVolumeTrendPoint>('trends/outsourced-volume', v => this.outsourcedTrend.set(v));
        if (money) {
          g<TestsByVendorRow[]>('tests-by-vendor', v => this.vendors.set(v ?? []));
          trend<OutsourcingCostTrendPoint>('trends/outsourcing-cost', v => this.costTrend.set(v));
          g<OutsourcingCostResult>('outsourced-revenue-vs-cost', v => this.revVsCost.set(v ?? null));
        }
        break;
      case 'profitability':
        if (money) {
          g<ProfitabilityRow[]>('profitability/by-test', v => this.profitByTest.set(v ?? []));
          g<ProfitabilityRow[]>('profitability/by-department', v => this.profitByDept.set(v ?? []));
        }
        break;
    }
  }

  private listSub: Subscription | null = null;
  private loadList(cfg: OpsListConfig, q: string, page: number): void {
    this.listSub?.unsubscribe();
    if (!this.canViewList(cfg)) { this.rows.set([]); this.total.set(0); return; }
    this.listLoading.set(true);
    const sep = q ? '&' : '?';
    this.listSub = this.api.get<{ total: number; rows: Record<string, unknown>[] }>(
      `/api/analytics/lists/${cfg.endpoint}${q}${sep}page=${page}&pageSize=${LIST_PAGE}`,
    ).subscribe({
      next: d => { this.rows.set(d?.rows ?? []); this.total.set(d?.total ?? 0); this.listLoading.set(false); },
      error: () => { this.rows.set([]); this.total.set(0); this.listLoading.set(false); },
    });
  }

  // ═══ Navigation actions ═════════════════════════════════════════════

  go(id: InsightsNavId): void {
    if (id !== this.nav()) {
      this.nav.set(id);
      this.drill.set(null);
      this.page.set(0);
      this.colsOpen.set(false);
      this.q.set('');
    }
    this.navSheet.set(false);
    this.ctxSheet.set(false);
    this.mainBody()?.nativeElement.scrollTo?.({ top: 0 });
  }

  /** A chart element / KPI / ranked row → its list, narrowed (band untouched). */
  openList(key: OpsListKey, drill: ListDrill | null = null): void {
    const cfg = OPS_LISTS.find(l => l.key === key);
    if (!cfg || !this.lists().includes(cfg)) return;
    this.go(`list:${key}`);
    this.drill.set(drill);
  }

  goList(key: OpsListKey): void { this.go(`list:${key}`); }

  clearDrill(): void { this.drill.set(null); this.page.set(0); }

  toggleNav(): void {
    const next = !this.navCollapsed();
    this.navCollapsed.set(next);
    writeStore(NAV_KEY, next);
  }

  setPeriod(p: AnalyticsPeriodPreset): void { this.period.set(p); this.page.set(0); }
  setFilter(which: 'branch' | 'department' | 'test' | 'referrer', v: string | null): void {
    const val = v ?? '';
    if (which === 'branch') this.branchId.set(val);
    if (which === 'department') this.departmentId.set(val);
    if (which === 'test') this.testId.set(val);
    if (which === 'referrer') this.refDoctorId.set(val);
    this.page.set(0);
  }
  clearFilters(): void {
    this.branchId.set(''); this.departmentId.set(''); this.testId.set(''); this.refDoctorId.set('');
    this.page.set(0);
  }
  /** Empty-state shortcut: a wider period. */
  widen(p: AnalyticsPeriodPreset): void { this.setPeriod(p); }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(ev: Event): void {
    if (this.colsOpen()) { this.colsOpen.set(false); ev.preventDefault(); }
    else if (this.filtersSheet()) { this.filtersSheet.set(false); ev.preventDefault(); }
    else if (this.ctxSheet()) { this.ctxSheet.set(false); ev.preventDefault(); }
    else if (this.navSheet()) { this.navSheet.set(false); ev.preventDefault(); }
  }

  // ═══ Overview: KPI tiles ════════════════════════════════════════════

  private dark(): 'dark' | 'light' { return this.theme.isDark() ? 'dark' : 'light'; }

  readonly kpis = computed<KpiTile[]>(() => {
    const o = this.overview();
    if (!o) return [];
    const theme = this.dark();
    const vol = this.volume()?.points ?? [];
    const rev = this.revenue()?.points ?? [];
    const out = this.outsourcedTrend()?.points ?? [];
    const labelsV = vol.map(p => bucketAxisLabel(p.bucket, this.volume()?.bucketUnit));
    const labelsR = rev.map(p => bucketAxisLabel(p.bucket, this.revenue()?.bucketUnit));
    const spark = (data: number[], labels: string[], i: number, fmt?: (v: number) => string) =>
      data.length >= 4 ? buildSparklineOption({ data, labels, theme, color: seriesColor(i, theme), valueFormatter: fmt }) : null;
    const slowest = [...this.tatByDept()].sort((a, b) => b.medianMinutes - a.medianMinutes)[0];
    const tiles: KpiTile[] = [
      { id: 'patients', label: 'Patients', value: formatCount(o.patients), raw: o.patients, money: false, list: 'patients',
        delta: deltaView(o.patients, o.patientsDeltaPct, { noBaseline: this.isAll() }), spark: spark(vol.map(p => p.patients), labelsV, 0) },
      { id: 'tests', label: 'Tests', value: formatCount(o.tests), raw: o.tests, money: false, list: 'test-volume',
        delta: deltaView(o.tests, o.testsDeltaPct, { noBaseline: this.isAll() }), spark: spark(vol.map(p => p.tests), labelsV, 0) },
    ];
    if (this.canSeeMoney() && o.billedNet != null) {
      tiles.push(
        { id: 'billedNet', label: 'Billed (net)', value: formatRupee(o.billedNet), raw: o.billedNet, money: true, list: 'orders',
          delta: deltaView(o.billedNet, o.billedNetDeltaPct, { noBaseline: this.isAll() }), spark: spark(rev.map(p => p.net), labelsR, 0, rupeeFormatter) },
        { id: 'collected', label: 'Collected', value: formatRupee(o.collected), raw: o.collected ?? 0, money: true, list: 'monthly-financial',
          delta: deltaView(o.collected, o.collectedDeltaPct, { noBaseline: this.isAll() }), spark: spark(rev.map(p => p.collected), labelsR, 1, rupeeFormatter) },
        { id: 'avgBillValue', label: 'Avg bill value', value: formatRupee(o.avgBillValue), raw: o.avgBillValue ?? 0, money: true, list: 'orders',
          delta: deltaView(o.avgBillValue, o.avgBillValueDeltaPct, { noBaseline: this.isAll() }), spark: spark(rev.map(p => p.avgBillValue), labelsR, 0, rupeeFormatter) },
      );
    }
    tiles.push(
      { id: 'testsPerPatient', label: 'Tests per patient', value: o.patients ? o.testsPerPatient.toFixed(2) : '—', raw: o.testsPerPatient, money: false, list: 'test-volume',
        delta: deltaView(o.testsPerPatient, o.testsPerPatientDeltaPct, { neutral: true, noBaseline: this.isAll() }), spark: spark(vol.map(p => p.testsPerPatient), labelsV, 0) },
      { id: 'outsourcedPct', label: 'Outsourced', value: o.tests ? `${o.outsourcedPct}%` : '—', raw: o.outsourcedPct, money: false, list: 'outsourced-tests',
        delta: deltaView(o.outsourcedPct, o.outsourcedPctDeltaPct, { neutral: true, noBaseline: this.isAll() }), spark: spark(out.map(p => p.count), out.map(p => bucketAxisLabel(p.bucket, this.outsourcedTrend()?.bucketUnit)), 2) },
      { id: 'medianTat', label: 'Median TAT', value: formatMinutes(o.medianTatMinutes), raw: o.medianTatMinutes ?? 0, money: false, list: null,
        delta: deltaView(o.medianTatMinutes, o.medianTatDeltaPct, { lowerIsBetter: true, noBaseline: this.isAll() }), spark: null,
        caption: slowest ? `Slowest: ${slowest.departmentName} · ${formatMinutes(slowest.medianMinutes)}` : 'Received → validated, in-house work' },
    );
    return tiles;
  });

  readonly selectedTile = computed<KpiTile | null>(() => this.kpis().find(k => k.id === this.selectedKpi()) ?? this.kpis()[0] ?? null);

  /** Nothing at all in the period: one calm banner instead of eight zeros shouting. */
  readonly periodEmpty = computed(() => {
    const o = this.overview();
    return !!o && !o.patients && !o.tests;
  });

  selectKpi(id: string): void {
    this.selectedKpi.set(id);
    if (!this.ctxSide()) this.ctxSheet.set(true);
  }

  /** Side card for the selected KPI: what the period looked like inside. */
  readonly kpiDetail = computed(() => {
    const k = this.selectedTile();
    if (!k) return null;
    const vol = this.volume();
    const rev = this.revenue();
    const unit = (k.money ? rev?.bucketUnit : vol?.bucketUnit) ?? 'day';
    const series: { bucket: string; v: number }[] =
      k.id === 'patients' ? (vol?.points ?? []).map(p => ({ bucket: p.bucket, v: p.patients }))
      : k.id === 'tests' ? (vol?.points ?? []).map(p => ({ bucket: p.bucket, v: p.tests }))
      : k.id === 'billedNet' ? (rev?.points ?? []).map(p => ({ bucket: p.bucket, v: p.net }))
      : k.id === 'collected' ? (rev?.points ?? []).map(p => ({ bucket: p.bucket, v: p.collected }))
      : [];
    const fmt = (v: number) => (k.money ? formatRupee(v) : formatCount(v));
    const peak = series.reduce<{ bucket: string; v: number } | null>((m, p) => (!m || p.v > m.v ? p : m), null);
    const facts: { k: string; v: string }[] = [];
    if (peak && peak.v > 0) facts.push({ k: `Busiest ${unit}`, v: `${fmt(peak.v)} · ${bucketAxisLabel(peak.bucket, unit)}` });
    if (series.length > 1) {
      const active = series.filter(p => p.v > 0).length;
      facts.push({ k: `Active ${unit}s`, v: `${active} of ${series.length}` });
    }
    let rank: RankRow[] = [];
    let rankTitle = '';
    if (k.id === 'tests' || k.id === 'testsPerPatient') {
      rankTitle = 'Most ordered tests';
      rank = this.topTestsByVolume().slice(0, 6).map(t => ({
        name: t.testName, value: formatCount(t.count), share: t.pctOfTotal / 100, meta: `${t.pctOfTotal}%`,
        drill: () => this.openList('test-volume', t.testId ? { label: t.testName, testId: t.testId } : null),
      }));
    } else if (k.id === 'billedNet' || k.id === 'avgBillValue' || k.id === 'collected') {
      rankTitle = 'Revenue by department';
      const max = Math.max(1, ...this.deptRevenue().map(d => d.revenue));
      rank = this.deptRevenue().slice(0, 6).map(d => ({
        name: d.departmentName, value: formatRupee(d.revenue), share: d.revenue / max,
        drill: () => this.openList('test-volume', d.departmentId ? { label: d.departmentName, departmentId: d.departmentId } : null),
      }));
    } else if (k.id === 'outsourcedPct') {
      rankTitle = 'Sent to partners';
      const max = Math.max(1, ...this.vendors().map(v => v.count));
      rank = this.vendors().slice(0, 6).map(v => ({ name: v.vendorName, value: formatCount(v.count), share: v.count / max, drill: () => this.openList('outsourced-tests') }));
    } else if (k.id === 'medianTat') {
      rankTitle = 'Median TAT by department';
      const max = Math.max(1, ...this.tatByDept().map(t => t.medianMinutes));
      rank = [...this.tatByDept()].sort((a, b) => b.medianMinutes - a.medianMinutes).slice(0, 6).map(t => ({
        name: t.departmentName, value: formatMinutes(t.medianMinutes), share: t.medianMinutes / max, meta: `${t.pctWithinTarget}% on time`,
      }));
    } else if (k.id === 'patients') {
      rankTitle = 'Tests by department';
      const max = Math.max(1, ...this.testsByDept().map(d => d.inHouse + d.outsourced));
      rank = this.testsByDept().slice(0, 6).map(d => ({
        name: d.departmentName, value: formatCount(d.inHouse + d.outsourced), share: (d.inHouse + d.outsourced) / max,
        drill: () => this.openList('test-volume', d.departmentId ? { label: d.departmentName, departmentId: d.departmentId } : null),
      }));
    }
    return { tile: k, facts, rank: this.searchRank(rank), rankTitle };
  });

  private searchRank(rows: RankRow[]): RankRow[] {
    const q = this.q().trim().toLowerCase();
    return q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows;
  }

  // ═══ Chart options (rebuilt on data / theme / toggles) ══════════════

  private line(args: Omit<BuildLineOptionArgs, 'theme'>) {
    return buildBusinessLineOption(null, { ...args, theme: this.dark() });
  }

  readonly volumeUnit = computed(() => this.volume()?.bucketUnit ?? 'day');
  readonly volumeLabels = computed(() => (this.volume()?.points ?? []).map(p => bucketAxisLabel(p.bucket, this.volumeUnit())));
  readonly volumeEmpty = computed(() => allZero((this.volume()?.points ?? []).map(p => p.tests + p.patients)));

  readonly ovVolumeChart = computed(() => {
    const pts = this.volume()?.points ?? [];
    return this.line({
      categories: pts.map(p => p.bucket), labels: this.volumeLabels(),
      series: [{ name: 'Tests', data: pts.map(p => p.tests) }, { name: 'Patients', data: pts.map(p => p.patients) }],
    });
  });

  readonly newReturningChart = computed(() => {
    const pts = this.volume()?.points ?? [];
    return buildStackedBarOption(null, {
      categories: pts.map(p => p.bucket), labels: this.volumeLabels(), theme: this.dark(),
      series: [{ name: 'New', data: pts.map(p => p.newPatients) }, { name: 'Returning', data: pts.map(p => p.returningPatients) }],
    });
  });
  readonly testsTrendChart = computed(() => {
    const pts = this.volume()?.points ?? [];
    return this.line({ categories: pts.map(p => p.bucket), labels: this.volumeLabels(), series: [{ name: 'Tests', data: pts.map(p => p.tests) }] });
  });
  readonly tppChart = computed(() => {
    const pts = this.volume()?.points ?? [];
    return this.line({
      categories: pts.map(p => p.bucket), labels: this.volumeLabels(),
      series: [{ name: 'Tests per patient', data: pts.map(p => p.testsPerPatient) }], valueFormatter: (v: number) => (+v).toFixed(2),
    });
  });

  readonly revenueUnit = computed(() => this.revenue()?.bucketUnit ?? 'day');
  readonly revenueEmpty = computed(() => allZero((this.revenue()?.points ?? []).map(p => p.gross + p.collected)));
  readonly ovRevenueChart = computed(() => {
    const pts = this.revenue()?.points ?? [];
    return this.line({
      categories: pts.map(p => p.bucket), labels: pts.map(p => bucketAxisLabel(p.bucket, this.revenueUnit())),
      series: [{ name: 'Billed (net)', data: pts.map(p => p.net) }, { name: 'Collected', data: pts.map(p => p.collected) }],
      valueFormatter: rupeeFormatter, axisFormatter: rupeeAxisFormatter,
    });
  });
  readonly revenueChart = computed(() => {
    const pts = this.revenue()?.points ?? [];
    const on = this.revenueOn();
    const theme = this.dark();
    return this.line({
      categories: pts.map(p => p.bucket), labels: pts.map(p => bucketAxisLabel(p.bucket, this.revenueUnit())),
      series: REVENUE_SERIES.map((k, i) => ({ k, i })).filter(x => on.has(x.k))
        .map(x => ({ name: REVENUE_SERIES_LABEL[x.k], data: pts.map(p => p[x.k]), color: seriesColor(x.i, theme) })),
      valueFormatter: rupeeFormatter, axisFormatter: rupeeAxisFormatter,
    });
  });
  readonly deptRevenueChart = computed(() => {
    const rows = this.deptRevenue().slice(0, 10);
    return buildHorizontalBarOption(null, { categories: rows.map(r => r.departmentName), values: rows.map(r => r.revenue), theme: this.dark(), valueFormatter: rupeeFormatter });
  });
  readonly topTestsChart = computed(() => {
    const rows = this.topTests().slice(0, 10);
    return buildHorizontalBarOption(null, { categories: rows.map(r => r.testName), values: rows.map(r => r.revenue), theme: this.dark(), valueFormatter: rupeeFormatter, color: seriesColor(1, this.dark()) });
  });

  readonly deptMixChart = computed(() => {
    const rows = this.testsByDept();
    const total = rows.reduce((s, r) => s + r.inHouse + r.outsourced, 0);
    return buildDonutOption({
      items: rows.map(r => ({ name: r.departmentName, value: r.inHouse + r.outsourced, key: r.departmentId ?? null })),
      theme: this.dark(), centre: { value: formatCount(total), label: 'tests' },
    });
  });
  readonly testsByDeptChart = computed(() => {
    const rows = this.testsByDept().slice(0, 12);
    return buildGroupedHBarOption({
      categories: rows.map(r => r.departmentName), theme: this.dark(), stacked: true,
      series: [{ name: 'In-house', data: rows.map(r => r.inHouse) }, { name: 'Outsourced', data: rows.map(r => r.outsourced), color: seriesColor(2, this.dark()) }],
    });
  });
  readonly topVolumeChart = computed(() => {
    const rows = this.topTestsByVolume().slice(0, 10);
    return buildHorizontalBarOption(null, { categories: rows.map(r => r.testName), values: rows.map(r => r.count), theme: this.dark() });
  });

  readonly referralUnit = computed(() => this.referralTrend()?.bucketUnit ?? 'day');
  readonly referralEmpty = computed(() => allZero((this.referralTrend()?.points ?? []).map(p => p.orders)));
  readonly referralChart = computed(() => {
    const pts = this.referralTrend()?.points ?? [];
    return this.line({ categories: pts.map(p => p.bucket), labels: pts.map(p => bucketAxisLabel(p.bucket, this.referralUnit())), series: [{ name: 'Referred orders', data: pts.map(p => p.orders) }] });
  });
  readonly doctorsChart = computed(() => {
    const rows = this.topDoctors().slice(0, 10);
    const money = this.canSeeMoney() && rows.some(r => r.revenue != null);
    return buildHorizontalBarOption(null, {
      categories: rows.map(r => r.doctorName), values: rows.map(r => (money ? r.revenue ?? 0 : r.orders)), theme: this.dark(),
      valueFormatter: money ? rupeeFormatter : undefined,
    });
  });
  readonly sourceChart = computed(() => {
    const rows = this.sourceTypes();
    return buildDonutOption({
      items: rows.map(r => ({ name: r.sourceType ? r.sourceType.charAt(0).toUpperCase() + r.sourceType.slice(1) : 'Not set', value: r.revenue })), theme: this.dark(), valueFormatter: rupeeFormatter,
      centre: { value: formatRupee(rows.reduce((s, r) => s + r.revenue, 0), true), label: 'revenue' },
    });
  });

  readonly tatChart = computed(() => {
    const rows = this.tatByDept().slice(0, 10);
    const hours = (m: number) => Math.round((m / 60) * 10) / 10;
    return buildGroupedHBarOption({
      categories: rows.map(r => r.departmentName), theme: this.dark(), valueFormatter: (v: number) => formatMinutes(v * 60),
      series: [{ name: 'Median', data: rows.map(r => hours(r.medianMinutes)) }, { name: '90th percentile', data: rows.map(r => hours(r.p90Minutes)), color: seriesColor(2, this.dark()) }],
    });
  });
  readonly pendingChart = computed(() => {
    const rows = this.pendingByStage();
    return buildStackedBarOption(null, {
      categories: rows.map(r => r.stage), theme: this.dark(),
      series: [
        { name: 'On time', data: rows.map(r => Math.max(0, r.count - r.overdue)), color: seriesColor(0, this.dark()) },
        { name: 'Overdue', data: rows.map(r => r.overdue), color: seriesColor(3, this.dark()) },
      ],
    });
  });
  readonly rejectionChart = computed(() => {
    const rows = this.rejection()?.topReasons ?? [];
    return buildHorizontalBarOption(null, { categories: rows.map(r => r.reason), values: rows.map(r => r.count), theme: this.dark(), color: seriesColor(3, this.dark()) });
  });
  readonly staffChart = computed(() => {
    const rows = this.staff().slice(0, 10);
    return buildGroupedHBarOption({
      categories: rows.map(r => r.userName), theme: this.dark(),
      series: [{ name: 'Entered', data: rows.map(r => r.entered) }, { name: 'Validated', data: rows.map(r => r.validated) }],
    });
  });
  readonly deliveryChart = computed(() => {
    const rows = this.delivery();
    return buildDonutOption({
      items: rows.map(r => ({ name: r.status, value: r.count })), theme: this.dark(),
      centre: { value: formatCount(rows.reduce((s, r) => s + r.count, 0)), label: 'messages' },
    });
  });

  readonly outsourcedUnit = computed(() => this.outsourcedTrend()?.bucketUnit ?? 'day');
  readonly outsourcedEmpty = computed(() => allZero((this.outsourcedTrend()?.points ?? []).map(p => p.count)));
  readonly outsourcedChart = computed(() => {
    const pts = this.outsourcedTrend()?.points ?? [];
    return this.line({ categories: pts.map(p => p.bucket), labels: pts.map(p => bucketAxisLabel(p.bucket, this.outsourcedUnit())), series: [{ name: 'Outsourced tests', data: pts.map(p => p.count), color: seriesColor(2, this.dark()) }] });
  });
  readonly costUnit = computed(() => this.costTrend()?.bucketUnit ?? 'day');
  readonly costEmpty = computed(() => allZero((this.costTrend()?.points ?? []).map(p => p.revenue + p.cost)));
  readonly costChart = computed(() => {
    const pts = this.costTrend()?.points ?? [];
    return this.line({
      categories: pts.map(p => p.bucket), labels: pts.map(p => bucketAxisLabel(p.bucket, this.costUnit())),
      series: [{ name: 'Revenue', data: pts.map(p => p.revenue) }, { name: 'Partner cost', data: pts.map(p => p.cost), color: seriesColor(2, this.dark()) }],
      valueFormatter: rupeeFormatter, axisFormatter: rupeeAxisFormatter,
    });
  });
  readonly vendorChart = computed(() => {
    const rows = this.vendors().slice(0, 10);
    return buildHorizontalBarOption(null, { categories: rows.map(r => r.vendorName), values: rows.map(r => r.count), theme: this.dark(), color: seriesColor(2, this.dark()) });
  });

  readonly profitRows = computed(() => (this.profitView() === 'test' ? this.profitByTest() : this.profitByDept()));
  readonly profitChart = computed(() => {
    const rows = this.profitRows().slice(0, 10);
    return buildGroupedHBarOption({
      categories: rows.map(r => r.name), theme: this.dark(), valueFormatter: rupeeAxisFormatter,
      series: [
        { name: 'Revenue', data: rows.map(r => r.revenue) },
        { name: 'Partner cost', data: rows.map(r => r.cost ?? 0), color: seriesColor(2, this.dark()) },
      ],
    });
  });
  readonly profitTotals = computed(() => {
    const rows = this.profitRows();
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const out = rows.filter(r => r.hasOutsourcedLines);
    return {
      revenue, outRevenue: out.reduce((s, r) => s + r.revenue, 0), cost: out.reduce((s, r) => s + (r.cost ?? 0), 0),
      margin: out.reduce((s, r) => s + (r.margin ?? 0), 0), noPrice: rows.reduce((s, r) => s + r.noPriceCount, 0), outCount: out.length,
    };
  });
  readonly profitCols = computed<ColDef<ProfitabilityRow>[]>(() => [
    { field: 'name', headerName: this.profitView() === 'test' ? 'Test' : 'Department', flex: 1.6, minWidth: 180, wrapText: true, autoHeight: true },
    { field: 'revenue', headerName: 'Revenue', type: 'rightAligned', minWidth: 120, valueFormatter: p => formatRupee(p.value as number), cellClass: 'pf-ins-num' },
    { field: 'cost', headerName: 'Partner cost', type: 'rightAligned', minWidth: 120, cellClass: 'pf-ins-num',
      valueFormatter: p => ((p.data as ProfitabilityRow)?.hasOutsourcedLines ? formatRupee(p.value as number) : '—') },
    { field: 'margin', headerName: 'Margin', type: 'rightAligned', minWidth: 120, cellClass: 'pf-ins-num',
      valueFormatter: p => ((p.data as ProfitabilityRow)?.hasOutsourcedLines ? formatRupee(p.value as number) : '—') },
  ]);

  readonly revenueTotals = computed(() => {
    const pts = this.revenue()?.points ?? [];
    return {
      gross: pts.reduce((s, p) => s + p.gross, 0), discount: pts.reduce((s, p) => s + p.discount, 0),
      refund: pts.reduce((s, p) => s + p.refund, 0),
    };
  });

  toggleRevenueSeries(k: RevenueSeriesKey): void {
    const next = new Set(this.revenueOn());
    if (next.has(k)) { if (next.size > 1) next.delete(k); } else next.add(k);
    this.revenueOn.set(next);
  }

  // ═══ Drill handlers (chart element → list) ══════════════════════════

  private bucketDrill(key: OpsListKey, unit: string, pick: ChartPick, label?: string): void {
    const r = this.resolved();
    const range = bucketRange(pick.name, unit, r.fromYmd, r.toYmd);
    this.openList(key, { label: label ?? rangeLabel(range.fromYmd, range.toYmd), ...range });
  }
  drillVolume(p: ChartPick, key: OpsListKey = 'test-volume'): void { this.bucketDrill(key, this.volumeUnit(), p); }
  drillRevenue(p: ChartPick): void { this.bucketDrill('monthly-financial', this.revenueUnit(), p); }
  drillReferral(p: ChartPick): void { this.bucketDrill('referrals', this.referralUnit(), p); }
  drillOutsourced(p: ChartPick): void { this.bucketDrill('outsourced-tests', this.outsourcedUnit(), p); }
  drillCost(p: ChartPick): void { this.bucketDrill('outsourced-tests', this.costUnit(), p); }
  drillDept(p: ChartPick, rows: { departmentName: string; departmentId?: string | null }[], key: OpsListKey = 'test-volume'): void {
    const row = rows.find(r => r.departmentName === p.name);
    const id = p.key ?? row?.departmentId ?? null;
    this.openList(key, id ? { label: p.name, departmentId: id } : { label: p.name });
  }
  drillTest(p: ChartPick, rows: { testName: string; testId?: string | null }[]): void {
    const id = rows.find(r => r.testName === p.name)?.testId ?? null;
    this.openList('test-volume', id ? { label: p.name, testId: id } : { label: p.name });
  }
  drillDoctor(p: ChartPick): void {
    const id = this.topDoctors().find(r => r.doctorName === p.name)?.doctorId ?? null;
    this.openList('referrals', id ? { label: p.name, refDoctorId: id } : { label: p.name });
  }
  drillProfit(p: ChartPick): void {
    const row = this.profitRows().find(r => r.name === p.name);
    if (this.profitView() === 'test') this.openList('test-volume', row?.id ? { label: p.name, testId: row.id } : { label: p.name });
    else this.openList('test-volume', row?.id ? { label: p.name, departmentId: row.id } : { label: p.name });
  }

  /** A drill whose dimension the server can't narrow by (no id on the row)
   *  still opens the list — the chip says what was clicked, honestly. */
  readonly drillNarrows = computed(() => {
    const d = this.drill();
    return !!d && !!(d.fromYmd || d.departmentId || d.testId || d.refDoctorId);
  });

  // ═══ Lists: grid, columns, export ═══════════════════════════════════

  canViewList(cfg: OpsListConfig | null): boolean {
    if (!cfg) return false;
    if (cfg.requiresExportPatientData) return this.canExportPatients();
    if (cfg.financialOnly) return this.canSeeMoney();
    return true;
  }
  readonly canExport = computed(() => {
    const c = this.listCfg();
    if (!c || !this.canViewList(c)) return false;
    return !(c.requiresExportPatientData || c.patientExport) || this.canExportPatients();
  });

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  readonly defaultColDef: ColDef = { sortable: true, resizable: true, filter: false, flex: 1, minWidth: 96, wrapText: true, autoHeight: true };

  /** Columns the viewer may see (money columns are absent without the permission). */
  readonly availableCols = computed(() => {
    const cfg = this.listCfg();
    if (!cfg) return [];
    const money = this.canSeeMoney();
    return cfg.columns.filter(c => !c.money || money);
  });
  readonly moneyHidden = computed(() => !this.canSeeMoney() && !!this.listCfg()?.columns.some(c => c.money));
  readonly colDefs = computed<ColDef[]>(() => {
    const cfg = this.listCfg();
    if (!cfg) return [];
    if (this.phone()) return [this.phoneRecordCol()];
    const hidden = new Set(this.hiddenCols()[cfg.key] ?? []);
    return this.availableCols().map((c): ColDef => ({
      field: c.field, headerName: c.headerName, hide: hidden.has(c.field),
      // Names take the spare width and wrap (never cut); codes, dates and
      // amounts are sized to their content (autoSizeStrategy) on one line.
      ...((c.flex ?? 1) > 1
        ? { flex: c.flex, minWidth: Math.round((c.minWidth ?? 110) * 0.8), wrapText: true, autoHeight: true }
        : { flex: undefined, minWidth: 72, wrapText: false, autoHeight: false }),
      type: c.money || c.num ? 'rightAligned' : undefined,
      cellClass: c.money || c.num || c.date || c.ref ? 'pf-ins-num' : undefined,
      tooltipValueGetter: c.ref ? (p) => String(p.value ?? '') : undefined,
      valueFormatter: c.date
        ? (p: { value: unknown }) => (p.value ? formatDate(p.value as string, 'd MMM y, h:mm a', 'en-IN', LAB_TIME_ZONE) : '')
        : c.money ? (p: { value: unknown }) => (p.value != null ? formatRupee(p.value as number) : '')
        : c.ref ? (p: { value: unknown }) => (p.value ? String(p.value).slice(0, 8).toUpperCase() : '')
        : c.num ? (p: { value: unknown }) => (p.value != null ? formatCount(p.value as number) : '')
        : (p: { value: unknown }) => (p.value == null || p.value === '' ? '—' : String(p.value)),
    }));
  });
  private fmtCell(c: { money?: boolean; date?: boolean; num?: boolean; ref?: boolean }, v: unknown): string {
    if (v == null || v === '') return '';
    if (c.date) return formatDate(v as string, 'd MMM, h:mm a', 'en-IN', LAB_TIME_ZONE);
    if (c.money) return formatRupee(v as number);
    if (c.ref) return String(v).slice(0, 8).toUpperCase();
    if (c.num) return formatCount(v as number);
    return String(v);
  }

  /** Phones: one record cell — the first text column as the title, the
   *  first money (or count) column as the value, every other column on a
   *  muted meta line. Nothing cut, no sideways scroll. */
  private phoneRecordCol(): ColDef {
    const cols = this.availableCols();
    const texts = cols.filter(c => !c.money && !c.date && !c.num && !c.ref);
    const value = cols.find(c => c.money) ?? cols.find(c => c.num);
    const esc = (t: string) => t.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
    return {
      colId: 'record', headerName: this.listCfg()?.label ?? '', flex: 1, minWidth: 200, sortable: false,
      valueGetter: p => (p.data ? cols.map(c => this.fmtCell(c, (p.data as Record<string, unknown>)[c.field])).join(' ') : ''),
      cellRenderer: (p: { data?: Record<string, unknown> }) => {
        const d = p.data;
        if (!d) return '';
        // Title = the first text column this row actually has (an order
        // without a number leads with its patient, never a blank line).
        const title = texts.find(c => d[c.field] != null && d[c.field] !== '') ?? cols[0];
        const meta = cols.filter(c => c !== title && c !== value).map(c => this.fmtCell(c, d[c.field])).filter(Boolean).join(' · ');
        return `<div class="pf-ins-rec"><span class="pf-ins-rec__t"><span>${esc(this.fmtCell(title, d[title.field]))}</span>` +
          (value ? `<span class="pf-ins-rec__v">${esc(this.fmtCell(value, d[value.field]))}</span>` : '') +
          `</span>${meta ? `<span class="pf-ins-rec__m">${esc(meta)}</span>` : ''}</div>`;
      },
    };
  }

  /** Fixed-content columns fit their content; the name column flexes. */
  readonly autoSize = computed(() => ({
    type: 'fitCellContents' as const,
    colIds: this.availableCols().filter(c => (c.flex ?? 1) <= 1).map(c => c.field),
  }));

  readonly visibleColCount = computed(() => this.colDefs().filter(c => !c.hide).length);

  isColHidden(field: string): boolean {
    const k = this.listKey();
    return !!k && (this.hiddenCols()[k] ?? []).includes(field);
  }
  toggleCol(field: string): void {
    const k = this.listKey();
    if (!k) return;
    const cur = new Set(this.hiddenCols()[k] ?? []);
    if (cur.has(field)) cur.delete(field);
    else if (this.visibleColCount() > 1) cur.add(field);
    const next = { ...this.hiddenCols(), [k]: [...cur] };
    this.hiddenCols.set(next);
    writeStore(COLS_KEY, next);
  }
  resetCols(): void {
    const k = this.listKey();
    if (!k) return;
    const next = { ...this.hiddenCols() };
    delete next[k];
    this.hiddenCols.set(next);
    writeStore(COLS_KEY, next);
  }

  readonly pageFrom = computed(() => (this.total() ? this.page() * LIST_PAGE + 1 : 0));
  readonly pageTo = computed(() => Math.min(this.total(), (this.page() + 1) * LIST_PAGE));
  readonly lastPage = computed(() => Math.max(0, Math.ceil(this.total() / LIST_PAGE) - 1));
  readonly rowsLabel = computed(() => `${formatCount(this.total())} ${this.total() === 1 ? 'row' : 'rows'}`);
  prevPage(): void { if (this.page() > 0) this.page.update(p => p - 1); }
  nextPage(): void { if (this.page() < this.lastPage()) this.page.update(p => p + 1); }

  /** Filters the server applies to this list, as words (side card). */
  readonly listFilters = computed(() => {
    const cfg = this.listCfg();
    if (!cfg) return [];
    const d = this.drill();
    const out: { k: string; v: string }[] = [];
    out.push({ k: 'Period', v: d?.fromYmd && d.toYmd ? rangeLabel(d.fromYmd, d.toYmd) : this.periodLabel() });
    out.push({ k: 'Branch', v: this.branches().find(b => b.id === this.branchId())?.name ?? 'All branches' });
    const dept = d?.departmentId ?? (cfg.takes.includes('departmentId') ? this.departmentId() : '');
    if (dept) out.push({ k: 'Department', v: this.departments().find(x => x.id === dept)?.name ?? d?.label ?? '—' });
    const test = d?.testId ?? (cfg.takes.includes('testId') ? this.testId() : '');
    if (test) out.push({ k: 'Test', v: this.tests().find(x => x.id === test)?.name ?? d?.label ?? '—' });
    const doc = d?.refDoctorId ?? (cfg.takes.includes('refDoctorId') ? this.refDoctorId() : '');
    if (doc) out.push({ k: 'Referrer', v: this.referrers().find(x => x.id === doc)?.name ?? d?.label ?? '—' });
    return out;
  });
  /** Band dimensions this list's endpoint can't narrow by. */
  readonly ignoredFilters = computed(() => {
    const cfg = this.listCfg();
    if (!cfg) return [];
    const out: string[] = [];
    if (this.departmentId() && !cfg.takes.includes('departmentId')) out.push('department');
    if (this.testId() && !cfg.takes.includes('testId')) out.push('test');
    if (this.refDoctorId() && !cfg.takes.includes('refDoctorId')) out.push('referrer');
    return out;
  });

  exportList(): void {
    const cfg = this.listCfg();
    if (!cfg || this.exporting()) return;
    this.exporting.set(true);
    const q = this.listQuery(cfg);
    const r = this.resolved();
    this.api.getBlob(`/api/analytics/lists/${cfg.endpoint}/export.csv${q}`).subscribe({
      next: blob => {
        try {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `insights-${cfg.key}-${r.fromYmd}-${r.toYmd}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        } catch { /* no DOM download (tests) */ }
        this.exporting.set(false);
      },
      error: () => this.exporting.set(false),
    });
  }

  // ═══ Section side-card summaries ════════════════════════════════════

  readonly sectionRank = computed<{ title: string; rows: RankRow[]; list: OpsListKey | null } | null>(() => {
    const sec = this.section();
    let title = '', rows: RankRow[] = [], list: OpsListKey | null = null;
    if (sec === 'volume') {
      title = 'Most ordered tests'; list = 'test-volume';
      rows = this.topTestsByVolume().slice(0, 8).map(t => ({
        name: t.testName, value: formatCount(t.count), share: t.pctOfTotal / 100, meta: `${t.pctOfTotal}% of tests`,
        drill: () => this.openList('test-volume', t.testId ? { label: t.testName, testId: t.testId } : null),
      }));
    } else if (sec === 'tests-depts') {
      // The main card ranks volume; the side card shows how much of each
      // department's work leaves the lab (counts from the same server rows).
      title = 'Sent out, by department'; list = 'outsourced-tests';
      rows = this.testsByDept().filter(d => d.outsourced > 0)
        .map(d => ({ d, total: d.inHouse + d.outsourced }))
        .sort((a, b) => b.d.outsourced / b.total - a.d.outsourced / a.total).slice(0, 8)
        .map(({ d, total }) => ({
          name: d.departmentName, value: `${formatCount(d.outsourced)} of ${formatCount(total)}`, share: d.outsourced / total,
          drill: () => this.openList('outsourced-tests', d.departmentId ? { label: d.departmentName, departmentId: d.departmentId } : null),
        }));
    } else if (sec === 'revenue') {
      return null;
    } else if (sec === 'referrals') {
      title = 'Doctor details'; list = 'referrals';
      const max = Math.max(1, ...this.topDoctors().map(d => d.patients));
      rows = this.topDoctors().slice(0, 8).map(d => ({
        name: d.doctorName, value: plural(d.patients, 'patient'), share: d.patients / max,
        meta: `${plural(d.orders, 'order')}${this.canSeeMoney() && d.revenue != null ? ' · ' + formatRupee(d.revenue) : ''}`,
        drill: () => this.openList('referrals', d.doctorId ? { label: d.doctorName, refDoctorId: d.doctorId } : null),
      }));
    } else if (sec === 'outsourcing') {
      title = this.canSeeMoney() ? 'Partner revenue' : 'Tests by partner'; list = 'outsourced-tests';
      const money = this.canSeeMoney();
      const max = Math.max(1, ...this.vendors().map(v => (money ? v.revenue : v.count)));
      rows = this.vendors().slice(0, 8).map(v => ({
        name: v.vendorName, value: money ? formatRupee(v.revenue) : formatCount(v.count), share: (money ? v.revenue : v.count) / max,
        meta: plural(v.count, 'test'), drill: () => this.openList('outsourced-tests'),
      }));
    } else if (sec === 'lab-ops') {
      title = 'Within TAT target'; list = null;
      rows = [...this.tatByDept()].sort((a, b) => a.pctWithinTarget - b.pctWithinTarget).slice(0, 8).map(t => ({
        name: t.departmentName, value: `${t.pctWithinTarget}%`, share: t.pctWithinTarget / 100,
        meta: `${plural(t.count, 'test')} · median ${formatMinutes(t.medianMinutes)}`,
      }));
    } else if (sec === 'profitability') {
      title = this.profitView() === 'test' ? 'Best margins' : 'Department margins'; list = 'test-volume';
      const withMargin = this.profitRows().filter(r => r.hasOutsourcedLines && r.margin != null).sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));
      const max = Math.max(1, ...withMargin.map(r => Math.abs(r.margin ?? 0)));
      rows = withMargin.slice(0, 8).map(r => ({ name: r.name, value: formatRupee(r.margin), share: Math.abs(r.margin ?? 0) / max, meta: `on ${formatRupee(r.revenue)}` }));
    } else {
      return null;
    }
    return { title, rows: this.searchRank(rows), list };
  });

  /** The side card's primary action for a section (the ONE primary). */
  readonly sectionCta = computed<{ label: string; list: OpsListKey } | null>(() => {
    switch (this.section()) {
      case 'overview': {
        const t = this.selectedTile();
        if (!t?.list) return null;
        const cfg = OPS_LISTS.find(l => l.key === t.list);
        return cfg && this.lists().includes(cfg) ? { label: `Open ${cfg.label.toLowerCase()}`, list: t.list } : null;
      }
      case 'volume': return this.lists().some(l => l.key === 'patients') ? { label: 'Open patients', list: 'patients' } : { label: 'Open test volume', list: 'test-volume' };
      case 'revenue': return { label: 'Open payments', list: 'monthly-financial' };
      case 'tests-depts': return { label: 'Open test volume', list: 'test-volume' };
      case 'referrals': return { label: 'Open referrals', list: 'referrals' };
      case 'outsourcing': return { label: 'Open outsourced tests', list: 'outsourced-tests' };
      case 'profitability': return { label: 'Open test volume', list: 'test-volume' };
      default: return null;
    }
  });

  // ═══ URL ════════════════════════════════════════════════════════════

  private restoreFromUrl(): void {
    const qp = this.route?.snapshot?.queryParamMap;
    if (!qp) return;
    const sec = qp.get('section');
    if (sec && (SECTIONS.some(s => s.id === sec) || OPS_LISTS.some(l => `list:${l.key}` === sec))) this.nav.set(sec as InsightsNavId);
    const p = qp.get('period') as AnalyticsPeriodPreset | null;
    if (p && ANALYTICS_PERIOD_OPTIONS.some(o => o.value === p)) this.period.set(p);
    const from = qp.get('from'), to = qp.get('to');
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) this.customFrom.set(from);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) this.customTo.set(to);
    const b = qp.get('branch');
    if (b) this.branchId.set(b);
  }

  private writeUrl(params: Record<string, string>): void {
    if (!this.router || !this.location) return;
    try {
      const tree = this.router.createUrlTree([], { relativeTo: this.route ?? undefined, queryParams: params });
      this.location.replaceState(this.router.serializeUrl(tree));
    } catch { /* no router in a bare spec */ }
  }

  private mq(query: string, set: (v: boolean) => void): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    const m = window.matchMedia(query);
    const on = (ev: MediaQueryListEvent) => set(ev.matches);
    try { m.addEventListener('change', on); this.destroyRef.onDestroy(() => m.removeEventListener('change', on)); } catch { /* old Safari */ }
    return !!m.matches;
  }
}
