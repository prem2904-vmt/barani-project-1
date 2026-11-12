import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill, injectLegacy } from '../../fill/contract';
import { NumpadComponent, numberText, parseNumber } from '../../fill/numpad.component';

export const HEIGHT_UNITS = ['m', 'cm', 'ft', 'in'];
export const WEIGHT_UNITS = ['kg', 'lb', 'g'];
const TO_M: Record<string, number> = { m: 1, cm: 0.01, ft: 0.3048, in: 0.0254 };
const TO_KG: Record<string, number> = { kg: 1, lb: 0.45359237, g: 0.001 };

/** BMI = kg / m², one decimal; null until both are there and sensible. */
export function bmiOf(height: number | null, hUnit: string, weight: number | null, wUnit: string): number | null {
  if (height === null || weight === null || height <= 0 || weight <= 0) return null;
  const m = height * (TO_M[hUnit] ?? 1);
  const kg = weight * (TO_KG[wUnit] ?? 1);
  const b = kg / (m * m);
  return Number.isFinite(b) ? Math.round(b * 10) / 10 : null;
}

type Part = 'height' | 'weight';

interface BmiVal {
  height: number | null;
  heightUnit: string;
  weight: number | null;
  weightUnit: string;
}

/**
 * bmi: height and weight on the in-app number pad, each with its unit
 * chips; the BMI is worked out live (kg / m²) and shown read-only once both
 * are there. Value {height, heightUnit, weight, weightUnit}.
 */
