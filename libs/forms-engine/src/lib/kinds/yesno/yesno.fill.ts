import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill } from '../../fill/contract';

interface YnChoice {
  key: 'yes' | 'no' | 'na';
  label: string;
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
          <span class="fe-checkrow__box" aria-hidden="true">
            @if (isTrue()) {
              <pf-icon name="check" [size]="18" [stroke]="2.6" />
            }
          </span>
          <span>{{ field().label }}</span>
        </button>
      }
      @default {
        <div class="fe-yn" role="radiogroup" [attr.aria-labelledby]="labelId()">
          @for (c of choices(); track c.key) {
            <button
              type="button"
              class="fe-chip"
              role="radio"
              [attr.aria-checked]="current() === c.key"
              [attr.data-option]="c.key"
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
  protected readonly display = computed(() => (this.config()['display'] as string) ?? 'buttons');
  private optionLabel(key: string, fallback: string): string {
    return this.field().options?.find((o) => o.key.toLowerCase() === key)?.label || fallback;
  }
  protected readonly yesLabel = computed(() => this.optionLabel('yes', 'Yes'));
  protected readonly noLabel = computed(() => this.optionLabel('no', 'No'));
  protected readonly choices = computed<YnChoice[]>(() => {
    const out: YnChoice[] = [
      { key: 'yes', label: this.yesLabel() },
      { key: 'no', label: this.noLabel() },
    ];
    if (this.config()['allowNa'] === true) out.push({ key: 'na', label: this.optionLabel('na', 'Not applicable') });
    return out;
  });
  /** 'yes' | 'no' | 'na' | null, whatever was stored (booleans from a tick box read as yes / no). */
  protected readonly current = computed(() => {
    const v = this.value();
    if (v === true) return 'yes';
    if (v === false) return 'no';
    return typeof v === 'string' ? v.toLowerCase() : null;
  });
  protected readonly isTrue = computed(() => this.current() === 'yes');

  protected pick(key: YnChoice['key']): void {
    this.emit(this.current() === key ? undefined : key);
  }

  protected flip(): void {
    this.emit(!this.isTrue());
  }
}
