import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { KindFill } from '../../fill/contract';
import { OptionCardsComponent } from '../../fill/option-cards.component';
import { optionLayout } from '../../fill/option-layout';

export { CHOICE_BUTTONS_MAX } from '../../fill/option-layout';

/**
 * choice: pick one, laid out like the legacy form (fill/option-layout.ts): `buttons` share one row equally and
 * wrap only when they don't fit (legacy buttonSelect); `list` is an equal-width grid, 2 or 3 per row (legacy
 * radio); options with descriptions or icons are full-width cards (follow-ups inside the card); `dropdown` and
 * long lists are the searchable pf-select. Tapping the chosen button again clears it.
 */
@Component({
  selector: 'fe-choice-fill',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, OptionCardsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (useSelect()) {
      <pf-select
        [options]="selectOptions()"
        [value]="current()"
        [searchable]="true"
        [disabled]="disabled()"
        [placeholder]="'Choose ' + field().label.toLowerCase()"
        (valueChange)="pick($event)"
      />
    } @else if (layout() === 'cards') {
      <fe-option-cards
        [field]="field()"
        [chosen]="current() ? [current()!] : []"
        [disabled]="disabled()"
        [labelId]="labelId()"
        [scope]="scope()"
        [lookup]="lookup()"
        [setKey]="setKey()"
        [lockedKeys]="lockedKeys()"
        [missingKeys]="missingKeys()"
        (toggle)="toggle($event)"
      />
    } @else {
      <div
        class="fe-chips"
        [class.fe-chips--row]="layout() === 'row'"
        [class.fe-chips--grid]="layout() === 'grid'"
        [class.fe-chips--grid3]="layout() === 'grid' && options().length % 3 === 0"
        [class.fe-chips--tiles]="tiles()"
        role="radiogroup"
        [attr.aria-labelledby]="labelId()"
      >
        @for (o of options(); track o.key) {
          <button
            type="button"
            class="fe-chip"
            role="radio"
            [attr.aria-checked]="o.key === current()"
            [attr.data-option]="o.key"
            [disabled]="disabled()"
            (click)="toggle(o.key)"
          >
            @if (tiles()) {
              <span class="fe-tile__mark" aria-hidden="true">{{ o.label.charAt(0) }}</span>
            }
            <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
            <span class="fe-chip__txt">
              <span>{{ o.label }}</span>
              @if (o.description) {
                <span class="fe-chip__desc">{{ o.description }}</span>
              }
            </span>
          </button>
        }
      </div>
    }
  `,
})
export class ChoiceFill extends KindFill {
  protected readonly options = computed(() => this.field().options ?? []);
  /** Legacy imageSelect: square tiles (the option's picture comes with the image kinds; until then its first letter). */
  protected readonly tiles = computed(() => this.config()['display'] === 'images');
  protected readonly current = computed(() => {
    const v = this.value();
    if (typeof v !== 'string') return null;
    return this.options().find((o) => o.key.toLowerCase() === v.toLowerCase())?.key ?? v;
  });
  protected readonly layout = computed(() => optionLayout(this.field()));
  protected readonly useSelect = computed(() => this.layout() === 'select');
  protected readonly selectOptions = computed<PfSelectOption<string>[]>(() =>
    this.options().map((o) => ({ value: o.key, label: o.label, hint: o.description })),
  );

  protected toggle(key: string): void {
    this.emit(this.current() === key ? undefined : key);
  }

  protected pick(key: string | null): void {
    this.emit(key ?? undefined);
  }
}
