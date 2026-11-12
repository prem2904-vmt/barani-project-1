import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill } from '../../fill/contract';
import { pictureUrls } from './pictureChoice-urls';
import { totalLine } from '../../narrative/combinations';
import { pickedOf, pictureChoiceConfig, placeOf, safePath, toggled } from './pictureChoice-model';

/**
 * pictureChoice: pictures laid out in a box; the doctor taps a part and it lights up (theme tint + outline + a tick
 * badge, so it never relies on colour alone). A set of picks (`multiple`) or one. The box scales with the width;
 * every part is at least a touch target. Answers and narrative are `multi`'s (an array of option keys).
 */
@Component({
  selector: 'fe-picturechoice-fill',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-pc" [attr.role]="multiple() ? 'group' : 'radiogroup'" [attr.aria-labelledby]="labelId() || null" [style.--pc-aspect]="cfg().aspect">
      <div class="fe-pc__box" [style.aspect-ratio]="cfg().aspect" [style.max-width]="'min(100%, calc(72vh * ' + cfg().aspect + '))'">
        @if (bgUrl(); as bg) {
          <img class="fe-pc__bg" [src]="bg" alt="" draggable="false" />
        }
        @for (p of parts(); track p.key) {
          <button
            type="button"
            class="fe-pc__part"
            [class.fe-pc__part--on]="p.on"
            [class.fe-pc__part--tile]="!p.url && !p.path"
            [attr.role]="multiple() ? 'checkbox' : 'radio'"
            [attr.aria-checked]="p.on"
            [attr.aria-label]="p.label"
            [attr.data-option]="p.key"
            [disabled]="disabled()"
            [style.left.%]="p.place.x * 100"
            [style.top.%]="p.place.y * 100"
            [style.width.%]="p.place.w * 100"
            [style.height.%]="p.place.h * 100"
            (click)="tap(p.key)"
          >
            <span class="fe-pc__art" aria-hidden="true">
              @if (p.url) {
                <img [src]="p.url" alt="" draggable="false" />
              } @else if (p.path) {
                <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><path [attr.d]="p.path" /></svg>
              } @else {
                <span class="fe-pc__initial">{{ p.label.charAt(0).toUpperCase() }}</span>
              }
            </span>
            @if (cfg().showLabels) {
              <span class="fe-pc__label">{{ p.label }}</span>
            }
            <span class="fe-pc__badge" aria-hidden="true"><pf-icon name="check" [size]="14" [stroke]="3" /></span>
          </button>
        }
      </div>
      @if (total(); as t) {
        <p class="fe-pc__total" data-total aria-live="polite">{{ t }}</p>
      }
    </div>
  `,
})
export class PictureChoiceFill extends KindFill {
  private readonly urls = pictureUrls(() => this.field());

  protected readonly cfg = computed(() => pictureChoiceConfig(this.field()));
  protected readonly multiple = computed(() => this.cfg().multiple);
  protected readonly picked = computed(() => pickedOf(this.field(), this.value()));
  /** The worked-out total of the picked parts' numbers (null when the question shows none). */
  protected readonly total = computed(() => totalLine(this.field(), this.picked()));
  protected readonly bgUrl = computed(() => {
    const id = this.cfg().background;
    return id ? (this.urls()[id] ?? null) : null;
  });
  protected readonly parts = computed(() => {
    const opts = this.field().options ?? [];
    const on = new Set(this.picked());
    return opts.map((o, i) => ({
      key: o.key,
      label: o.label,
      on: on.has(o.key),
      place: placeOf(o, i, opts.length),
      url: o.asset ? (this.urls()[o.asset] ?? null) : null,
      path: o.asset ? null : safePath(o.drawn),
    }));
  });

  protected tap(key: string): void {
    this.emit(toggled(this.field(), this.value(), key));
  }
}
