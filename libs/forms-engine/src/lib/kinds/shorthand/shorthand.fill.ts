import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { KindFill } from '../../fill/contract';
import { NumpadComponent, numberText, parseNumber, stepValue } from '../../fill/numpad.component';
import { FieldDef } from '../../core/types';
import { DateFill } from '../date/date.fill';
import {
  OBSTETRIC_WARNING_WORDS,
  ShorthandPreset,
  ShorthandValue,
  VA_DISTANCE,
  VA_NEAR,
  nearestQuarter,
  shorthandNumber,
  obstetricWarnings,
  presetOf,
  writeShorthand,
} from './shorthand-math';

/**
 * One small number box of a shorthand: label, − value +, and the in-app number pad behind the value (no keyboard).
 * `signed` adds + / − chips (the iOS number pad has no minus key); `quarter` means the value moves in 0.25 steps,
 * typed numbers are only written once they sit on a step and are rounded to the nearest one on Done.
 */
@Component({
  selector: 'fe-sh-num',
  standalone: true,
  imports: [NumpadComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .fe-shnum__line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .fe-shnum__sign {
        display: inline-flex;
        gap: 6px;
      }
      .fe-shnum__sign .fe-chip {
        padding: 8px 0;
        font-size: 18px;
        font-weight: 600;
      }
      .fe-shnum__cap {
        font-weight: 400;
        color: var(--text-tertiary);
      }
      .fe-shnum .fe-numbox {
        min-width: 88px;
      }
    `,
  ],
  template: `
    <div class="fe-sub fe-shnum" [attr.data-box]="box()">
      <span class="fe-sub__lbl"
        >{{ label() }}@if (caption()) {
          <span class="fe-shnum__cap"> {{ caption() }}</span>
        }</span
      >
      <div class="fe-shnum__line">
        @if (signed()) {
          <div class="fe-shnum__sign" role="radiogroup" [attr.aria-label]="'Sign of ' + label()">
            <button
              type="button"
              class="fe-chip"
              role="radio"
              [attr.aria-checked]="sign() === 1"
              [attr.aria-label]="'Plus, ' + label()"
              [disabled]="disabled()"
              (click)="setSign(1)"
            >
              +
            </button>
            <button
              type="button"
              class="fe-chip"
              role="radio"
              [attr.aria-checked]="sign() === -1"
              [attr.aria-label]="'Minus, ' + label()"
              [disabled]="disabled()"
              (click)="setSign(-1)"
            >
              −
            </button>
          </div>
        }
        <div class="fe-stepper">
          <button
            type="button"
            class="fe-stepper__btn pf-touch"
            [attr.aria-label]="'Less ' + label()"
            [disabled]="disabled() || (value() !== null && value()! <= min())"
            (click)="step(-1)"
          >
            <pf-icon name="minus" [size]="20" />
          </button>
          <button
            type="button"
            class="fe-numbox pf-touch"
            [class.fe-numbox--empty]="shown() === ''"
            [attr.aria-expanded]="open()"
            [attr.aria-label]="label() + ': ' + (shown() || 'not set') + '. Tap to type.'"
            [disabled]="disabled()"
            (click)="toggle()"
          >
            <span class="fe-numbox__v">{{ shown() || '–' }}</span>
          </button>
          <button
            type="button"
            class="fe-stepper__btn pf-touch"
            [attr.aria-label]="'More ' + label()"
            [disabled]="disabled() || (value() !== null && value()! >= max())"
            (click)="step(1)"
          >
            <pf-icon name="plus" [size]="20" />
          </button>
        </div>
      </div>
      @if (open() && !disabled()) {
        <fe-numpad
          [label]="label()"
          [text]="typing() ?? magnitudeText()"
          [decimals]="decimals()"
          [maxLength]="6"
          (textChange)="type($event)"
          (done)="finish()"
        />
      }
    </div>
  `,
})
export class ShNumberComponent {
  readonly box = input.required<string>();
  readonly label = input.required<string>();
  readonly caption = input<string>('');
  readonly value = input<number | null>(null);
  readonly disabled = input<boolean>(false);
  readonly min = input<number>(0);
  readonly max = input<number>(100);
  readonly stepBy = input<number>(1);
  /** What the first tap on − or + writes (a typical value). Default: the lowest value. */
  readonly start = input<number | null>(null);
  readonly signed = input<boolean>(false);
  readonly decimals = input<boolean>(false);
  /** Always two decimals (glasses power): +1.25. */
  readonly fixed = input<boolean>(false);
  /** The sign a signed box takes before it has a value. */
  readonly defaultSign = input<number>(1);
  readonly valueChange = output<number | null>();

  protected readonly open = signal(false);
  protected readonly typing = signal<string | null>(null);
  private readonly pending = signal<number | null>(null);

  protected readonly sign = computed<number>(() => {
    const v = this.value();
    if (v !== null && v < 0) return -1;
    if (v !== null && v > 0) return 1;
    return this.pending() ?? this.defaultSign();
  });

  protected readonly shown = computed(() => {
    const v = this.value();
    if (v === null) return '';
    if (this.fixed()) return (v > 0 ? '+' : '') + v.toFixed(2);
    return numberText(v);
  });

  protected readonly magnitudeText = computed(() => {
    const v = this.value();
    return v === null ? '' : numberText(Math.abs(v));
  });

  protected toggle(): void {
    this.typing.set(null);
    this.open.update((o) => !o);
  }

  protected step(dir: 1 | -1): void {
    this.typing.set(null);
    const v = this.value();
    if (v === null) {
      const s = this.start() ?? this.min();
      this.valueChange.emit(Math.min(this.max(), Math.max(this.min(), s)));
      return;
    }
    this.valueChange.emit(stepValue(v, dir * this.stepBy(), this.min(), this.max()));
  }

  protected setSign(s: number): void {
    this.pending.set(s);
    const v = this.value();
    if (v !== null && v !== 0) this.valueChange.emit(s * Math.abs(v));
  }

  protected type(t: string): void {
    this.typing.set(t);
    const m = parseNumber(t);
    if (m === null) {
      this.valueChange.emit(null);
      return;
    }
    const v = this.signed() ? this.sign() * m : m;
    if (this.accepts(v)) this.valueChange.emit(v);
  }

  /** Done on the pad: a typed number is rounded to the box's step and kept inside its range. */
  protected finish(): void {
    const t = this.typing();
    this.typing.set(null);
    this.open.set(false);
    if (t === null) return;
    const m = parseNumber(t);
    if (m === null) return;
    const raw = this.signed() ? this.sign() * m : m;
    const snapped = this.stepBy() === 0.25 ? nearestQuarter(raw) : Math.round(raw);
    this.valueChange.emit(Math.min(this.max(), Math.max(this.min(), snapped)));
  }

  private accepts(v: number): boolean {
    if (v < this.min() || v > this.max()) return false;
    return this.stepBy() === 0.25 ? Math.abs(v * 4 - Math.round(v * 4)) < 1e-9 : Number.isInteger(v);
  }
}

/** A row of chips that picks one word (tap the chosen one again to clear it). */
@Component({
  selector: 'fe-sh-chips',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-sub" [attr.data-box]="box()">
      <span class="fe-sub__lbl">{{ label() }}</span>
      <div class="fe-chips" role="radiogroup" [attr.aria-label]="label()">
        @for (o of options(); track o.value) {
          <button
            type="button"
            class="fe-chip"
            role="radio"
            [attr.aria-checked]="o.value === value()"
            [attr.data-option]="o.value"
            [attr.aria-label]="o.aria ?? null"
            [disabled]="disabled() || !!o.off"
            (click)="valueChange.emit(o.value === value() ? null : o.value)"
          >
            <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
            {{ o.label }}
          </button>
        }
      </div>
    </div>
  `,
})
export class ShChipsComponent {
  readonly box = input.required<string>();
  readonly label = input.required<string>();
  readonly options = input.required<{ value: string; label: string; aria?: string; off?: boolean }[]>();
  readonly value = input<string | null>(null);
  readonly disabled = input<boolean>(false);
  readonly valueChange = output<string | null>();
}

/**
 * shorthand: a few small boxes that write standard notation; the preset (config.preset) decides the boxes. Value is
 * one object per preset (see shorthand-math.ts); emptied boxes leave the object, an empty object is no answer.
 * What it will write is shown under the boxes, so the doctor sees the notation as it forms.
 */
@Component({
  selector: 'fe-shorthand-fill',
  standalone: true,
  imports: [ShNumberComponent, ShChipsComponent, SelectComponent, DateFill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .fe-sh {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .fe-sh__row {
        display: flex;
        flex-wrap: wrap;
        gap: 14px 22px;
      }
      .fe-sh__says {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 10px;
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px dashed var(--pf-line);
        background: color-mix(in srgb, var(--color-primary, #7c3aed) 4%, var(--pf-card-bg));
        font-size: 16px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--text-primary);
      }
      .fe-sh__k {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-tertiary);
      }
      .fe-sh__warn {
        margin: 0;
        font-size: 13px;
        line-height: 1.45;
        color: var(--amber-text, #b45309);
      }
      .fe-sh__grades {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 8px;
        max-width: 420px;
      }
      .fe-sh__grades .fe-chip {
        padding-inline: 0;
        font-size: 18px;
      }
      .fe-sh__pick {
        max-width: 260px;
      }
    `,
  ],
  template: `
    <div class="fe-sh" role="group" [attr.aria-labelledby]="labelId()" [attr.data-preset]="preset()">
      @switch (preset()) {
        @case ('obstetricScore') {
          <div class="fe-sh__row">
            @for (b of obstetricBoxes(); track b.key) {
              <fe-sh-num
                [box]="b.key"
                [label]="b.letter"
                [caption]="b.caption"
                [value]="n(b.key)"
                [min]="0"
                [max]="30"
                [stepBy]="1"
                [start]="0"
                [disabled]="disabled()"
                (valueChange)="setNum(b.key, $event)"
              />
            }
          </div>
          @for (w of warnings(); track w) {
            <p class="fe-sh__warn" role="note" [attr.data-warning]="w">{{ warningWords[w] }}</p>
          }
        }
        @case ('menstrual') {
          <div class="fe-sh__row">
            <fe-sh-num box="flowDays" label="Bleeding" caption="days" [value]="n('flowDays')" [min]="1" [max]="30" [start]="5" [disabled]="disabled()" (valueChange)="setNum('flowDays', $event)" />
            <fe-sh-num box="cycleDays" label="Cycle" caption="days" [value]="n('cycleDays')" [min]="1" [max]="365" [start]="28" [disabled]="disabled()" (valueChange)="setNum('cycleDays', $event)" />
          </div>
          <fe-sh-chips
            box="regularity"
            label="Cycle is"
            [options]="regularityOptions"
            [value]="s('regularity')"
            [disabled]="disabled()"
            (valueChange)="setText('regularity', $event)"
          />
          @if (lmp()) {
            <div class="fe-sub" data-box="lmp">
              <span class="fe-sub__lbl">Last menstrual period <span class="fe-field__note">(optional)</span></span>
              <fe-date-fill
                [field]="lmpField"
                [value]="s('lmp')"
                [disabled]="disabled()"
                [set]="setLmp"
                labelId=""
              />
            </div>
          }
        }
        @case ('visualAcuity') {
          <fe-sh-chips box="distance" label="Distance" [options]="distanceOptions" [value]="s('distance')" [disabled]="disabled()" (valueChange)="setText('distance', $event)" />
          @if (cfgOn('pinhole')) {
            <div class="fe-sub fe-sh__pick" data-box="pinhole">
              <span class="fe-sub__lbl">With pinhole</span>
              <pf-select
                [options]="pinholeOptions"
                [value]="s('pinhole') ?? ''"
                [disabled]="disabled()"
                placeholder="Not tested"
                (valueChange)="setText('pinhole', $event || null)"
              />
            </div>
          }
          @if (cfgOn('near')) {
            <fe-sh-chips box="near" label="Near" [options]="nearOptions" [value]="s('near')" [disabled]="disabled()" (valueChange)="setText('near', $event)" />
          }
          @if (cfgOn('glasses')) {
            <div class="fe-chips" data-box="glasses">
              <button
                type="button"
                class="fe-chip"
                role="switch"
                [attr.aria-checked]="glasses()"
                [disabled]="disabled()"
                (click)="setGlasses(!glasses())"
              >
                With glasses
              </button>
            </div>
          }
        }
        @case ('refraction') {
          <div class="fe-sh__row">
            <fe-sh-num box="sph" label="Sphere" caption="D" [value]="n('sph')" [min]="-20" [max]="20" [stepBy]="0.25" [start]="0" [signed]="true" [decimals]="true" [fixed]="true" [defaultSign]="-1" [disabled]="disabled()" (valueChange)="setNum('sph', $event)" />
            <fe-sh-num box="cyl" label="Cylinder" caption="D" [value]="n('cyl')" [min]="-10" [max]="10" [stepBy]="0.25" [start]="0" [signed]="true" [decimals]="true" [fixed]="true" [defaultSign]="-1" [disabled]="disabled()" (valueChange)="setNum('cyl', $event)" />
            <fe-sh-num box="axis" label="Axis" caption="0 to 180" [value]="n('axis')" [min]="0" [max]="180" [start]="90" [disabled]="disabled()" (valueChange)="setNum('axis', $event)" />
            @if (cfgOn('add')) {
              <fe-sh-num box="add" label="Add" caption="reading, D" [value]="n('add')" [min]="0" [max]="4" [stepBy]="0.25" [start]="1" [decimals]="true" [fixed]="true" [disabled]="disabled()" (valueChange)="setNum('add', $event)" />
            }
          </div>
        }
        @case ('musclePower') {
          <div class="fe-sub" data-box="grade">
            <span class="fe-sub__lbl">Power <span class="fe-field__note">(0 none, 5 normal)</span></span>
            <div class="fe-sh__grades" role="radiogroup" aria-label="Power">
              @for (g of grades; track g) {
                <button type="button" class="fe-chip" role="radio" [attr.aria-checked]="n('grade') === g" [attr.data-option]="g" [disabled]="disabled()" (click)="setGrade(g)">
                  {{ g }}
                </button>
              }
            </div>
          </div>
          <fe-sh-chips
            box="sign"
            label="A little less or more"
            [options]="signOptions()"
            [value]="s('sign')"
            [disabled]="disabled()"
            (valueChange)="setText('sign', $event)"
          />
        }
      }
      @if (words()) {
        <p class="fe-sh__says" aria-live="polite" data-says><span class="fe-sh__k">Writes</span><span>{{ words() }}</span></p>
      }
    </div>
  `,
})
export class ShorthandFill extends KindFill {
  protected readonly warningWords = OBSTETRIC_WARNING_WORDS;
  protected readonly grades = [0, 1, 2, 3, 4, 5];
  protected readonly regularityOptions = [
    { value: 'regular', label: 'Regular' },
    { value: 'irregular', label: 'Irregular' },
  ];
  protected readonly distanceOptions = VA_DISTANCE.map((d) => ({ value: d, label: d }));
  protected readonly nearOptions = VA_NEAR.map((d) => ({ value: d, label: d }));
  protected readonly pinholeOptions: PfSelectOption<string>[] = [{ value: '', label: 'Not tested' }, ...VA_DISTANCE.map((d) => ({ value: d, label: d }))];
  protected readonly lmpField: FieldDef = { key: 'lmp', kind: 'date', label: 'Last menstrual period', config: { purpose: 'event' } };

  protected readonly preset = computed<ShorthandPreset>(() => presetOf(this.config()));
  protected readonly lmp = computed(() => this.config()['lmp'] !== false);
  protected readonly obstetricBoxes = computed(() => [
    { key: 'g', letter: 'G', caption: 'pregnancies' },
    { key: 'p', letter: 'P', caption: 'births' },
    { key: 'l', letter: 'L', caption: 'living' },
    { key: 'a', letter: 'A', caption: 'abortions' },
    ...(this.config()['deaths'] === true ? [{ key: 'd', letter: 'D', caption: 'deaths' }] : []),
  ]);

  protected readonly obj = computed<ShorthandValue>(() => {
    const v = this.value();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as ShorthandValue) : {};
  });
  protected readonly words = computed(() => writeShorthand(this.preset(), this.obj(), this.lmp()));
  protected readonly warnings = computed(() => (this.preset() === 'obstetricScore' ? obstetricWarnings(this.obj()) : []));
  protected readonly glasses = computed(() => this.obj()['glasses'] === true);
  protected readonly signOptions = computed(() => {
    const g = shorthandNumber(this.obj()['grade']);
    return [
      { value: '-', label: '−', aria: 'Minus, a little less', off: g === null || g === 0 },
      { value: '+', label: '+', aria: 'Plus, a little more', off: g === null || g === 0 || g === 5 },
    ];
  });

  protected n(key: string): number | null {
    return shorthandNumber(this.obj()[key]);
  }
  protected s(key: string): string | null {
    const v = this.obj()[key];
    return typeof v === 'string' && v !== '' ? v : null;
  }
  protected cfgOn(name: string): boolean {
    return this.config()[name] !== false;
  }

  protected setNum(key: string, v: number | null): void {
    this.write({ [key]: v === null ? undefined : v });
  }

  protected setText(key: string, v: string | null): void {
    this.write({ [key]: v === null || v === '' ? undefined : v });
  }

  protected setGlasses(on: boolean): void {
    this.write({ glasses: on ? true : undefined });
  }

  protected readonly setLmp = (v: unknown): void => this.write({ lmp: typeof v === 'string' && v ? v : undefined });

  protected setGrade(g: number): void {
    const again = this.n('grade') === g;
    const sign = this.s('sign');
    // a grade that cannot carry the sign drops it (0 has none, 5 has no plus)
    const keep = !again && g !== 0 && !(g === 5 && sign === '+') ? sign : null;
    this.write({ grade: again ? undefined : g, sign: keep ?? undefined });
  }

  /** Merge changes into the answer; `undefined` removes a box; nothing left = no answer. */
  private write(change: ShorthandValue): void {
    const next: ShorthandValue = { ...this.obj() };
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    if (this.preset() === 'musclePower' && next['grade'] === undefined) delete next['sign'];
    this.emit(Object.keys(next).length ? next : undefined);
  }
}
