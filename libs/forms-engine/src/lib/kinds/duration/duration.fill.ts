import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { KindFill } from '../../fill/contract';
import { NumpadComponent, numberText, parseNumber } from '../../fill/numpad.component';

export const DURATION_NUMBERS = [1, 2, 3, 5, 7, 10, 14, 30];
export const PERIODS = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
  { key: 'night', label: 'Night' },
];
const UNIT_LABEL: Record<string, string> = {
  seconds: 'Seconds',
  minutes: 'Minutes',
  hours: 'Hours',
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
  years: 'Years',
};

/** Unit words are stored plural ("days"); legacy singulars read as their plural. */
export function pluralUnit(u: unknown): string | null {
  if (typeof u !== 'string' || !u) return null;
  const s = u.toLowerCase();
  return s.endsWith('s') ? s : s + 's';
}

/** "5 days", "5–7 days", "1 week". */
export function durationText(amount: number | null, to: number | null, unit: string): string {
  if (amount === null) return '';
  const top = to ?? amount;
  const word = top === 1 ? unit.replace(/s$/, '') : unit;
  return to !== null && to !== amount ? `${amount}–${to} ${word}` : `${amount} ${word}`;
}

type Which = 'from' | 'to';

/**
 * duration: "how long". By default the legacy layout: a number box (two for a range) and the unit as a dropdown
 * (pf-select). With `display: 'chips'`, without a keyboard: number chips
 * 1 2 3 5 7 10 14 30 (+ Other → the in-app number pad) and unit chips;
 * range mode has a From row and a To row. Clock scale: minutes / hours.
 * Period scale: Morning / Afternoon / Evening / Night (a plain string).
 * Value {amount, unit} (+ valueTo); legacy {value, unit} is read too.
 */
