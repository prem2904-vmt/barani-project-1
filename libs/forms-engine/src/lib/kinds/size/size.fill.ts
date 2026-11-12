import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { KindFill, injectLegacy } from '../../fill/contract';
import { NumpadComponent, numberText, parseNumber } from '../../fill/numpad.component';

export const SIZE_UNITS = ['cm', 'mm', 'inch', 'feet', 'meter'];
const UNIT_LABEL: Record<string, string> = { cm: 'cm', mm: 'mm', inch: 'inch', feet: 'feet', meter: 'metre' };

/** What each box is called (screen readers and the pad's label). */
export function boxName(i: number, count: number): string {
  if (count <= 3) return ['Length', 'Width', 'Depth'][i];
  return `Size ${i + 1}`;
}

/**
 * size: up to five value boxes ("2 × 3 cm"), each opening the in-app
 * number pad for THAT box, and unit chips. Value {dimensions:[…], unit};
 * nothing filled → no value.
 */
@Component({
  selector: 'fe-size-fill',
  standalone: true,
  imports: [NumpadComponent, PfIconComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (legacy()) {
      <!-- legacy size-input: ONE card row; the question left; boxes x boxes and the unit dropdown right -->
      <div class="fe-measure--legacy fe-size--legacy" role="group" [attr.aria-labelledby]="labelId()">
        <span class="fe-measure__q">{{ field().label }}@if (field().required) {<span class="fe-field__req" aria-hidden="true"></span>}</span>
        <span class="fe-measure__ctl">
          @for (i of boxes(); track i) {
            @if (i > 0) {
              <span class="fe-size__x" aria-hidden="true">×</span>
            }
            <input
              type="number"
              step="0.01"
              class="fe-measure__num fe-size__in"
              [attr.aria-label]="name(i)"
              [value]="textOf(i)"
              [disabled]="disabled()"
              (input)="typeBox(i, $any($event.target).value)"
            />
          }
          <pf-select
            class="fe-size__unitsel"
            [options]="unitOptions"
            [value]="unit()"
            [disabled]="disabled()"
            (valueChange)="pickUnit($event ?? 'cm')"
          />
        </span>
      </div>
    } @else {
    <div class="fe-size" role="group" [attr.aria-labelledby]="labelId()">
      <div class="fe-size__boxes">
        @for (i of boxes(); track i) {
          @if (i > 0) {
            <span class="fe-size__x" aria-hidden="true">×</span>
          }
          <button
            type="button"
            class="fe-numbox pf-touch"
            [class.fe-numbox--empty]="!textOf(i)"
            [attr.aria-expanded]="open() === i"
            [attr.aria-label]="name(i) + ': ' + (textOf(i) || 'not set') + ' ' + unit() + '. Tap to type.'"
            [disabled]="disabled()"
            (click)="toggle(i)"
          >
            <span class="fe-numbox__v">{{ textOf(i) || 'Tap to enter' }}</span>
          </button>
        }
        <span class="fe-size__unit">{{ unitLabel(unit()) }}</span>
      </div>
      @if (open() !== null && !disabled()) {
        <fe-numpad
          [label]="name(open()!)"
          [text]="textOf(open()!)"
          [decimals]="true"
          [maxLength]="6"
          (textChange)="type(open()!, $event)"
          (done)="close()"
        />
      }
      <div class="fe-chips" role="radiogroup" aria-label="Unit">
        @for (u of units; track u) {
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
    }
  `,
})
export class SizeFill extends KindFill {
  protected readonly legacy = injectLegacy();
  /** The old unit list, as written there (cm, mm, inch, feet, meter). */
  protected readonly unitOptions: PfSelectOption<string>[] = SIZE_UNITS.map((u) => ({ value: u, label: u }));
  protected readonly units = SIZE_UNITS;
  protected readonly open = signal<number | null>(null);
  private readonly typing = signal<string | null>(null);
  private readonly pendingUnit = signal<string | null>(null);

  protected readonly count = computed(() => {
    const n = Number(this.config()['boxCount'] ?? 2);
    return Math.min(5, Math.max(1, Number.isFinite(n) ? Math.round(n) : 2));
  });
  protected readonly boxes = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  private readonly dims = computed<(number | null)[]>(() => {
    const d = (this.value() as { dimensions?: unknown[] } | null)?.dimensions;
    return Array.from({ length: this.count() }, (_, i) => (typeof d?.[i] === 'number' ? (d[i] as number) : null));
  });
  protected readonly unit = computed(() => {
    const stored = (this.value() as { unit?: string } | null)?.unit;
    return this.pendingUnit() ?? stored ?? (this.config()['defaultUnit'] as string) ?? 'cm';
  });

  protected name(i: number): string {
    return boxName(i, this.count());
  }

  protected unitLabel(u: string): string {
    return UNIT_LABEL[u] ?? u;
  }

  protected textOf(i: number): string {
    if (this.open() === i && this.typing() !== null) return this.typing()!;
    return numberText(this.dims()[i]);
  }

  protected toggle(i: number): void {
    this.typing.set(null);
    this.open.set(this.open() === i ? null : i);
  }

  protected close(): void {
    this.typing.set(null);
    this.open.set(null);
  }

  /** Legacy number box: the raw text; an empty box leaves that dimension unset. */
  protected typeBox(i: number, raw: string): void {
    const d = [...this.dims()];
    d[i] = parseNumber(raw);
    this.write(d, this.unit());
  }

  protected type(i: number, t: string): void {
    this.typing.set(t);
    const d = [...this.dims()];
    d[i] = parseNumber(t);
    this.write(d, this.unit());
  }

  protected pickUnit(u: string): void {
    this.pendingUnit.set(u);
    if (this.dims().some((x) => x !== null)) this.write(this.dims(), u);
  }

  private write(d: (number | null)[], unit: string): void {
    this.emit(d.some((x) => x !== null) ? { dimensions: d, unit } : undefined);
  }
}
