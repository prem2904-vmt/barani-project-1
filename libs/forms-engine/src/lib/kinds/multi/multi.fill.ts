import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { KindFill } from '../../fill/contract';
import { OptionCardsComponent } from '../../fill/option-cards.component';
import { MULTI_CHIPS_MAX, optionLayout } from '../../fill/option-layout';

export { MULTI_CHIPS_MAX } from '../../fill/option-layout';

/**
 * multi: pick any number. Legacy multiselect-expand cards (fe-option-cards): one full-width card per option, the
 * chosen ones open their follow-up questions inside themselves. A long dropdown list uses the searchable
 * pf-select (multiple); `images` keeps the picture tiles.
 */
@Component({
  selector: 'fe-multi-fill',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, OptionCardsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (useSelect()) {
      <pf-select
        [options]="selectOptions()"
        [multiple]="true"
        [values]="chosen()"
        [searchable]="true"
        [disabled]="disabled()"
        [placeholder]="'Choose ' + field().label.toLowerCase()"
        (valuesChange)="pickMany($event)"
      />
    } @else if (layout() === 'cards') {
      <fe-option-cards
        [field]="field()"
        [chosen]="chosen()"
        [multiple]="true"
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
        [class.fe-chips--list]="config()['display'] === 'list'"
        [class.fe-chips--tiles]="tiles()"
        role="group"
        [attr.aria-labelledby]="labelId()"
      >
        @for (o of options(); track o.key) {
          <button
            type="button"
            class="fe-chip"
            [attr.aria-pressed]="isOn(o.key)"
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
export class MultiFill extends KindFill {
  protected readonly options = computed(() => this.field().options ?? []);
  /** Legacy imageSelect: square tiles (the option's picture comes with the image kinds; until then its first letter). */
  protected readonly tiles = computed(() => this.config()['display'] === 'images');
  protected readonly chosen = computed<string[]>(() => {
    const v = this.value();
    const list = Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];
    // keep the option's own spelling of the key
    return list.map((x) => this.options().find((o) => o.key.toLowerCase() === x.toLowerCase())?.key ?? x);
  });
  protected readonly layout = computed(() => optionLayout(this.field()));
  protected readonly useSelect = computed(() => this.layout() === 'select');
  protected readonly selectOptions = computed<PfSelectOption<string>[]>(() =>
    this.options().map((o) => ({ value: o.key, label: o.label, hint: o.description })),
  );

  protected isOn(key: string): boolean {
    return this.chosen().includes(key);
  }

  protected toggle(key: string): void {
    const cur = this.chosen();
    // keep the form's order, not the tap order
    const next = cur.includes(key)
      ? cur.filter((k) => k !== key)
      : this.options()
          .map((o) => o.key)
          .filter((k) => k === key || cur.includes(k));
    this.emit(next.length ? next : undefined);
  }

  protected pickMany(keys: string[]): void {
    this.emit(keys?.length ? keys : undefined);
  }
}
