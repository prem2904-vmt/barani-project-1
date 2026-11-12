import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ApplyFieldChange } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { GROWTH_MEASURES, GrowthMeasure, growthLabel } from './chart-math';
import { measuresOf, presetOf } from './plotchart-value';

/**
 * Studio panel for `plotChart`: for a growth chart, which measures the doctor can plot; for the other charts a line saying where the numbers
 * come from (the reference data and its sources are fixed in the product, never typed here).
 */
@Component({
  selector: 'fe-plotchart-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fe-cs" data-panel="plotChart">
      @switch (preset()) {
        @case ('growth') {
          <h3 class="fe-cs__h">Measures <span class="fe-cs__note">what can be plotted</span></h3>
          <div class="fe-cs__chips" role="group" aria-label="Measures">
            @for (m of all; track m) {
              <button type="button" class="fe-cs__chip" [attr.data-measure]="m" [attr.aria-pressed]="chosen().includes(m)" (click)="toggle(m)">{{ label(m) }}</button>
            }
          </div>
          <p class="fe-cs__note">Drawn on the WHO growth curves: standards for birth to 5 years, the WHO reference for 5 to 19 years (weight to 10 years). The centile is worked out for you.</p>
        }
        @case ('audiogram') {
          <p class="fe-cs__note">Hearing thresholds at 250 to 8000 Hz for each ear, air and bone, with the average, the WHO grade of hearing loss and the type (conductive, sensorineural or mixed) worked out for you.</p>
        }
        @default {
          <p class="fe-cs__note">The WHO labour chart: cervix and descent of the head over the hours, with the alert line and the action line, the fetal heart rate and the contractions. It says when a line was crossed.</p>
        }
      }
    </section>
  `,
})
export class PlotChartPanelComponent {
  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();
  protected readonly all = GROWTH_MEASURES;
  protected readonly preset = computed(() => presetOf(this.field().config));
  protected readonly chosen = computed(() => measuresOf(this.field().config));
  protected label = growthLabel;

  protected toggle(m: GrowthMeasure): void {
    this.apply()((f) => {
      f.config ??= {};
      const now = measuresOf(f.config);
      const next = now.includes(m) ? now.filter((x) => x !== m) : GROWTH_MEASURES.filter((x) => now.includes(x) || x === m);
      if (next.length) f.config['measures'] = next; // at least one stays
    });
  }
}
