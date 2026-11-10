import { ChangeDetectionStrategy, Component, ElementRef, effect, forwardRef, inject, input, output } from '@angular/core';
import { Lookup, isShown } from '../core/rules';
import { Answers, FieldDef, OptionDef } from '../core/types';
import { FieldHostComponent } from './field-host.component';

/**
 * Legacy multiselect-expand, 1:1 in layout (resident-fe dynamic-inputs/multiselect-expand): one full-width card
 * per option (two per row on a half-width field) — the icon tile, the title and its description, a round tick
 * on the right. A chosen card opens its follow-up questions INSIDE itself, under a thin line, and the cursor goes
 * to the first text box (legacy focused the first sub-field after 150 ms). Used by multi (any number) and by a
 * single choice whose options carry descriptions or icons.
 */
@Component({
  selector: 'fe-option-cards',
  standalone: true,
  imports: [forwardRef(() => FieldHostComponent)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fe-cards"
      [class.fe-cards--half]="field().width === 'half'"
      [attr.role]="multiple() ? 'group' : 'radiogroup'"
      [attr.aria-labelledby]="labelId()"
    >
      @for (o of field().options ?? []; track o.key) {
        <div class="fe-card" [class.fe-card--on]="isOn(o.key)" [attr.data-card]="o.key">
          <button
            type="button"
            class="fe-card__head pf-touch"
            [attr.role]="multiple() ? 'checkbox' : 'radio'"
            [attr.aria-checked]="isOn(o.key)"
            [attr.data-option]="o.key"
            [disabled]="disabled()"
            (click)="toggle.emit(o.key)"
          >
            @if (o.icon) {
              <span class="fe-card__icon" aria-hidden="true">{{ mark(o) }}</span>
            }
            <span class="fe-card__txt">
              <span class="fe-card__title">{{ o.label }}</span>
              @if (o.description) {
                <span class="fe-card__desc">{{ o.description }}</span>
              }
            </span>
            <span class="fe-card__tick" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
            </span>
          </button>
          @if (isOn(o.key) && subs(o).length) {
            <div class="fe-card__body" role="group" [attr.data-follow]="o.key" [attr.aria-label]="o.label + ': follow-up'">
              <div class="fe-card__line"></div>
              @for (sub of subs(o); track sub.key) {
                <fe-field
                  [field]="sub"
                  [scope]="scope()"
                  [lookup]="lookup()"
                  [setValue]="setKey()"
                  [lockedKeys]="lockedKeys()"
                  [missingKeys]="missingKeys()"
                />
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class OptionCardsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly field = input.required<FieldDef>();
  readonly chosen = input<readonly string[]>([]);
  readonly multiple = input(false);
  readonly disabled = input(false);
  readonly labelId = input('');
  readonly scope = input<Answers>({});
  readonly lookup = input<Lookup>(() => undefined);
  readonly setKey = input<(key: string, value: unknown) => void>(() => undefined);
  readonly lockedKeys = input<ReadonlySet<string>>(new Set());
  readonly missingKeys = input<ReadonlySet<string>>(new Set());
  readonly toggle = output<string>();

  private seen: Set<string> | null = null;

  constructor() {
    effect(() => {
      const keys = this.chosen().filter((k) => this.subs(this.option(k)).length > 0);
      const before = this.seen;
      this.seen = new Set(keys);
      if (!before) return; // never on load
      const fresh = keys.find((k) => !before.has(k));
      if (!fresh) return;
      setTimeout(() => {
        const body = this.host.nativeElement.querySelector<HTMLElement>(`[data-follow="${cssEscape(fresh)}"]`);
        if (!body) return;
        body.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        body.querySelector<HTMLElement>('input.fe-text__input, textarea.fe-text__input')?.focus({ preventScroll: true });
      }, 150);
    });
  }

  protected isOn(key: string): boolean {
    return this.chosen().includes(key);
  }

  protected subs(o: OptionDef | undefined): FieldDef[] {
    if (!o) return [];
    const get = this.lookup();
    return (o.subFields ?? []).filter((s) => isShown(s.showWhen, get));
  }

  /** The icon tile: legacy named a font icon the app never loaded (it printed "wind"); Prepare shows the first letter. */
  protected mark(o: OptionDef): string {
    return (o.label.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? '•').toUpperCase();
  }

  private option(key: string): OptionDef | undefined {
    return (this.field().options ?? []).find((o) => o.key === key);
  }
}

function cssEscape(v: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&');
}
