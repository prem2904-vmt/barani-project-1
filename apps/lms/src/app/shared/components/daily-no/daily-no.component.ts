import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { dailyNoLabel, dailyNoOf, dailyNoTitle } from '../../utils/daily-no';

/**
 * `<pf-daily-no [of]="order" />` — the quiet "#12" chip placed before a
 * patient's name on lab screens (see utils/daily-no.ts). Takes the order, or
 * any row carrying `order` (a tube / line), or explicit `no` + `day`.
 * Renders nothing when there is no number (orders from before the feature).
 */
@Component({
  selector: 'pf-daily-no',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (label()) {<span class="pf-dayno" [attr.title]="title()" [attr.aria-label]="title()">{{ label() }}</span>}`,
  styles: [':host { display: contents; }'],
})
export class DailyNoComponent {
  readonly of = input<unknown>(null);
  readonly no = input<number | null | undefined>(undefined);
  readonly day = input<string | null | undefined>(undefined);

  private readonly fields = computed(() =>
    this.no() != null ? { dailyNo: this.no(), dailyNoDay: this.day() ?? null } : dailyNoOf(this.of()));
  readonly label = computed(() => dailyNoLabel(this.fields().dailyNo, this.fields().dailyNoDay));
  readonly title = computed(() => dailyNoTitle(this.fields().dailyNo, this.fields().dailyNoDay));
}