@Component({
  selector: 'fe-bmi-fill',
  standalone: true,
  imports: [NumpadComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (legacy()) {
      <!-- legacy bmi-input: Height, Weight and the worked-out BMI on ONE row, plain number boxes with the unit beside them -->
      <div class="fe-bmi fe-bmi--legacy" role="group" [attr.aria-labelledby]="labelId()">
        @for (p of parts; track p) {
          <div class="fe-sub">
            <span class="fe-sub__lbl">{{ label(p) }}</span>
            <div class="fe-bmi__box">
              <input
                class="fe-bmi__in"
                type="number"
                min="0"
                step="any"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0"
                [attr.data-part]="p"
                [attr.aria-label]="label(p) + ' in ' + unitOf(p)"
                [value]="textOf(p)"
                [disabled]="disabled()"
                (input)="typeBox(p, $any($event.target))"
              />
              <span class="fe-bmi__unit">{{ unitOf(p) }}</span>
            </div>
          </div>
        }
        <div class="fe-sub">
          <span class="fe-sub__lbl">{{ labels().bmi }}</span>
          <div class="fe-bmi__result-box" [class.fe-bmi__result-box--on]="bmi() !== null" aria-live="polite">
            <span class="fe-bmi__figure">{{ bmi() !== null ? bmi() : '—' }}</span>
            @if (bmi() !== null) {
              <span class="fe-bmi__ru">kg/m²</span>
              @if (category(); as c) {
                <span class="fe-bmi__cat" [attr.data-category]="c">{{ c }}</span>
              }
            }
          </div>
        </div>
      </div>
    } @else {
    <div class="fe-bmi" role="group" [attr.aria-labelledby]="labelId()">
      @for (p of parts; track p) {
        <div class="fe-sub">
          <span class="fe-sub__lbl">{{ label(p) }}</span>
          <div class="fe-bmi__row">
            <button
              type="button"
              class="fe-numbox pf-touch"
              [class.fe-numbox--empty]="!textOf(p)"
              [attr.aria-expanded]="open() === p"
              [attr.aria-label]="label(p) + ': ' + (textOf(p) || 'not set') + ' ' + unitOf(p) + '. Tap to type.'"
              [disabled]="disabled()"
              (click)="toggle(p)"
            >
              <span class="fe-numbox__v">{{ textOf(p) || 'Tap to enter' }}</span>
              <span class="fe-numbox__u">{{ unitOf(p) }}</span>
            </button>
            <div class="fe-chips" role="radiogroup" [attr.aria-label]="label(p) + ' unit'">
              @for (u of unitsOf(p); track u) {
                <button
                  type="button"
                  class="fe-chip"
                  role="radio"
                  [attr.aria-checked]="unitOf(p) === u"
                  [disabled]="disabled()"
                  (click)="pickUnit(p, u)"
                >
                  <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
                  {{ u }}
                </button>
              }
            </div>
          </div>
          @if (open() === p && !disabled()) {
            <fe-numpad
              [label]="label(p)"
              [text]="textOf(p)"
              [decimals]="true"
              [maxLength]="6"
              (textChange)="type(p, $event)"
              (done)="close()"
            />
          }
        </div>
      }
      @if (bmi() !== null) {
        <p class="fe-bmi__result" aria-live="polite">
          <span class="fe-sub__lbl">{{ labels().bmi }}</span>
          <span class="fe-bmi__figure">{{ bmi() }}</span>
          @if (category(); as c) {
            <span class="fe-bmi__cat" [attr.data-category]="c">{{ c }}</span>
          }
        </p>
      }
    </div>
    }
  `,
})
export class BmiFill extends KindFill {
  protected readonly legacy = injectLegacy();
  protected readonly parts: Part[] = ['height', 'weight'];
  protected readonly open = signal<Part | null>(null);
  private readonly typing = signal<string | null>(null);
  private readonly pending = signal<Partial<BmiVal>>({});

  protected readonly labels = computed(() => {
    const l = (this.config()['labels'] as Record<string, string> | undefined) ?? {};
    return { height: l['height'] || 'Height', weight: l['weight'] || 'Weight', bmi: l['bmi'] || 'BMI' };
  });

  protected readonly val = computed<BmiVal>(() => {
    const v = (this.value() as Partial<BmiVal> | null) ?? {};
    const p = this.pending();
    return {
      height: typeof v.height === 'number' ? v.height : null,
      weight: typeof v.weight === 'number' ? v.weight : null,
      heightUnit: p.heightUnit ?? v.heightUnit ?? (this.config()['heightUnit'] as string) ?? 'm',
      weightUnit: p.weightUnit ?? v.weightUnit ?? (this.config()['weightUnit'] as string) ?? 'kg',
    };
  });
  protected readonly bmi = computed(() => {
    const v = this.val();
    return bmiOf(v.height, v.heightUnit, v.weight, v.weightUnit);
  });

  /** Legacy bmi-input: the WHO band in words next to the figure. */
  protected readonly category = computed(() => bmiCategory(this.bmi()));

  protected label(p: Part): string {
    return this.labels()[p];
  }

  protected unitsOf(p: Part): string[] {
    return p === 'height' ? HEIGHT_UNITS : WEIGHT_UNITS;
  }

  protected unitOf(p: Part): string {
    return p === 'height' ? this.val().heightUnit : this.val().weightUnit;
  }

  protected textOf(p: Part): string {
    if (this.open() === p && this.typing() !== null) return this.typing()!;
    return numberText(this.val()[p]);
  }

  protected toggle(p: Part): void {
    this.typing.set(null);
    this.open.set(this.open() === p ? null : p);
  }

  protected close(): void {
    this.typing.set(null);
    this.open.set(null);
  }

  protected type(p: Part, t: string): void {
    this.typing.set(t);
    this.write({ ...this.val(), [p]: parseNumber(t) });
  }

  /** Legacy `<input type=number>`: only digits and one point stay. */
  protected typeBox(p: Part, input: HTMLInputElement): void {
    const clean = input.value.replace(/[^0-9.]/g, '').replace(/^(\d*\.\d*)\..*$/, '$1');
    if (input.type !== 'number' && clean !== input.value) input.value = clean;
    this.open.set(p);
    this.typing.set(clean);
    this.write({ ...this.val(), [p]: parseNumber(clean) });
  }

  protected pickUnit(p: Part, u: string): void {
    const key = p === 'height' ? 'heightUnit' : 'weightUnit';
    this.pending.update((x) => ({ ...x, [key]: u }));
    const next = { ...this.val(), [key]: u };
    if (next.height !== null || next.weight !== null) this.write(next);
  }

  private write(v: BmiVal): void {
    this.emit(v.height === null && v.weight === null ? undefined : v);
  }
}

/** BMI band in the legacy words (resident-fe bmi-input): < 18.5 Underweight, < 25 Normal, < 30 Overweight, else Obese. */
export function bmiCategory(bmi: number | string | null | undefined): string | null {
  const n = typeof bmi === 'string' ? Number(bmi) : bmi;
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return null;
  if (n < 18.5) return 'Underweight';
  if (n < 25) return 'Normal';
  if (n < 30) return 'Overweight';
  return 'Obese';
}
