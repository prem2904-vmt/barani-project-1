import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed,
  effect, inject, input, signal, viewChild, viewChildren,
} from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { ThemeService } from '../../../core/services/theme.service';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { filterTestList } from '../../../shared/utils/test-search';
import { oneLine } from '../../../shared/utils/reference-range';
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
        <div class="pf-lt__skel" aria-hidden="true">
          <div class="pf-lt__skel-side">
            @for (i of [1, 2, 3, 4, 5]; track i) { <span class="pf-lt__skel-bar pf-lt__skel-bar--row"></span> }
          </div>
          <div class="pf-lt__skel-main">
            <span class="pf-lt__skel-bar" style="width: 40%"></span>
            <span class="pf-lt__skel-chart"></span>
          </div>
        </div>
      } @else if (tests().length === 0) {
        <div class="nd-empty">
          <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg></span>
          <p class="nd-empty__title">No repeat tests yet</p>
          <p class="nd-empty__body">Trends appear once this patient has taken the same test at least twice.</p>
        </div>
      } @else {
        <div class="pf-lt__grid">
          <!-- Left: (search) + repeated tests -->
          <aside class="pf-lt__side" aria-label="Repeated tests">
            @if (query() === null) {
              <label class="pf-lt__search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
                </svg>
                <input type="text" class="nd-input" placeholder="Search tests" aria-label="Search tests" [value]="testQuery()"
                       (input)="testQuery.set($any($event.target).value)" />
              </label>
            }
            <div class="pf-lt__list" role="listbox" aria-label="Tests with trends">
              @for (t of filteredTests(); track t.testId) {
                <button type="button" class="pf-lt__test" role="option"
                        [attr.aria-selected]="selectedTestId() === t.testId"
                        (click)="selectTest(t.testId)">
                  <span class="pf-lt__test-name">{{ t.testName }}</span>
                  <span class="pf-lt__test-meta nd-num">
                    @if (t.parameters.length > 1) { {{ t.parameters.length }} values · }{{ t.count }} results
                  </span>
                </button>
              } @empty {
                <p class="pf-lt__noresult">No tests match “{{ effectiveQuery() }}”.</p>
              }
            </div>
          </aside>

          <!-- Right: controls + chart(s) -->
          <section class="pf-lt__panel">
            @if (selectedTest(); as st) {
              @if (viewMode() === 'param' && st.parameters.length > 1) {
                <button type="button" class="pf-lt__crumb" (click)="backToOverview()" title="Back to all values">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                  {{ st.testName }}
                </button>
              }
              <div class="pf-lt__controls">
                <pf-select class="pf-lt__mobile-pick"
                           [class.pf-lt__mobile-pick--hide]="viewMode() === 'param'"
                           placeholder="Select test"
                           [options]="testOptions()" [value]="selectedTestId() ?? ''"
                           (valueChange)="selectTest($any($event))"></pf-select>
                @if (viewMode() === 'param' && st.parameters.length > 1) {
                  <button type="button" class="nd-btn nd-btn--tertiary pf-lt__back" (click)="backToOverview()" aria-label="All values" title="All values">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                    <span class="pf-lt__back-lbl">All values</span>
                  </button>
                }
                @if (viewMode() === 'overall') {
                  <span class="pf-lt__title">{{ st.testName }} <span class="pf-lt__title-sub">· all values</span></span>
                } @else {
                  <pf-select class="pf-lt__dd pf-lt__dd--param" size="sm"
                             [options]="paramOptions()" [value]="selectedParam()"
                             (valueChange)="selectedParam.set($any($event))"></pf-select>
                }
                <pf-select class="pf-lt__dd pf-lt__dd--range" size="sm"
                           [options]="RANGE_OPTIONS" [value]="range()"
                           (valueChange)="range.set($any($event))"></pf-select>
                @if (viewMode() === 'param') {
                  <div class="nd-seg pf-lt__toggle" role="radiogroup" aria-label="Chart type">
                    <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="chartType() === 'line'" (click)="chartType.set('line')">Line</button>
                    <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="chartType() === 'bar'" (click)="chartType.set('bar')">Bar</button>
                  </div>
                }
              </div>

              @if (viewMode() === 'overall') {
                <div class="pf-lt__matrix">
                  @for (p of overviewParams(); track p.parameter) {
                    <button type="button" class="pf-lt__cell" (click)="drillTo(p.parameter)" [attr.aria-label]="p.parameter + ', latest ' + latest(p) + (p.unit ? ' ' + p.unit : '')">
                      <div class="pf-lt__cell-head">
                        <span class="pf-lt__cell-name">{{ p.parameter }}</span>
                        @if (delta(p); as d) {
                          <span class="pf-lt__cell-delta nd-num">
                            @if (d.dir === 'up') { <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg> }
                            @else if (d.dir === 'down') { <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg> }
                            {{ d.text }}
                          </span>
                        }
                      </div>
                      <div class="pf-lt__cell-val nd-num" [class.abn]="isAbnormal(p)">
                        {{ latest(p) }}<span class="pf-lt__cell-unit">{{ p.unit || '' }}</span>
                      </div>
                      <div class="pf-lt__spark" #spark></div>
                      <div class="pf-lt__cell-foot nd-num">
                        <span>{{ pointCount(p) }} results</span>
                        @if (p.referenceRange) { <span class="pf-lt__cell-ref" [title]="p.referenceRange">{{ refLine(p.referenceRange) }}</span> }
                      </div>
                    </button>
                  }
                </div>
              } @else if (activeParam(); as ap) {
                <div class="pf-lt__meta nd-num">
                  <span>{{ filteredPoints().length }} results</span>
                  @if (ap.referenceRange) { <span class="pf-lt__ref">Reference: {{ ap.referenceRange }}{{ ap.unit ? ' ' + ap.unit : '' }}</span> }
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
    /* Fill the host so the whole thing fits with no page scroll. Palette:
       violet + neutrals; the ONLY colour beyond that is a real flag (an
       abnormal latest value in red). Noto Sans, tabular numbers. */
    :host { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; }
    .pf-lt { width: 100%; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-lt__grid { display: grid; grid-template-columns: 240px 1fr; gap: 16px; flex: 1 1 auto; min-height: 0; }
    @media (max-width: 700px) { .pf-lt__grid { grid-template-columns: 1fr; } }
    .pf-lt__side { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
    .pf-lt__search { position: relative; display: block; flex: none; }
    .pf-lt__search > svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
    .pf-lt__search .nd-input { width: 100%; height: 36px; min-height: 36px; padding-left: 34px; }
    .pf-lt__list { display: flex; flex-direction: column; gap: 4px; flex: 1; min-height: 0; overflow-y: auto; }
    .pf-lt__test {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 48px;
      padding: 8px 12px; border-radius: var(--nd-radius-sm, 10px); text-align: left; cursor: pointer;
      background: transparent; border: 1px solid transparent; color: var(--text-primary); font: inherit;
    }
    .pf-lt__test:hover { background: var(--nd-chip-bg); }
    .pf-lt__test[aria-selected='true'] { background: var(--nd-sel-bg, var(--nd-chip-bg)); border-color: var(--nd-sel-border); }
    .pf-lt__test:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    /* Names wrap onto multiple lines instead of truncating. */
    .pf-lt__test-name { font-size: 13px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
    .pf-lt__test-meta { font-size: 12px; color: var(--text-tertiary); }
    .pf-lt__noresult { font-size: 12.5px; color: var(--text-tertiary); padding: 10px 4px; margin: 0; }
    .pf-lt__panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .pf-lt__controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
    .pf-lt__title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-lt__title-sub { font-weight: 400; color: var(--text-tertiary); }
    .pf-lt__back { gap: 4px; }
    .pf-lt__toggle { margin-left: auto; }
    .pf-lt__meta { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; color: var(--text-tertiary); margin-bottom: 6px; flex-shrink: 0; }
    .pf-lt__chart { width: 100%; flex: 1 1 auto; min-height: 220px; }

    .pf-lt__matrix {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
      gap: 10px; align-content: start; flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 2px;
    }
    .pf-lt__cell {
      display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer; font: inherit;
      padding: 10px 11px 8px; border-radius: var(--nd-radius-sm, 10px);
      background: var(--nd-card-bg); border: 1px solid var(--nd-line); color: var(--text-primary);
      transition: border-color var(--nd-dur-fast) ease;
    }
    .pf-lt__cell:hover { border-color: var(--nd-sel-border); }
    .pf-lt__cell:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-lt__cell-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
    .pf-lt__cell-name { font-size: 12px; font-weight: 500; color: var(--text-secondary); overflow-wrap: anywhere; line-height: 1.25; }
    .pf-lt__cell-delta { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; font-size: 11px; font-weight: 500; color: var(--text-tertiary); }
    .pf-lt__cell-val { font-size: 18px; font-weight: 600; color: var(--text-primary); line-height: 1.15; }
    .pf-lt__cell-val.abn { color: color-mix(in srgb, var(--red-text) 80%, var(--text-primary)); }
    .pf-lt__cell-unit { font-size: 11px; font-weight: 400; color: var(--text-tertiary); margin-left: 3px; }
    .pf-lt__spark { width: 100%; height: 40px; }
    .pf-lt__cell-foot { display: flex; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--text-tertiary); }
    .pf-lt__cell-ref { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }
    .pf-lt__ref { white-space: pre-line; }

    /* Loading: a static skeleton in the page's shape (no shimmer loop). */
    .pf-lt__skel { display: grid; grid-template-columns: 240px 1fr; gap: 16px; flex: 1 1 auto; min-height: 220px; }
    .pf-lt__skel-side, .pf-lt__skel-main { display: flex; flex-direction: column; gap: 10px; }
    .pf-lt__skel-bar { display: block; height: 12px; width: 100%; border-radius: 6px; background: var(--nd-chip-bg); }
    .pf-lt__skel-bar--row { height: 40px; border-radius: 10px; }
    .pf-lt__skel-chart { flex: 1 1 auto; min-height: 180px; border-radius: 12px; background: var(--nd-chip-bg); }
    @media (max-width: 700px) { .pf-lt__skel { grid-template-columns: 1fr; } .pf-lt__skel-side { display: none; } }

    .pf-lt__mobile-pick { display: none; }
    .pf-lt__crumb {
      display: none; align-items: center; gap: 4px; max-width: 100%;
      margin-bottom: 8px; padding: 2px; background: none; border: 0; cursor: pointer; font: inherit;
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-lt__crumb svg { flex-shrink: 0; }
    .pf-lt__dd { flex: 0 0 auto; }
    .pf-lt__dd--param { width: 210px; }
    .pf-lt__dd--range { width: 150px; }

    /* ── Phone (<=640): additive, one column. ── */
    @media (max-width: 640px) {
      .pf-lt__grid { grid-template-columns: 1fr; gap: 0; }
      .pf-lt__side { display: none; }
      .pf-lt__crumb { display: inline-flex; min-height: 44px; }
      .pf-lt__mobile-pick { display: block; flex: 1 1 auto; min-width: 0; margin-bottom: 0; }
      .pf-lt__mobile-pick--hide { display: none; }
      .pf-lt__controls { flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
      .pf-lt__back { display: none; }
      .pf-lt__dd--param { flex: 1 1 150px; width: auto; min-width: 0; }
      .pf-lt__dd--range { flex: 0 0 auto; width: 150px; }
      .pf-lt__toggle .nd-seg__item { min-height: 40px; }
      .pf-lt__title { display: none; }
      .pf-lt__matrix { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; }
      .pf-lt__cell-val { font-size: 16px; }
      .pf-lt__chart { min-height: 200px; }
    }
    @media (prefers-reduced-motion: reduce) { .pf-lt__cell { transition: none; } }
  `],
})
export class LabTrendsComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly theme = inject(ThemeService, { optional: true });

  /** Patient whose trends to load. */
  readonly patientId = input.required<string>();
  /** The profile card's header search (ND "card header: search + filter").
   *  null = standalone: the list shows its own search box. */
  readonly query = input<string | null>(null);
  /** Measure the viewport and size itself (standalone). Inside an nd-card
   *  body the card owns the height, so the profile passes false. */
  readonly fit = input<boolean>(true);
  /** Open straight on one analyte (the cumulative grid's row → its chart):
   *  its test, drilled into that parameter. Matched case-insensitively. */
  readonly focus = input<{ testId: string; parameter: string } | null>(null);

  private readonly chartEl = viewChild<ElementRef<HTMLDivElement>>('chart');
  private readonly sparkEls = viewChildren<ElementRef<HTMLDivElement>>('spark');
  readonly loading = signal(true);
  readonly tests = signal<TrendTest[]>([]);
  readonly testQuery = signal('');
  /** Left-list tests filtered by the search box using common search logic. */
  readonly effectiveQuery = computed(() => this.query() ?? this.testQuery());
  readonly filteredTests = computed(() => {
    return filterTestList(this.tests(), this.effectiveQuery());
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
      label: `${t.testName} · ${t.parameters.length} value${t.parameters.length === 1 ? '' : 's'} · ${t.count} results`,
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
    if (!this.fit()) return;
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
    // Detailed chart: re-render on selection / type / range / data / theme change.
    effect(() => {
      this.filteredPoints(); this.chartType(); this.activeParam(); this.chartEl(); this.viewMode(); this.theme?.isDark();
      queueMicrotask(() => this.renderParam());
    });
    // Overall matrix: re-render sparklines when the panel / range / els change.
    effect(() => {
      this.overviewParams(); this.range(); this.sparkEls(); this.viewMode(); this.theme?.isDark();
      queueMicrotask(() => this.renderMatrix());
    });
  }

  private load(id: string) {
    this.loading.set(true);
    this.api.get<{ tests: TrendTest[] }>(`/api/patients/${id}/lab-trends`).subscribe({
      next: r => {
        const list = r?.tests ?? [];
        this.tests.set(list);
        if (!this.applyFocus() && list.length) this.selectTest(list[0].testId);
        this.loading.set(false);
      },
      error: () => { this.tests.set([]); this.loading.set(false); },
    });
  }

  /** Select the focused analyte, when it is one of the trended tests. */
  private applyFocus(): boolean {
    const f = this.focus();
    if (!f) return false;
    const t = this.tests().find(x => x.testId === f.testId);
    if (!t) return false;
    this.selectTest(t.testId);
    const p = t.parameters.find(x => x.parameter.trim().toLowerCase() === f.parameter.trim().toLowerCase());
    if (p) this.drillTo(p.parameter);
    return true;
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
  /** The compact cell's one-line reference ("a · b"); the title keeps the lines. */
  refLine(s: string | null | undefined): string { return oneLine(s, ' · '); }

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
    return { dir: d > 0 ? 'up' : 'down', text: mag };
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
    this._chart.setOption(ndTrendSkin(buildTrendOption(ec, {
      param, points: this.filteredPoints(), chartType: this.chartType(), theme: 'dark',
    }), this.isDark()), true);
    this._chart.resize();
  }
  private _chartHost: HTMLElement | null = null;
  /** Light / dark follows the app theme (the screen chart only — the PDF
   *  trendogram keeps trend-chart.ts's own light theme). */
  private isDark(): boolean {
    if (this.theme) return this.theme.isDark();
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  }

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
      chart.setOption(ndSparkSkin(buildSparklineOption(ec, {
        points: this.cellPoints(p), referenceRange: p.referenceRange,
      }), this.isDark()), true);
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

// ── ND chart skin (screen only) ─────────────────────────────────────────
// trend-chart.ts is shared with the PDF trendogram, so the palette is
// applied here instead: Noto Sans + tabular numbers, theme-aware axes and
// tooltip, violet data, a NEUTRAL reference band (never green), and red
// only on flagged points (the one meaningful colour).
const ND_FONT = "'Noto Sans', system-ui, sans-serif";
const VIOLET = { light: '#7c3aed', dark: '#a78bfa' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ndTrendSkin(opt: any, dark: boolean): any {
  if (!opt) return opt;
  const axis = dark ? '#94a3b8' : '#475569';
  const grid = dark ? 'rgba(255,255,255,0.06)' : '#e2e8f0';
  const line = dark ? 'rgba(255,255,255,0.15)' : '#cbd5e1';
  opt.backgroundColor = 'transparent';
  opt.textStyle = { fontFamily: ND_FONT };
  // Room for the last date label (it was clipped at the right edge).
  if (opt.grid) opt.grid = { ...opt.grid, right: 32 };
  for (const ax of [opt.xAxis, opt.yAxis]) {
    if (!ax) continue;
    ax.axisLabel = { ...(ax.axisLabel ?? {}), color: axis, fontFamily: ND_FONT, fontSize: 11 };
    if (ax.axisLine) ax.axisLine = { ...ax.axisLine, lineStyle: { color: line } };
    if (ax.splitLine) ax.splitLine = { ...ax.splitLine, lineStyle: { color: grid } };
  }
  if (opt.tooltip) {
    opt.tooltip = {
      ...opt.tooltip,
      backgroundColor: dark ? 'rgba(20,20,28,0.94)' : '#ffffff',
      borderColor: dark ? 'rgba(255,255,255,0.12)' : '#e2e8f0',
      textStyle: { color: dark ? '#e2e8f0' : '#0f172a', fontSize: 12, fontFamily: ND_FONT },
      extraCssText: 'font-variant-numeric: tabular-nums; border-radius: 10px; box-shadow: 0 8px 24px rgba(15,23,42,0.18);',
    };
  }
  recolour(opt, dark);
  return opt;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ndSparkSkin(opt: any, dark: boolean): any {
  if (!opt) return opt;
  opt.textStyle = { fontFamily: ND_FONT };
  recolour(opt, dark);
  return opt;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function recolour(opt: any, dark: boolean): void {
  const v = dark ? VIOLET.dark : VIOLET.light;
  for (const s of opt.series ?? []) {
    if (s.markArea?.itemStyle) {
      s.markArea = { ...s.markArea, itemStyle: { color: dark ? 'rgba(148,163,184,0.10)' : 'rgba(100,116,139,0.10)' } };
    }
    if (s.type === 'line' && s.lineStyle) s.lineStyle = { ...s.lineStyle, color: v };
    const itemColor = s.itemStyle?.color;
    if (typeof itemColor === 'function') {
      // Keep the flagged (red) points; everything else takes the theme violet.
      s.itemStyle = {
        ...s.itemStyle,
        color: (p: { dataIndex: number }) => {
          const c = itemColor(p);
          return typeof c === 'string' && /^#(dc2626|fb7185)$/i.test(c) ? (dark ? '#fb7185' : '#dc2626') : (s.type === 'bar' ? v : v);
        },
      };
    }
  }
}
