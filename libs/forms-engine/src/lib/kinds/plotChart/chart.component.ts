import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ChartSpec, layoutChart } from './chart-model';

/**
 * A chart drawn as SVG from a `ChartSpec` (growth curves, an audiogram, a partograph). Colours of the frame, grid and numbers come from the
 * theme (light and dark); the series keep their own colours. Never takes pointer input: it is a picture of what the doctor entered.
 */
@Component({
  selector: 'fe-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (laid(); as L) {
      <svg class="fe-chart" [attr.viewBox]="'0 0 ' + L.w + ' ' + L.h" role="img" [attr.aria-label]="summary()" preserveAspectRatio="xMidYMid meet">
        @for (p of L.panels; track $index) {
          <g class="fe-chart__panel">
            @for (b of p.bands; track $index) {
              <rect [attr.x]="p.x" [attr.y]="b.y" [attr.width]="p.width" [attr.height]="b.height" [attr.fill]="b.color" />
            }
            @for (x of p.vgrid; track $index) {
              <line class="fe-chart__grid" [attr.x1]="x" [attr.x2]="x" [attr.y1]="p.y" [attr.y2]="p.y + p.height" />
            }
            @for (t of p.hgrid; track $index) {
              <line class="fe-chart__grid" [attr.x1]="p.x" [attr.x2]="p.x + p.width" [attr.y1]="t.y" [attr.y2]="t.y" />
              <text class="fe-chart__num" [attr.x]="p.x - 5" [attr.y]="t.y" text-anchor="end" dominant-baseline="central">{{ t.label }}</text>
            }
            <rect class="fe-chart__frame" [attr.x]="p.x" [attr.y]="p.y" [attr.width]="p.width" [attr.height]="p.height" fill="none" />
            @for (s of p.series; track s.name) {
              @if (s.line) {
                <polyline [attr.points]="s.line" fill="none" [attr.stroke]="s.color" [attr.stroke-width]="s.width" stroke-linejoin="round" [attr.stroke-dasharray]="s.dashed ? '5 3' : null" />
              }
              @for (m of s.marks; track $index) {
                @if (m.marker === 'dot') {
                  <circle [attr.cx]="m.x" [attr.cy]="m.y" r="3.4" [attr.fill]="s.color" class="fe-chart__dot" />
                } @else if (m.marker === 'circle') {
                  <circle [attr.cx]="m.x" [attr.cy]="m.y" r="4.5" class="fe-chart__ring" [attr.stroke]="s.color" stroke-width="1.8" />
                } @else if (m.marker === 'bar') {
                  <rect [attr.x]="m.x - 4" [attr.y]="m.y" width="8" [attr.height]="m.bar" [attr.fill]="s.color" fill-opacity="0.75" />
                } @else if (m.d) {
                  <path [attr.d]="m.d" fill="none" [attr.stroke]="s.color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                }
              }
            }
          </g>
        }
        @for (t of L.xTicks; track $index) {
          <text class="fe-chart__num" [attr.x]="t.x" [attr.y]="t.y" text-anchor="middle" dominant-baseline="central">{{ t.label }}</text>
        }
      </svg>
    }
  `,
})
export class ChartComponent {
  readonly spec = input.required<ChartSpec | null>();
  /** What a screen reader says about this picture. */
  readonly summary = input<string>('Chart');
  protected readonly laid = computed(() => (this.spec() ? layoutChart(this.spec()!) : null));
}
