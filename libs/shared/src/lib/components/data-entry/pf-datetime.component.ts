import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PfDateComponent } from './pf-date.component.js';
import { PfTimeComponent } from './pf-time.component.js';

/**
 * Kit date+time input — pairs `pf-date` with `pf-time` so a
 * `datetime-local` field never falls back to the native browser control.
 *
 * Value in / out is `YYYY-MM-DDTHH:mm`, the same string a native
 * `<input type="datetime-local">` reads and emits (no seconds), so this is
 * a drop-in replacement.
 */
@Component({
  selector: 'pf-datetime',
  standalone: true,
  imports: [PfDateComponent, PfTimeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="flex flex-wrap items-start gap-2">
      <pf-date class="min-w-[110px] flex-[1_1_120px]" [label]="label() + ' date'" [value]="datePart()" (valueChange)="onDate($event)"></pf-date>
      <pf-time class="min-w-[110px] flex-[1_1_120px]" [label]="label() + ' time'" [value]="timePart()" (valueChange)="onTime($event)"></pf-time>
    </span>
  `,

})
export class PfDateTimeComponent {
  /** `YYYY-MM-DDTHH:mm` (or null / ''). */
  readonly value = input<string | null>(null);
  readonly label = input<string>('Date & time');
  readonly valueChange = output<string | null>();

  readonly datePart = computed(() => {
    const m = String(this.value() ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  });
  readonly timePart = computed(() => {
    const m = String(this.value() ?? '').match(/T(\d{2}:\d{2})/);
    return m ? m[1] : null;
  });

  onDate(d: string | null): void {
    const time = this.timePart() ?? '00:00';
    this.valueChange.emit(d ? `${d}T${time}` : null);
  }

  onTime(t: string | null): void {
    const date = this.datePart();
    if (!date || !t) return;
    this.valueChange.emit(`${date}T${t}`);
  }
}
