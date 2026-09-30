import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ChartData } from '../../utils/report-chart/report-chart.data';
import { CHART_KINDS } from '../../utils/report-chart/report-chart.model';
import { approxMeasure, chartWidth, layoutChart, type ChartColor, type PathSeg } from '../../utils/report-chart/report-chart.layout';
import { marksBox, pathD } from '../../utils/report-chart/report-chart.geom';
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
      <figure class="pfrc" [class.pfrc--half]="data()?.size === 'half' && !thumb()" [class.pfrc--thumb]="thumb()">
        <svg [attr.viewBox]="viewBox()" [attr.role]="thumb() ? null : 'img'"
             [attr.aria-label]="thumb() ? null : ariaLabel()" [attr.aria-hidden]="thumb() ? 'true' : null"
             [attr.preserveAspectRatio]="thumb() ? 'xMidYMid meet' : 'xMinYMin meet'">
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
              @case ('path') {
                <path [attr.d]="d($any(op).segs)" [attr.fill]="$any(op).fill ? col($any(op).fill) : 'none'"
                      [attr.fill-opacity]="$any(op).opacity ?? null"
                      [attr.stroke]="$any(op).stroke ? col($any(op).stroke) : null" [attr.stroke-width]="$any(op).lw ?? null"
                      [attr.stroke-dasharray]="dash($any(op).dash)" stroke-linejoin="round" />
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
    .pfrc--thumb { height: 100%; box-sizing: border-box; padding: 5px 6px; border: 0; border-radius: 6px; }
    .pfrc--thumb svg { width: 100%; height: 100%; }
    :host(.pfrc-muted) .pfrc { background: transparent; }
  `],
})
export class ReportChartComponent {
  readonly data = input<ChartData | null>(null);
  /** Report theme overrides (accent, abnormal style). */
  readonly theme = input<Partial<ChartPdfTheme> | null>(null);
  /** Content width in points the chart is laid out against. */
  readonly contentWidth = input<number>(CONTENT_W);
  /** A picker thumbnail: marks only (no text), decorative. */
  readonly thumb = input<boolean>(false);

  private readonly th = computed<ChartPdfTheme>(() => ({ ...DEFAULT_CHART_THEME, ...(this.theme() ?? {}) }));

  readonly layout = computed(() => {
    const d = this.data();
    if (!d) return null;
    const thumb = this.thumb();
    return layoutChart(d, thumb ? this.contentWidth() : chartWidth(d.size, this.contentWidth()), { measure: approxMeasure, fontScale: 1, thumb });
  });

  /** The whole chart; a thumbnail is cropped to its marks. */
  readonly viewBox = computed(() => {
    const l = this.layout();
    if (!l) return '0 0 1 1';
    if (!this.thumb()) return `-4 -4 ${l.width + 8} ${l.height + 8}`;
    const b = marksBox(l.ops);
    return b ? `${b[0] - 2} ${b[1] - 2} ${b[2] - b[0] + 4} ${b[3] - b[1] + 4}` : `0 0 ${l.width} ${l.height}`;
  });

  readonly ariaLabel = computed(() => {
    const d = this.data();
    if (!d) return '';
    const one = (s: ChartData['series'][number]) => d.xLabels.map((x, i) => {
      const p = s?.points[i];
      return `${x} ${p?.value != null ? p.display + (p.unit ? ' ' + p.unit : '') + (p.flag ? ' ' + p.flag : '') : 'not measured'}`;
    }).join(', ');
    const kind = CHART_KINDS.find(k => k.value === d.kind)?.label ?? 'Chart';
    const body = d.series.length > 1 ? d.series.map(s => `${s.label}: ${one(s)}`).join('; ') : one(d.series[0]);
    return `${kind} chart, ${d.title}: ${body}`;
  });

  col(c: ChartColor): string { return chartColor(c, this.th()); }
  dash(d?: number[]): string | null { return d?.length ? d.join(' ') : null; }
  pts(p: Array<[number, number]>): string { return p.map(([x, y]) => `${x},${y}`).join(' '); }
  d(segs: PathSeg[]): string { return pathD(segs); }
  anchor(a: 'left' | 'center' | 'right'): string { return a === 'left' ? 'start' : a === 'right' ? 'end' : 'middle'; }
}
