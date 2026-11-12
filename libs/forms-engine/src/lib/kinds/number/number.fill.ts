import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill, injectLegacy } from '../../fill/contract';
import { NumpadComponent, numberText, parseNumber, stepValue } from '../../fill/numpad.component';

/**
 * number: by default the legacy plain box (the number keyboard), the unit after it. With
 * `display: 'stepper'`: − [ value unit ] + — the value box opens the in-app number pad inline (no system
 * keyboard); the steppers move by `step` within min / max.
 */
@Component({
  selector: 'fe-number-fill',
  standalone: true,
  imports: [NumpadComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (box()) {
      <!-- legacy number: a plain box (the phone's number keyboard), the unit after it -->
      <div class="fe-numline">
        <input
          class="fe-text__input fe-numline__input"
          [attr.type]="legacy() ? 'number' : 'text'"
          [attr.step]="legacy() ? 'any' : null"
          [attr.inputmode]="decimals() ? 'decimal' : 'numeric'"
          autocomplete="off"
          [attr.aria-labelledby]="labelId()"
          [attr.aria-invalid]="outOfRange() ? 'true' : null"
          [placeholder]="field().placeholder || 'Enter ' + field().label.toLowerCase()"
          [value]="text()"
          [disabled]="disabled()"
          (input)="type($any($event.target).value)"
          (blur)="typing.set(null)"
        />
        @if (unit()) {
          <span class="fe-numline__u">{{ unit() }}</span>
        }
      </div>
    } @else {
    <div class="fe-stepper" role="group" [attr.aria-labelledby]="labelId()">
      <button
        type="button"
        class="fe-stepper__btn pf-touch"
        [disabled]="disabled() || atMin()"
        [attr.aria-label]="'Less ' + field().label"
        (click)="step(-1)"
      >
        <pf-icon name="minus" [size]="22" />
      </button>
      <button
        type="button"
        class="fe-numbox pf-touch"
        [class.fe-numbox--empty]="!text()"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="
          field().label + ': ' + (text() || 'not set') + (unit() ? ' ' + unit() : '') + '. Tap to type.'
        "
        [disabled]="disabled()"
        (click)="open.set(!open())"
      >
        <span class="fe-numbox__v">{{ text() || 'Tap to enter' }}</span>
        @if (unit()) {
          <span class="fe-numbox__u">{{ unit() }}</span>
        }
      </button>
      <button
        type="button"
        class="fe-stepper__btn pf-touch"
        [disabled]="disabled() || atMax()"
        [attr.aria-label]="'More ' + field().label"
        (click)="step(1)"
      >
        <pf-icon name="plus" [size]="22" />
      </button>
    </div>
    }
    @if (outOfRange(); as msg) {
      <p class="fe-field__err">{{ msg }}</p>
    }
    @if (!box() && open() && !disabled()) {
      <fe-numpad
        [label]="field().label"
        [text]="text()"
        [decimals]="decimals()"
        (textChange)="type($event)"
        (done)="close()"
      />
    }
  `,
})
export class NumberFill extends KindFill {
  /** The old number box was `<input type=number>` (letters never land in it). */
  protected readonly legacy = injectLegacy();
  protected readonly open = signal(false);
  protected readonly unit = computed(() => (this.config()['unit'] as string) ?? '');
  private readonly min = computed(() => this.config()['min'] as number | undefined);
  private readonly max = computed(() => this.config()['max'] as number | undefined);
  private readonly stepBy = computed(() => (this.config()['step'] as number) || 1);
  protected readonly decimals = computed(() => !Number.isInteger(this.stepBy()));
  /** While typing, keep the raw text ('12.') so the pad never fights the doctor. */
  protected readonly typing = signal<string | null>(null);
  /** Legacy layout (a plain number box) unless the form asks for the − value + stepper (`display: 'stepper'`). */
  protected readonly box = computed(() => this.config()['display'] !== 'stepper');
  protected readonly text = computed(() => this.typing() ?? numberText(this.value()));
  private readonly num = computed(() => parseNumber(numberText(this.value())));
  protected readonly atMin = computed(
    () => this.min() !== undefined && this.num() !== null && this.num()! <= this.min()!,
  );
  protected readonly atMax = computed(
    () => this.max() !== undefined && this.num() !== null && this.num()! >= this.max()!,
  );
  protected readonly outOfRange = computed(() => {
    const n = this.num();
    if (n === null) return null;
    // the form's own words when it has them (legacy validation.errorMessage)
    const own = (this.config()['errorMessage'] as string) || '';
    if (this.min() !== undefined && n < this.min()!) return own || `The lowest is ${this.min()}.`;
    if (this.max() !== undefined && n > this.max()!) return own || `The highest is ${this.max()}.`;
    return null;
  });

  protected close(): void {
    this.open.set(false);
    this.typing.set(null);
  }

  protected step(dir: 1 | -1): void {
    this.typing.set(null);
    this.emit(stepValue(this.num(), dir * this.stepBy(), this.min(), this.max()));
  }

  protected type(t: string): void {
    this.typing.set(t);
    const n = parseNumber(t);
    this.emit(n === null ? undefined : n);
  }
}