@Component({
  selector: 'fe-duration-fill',
  standalone: true,
  imports: [NumpadComponent, PfIconComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (scale() === 'period') {
      <div class="fe-chips" role="radiogroup" [attr.aria-labelledby]="labelId()">
        @for (p of periods; track p.key) {
          <button
            type="button"
            class="fe-chip"
            role="radio"
            [attr.aria-checked]="period() === p.key"
            [disabled]="disabled()"
            (click)="emit(period() === p.key ? undefined : p.key)"
          >
            <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
            {{ p.label }}
          </button>
        }
      </div>
    } @else if (box()) {
      <!-- legacy duration-input: a number box (– a second one for a range) and the unit as a dropdown -->
      <div class="fe-durbox" role="group" [attr.aria-labelledby]="labelId()">
        @for (row of rows(); track row) {
          @if (row === 'to') {
            <span class="fe-durbox__dash" aria-hidden="true">–</span>
          }
          <input
            class="fe-text__input fe-durbox__num"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            [attr.data-row]="row"
            [attr.aria-label]="field().label + (range() ? (row === 'from' ? ', from' : ', to') : '') + ', how many'"
            [placeholder]="range() ? (row === 'from' ? 'From' : 'To') : (field().placeholder || 'Duration')"
            [value]="numberText(numOf(row))"
            [disabled]="disabled()"
            (input)="typed(row, $any($event.target).value)"
          />
        }
        <pf-select
          class="fe-durbox__unit"
          [options]="unitOptions()"
          [value]="unit()"
          [disabled]="disabled()"
          [placeholder]="'Unit'"
          (valueChange)="pickUnit($event)"
        />
      </div>
      @if (preview()) {
        <p class="fe-dur__says" aria-live="polite">{{ preview() }}</p>
      }
    } @else {
      <div class="fe-dur" role="group" [attr.aria-labelledby]="labelId()">
        @for (row of rows(); track row) {
          <div class="fe-sub">
            @if (range()) {
              <span class="fe-sub__lbl">{{ row === 'from' ? 'From' : 'To' }}</span>
            }
            <div class="fe-chips">
              @for (n of numbers; track n) {
                <button
                  type="button"
                  class="fe-chip fe-chip--num"
                  [attr.aria-pressed]="numOf(row) === n"
                  [attr.aria-label]="(range() ? (row === 'from' ? 'From ' : 'To ') : '') + n"
                  [disabled]="disabled()"
                  (click)="pickNumber(row, n)"
                >
                  {{ n }}
                </button>
              }
              <button
                type="button"
                class="fe-chip"
                [attr.aria-pressed]="isOther(row)"
                [attr.aria-expanded]="padFor() === row"
                [attr.aria-label]="(range() ? (row === 'from' ? 'From: ' : 'To: ') : '') + 'other number'"
                [disabled]="disabled()"
                (click)="togglePad(row)"
              >
                {{ isOther(row) ? numOf(row) : 'Other' }}
              </button>
            </div>
            @if (padFor() === row && !disabled()) {
              <fe-numpad
                [label]="field().label"
                [text]="padText()"
                [decimals]="false"
                [maxLength]="4"
                (textChange)="typed(row, $event)"
                (done)="padFor.set(null)"
              />
            }
          </div>
        }
        <div class="fe-sub">
          <span class="fe-sub__lbl">Unit</span>
          <div class="fe-chips" role="radiogroup" aria-label="Unit">
            @for (u of units(); track u) {
              <button
                type="button"
                class="fe-chip"
                role="radio"
                [attr.aria-checked]="unit() === u"
                [disabled]="disabled()"
                (click)="pickUnit(u)"
              >
                <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
                {{ unitLabel(u) }}
              </button>
            }
          </div>
        </div>
        @if (preview()) {
          <p class="fe-dur__says" aria-live="polite">{{ preview() }}</p>
        }
      </div>
    }
  `,
})
export class DurationFill extends KindFill {
  protected readonly numbers = DURATION_NUMBERS;
  protected readonly periods = PERIODS;

  protected readonly scale = computed(() => (this.config()['scale'] as string) ?? 'calendar');
  /** Legacy layout (number box + unit dropdown) unless the form asks for the touch chips (`display: 'chips'`). */
  protected readonly box = computed(() => this.config()['display'] !== 'chips');
  protected readonly numberText = numberText;
  protected readonly unitOptions = computed<PfSelectOption<string>[]>(() =>
    this.units().map((u) => ({ value: u, label: this.unitLabel(u) })),
  );
  protected readonly range = computed(() => this.config()['mode'] === 'range');
  protected readonly rows = computed<Which[]>(() => (this.range() ? ['from', 'to'] : ['from']));
  protected readonly units = computed(() => {
    if (this.scale() === 'clock') {
      return this.config()['defaultUnit'] === 'seconds' ? ['seconds', 'minutes', 'hours'] : ['minutes', 'hours'];
    }
    return ['days', 'weeks', 'months', 'years'];
  });

  private readonly obj = computed(() => {
    const v = this.value();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  });
  protected readonly period = computed(() => (typeof this.value() === 'string' ? (this.value() as string) : null));
  private readonly amount = computed(() => {
    const o = this.obj();
    const n = o ? (o['amount'] ?? o['value']) : null;
    return typeof n === 'number' ? n : null;
  });
  private readonly to = computed(() => {
    const n = this.obj()?.['valueTo'];
    return typeof n === 'number' ? n : null;
  });
  /** A unit picked before any number is held here until a number is tapped. */
  private readonly pendingUnit = signal<string | null>(null);
  protected readonly unit = computed(() => {
    const stored = pluralUnit(this.obj()?.['unit']);
    if (stored && this.amount() !== null) return stored;
    const def = pluralUnit(this.config()['defaultUnit']);
    const fallback = def && this.units().includes(def) ? def : this.units()[0];
    return this.pendingUnit() ?? stored ?? fallback;
  });
  protected readonly preview = computed(() => durationText(this.amount(), this.to(), this.unit()));

  protected readonly padFor = signal<Which | null>(null);
  private readonly padTyping = signal<string | null>(null);
  protected readonly padText = computed(() => this.padTyping() ?? numberText(this.numOf(this.padFor() ?? 'from')));

  protected numOf(row: Which): number | null {
    return row === 'from' ? this.amount() : this.to();
  }

  protected isOther(row: Which): boolean {
    const n = this.numOf(row);
    return n !== null && !DURATION_NUMBERS.includes(n);
  }

  protected unitLabel(u: string): string {
    return UNIT_LABEL[u] ?? u;
  }

  protected pickNumber(row: Which, n: number): void {
    const current = this.numOf(row);
    this.write(row, current === n ? null : n);
  }

  protected togglePad(row: Which): void {
    this.padTyping.set(null);
    this.padFor.set(this.padFor() === row ? null : row);
  }

  protected typed(row: Which, text: string): void {
    this.padTyping.set(text);
    this.write(row, parseNumber(text));
  }

  protected pickUnit(u: string): void {
    this.pendingUnit.set(u);
    if (this.amount() !== null) this.write('from', this.amount(), u);
  }

  private write(row: Which, n: number | null, unit = this.unit()): void {
    let amount = this.amount();
    let to = this.to();
    if (row === 'from') amount = n;
    else to = n;
    if (amount === null) {
      // nothing to say without a number ("for — days")
      this.emit(undefined);
      return;
    }
    const v: Record<string, unknown> = { amount, unit };
    if (this.range() && to !== null) v['valueTo'] = to;
    this.emit(v);
  }
}
