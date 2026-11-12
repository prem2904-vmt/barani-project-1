import { ChangeDetectionStrategy, Component, ElementRef, computed, signal, viewChild } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill, injectLegacy } from '../../fill/contract';
import { NumpadComponent, numberText, parseNumber, stepValue } from '../../fill/numpad.component';

/** Snap a raw slider position to the step, within min / max. */
export function snap(raw: number, min: number, max: number, step: number): number {
  const s = step > 0 ? step : 1;
  const v = min + Math.round((raw - min) / s) * s;
  const dec = (String(s).split('.')[1] ?? '').length;
  return Math.min(max, Math.max(min, Number(v.toFixed(Math.min(dec, 6)))));
}

/**
 * measure: one reading with a unit. A big stepper (− value +), a slider
 * drawn with pointer events (not a native range input; 48px track and
 * thumb, keyboard arrows, a value bubble) and the in-app number pad behind
 * the value. Value {value, unit}. The slider carries data-no-swipe so the
 * page swipe never fires while dragging it.
 */
@Component({
  selector: 'fe-measure-fill',
  standalone: true,
  imports: [NumpadComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (legacy()) {
      <!-- legacy measure-input: ONE card row, the question on the left; slider, number box and unit on the right -->
      <div class="fe-measure fe-measure--legacy" role="group" [attr.aria-labelledby]="labelId()">
        <span class="fe-measure__q">{{ field().label }}@if (field().required) {<span class="fe-field__req" aria-hidden="true"></span>}</span>
        <span class="fe-measure__ctl">
          <input
            type="range"
            class="fe-measure__range"
            data-no-swipe
            [attr.min]="min()"
            [attr.max]="max()"
            [attr.step]="stepBy()"
            [attr.aria-label]="field().label"
            [value]="num() ?? min()"
            [disabled]="disabled()"
            (input)="typeBox($any($event.target).value, false)"
          />
          <input
            type="number"
            class="fe-measure__num"
            [attr.min]="min()"
            [attr.max]="max()"
            [attr.step]="stepBy()"
            [attr.aria-label]="field().label + ' value'"
            [value]="num() ?? min()"
            [disabled]="disabled()"
            (input)="typeBox($any($event.target).value, true)"
          />
          @if (unit()) {
            <span class="fe-measure__unit">{{ unit() }}</span>
          }
        </span>
      </div>
    } @else {
    <div class="fe-measure" role="group" [attr.aria-labelledby]="labelId()">
      <div class="fe-stepper">
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
          [attr.aria-label]="field().label + ': ' + (text() || 'not set') + ' ' + unit() + '. Tap to type.'"
          [disabled]="disabled()"
          (click)="toggle()"
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
      <div
        #track
        class="fe-slider"
        data-no-swipe
        role="slider"
        [attr.tabindex]="disabled() ? -1 : 0"
        [attr.aria-label]="field().label"
        [attr.aria-valuemin]="min()"
        [attr.aria-valuemax]="max()"
        [attr.aria-valuenow]="num()"
        [attr.aria-valuetext]="num() === null ? 'not set' : num() + ' ' + unit()"
        [attr.aria-disabled]="disabled()"
        [class.fe-slider--empty]="num() === null"
        [class.fe-slider--drag]="dragging()"
        (pointerdown)="down($event)"
        (pointermove)="move($event)"
        (pointerup)="up($event)"
        (pointercancel)="up($event)"
        (keydown)="key($event)"
      >
        <span class="fe-slider__rail" aria-hidden="true">
          <span class="fe-slider__fill" [style.width.%]="pct()"></span>
        </span>
        <span class="fe-slider__thumb" aria-hidden="true" [style.left.%]="pct()">
          @if (num() !== null) {
            <span class="fe-slider__bubble">{{ num() }}</span>
          }
        </span>
      </div>
      <div class="fe-slider__ends" aria-hidden="true">
        <span>{{ min() }} {{ unit() }}</span
        ><span>{{ max() }} {{ unit() }}</span>
      </div>
      @if (open() && !disabled()) {
        <fe-numpad
          [label]="field().label"
          [text]="text()"
          [decimals]="decimals()"
          (textChange)="type($event)"
          (done)="close()"
        />
      }
    </div>
    }
  `,
})
export class MeasureFill extends KindFill {
  protected readonly legacy = injectLegacy();
  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  protected readonly open = signal(false);
  protected readonly dragging = signal(false);
  private readonly typing = signal<string | null>(null);

  protected readonly min = computed(() => num(this.config()['min'], 0));
  protected readonly max = computed(() => Math.max(this.min() + 1, num(this.config()['max'], 200)));
  protected readonly stepBy = computed(() => num(this.config()['step'], 1) || 1);
  protected readonly decimals = computed(() => !Number.isInteger(this.stepBy()));
  protected readonly unit = computed(
    () => (this.config()['unit'] as string) ?? (this.value() as { unit?: string } | null)?.unit ?? '',
  );
  protected readonly num = computed(() => {
    const v = (this.value() as { value?: unknown } | null)?.value;
    return typeof v === 'number' ? v : null;
  });
  protected readonly text = computed(() => this.typing() ?? numberText(this.num()));
  protected readonly pct = computed(() => {
    const n = this.num();
    if (n === null) return 0;
    return Math.min(100, Math.max(0, ((n - this.min()) / (this.max() - this.min())) * 100));
  });
  protected readonly atMin = computed(() => this.num() !== null && this.num()! <= this.min());
  protected readonly atMax = computed(() => this.num() !== null && this.num()! >= this.max());

  protected toggle(): void {
    this.typing.set(null);
    this.open.set(!this.open());
  }

  protected close(): void {
    this.typing.set(null);
    this.open.set(false);
  }

  protected step(dir: 1 | -1): void {
    this.typing.set(null);
    this.write(stepValue(this.num(), dir * this.stepBy(), this.min(), this.max()));
  }

  /** Legacy slider / number box: the raw text of either one (an empty number box clears the answer). */
  protected typeBox(raw: string, clearable: boolean): void {
    const n = parseNumber(raw);
    this.write(n === null ? (clearable ? null : this.num()) : Math.min(this.max(), Math.max(this.min(), n)));
  }

  protected type(t: string): void {
    this.typing.set(t);
    this.write(parseNumber(t));
  }

  protected down(e: PointerEvent): void {
    if (this.disabled()) return;
    this.dragging.set(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    this.fromPointer(e);
  }

  protected move(e: PointerEvent): void {
    if (this.dragging()) this.fromPointer(e);
  }

  protected up(e: PointerEvent): void {
    if (!this.dragging()) return;
    this.dragging.set(false);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }

  protected key(e: KeyboardEvent): void {
    if (this.disabled()) return;
    const big = (this.max() - this.min()) / 10;
    const by: Record<string, () => number> = {
      ArrowRight: () => stepValue(this.num(), this.stepBy(), this.min(), this.max()),
      ArrowUp: () => stepValue(this.num(), this.stepBy(), this.min(), this.max()),
      ArrowLeft: () => stepValue(this.num(), -this.stepBy(), this.min(), this.max()),
      ArrowDown: () => stepValue(this.num(), -this.stepBy(), this.min(), this.max()),
      PageUp: () => snap((this.num() ?? this.min()) + big, this.min(), this.max(), this.stepBy()),
      PageDown: () => snap((this.num() ?? this.min()) - big, this.min(), this.max(), this.stepBy()),
      Home: () => this.min(),
      End: () => this.max(),
    };
    const f = by[e.key];
    if (!f) return;
    e.preventDefault();
    this.write(f());
  }

  /** Position along the track → value (exposed for specs: jsdom has no layout). */
  setFromFraction(fraction: number): void {
    const f = Math.min(1, Math.max(0, fraction));
    this.write(snap(this.min() + f * (this.max() - this.min()), this.min(), this.max(), this.stepBy()));
  }

  private fromPointer(e: PointerEvent): void {
    const el = this.track()?.nativeElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    this.setFromFraction((e.clientX - r.left) / r.width);
  }

  private write(n: number | null): void {
    this.emit(n === null ? undefined : { value: n, unit: this.unit() });
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
