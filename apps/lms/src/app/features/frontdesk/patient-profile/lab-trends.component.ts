import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed,
  effect, inject, input, signal, viewChild,
} from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { TrendPoint, TrendParam, TrendTest, buildTrendOption, filterTrendPoints } from '../../../shared/utils/trend-chart';

type RangeKey = '5' | '10' | '3m' | '6m' | 'all';

/**
 * Lab Trends — value-over-time charts for a patient's REPEATED tests. Two-panel:
 * repeated tests on the left, a themed ECharts chart on the right with a
 * parameter picker, a date/last-N range filter, and a line⇄bar toggle. ECharts
 * is dynamically imported so it only downloads when this view is opened.
 */
@Component({
  selector: 'pf-lab-trends',
  standalone: true,
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
                  <span class="pf-lt__test-name">{{ t.testName }}</span>
                  <span class="pf-lt__test-count">×{{ t.count }}</span>
                </button>
              } @empty {
                <p class="pf-lt__noresult">No tests match “{{ testQuery() }}”.</p>
              }
            </div>
          </aside>

          <!-- Right: controls + chart -->
          <section class="pf-lt__panel">
            @if (selectedTest(); as st) {
              <div class="pf-lt__controls">
                <select class="pf-lt__select" [value]="selectedParam()"
                        (change)="selectedParam.set($any($event.target).value)">
                  @for (p of st.parameters; track p.parameter) {
                    <option [value]="p.parameter">{{ p.parameter }}{{ p.unit ? ' (' + p.unit + ')' : '' }}</option>
                  }
                </select>
                <select class="pf-lt__select" [value]="range()"
                        (change)="range.set($any($event.target).value)">
                  <option value="5">Last 5 tests</option>
                  <option value="10">Last 10 tests</option>
                  <option value="3m">Last 3 months</option>
                  <option value="6m">Last 6 months</option>
                  <option value="all">All time</option>
                </select>
                <div class="pf-lt__toggle">
                  <button type="button" [class.pf-lt__toggle--on]="chartType() === 'line'" (click)="chartType.set('line')">Line</button>
                  <button type="button" [class.pf-lt__toggle--on]="chartType() === 'bar'" (click)="chartType.set('bar')">Bar</button>
                </div>
              </div>

              @if (activeParam(); as ap) {
                <div class="pf-lt__meta">
                  <span>{{ filteredPoints().length }} results</span>
                  @if (ap.referenceRange) { <span>Reference: {{ ap.referenceRange }}{{ ap.unit ? ' ' + ap.unit : '' }}</span> }
                </div>
              }
              <div class="pf-lt__chart" #chart></div>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: [`
    .pf-lt { width: 100%; }
    .pf-lt__msg, .pf-lt__empty { padding: 32px; text-align: center; color: var(--text-tertiary); }
    .pf-lt__empty-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); }
    .pf-lt__empty-sub { font-size: 12.5px; color: var(--text-tertiary); margin-top: 4px; }
    .pf-lt__grid { display: grid; grid-template-columns: 240px 1fr; gap: 16px; }
    @media (max-width: 700px) { .pf-lt__grid { grid-template-columns: 1fr; } }
    .pf-lt__side { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .pf-lt__search {
      display: flex; align-items: center; gap: 7px; padding: 7px 10px;
      border-radius: 9px; background: var(--input-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--glass-border); color: var(--text-tertiary);
    }
    .pf-lt__search input {
      flex: 1; min-width: 0; background: none; border: 0; outline: none;
      color: var(--text-primary); font-size: 12.5px;
    }
    .pf-lt__list { display: flex; flex-direction: column; gap: 6px; max-height: 420px; overflow-y: auto; }
    .pf-lt__test {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
      padding: 10px 12px; border-radius: 10px; text-align: left; cursor: pointer;
      background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary);
    }
    .pf-lt__test--on { border-color: rgba(168,85,247,0.5); background: rgba(124,58,237,0.12); color: var(--text-primary); }
    /* Names wrap onto multiple lines instead of truncating. */
    .pf-lt__test-name { font-size: 13px; font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; }
    .pf-lt__test-count { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; margin-top: 1px; }
    .pf-lt__noresult { font-size: 12px; color: var(--text-tertiary); padding: 10px 4px; }
    .pf-lt__panel { min-width: 0; }
    .pf-lt__controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
    .pf-lt__select {
      background: var(--input-bg, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border);
      border-radius: 8px; padding: 7px 10px; color: var(--text-primary); font-size: 12.5px;
    }
    .pf-lt__toggle { display: inline-flex; border: 1px solid var(--glass-border); border-radius: 8px; overflow: hidden; margin-left: auto; }
    .pf-lt__toggle button { padding: 7px 14px; font-size: 12px; font-weight: 600; background: none; border: 0; color: var(--text-secondary); cursor: pointer; }
    .pf-lt__toggle--on { background: linear-gradient(135deg, #7c3aed, #a855f7); color: #fff; }
    .pf-lt__meta { display: flex; gap: 16px; font-size: 11.5px; color: var(--text-tertiary); margin-bottom: 6px; }
    .pf-lt__chart { width: 100%; height: 340px; }
  `],
})
export class LabTrendsComponent implements OnDestroy {
  private readonly api = inject(ApiService);

  /** Patient whose trends to load. */
  readonly patientId = input.required<string>();

  private readonly chartEl = viewChild<ElementRef<HTMLDivElement>>('chart');
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
  readonly chartType = signal<'line' | 'bar'>('line');
  readonly range = signal<RangeKey>('5');

  readonly selectedTest = computed(() =>
    this.tests().find(t => t.testId === this.selectedTestId()) ?? null);
  readonly activeParam = computed<TrendParam | null>(() => {
    const t = this.selectedTest();
    if (!t) return null;
    return t.parameters.find(p => p.parameter === this.selectedParam()) ?? t.parameters[0] ?? null;
  });

  /** Points for the active parameter, filtered by the range control. */
  readonly filteredPoints = computed<TrendPoint[]>(() => {
    const p = this.activeParam();
    return p ? filterTrendPoints(p.points, this.range()) : [];
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _echarts: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chart: any = null;
  private _resize = () => this._chart?.resize();

  constructor() {
    // Load once the patientId is available.
    effect(() => {
      const id = this.patientId();
      if (id) this.load(id);
    });
    // Re-render whenever the selection, chart type, range, or data changes.
    effect(() => {
      this.filteredPoints(); this.chartType(); this.activeParam(); this.chartEl();
      queueMicrotask(() => this.render());
    });
  }

  private load(id: string) {
    this.loading.set(true);
    this.api.get<{ tests: TrendTest[] }>(`/api/patients/${id}/lab-trends`).subscribe({
      next: r => {
        const list = r?.tests ?? [];
        this.tests.set(list);
        if (list.length) { this.selectedTestId.set(list[0].testId); this.selectedParam.set(list[0].parameters[0]?.parameter ?? ''); }
        this.loading.set(false);
      },
      error: () => { this.tests.set([]); this.loading.set(false); },
    });
  }

  selectTest(id: string) {
    this.selectedTestId.set(id);
    const t = this.tests().find(x => x.testId === id);
    this.selectedParam.set(t?.parameters[0]?.parameter ?? '');
  }

  private async render() {
    const el = this.chartEl()?.nativeElement;
    const param = this.activeParam();
    if (!el || !param) return;
    this._echarts ??= await import('echarts');
    const ec = this._echarts;
    this._chart ??= ec.init(el, undefined, { renderer: 'canvas' });
    if (!this._boundResize) { window.addEventListener('resize', this._resize); this._boundResize = true; }

    this._chart.setOption(buildTrendOption(ec, {
      param, points: this.filteredPoints(), chartType: this.chartType(), theme: 'dark',
    }), true);
    this._chart.resize();
  }
  private _boundResize = false;

  ngOnDestroy() {
    if (this._boundResize) window.removeEventListener('resize', this._resize);
    this._chart?.dispose();
  }
}
