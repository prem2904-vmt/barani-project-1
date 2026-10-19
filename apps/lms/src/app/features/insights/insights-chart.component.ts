import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, output, untracked, viewChild } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';
import { ndTrendSkin } from '../frontdesk/patient-profile/lab-trends.component';
import { restoreSeriesColours } from '../../shared/utils/business-chart';

/** Legend, bar labels and donut captions wear the theme's TEXT inks (never
 *  the series colour, never ECharts' default outlined label); the shared
 *  skin only covers axes, grid and tooltip. Keeps a builder's wider right
 *  gutter (direct bar labels) that the skin would narrow. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function themeText(opt: any, dark: boolean, gridRight: unknown): void {
  const primary = dark ? '#e2e8f0' : '#0f172a';
  const secondary = dark ? '#cbd5e1' : '#475569';
  if (opt.grid && typeof gridRight === 'number' && gridRight > (opt.grid.right ?? 0)) opt.grid = { ...opt.grid, right: gridRight };
  if (opt.legend) opt.legend = { ...opt.legend, textStyle: { ...(opt.legend.textStyle ?? {}), color: secondary }, inactiveColor: dark ? '#475569' : '#cbd5e1' };
  if (opt.title) opt.title = { ...opt.title, textStyle: { ...(opt.title.textStyle ?? {}), color: primary }, subtextStyle: { ...(opt.title.subtextStyle ?? {}), color: dark ? '#94a3b8' : '#64748b' } };
  for (const sr of opt.series ?? []) {
    if (sr.label?.show) sr.label = { ...sr.label, color: secondary, textBorderWidth: 0, textShadowBlur: 0 };
  }
}

/** What a click on a chart element hands back (bar / point / slice). */
export interface ChartPick { name: string; seriesName?: string; dataIndex: number; key?: string | null; }

type EChartsLib = typeof import('echarts');
type EChart = ReturnType<EChartsLib['init']>;

let echartsLib: Promise<EChartsLib> | null = null;
function loadEcharts(): Promise<EChartsLib> {
  echartsLib ??= import('echarts');
  return echartsLib;
}

/**
 * One Insights chart: ECharts (lazy chunk), the app's ONE skin
 * (`ndTrendSkin`, + each series' own colour put back), light/dark follows
 * the theme, resizes with its box (ResizeObserver — a side card collapsing
 * or a phone rotating re-flows it), and every element click comes out as
 * `pick` so the host can drill to the list behind it. `spark` skips the
 * axis skin (sparklines have none).
 */
@Component({
  selector: 'pf-ins-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="pf-insc" [class.pf-insc--click]="clickable()" [style.height]="height()" role="img" [attr.aria-label]="label()"></div>`,
  styles: [`
    :host { display: block; min-width: 0; }
    .pf-insc { width: 100%; }
    .pf-insc--click { cursor: pointer; }
  `],
})
export class InsightsChartComponent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly option = input<any>(null);
  readonly height = input<string>('240px');
  readonly label = input<string>('');
  readonly clickable = input<boolean>(false);
  readonly spark = input<boolean>(false);
  readonly pick = output<ChartPick>();

  private readonly theme = inject(ThemeService);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private chart: EChart | null = null;
  private ro: ResizeObserver | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.ro?.disconnect();
      try { this.chart?.dispose(); } catch { /* already gone */ }
      this.chart = null;
    });
    effect(() => {
      const opt = this.option();
      const dark = this.theme.isDark();
      const spark = this.spark();
      const el = this.host().nativeElement;
      untracked(() => void this.paint(el, opt, dark, spark));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async paint(el: HTMLElement, opt: any, dark: boolean, spark: boolean): Promise<void> {
    if (!opt || typeof window === 'undefined') return;
    let ec: EChartsLib;
    try { ec = await loadEcharts(); } catch { return; }
    if (this.destroyed) return;
    try {
      if (!this.chart || this.chart.getDom() !== el) {
        this.chart?.dispose();
        this.chart = ec.init(el, undefined, { renderer: 'canvas' });
        this.chart.on('click', (p: unknown) => {
          const e = p as { name?: string; seriesName?: string; dataIndex?: number; data?: { key?: string | null } };
          this.pick.emit({ name: e.name ?? '', seriesName: e.seriesName, dataIndex: e.dataIndex ?? 0, key: e.data?.key ?? null });
        });
        if (typeof ResizeObserver !== 'undefined') {
          this.ro?.disconnect();
          this.ro = new ResizeObserver(() => { try { this.chart?.resize(); } catch { /* disposed */ } });
          this.ro.observe(el);
        }
      }
      const gridRight = opt.grid?.right;
      const skinned = spark ? opt : restoreSeriesColours(ndTrendSkin(opt, dark));
      if (!spark) themeText(skinned, dark, gridRight);
      if (!this.clickable()) for (const s of skinned.series ?? []) s.cursor = 'default';
      this.chart.setOption(skinned, { notMerge: true });
    } catch { /* jsdom / no canvas: the card still shows its numbers */ }
  }
}
