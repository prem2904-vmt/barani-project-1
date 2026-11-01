import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ReportTemplate } from '../../../shared/models/report.model';
import { readReportStyle, writeReportStyle, type ReportStyle } from '../../../shared/utils/report-style';

type Trend = ReportStyle['charts']['trend'];

/**
 * Report designer -> Footer: the Chart panel card (report layout plan 3.11).
 *
 * Decides how the serial-result trend charts and the range-bar column print:
 * as pictures (today) or drawn sharply in the report's colours, how many sit
 * across, and whether the range bar sits next to each reference range. The
 * preview beside it prints sample trends so every choice shows at once.
 *
 * Presentational: it reads the template and emits a metadata patch; the editor
 * owns the template, its undo history and the live preview.
 */
@Component({
  selector: 'pf-report-chart-panel-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-cpc" aria-label="Charts">
      <h4 class="pf-cpc__h">Charts</h4>
      <p class="pf-cpc__s">How the trend charts and the range bar print. The preview shows sample trends.</p>

      <span class="pf-cpc__k" id="pf-cpc-style">Trend charts</span>
      <div class="pf-seg pf-cpc__seg" role="radiogroup" aria-labelledby="pf-cpc-style">
        @for (o of styles; track o.value) {
          <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="trend().style === o.value" (click)="setTrend({ style: o.value })">{{ o.label }}</button>
        }
      </div>
      <p class="pf-cpc__hint">{{ trend().style === 'vector'
        ? 'Drawn sharply in your report colours and type, with round axis numbers. Smaller files, and clear on any printer.'
        : 'Pictures, as printed today.' }}</p>

      @if (trend().style === 'vector') {
        <span class="pf-cpc__k" id="pf-cpc-layout">Charts across the page</span>
        <div class="pf-cpc__tiles" role="radiogroup" aria-labelledby="pf-cpc-layout">
          @for (l of layouts; track l.value) {
            <button type="button" class="pf-cpc__tile press" role="radio" [attr.aria-checked]="trend().layout === l.value" (click)="setTrend({ layout: l.value })">
              <span class="pf-cpc__pic" [class]="'pf-cpc__pic pf-cpc__pic--' + l.value" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="pf-cpc__tn">{{ l.label }}</span>
            </button>
          }
        </div>
        <div class="pf-cpc__row">
          <span class="pf-cpc__txt"><span class="pf-cpc__label">Normal range band</span><span class="pf-cpc__desc">A light band behind the line where the result is normal.</span></span>
          <button type="button" class="pf-toggle pf-cpc__sw" role="switch" [attr.aria-checked]="trend().band" aria-label="Normal range band" (click)="setTrend({ band: !trend().band })">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="pf-cpc__row">
          <span class="pf-cpc__txt"><span class="pf-cpc__label">Values on the points</span><span class="pf-cpc__desc">Writes each result beside its point.</span></span>
          <button type="button" class="pf-toggle pf-cpc__sw" role="switch" [attr.aria-checked]="trend().values" aria-label="Values on the points" (click)="setTrend({ values: !trend().values })">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
      }

      <div class="pf-cpc__row">
        <span class="pf-cpc__txt"><span class="pf-cpc__label">Range bar</span><span class="pf-cpc__desc">A small number line beside each reference range, showing where the result falls. High and Low are still written out.</span></span>
        <button type="button" class="pf-toggle pf-cpc__sw" role="switch" [attr.aria-checked]="rangeBar()" aria-label="Range bar" (click)="setRangeBar(!rangeBar())">
          <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
        </button>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pf-cpc { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--pf-line); }
    .pf-cpc__h { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-cpc__s { margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-tertiary); }
    .pf-cpc__k { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .pf-cpc__seg { flex-wrap: wrap; align-self: flex-start; }
    .pf-cpc__hint { margin: 0; font-size: 12px; line-height: 1.4; color: var(--text-tertiary); }
    .pf-cpc__tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .pf-cpc__tile { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 8px; min-height: 44px; text-align: left; font: inherit; cursor: pointer;
      border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-line); background: var(--pf-card-bg); color: var(--text-primary); }
    .pf-cpc__tile[aria-checked='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-cpc__tile:focus-visible { outline: 2px solid var(--pf-sel-border); outline-offset: 2px; }
    .pf-cpc__tn { font-size: 12.5px; font-weight: 600; }
    .pf-cpc__pic { display: grid; gap: 3px; width: 100%; aspect-ratio: 3 / 2; padding: 5px; border-radius: 4px; background: #fff; border: 1px solid #cbd5e1; }
    .pf-cpc__pic i { display: block; border-radius: 2px; background: #e2e8f0; border: 1px solid #cbd5e1; }
    .pf-cpc__pic--grid-2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; }
    .pf-cpc__pic--grid-2 i:nth-child(3) { display: none; }
    .pf-cpc__pic--grid-3 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr; }
    .pf-cpc__pic--list { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
    .pf-cpc__pic--list i:nth-child(3) { display: none; }
    .pf-cpc__row { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 6px 0; }
    .pf-cpc__txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-cpc__label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-cpc__desc { font-size: 12px; line-height: 1.4; color: var(--text-muted); }
    .pf-cpc__sw { flex: none; min-width: 44px; min-height: 44px; }
    @media (max-width: 520px) { .pf-cpc__tiles { grid-template-columns: 1fr; } }
    @media (pointer: coarse) { .pf-seg__item { min-height: 40px; } }
  `],
})
export class ReportChartPanelCardComponent {
  readonly template = input.required<ReportTemplate>();
  readonly patch = output<Partial<ReportTemplate>>();

  readonly trend = computed<Trend>(() => readReportStyle(this.template()).charts.trend);
  readonly rangeBar = computed(() => readReportStyle(this.template()).charts.rangeBar);

  readonly styles: ReadonlyArray<{ value: Trend['style']; label: string }> = [
    { value: 'png', label: 'Pictures (today)' },
    { value: 'vector', label: 'Sharp, in your colours' },
  ];
  readonly layouts: ReadonlyArray<{ value: Trend['layout']; label: string }> = [
    { value: 'grid-2', label: 'Two across' },
    { value: 'grid-3', label: 'Three across' },
    { value: 'list', label: 'One per row' },
  ];

  setTrend(p: Partial<Trend>): void {
    this.patch.emit({ metadata: writeReportStyle(this.template(), { charts: { trend: p } }) });
  }
  setRangeBar(on: boolean): void {
    this.patch.emit({ metadata: writeReportStyle(this.template(), { charts: { rangeBar: on } }) });
  }
}
