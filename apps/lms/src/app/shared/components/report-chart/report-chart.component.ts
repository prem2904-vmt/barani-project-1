import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ChartData } from '../../utils/report-chart/report-chart.data';
import { approxMeasure, chartWidth, layoutChart, type ChartColor } from '../../utils/report-chart/report-chart.layout';
import { chartColor, DEFAULT_CHART_THEME, type ChartPdfTheme } from '../../utils/report-chart/report-chart.pdf';

/** A4 content width in points (the report's MARGIN_X = 30 on each side). */
const CONTENT_W = 535.28;

/**
 * `pf-report-chart` — the report chart as inline SVG, painted from the SAME
 * geometry the PDF draws (report-chart.layout.ts), on a white "paper"
 * surface: what the author / pathologist sees here is what prints.
 */
@Component({
  selector: 'pf-report-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (layout(); as l) {
      <figure class="pfrc" [class.pfrc--half]="data()?.size === 'half'">
        <svg [attr.viewBox]="'-4 -4 ' + (l.width + 8) + ' ' + (l.height + 8)" role="img"
             [attr.aria-label]="ariaLabel()" preserveAspectRatio="xMinYMin meet">
          @for (op of l.ops; track $index) {
            @switch (op.t) {
              @case ('line') {
                <line [attr.x1]="$any(op).x1" [attr.y1]="$any(op).y1" [attr.x2]="$any(op).x2" [attr.y2]="$any(op).y2"
                      [attr.stroke]="col($any(op).color)" [attr.stroke-width]="$any(op).w"
                      [attr.stroke-dasharray]="dash($any(op).dash)" />
              }
              @case ('poly') {
                <polyline [attr.points]="pts($any(op).pts)" fill="none" [attr.stroke]="col($any(op).color)"
                          [attr.stroke-width]="$any(op).w" stroke-linejoin="round" stroke-linecap="round"
                          [attr.stroke-dasharray]="dash($any(op).dash)" />
              }
              @case ('rect') {
                <rect [attr.x]="$any(op).x" [attr.y]="$any(op).y" [attr.width]="$any(op).w" [attr.height]="$any(op).h"
                      [attr.fill]="$any(op).fill ? col($any(op).fill) : 'none'"
                      [attr.stroke]="$any(op).stroke ? col($any(op).stroke) : null" [attr.stroke-width]="$any(op).lw ?? null" />
              }
              @case ('circle') {
                <circle [attr.cx]="$any(op).cx" [attr.cy]="$any(op).cy" [attr.r]="$any(op).r"
                        [attr.fill]="$any(op).fill ? col($any(op).fill) : 'none'"
                        [attr.stroke]="$any(op).stroke ? col($any(op).stroke) : null" [attr.stroke-width]="$any(op).lw ?? null" />
              }
              @case ('text') {
                <text [attr.x]="$any(op).x" [attr.y]="$any(op).y" [attr.font-size]="$any(op).size"
                      [attr.font-weight]="$any(op).bold ? 700 : 400" [attr.font-style]="$any(op).italic ? 'italic' : null"
                      [attr.fill]="col($any(op).color)" [attr.text-anchor]="anchor($any(op).align)">{{ $any(op).text }}</text>
              }
            }
          }
        </svg>
      </figure>
    }
  `,
  styles: [`
    :host { display: block; }
    .pfrc { margin: 0; padding: 10px 12px; background: #fff; border-radius: 10px;
      border: 1px solid rgba(15, 23, 42, .1); color: #111; }
    .pfrc svg { display: block; width: 100%; height: auto;
      font-family: Helvetica, Arial, 'Noto Sans', sans-serif; font-variant-numeric: tabular-nums; }
    .pfrc--half svg { max-width: 60%; }
  `],
})
export class ReportChartComponent {
  readonly data = input<ChartData | null>(null);
  /** Report theme overrides (accent, abnormal style). */
  readonly theme = input<Partial<ChartPdfTheme> | null>(null);
  /** Content width in points the chart is laid out against. */
  readonly contentWidth = input<number>(CONTENT_W);

  private readonly th = computed<ChartPdfTheme>(() => ({ ...DEFAULT_CHART_THEME, ...(this.theme() ?? {}) }));

  readonly layout = computed(() => {
    const d = this.data();
    if (!d) return null;
    return layoutChart(d, chartWidth(d.size, this.contentWidth()), { measure: approxMeasure, fontScale: 1 });
  });

  readonly ariaLabel = computed(() => {
    const d = this.data();
    if (!d) return '';
    const s = d.series[0];
    const pts = d.xLabels.map((x, i) => {
      const p = s?.points[i];
      return `${x} ${p?.value != null ? p.display + (p.flag ? ' ' + p.flag : '') : 'not measured'}`;
    });
    return `${d.title}: ${pts.join(', ')}`;
  });

  col(c: ChartColor): string { return chartColor(c, this.th()); }
  dash(d?: number[]): string | null { return d?.length ? d.join(' ') : null; }
  pts(p: Array<[number, number]>): string { return p.map(([x, y]) => `${x},${y}`).join(' '); }
  anchor(a: 'left' | 'center' | 'right'): string { return a === 'left' ? 'start' : a === 'right' ? 'end' : 'middle'; }
}
