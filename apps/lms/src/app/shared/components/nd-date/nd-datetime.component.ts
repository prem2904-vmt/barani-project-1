import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NdDateComponent } from './nd-date.component';
import { NdTimeComponent } from '../nd-time/nd-time.component';

/**
 * Kit date+time input — pairs `pf-nd-date` with `pf-nd-time` so a
 * `datetime-local` field never falls back to the native browser control.
 *
 * Value in / out is `YYYY-MM-DDTHH:mm`, the same string a native
 * `<input type="datetime-local">` reads and emits (no seconds), so this is
 * a drop-in replacement.
 */
@Component({
  selector: 'pf-nd-datetime',
  standalone: true,
  imports: [NdDateComponent, NdTimeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pf-nddt">
      <pf-nd-date [label]="label() + ' date'" [value]="datePart()" (valueChange)="onDate($event)"></pf-nd-date>
      <pf-nd-time [label]="label() + ' time'" [value]="timePart()" (valueChange)="onTime($event)"></pf-nd-time>
    </span>
  `,
  styles: [`
    .pf-nddt { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
    .pf-nddt pf-nd-date, .pf-nddt pf-nd-time { flex: 1 1 120px; min-width: 110px; }
  `],
})
export class NdDateTimeComponent {
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
