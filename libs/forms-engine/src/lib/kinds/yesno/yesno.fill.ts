import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill } from '../../fill/contract';

interface YnChoice {
  /** The stored value: the option's own key ('yes' / 'no' / 'na' keep their canonical lower-case spelling). */
  key: string;
  label: string;
  /** Selected colour: legacy yesNoNa paints Yes green and No red; any other word uses the primary. */
  tone: 'yes' | 'no' | 'other';
}

/**
 * yesno: two (or three, with Not applicable) big buttons — one tap answers
 * and the page can move on. `switch` is a 48px switch row, `check` a tick
 * box; both store true / false (the sentence comes from says.whenTrue /
 * whenFalse). Tapping the chosen button again clears it.
 */
@Component({
  selector: 'fe-yesno-fill',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (display()) {
      @case ('switch') {
        <button
          type="button"
          class="fe-chip fe-switchrow"
          role="switch"
          [attr.aria-checked]="isTrue()"
          [attr.aria-labelledby]="labelId()"
          [disabled]="disabled()"
          (click)="flip()"
        >
          <span class="fe-switchrow__txt">{{ isTrue() ? yesLabel() : noLabel() }}</span>
          <span class="pf-toggle__track fe-switch" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
        </button>
      }
      @case ('check') {
        <button
          type="button"
          class="fe-chip fe-checkrow"
          role="checkbox"
          [attr.aria-checked]="isTrue()"
          [attr.aria-labelledby]="labelId()"
          [disabled]="disabled()"
          (click)="flip()"
        >
          <!-- legacy checkbox: ONE small switch with the question beside it (never option cards) -->
          <span class="pf-toggle__track fe-switch fe-switch--sm" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          <span>{{ field().label }}@if (field().required) {<span class="fe-field__req" aria-hidden="true"></span>}</span>
        </button>
      }
      @case ('slider') {
        <!-- legacy toggle-switch: a three-position slider, option A · — · option B (the dash clears the answer) -->
        <div
          class="fe-tslider"
          role="radiogroup"
          [attr.aria-labelledby]="labelId()"
          [class.fe-tslider--left]="current() === sliderA().key.toLowerCase()"
          [class.fe-tslider--right]="current() === sliderB().key.toLowerCase()"
          [class.fe-tslider--center]="current() !== sliderA().key.toLowerCase() && current() !== sliderB().key.toLowerCase()"
        >
          <span class="fe-tslider__pill" aria-hidden="true"></span>
          <button type="button" class="fe-tslider__opt" role="radio" [attr.aria-checked]="current() === sliderA().key.toLowerCase()" [attr.data-option]="sliderA().key" [disabled]="disabled()" (click)="emit(sliderA().key)">{{ sliderA().label }}</button>
          <button type="button" class="fe-tslider__opt fe-tslider__none" role="radio" [attr.aria-checked]="current() === null" aria-label="No answer" data-option="" [disabled]="disabled()" (click)="emit(undefined)">—</button>
          <button type="button" class="fe-tslider__opt" role="radio" [attr.aria-checked]="current() === sliderB().key.toLowerCase()" [attr.data-option]="sliderB().key" [disabled]="disabled()" (click)="emit(sliderB().key)">{{ sliderB().label }}</button>
        </div>
      }
      @default {
        <div class="fe-yn" role="radiogroup" [attr.aria-labelledby]="labelId()">
          @for (c of choices(); track c.key) {
            <button
              type="button"
              class="fe-chip"
              role="radio"
              [attr.aria-checked]="current() === c.key.toLowerCase()"
              [attr.data-option]="c.key"
              [attr.data-tone]="c.tone"
              [disabled]="disabled()"
              (click)="pick(c.key)"
            >
              <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
              {{ c.label }}
            </button>
          }
        </div>
      }
    }
  `,
})
export class YesnoFill extends KindFill {
  private readonly rawDisplay = computed(() => (this.config()['display'] as string) ?? 'buttons');
  /** A legacy toggle ("Present / Absent", "Impaired / Normal"): an imported toggle (switch + labelFallback) with two worded options is the slider. */
  protected readonly display = computed(() =>
    this.rawDisplay() === 'switch' && this.config()['labelFallback'] === true && (this.field().options?.length ?? 0) === 2 ? 'slider' : this.rawDisplay(),
  );
  protected readonly sliderA = computed(() => this.field().options![0]);
  protected readonly sliderB = computed(() => this.field().options![1]);
  private optionLabel(key: string, fallback: string): string {
    return this.field().options?.find((o) => o.key.toLowerCase() === key)?.label || fallback;
  }
  protected readonly yesLabel = computed(() => this.optionLabel('yes', 'Yes'));
  protected readonly noLabel = computed(() => this.optionLabel('no', 'No'));
  protected readonly choices = computed<YnChoice[]>(() => {
    const tone = (k: string): YnChoice['tone'] => (k === 'yes' ? 'yes' : k === 'no' ? 'no' : 'other');
    const canon = (k: string) => (['yes', 'no', 'na'].includes(k.toLowerCase()) ? k.toLowerCase() : k);
    const own = this.field().options ?? [];
    // legacy yesNoNa shows the question's own options as they are written ("Taken / Not taken", "Yes / No")
    const out: YnChoice[] = own.length
      ? own.map((o) => ({ key: canon(o.key), label: o.label, tone: tone(o.key.toLowerCase()) }))
      : [
          { key: 'yes', label: this.yesLabel(), tone: 'yes' },
          { key: 'no', label: this.noLabel(), tone: 'no' },
        ];
    if (this.config()['allowNa'] === true && !out.some((c) => c.key.toLowerCase() === 'na'))
      out.push({ key: 'na', label: this.optionLabel('na', 'Not applicable'), tone: 'other' });
    return out;
  });
  /** 'yes' | 'no' | 'na' | null, whatever was stored (booleans from a tick box read as yes / no). */
  protected readonly current = computed(() => {
    const v = this.value();
    if (v === true) return 'yes';
    if (v === false) return 'no';
    return typeof v === 'string' && v ? v.toLowerCase() : null;
  });
  protected readonly isTrue = computed(() => this.current() === 'yes');

  protected pick(key: string): void {
    this.emit(this.current() === key.toLowerCase() ? undefined : key);
  }

  protected flip(): void {
    this.emit(!this.isTrue());
  }
}
