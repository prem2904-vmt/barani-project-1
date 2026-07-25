import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed,
  effect, inject, input, signal, viewChild, viewChildren,
} from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import {
  TrendPoint, TrendParam, TrendTest, buildTrendOption, buildSparklineOption, filterTrendPoints,
} from '../../../shared/utils/trend-chart';

type RangeKey = '5' | '10' | '3m' | '6m' | 'all';

/**
 * Lab Trends (Trendogram) — value-over-time charts for a patient's REPEATED
 * tests. Two panels: repeated tests on the left; on the right, either
 *  - the "overall" view: a matrix of mini sparklines, one per parameter of a
 *    panel (CBC → Hb, WBC, PLT…), each with its latest value + abnormal flag; or
 *  - the "nested" view: the full detailed chart for one drilled-into parameter.
 * Single-value tests skip straight to the detailed chart. ECharts is
 * dynamically imported so it only downloads when this view is opened.
 */
@Component({
  selector: 'pf-lab-trends',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-lt">
      @if (loading()) {
        <p class="pf-lt__msg">Loading trends…</p>
      } @else if (tests().length === 0) {
        <div class="pf-lt__empty">
          <p class="pf-lt__empty-title">No repeat tests yet</p>
          <p class="pf-lt__empty-sub">Trends appear once this patient has taken the same test at least twice.</p>
        </div>
      } @else {
        <div class="pf-lt__grid">
          <!-- Left: search + repeated tests -->
          <aside class="pf-lt__side">
            <div class="pf-lt__search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input type="text" placeholder="Search tests…" [value]="testQuery()"
                     (input)="testQuery.set($any($event.target).value)" />
            </div>
            <div class="pf-lt__list" role="tablist">
              @for (t of filteredTests(); track t.testId) {
                <button type="button" class="pf-lt__test"
                        [class.pf-lt__test--on]="selectedTestId() === t.testId"
                        (click)="selectTest(t.testId)">
                  <span class="pf-lt__test-name">
                    {{ t.testName }}
                    @if (t.parameters.length > 1) { <span class="pf-lt__pill">{{ t.parameters.length }} values</span> }
                  </span>
                  <span class="pf-lt__test-count">×{{ t.count }}</span>
                </button>
              } @empty {
                <p class="pf-lt__noresult">No tests match “{{ testQuery() }}”.</p>
              }
            </div>
          </aside>

          <!-- Right: controls + chart(s) -->
          <section class="pf-lt__panel">
            @if (selectedTest(); as st) {
              <!-- Phone, drilled-in: a category breadcrumb up top (also taps back
                   to the panel overview) so you always know which panel this
                   value belongs to. -->
              @if (viewMode() === 'param' && st.parameters.length > 1) {
                <button type="button" class="pf-lt__crumb" (click)="backToOverview()" title="Back to all values">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                  {{ st.testName }}
                </button>
              }
              <!-- Header: (phone) panel picker + funnel on one row, or on drill-in
                   the param picker + funnel + line/bar; desktop keeps the title/
                   sidebar-driven layout. -->
              <div class="pf-lt__controls">
                <!-- Phone panel picker (overall only; the funnel sits to its right).
                     Hidden while drilled in — the breadcrumb returns to overview. -->
                <pf-select class="pf-lt__mobile-pick"
                           [class.pf-lt__mobile-pick--hide]="viewMode() === 'param'"
                           placeholder="Select test"
                           [options]="testOptions()" [value]="selectedTestId() ?? ''"
                           (valueChange)="selectTest($any($event))"></pf-select>
                @if (viewMode() === 'param' && st.parameters.length > 1) {
                  <button type="button" class="pf-lt__back" (click)="backToOverview()" aria-label="All values" title="All values">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                    <span class="pf-lt__back-lbl">All values</span>
                  </button>
                }
                @if (viewMode() === 'overall') {
                  <span class="pf-lt__title">{{ st.testName }} <span class="pf-lt__title-sub">— all values</span></span>
                } @else {
                  <pf-select class="pf-lt__dd pf-lt__dd--param" size="sm"
                             [options]="paramOptions()" [value]="selectedParam()"
                             (valueChange)="selectedParam.set($any($event))"></pf-select>
                }
                <pf-select class="pf-lt__dd pf-lt__dd--range" size="sm"
                           [options]="RANGE_OPTIONS" [value]="range()"
                           (valueChange)="range.set($any($event))"></pf-select>
                @if (viewMode() === 'param') {
                  <div class="pf-lt__toggle">
                    <button type="button" [class.pf-lt__toggle--on]="chartType() === 'line'" (click)="chartType.set('line')">Line</button>
                    <button type="button" [class.pf-lt__toggle--on]="chartType() === 'bar'" (click)="chartType.set('bar')">Bar</button>
                  </div>
                }
              </div>

              @if (viewMode() === 'overall') {
                <!-- Overall matrix of sparklines (one per parameter) -->
                <div class="pf-lt__matrix">
                  @for (p of overviewParams(); track p.parameter) {
                    <button type="button" class="pf-lt__cell" (click)="drillTo(p.parameter)">
                      <div class="pf-lt__cell-head">
                        <span class="pf-lt__cell-name">{{ p.parameter }}</span>
                        @if (delta(p); as d) {
                          <span class="pf-lt__cell-delta" [class.up]="d.dir === 'up'" [class.down]="d.dir === 'down'">{{ d.text }}</span>
                        }
                      </div>
                      <div class="pf-lt__cell-val" [class.abn]="isAbnormal(p)">
                        {{ latest(p) }}<span class="pf-lt__cell-unit">{{ p.unit || '' }}</span>
                      </div>
                      <div class="pf-lt__spark" #spark></div>
                      <div class="pf-lt__cell-foot">
                        <span>×{{ pointCount(p) }}</span>
                        @if (p.referenceRange) { <span class="pf-lt__cell-ref">{{ p.referenceRange }}</span> }
                      </div>
                    </button>
                  }
                </div>
              } @else if (activeParam(); as ap) {
                <div class="pf-lt__meta">
                  <span>{{ filteredPoints().length }} results</span>
                  @if (ap.referenceRange) { <span>Reference: {{ ap.referenceRange }}{{ ap.unit ? ' ' + ap.unit : '' }}</span> }
                </div>
                <div class="pf-lt__chart" #chart></div>
              }
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: [`
    /* Fill the host so the whole thing fits the viewport with no page scroll. */
    :host { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; }
    .pf-lt { width: 100%; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-lt__msg, .pf-lt__empty { padding: 32px; text-align: center; color: var(--text-tertiary); }
    .pf-lt__empty-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); }
    .pf-lt__empty-sub { font-size: 12.5px; color: var(--text-tertiary); margin-top: 4px; }
    .pf-lt__grid { display: grid; grid-template-columns: 240px 1fr; gap: 16px; flex: 1 1 auto; min-height: 0; }
    @media (max-width: 700px) { .pf-lt__grid { grid-template-columns: 1fr; } }
    .pf-lt__side { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
    .pf-lt__search {
      display: flex; align-items: center; gap: 7px; padding: 7px 10px;
      border-radius: 9px; background: var(--input-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--glass-border); color: var(--text-tertiary);
    }
    .pf-lt__search input {
      flex: 1; min-width: 0; background: none; border: 0; outline: none;
      color: var(--text-primary); font-size: 12.5px;
    }
    .pf-lt__list { display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; overflow-y: auto; }
    .pf-lt__test {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
      padding: 10px 12px; border-radius: 10px; text-align: left; cursor: pointer;
      background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary);
    }
    .pf-lt__test--on { border-color: rgba(168,85,247,0.5); background: rgba(124,58,237,0.12); color: var(--text-primary); }
    /* Names wrap onto multiple lines instead of truncating. */
    .pf-lt__test-name { font-size: 13px; font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; }
    .pf-lt__pill {
      display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px;
      font-size: 10px; font-weight: 600; vertical-align: middle;
      background: rgba(168,85,247,0.16); color: var(--violet-text); border: 1px solid rgba(168,85,247,0.3);
    }
    .pf-lt__test-count { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; margin-top: 1px; }
    .pf-lt__noresult { font-size: 12px; color: var(--text-tertiary); padding: 10px 4px; }
    .pf-lt__panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .pf-lt__controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
    .pf-lt__title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
    .pf-lt__title-sub { font-weight: 500; color: var(--text-tertiary); }
    .pf-lt__back {
      display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 8px;
      font-size: 12px; font-weight: 600; cursor: pointer;
      background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary);
    }
    .pf-lt__back:hover { color: var(--text-primary); border-color: rgba(168,85,247,0.4); }
    .pf-lt__toggle { display: inline-flex; border: 1px solid var(--glass-border); border-radius: 8px; overflow: hidden; margin-left: auto; }
    .pf-lt__toggle button { padding: 7px 14px; font-size: 12px; font-weight: 600; background: none; border: 0; color: var(--text-secondary); cursor: pointer; }
    .pf-lt__toggle--on { background: linear-gradient(135deg, #7c3aed, #a855f7); color: #fff; }
    .pf-lt__meta { display: flex; gap: 16px; font-size: 11.5px; color: var(--text-tertiary); margin-bottom: 6px; flex-shrink: 0; }
    /* Chart flex-fills the remaining panel height — no fixed height, no page scroll. */
    .pf-lt__chart { width: 100%; flex: 1 1 auto; min-height: 220px; }

    /* Overall matrix of sparkline cards — fills the panel; scrolls internally
       (never the page) if a wide panel has more rows than fit. */
    .pf-lt__matrix {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
      gap: 10px; align-content: start; flex: 1 1 auto; min-height: 0; overflow-y: auto;
      padding-right: 2px;
    }
    .pf-lt__cell {
      display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer;
      padding: 10px 11px 8px; border-radius: 11px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      transition: border-color .15s, transform .1s;
    }
    .pf-lt__cell:hover { border-color: rgba(168,85,247,0.5); transform: translateY(-1px); }
    .pf-lt__cell-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
    .pf-lt__cell-name { font-size: 11.5px; font-weight: 600; color: var(--text-secondary); overflow-wrap: anywhere; line-height: 1.2; }
    .pf-lt__cell-delta { font-size: 10.5px; font-weight: 700; color: var(--text-tertiary); flex-shrink: 0; }
    .pf-lt__cell-delta.up { color: var(--rose-text); }
    .pf-lt__cell-delta.down { color: var(--green-text); }
    .pf-lt__cell-val { font-size: 18px; font-weight: 700; color: var(--text-primary); line-height: 1.1; }
    .pf-lt__cell-val.abn { color: var(--rose-text); }
    .pf-lt__cell-unit { font-size: 10.5px; font-weight: 500; color: var(--text-tertiary); margin-left: 3px; }
    .pf-lt__spark { width: 100%; height: 40px; }
    .pf-lt__cell-foot { display: flex; justify-content: space-between; gap: 6px; font-size: 10px; color: var(--text-tertiary); }
    .pf-lt__cell-ref { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }

    /* Phone-only test picker — the 240px sidebar collapses into this pf-select. */
    .pf-lt__mobile-pick { display: none; }
    /* Phone-only category breadcrumb shown when drilled into a value. */
    .pf-lt__crumb {
      display: none; align-items: center; gap: 4px; max-width: 100%;
      margin-bottom: 8px; padding: 2px; background: none; border: 0; cursor: pointer;
      font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-lt__crumb svg { flex-shrink: 0; }
    .pf-lt__crumb:hover { color: var(--text-secondary); }
    /* Classy dropdowns sit inline on desktop at a sensible width. */
    .pf-lt__dd { flex: 0 0 auto; }
    .pf-lt__dd--param { width: 210px; }
    .pf-lt__dd--range { width: 150px; }

    /* ── Phone (<=640): additive, one-column, native-feeling. Desktop/iPad
       above are untouched. ─────────────────────────────────────────────── */
    @media (max-width: 640px) {
      .pf-lt__grid { grid-template-columns: 1fr; gap: 0; }
      .pf-lt__side { display: none; }              /* search + list → the picker */
      .pf-lt__crumb { display: inline-flex; }      /* category breadcrumb (param) */
      /* Panel picker joins the funnel on one row (flex fills; funnel to its right). */
      .pf-lt__mobile-pick { display: block; flex: 1 1 auto; min-width: 0; margin-bottom: 0; }
      .pf-lt__mobile-pick--hide { display: none; } /* hidden while drilled in */
      /* One compact control bar instead of five stacked full-width rows, so the
         chart is visible without scrolling. */
      .pf-lt__controls { flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
      /* The breadcrumb up top is the back affordance on phones. */
      .pf-lt__back { display: none; }
      /* Parameter picker fills the row; ellipsis on long names. */
      .pf-lt__dd--param { flex: 1 1 150px; width: auto; min-width: 0; }
      /* Range → a compact funnel-icon dropdown (label hidden; tap opens choices). */
      .pf-lt__dd--range { flex: 0 0 auto; width: 44px; }
      .pf-lt__dd--range ::ng-deep .pf-dd__value,
      .pf-lt__dd--range ::ng-deep .pf-dd__chevron { display: none; }
      .pf-lt__dd--range ::ng-deep .pf-dd__trigger {
        justify-content: center; padding: 0; min-height: 40px;
        background-repeat: no-repeat; background-position: center;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3'/%3E%3C/svg%3E");
      }
      /* Line/Bar → compact, pushed to the right. */
      .pf-lt__toggle { width: auto; margin-left: auto; }
      .pf-lt__toggle button { min-height: 40px; padding: 6px 14px; }
      /* The picker already names the panel — drop the redundant title row. */
      .pf-lt__title { display: none; }
      /* Two sparklines per row on a phone. */
      .pf-lt__matrix { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; }
      .pf-lt__cell-val { font-size: 16px; }
      .pf-lt__chart { min-height: 180px; }
    }
  `],
})
export class LabTrendsComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Patient whose trends to load. */
  readonly patientId = input.required<string>();

  private readonly chartEl = viewChild<ElementRef<HTMLDivElement>>('chart');
  private readonly sparkEls = viewChildren<ElementRef<HTMLDivElement>>('spark');
  readonly loading = signal(true);
  readonly tests = signal<TrendTest[]>([]);
  readonly testQuery = signal('');
  /** Left-list tests filtered by the search box (name match, case-insensitive). */
  readonly filteredTests = computed(() => {
    const q = this.testQuery().trim().toLowerCase();
    if (!q) return this.tests();
    return this.tests().filter(t => t.testName.toLowerCase().includes(q));
  });
  readonly selectedTestId = signal<string | null>(null);
  readonly selectedParam = signal<string>('');
  /** 'overall' = sparkline matrix of a panel's values; 'param' = one detailed chart. */
  readonly viewMode = signal<'overall' | 'param'>('param');
  readonly chartType = signal<'line' | 'bar'>('line');
  readonly range = signal<RangeKey>('5');

  readonly selectedTest = computed(() =>
    this.tests().find(t => t.testId === this.selectedTestId()) ?? null);

  /** Panel parameters for the overall matrix (each keeps its full series). */
  readonly overviewParams = computed<TrendParam[]>(() => this.selectedTest()?.parameters ?? []);

  /** Options for the classy pf-select dropdowns. */
  readonly RANGE_OPTIONS: PfSelectOption[] = [
    { value: '5', label: 'Last 5 tests' },
    { value: '10', label: 'Last 10 tests' },
    { value: '3m', label: 'Last 3 months' },
    { value: '6m', label: 'Last 6 months' },
    { value: 'all', label: 'All time' },
  ];
  readonly testOptions = computed<PfSelectOption[]>(() =>
    this.tests().map(t => ({
      value: t.testId,
      label: `${t.testName} · ${t.parameters.length} value${t.parameters.length === 1 ? '' : 's'} · ×${t.count}`,
    })));
  readonly paramOptions = computed<PfSelectOption[]>(() =>
    (this.selectedTest()?.parameters ?? []).map(p => ({
      value: p.parameter,
      label: p.unit ? `${p.parameter} (${p.unit})` : p.parameter,
    })));

  readonly activeParam = computed<TrendParam | null>(() => {
    const t = this.selectedTest();
    if (!t) return null;
    return t.parameters.find(p => p.parameter === this.selectedParam()) ?? t.parameters[0] ?? null;
  });

  /** Points for the active parameter (detailed view), filtered by the range control. */
  readonly filteredPoints = computed<TrendPoint[]>(() => {
    const p = this.activeParam();
    return p ? filterTrendPoints(p.points, this.range()) : [];
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _echarts: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chart: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _sparks: any[] = [];
  private _resize = () => { this.fitHeight(); this._chart?.resize(); for (const s of this._sparks) s?.resize(); };

  /** Size the panel to exactly the space left below the page chrome so the
   *  whole Trendogram fits the viewport — measured, not a guessed offset, so
   *  it's correct no matter how tall the patient bar / tab row happen to be. */
  private fitHeight() {
    const el = this.host.nativeElement;
    const top = el.getBoundingClientRect().top;
    // On phones the bottom-nav floats over the content; measure its real height
    // (includes safe-area) so the chart stops just above it. Not rendered/visible
    // on desktop → 0 → unchanged.
    const nav = document.querySelector('pf-bottom-nav') as HTMLElement | null;
    const navH = nav && nav.offsetParent !== null ? nav.offsetHeight + 12 : 0;
    // Fit the space that's actually left; a modest floor keeps the chart usable
    // without forcing the panel past the fold (which would reintroduce scroll).
    const h = Math.max(window.innerHeight - top - navH - 20, 280);
    el.style.height = `${h}px`;
  }

  constructor() {
    // Load once the patientId is available.
    effect(() => {
      const id = this.patientId();
      if (id) this.load(id);
    });
    // Detailed chart: re-render on selection / type / range / data change.
    effect(() => {
      this.filteredPoints(); this.chartType(); this.activeParam(); this.chartEl(); this.viewMode();
      queueMicrotask(() => this.renderParam());
    });
    // Overall matrix: re-render sparklines when the panel / range / els change.
    effect(() => {
      this.overviewParams(); this.range(); this.sparkEls(); this.viewMode();
      queueMicrotask(() => this.renderMatrix());
    });
  }

  private load(id: string) {
    this.loading.set(true);
    this.api.get<{ tests: TrendTest[] }>(`/api/patients/${id}/lab-trends`).subscribe({
      next: r => {
        const list = r?.tests ?? [];
        this.tests.set(list);
        if (list.length) this.selectTest(list[0].testId);
        this.loading.set(false);
      },
      error: () => { this.tests.set([]); this.loading.set(false); },
    });
  }

  selectTest(id: string) {
    this.selectedTestId.set(id);
    const t = this.tests().find(x => x.testId === id);
    const params = t?.parameters ?? [];
    this.selectedParam.set(params[0]?.parameter ?? '');
    // Panels (>1 value) open on the overall matrix; single-value tests go direct.
    this.viewMode.set(params.length > 1 ? 'overall' : 'param');
  }

  /** Drill from a sparkline cell into the full detailed chart for that value. */
  drillTo(parameter: string) {
    this.selectedParam.set(parameter);
    this.viewMode.set('param');
  }

  backToOverview() { this.viewMode.set('overall'); }

  // --- Sparkline cell helpers (operate on the range-filtered series) ---
  private cellPoints(p: TrendParam): TrendPoint[] { return filterTrendPoints(p.points, this.range()); }
  pointCount(p: TrendParam): number { return this.cellPoints(p).length; }
  latest(p: TrendParam): string {
    const pts = this.cellPoints(p);
    const v = pts.length ? pts[pts.length - 1].value : null;
    return v === null ? '—' : String(v);
  }
  isAbnormal(p: TrendParam): boolean {
    const pts = this.cellPoints(p);
    const f = pts.length ? pts[pts.length - 1].flag : null;
    return !!(f && f.trim() && f.toUpperCase() !== 'N');
  }
  /** Direction + magnitude of the latest change vs the previous result. */
  delta(p: TrendParam): { dir: 'up' | 'down' | 'flat'; text: string } | null {
    const pts = this.cellPoints(p);
    if (pts.length < 2) return null;
    const a = pts[pts.length - 2].value, b = pts[pts.length - 1].value;
    const d = b - a;
    if (d === 0) return { dir: 'flat', text: '±0' };
    const mag = Math.abs(d) >= 1 ? Math.abs(d).toFixed(0) : Math.abs(d).toFixed(1);
    return { dir: d > 0 ? 'up' : 'down', text: `${d > 0 ? '▲' : '▼'} ${mag}` };
  }

  private async renderParam() {
    if (this.viewMode() !== 'param') return;
    this.fitHeight();
    const el = this.chartEl()?.nativeElement;
    const param = this.activeParam();
    if (!el || !param) return;
    this._echarts ??= await import('echarts');
    const ec = this._echarts;
    // The #chart node is recreated whenever we leave/re-enter the detailed view,
    // so a cached instance would be bound to a detached node (blank chart).
    // Re-init whenever the host element changes.
    if (this._chart && this._chartHost !== el) { this._chart.dispose(); this._chart = null; }
    if (!this._chart) { this._chart = ec.init(el, undefined, { renderer: 'canvas' }); this._chartHost = el; }
    this.bindResize();
    this._chart.setOption(buildTrendOption(ec, {
      param, points: this.filteredPoints(), chartType: this.chartType(), theme: 'dark',
    }), true);
    this._chart.resize();
  }
  private _chartHost: HTMLElement | null = null;

  private async renderMatrix() {
    if (this.viewMode() !== 'overall') return;
    this.fitHeight();
    const els = this.sparkEls();
    const params = this.overviewParams();
    if (!els.length || !params.length) return;
    this._echarts ??= await import('echarts');
    const ec = this._echarts;
    this.bindResize();
    // Rebuild the instance set to match the current cells.
    for (const s of this._sparks) s?.dispose();
    this._sparks = [];
    els.forEach((ref, i) => {
      const p = params[i];
      if (!p) return;
      const chart = ec.init(ref.nativeElement, undefined, { renderer: 'canvas' });
      chart.setOption(buildSparklineOption(ec, {
        points: this.cellPoints(p), referenceRange: p.referenceRange,
      }), true);
      chart.resize();
      this._sparks.push(chart);
    });
  }

  private _boundResize = false;
  private bindResize() {
    if (this._boundResize) return;
    window.addEventListener('resize', this._resize);
    this._boundResize = true;
  }

  ngOnDestroy() {
    if (this._boundResize) window.removeEventListener('resize', this._resize);
    this._chart?.dispose();
    for (const s of this._sparks) s?.dispose();
  }
}
