import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { FieldDef } from '../../core/types';
import { pictureChoiceConfig, placeOf, safePath } from './pictureChoice-model';
import { pictureUrls } from './pictureChoice-urls';

/**
 * Studio: a small copy of a picture box to TAP the parts on (the combination sentences' "these choices" and
 * its preview). Same look as the doctor's box (tint, outline, tick), no names, never a touch-sized fill control.
 */
@Component({
  selector: 'fe-picturechoice-mini',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-pc fe-pc--mini" role="group" [attr.aria-label]="label()">
      <div class="fe-pc__box" [style.aspect-ratio]="aspect()">
        @if (bgUrl(); as bg) {
          <img class="fe-pc__bg" [src]="bg" alt="" draggable="false" />
        }
        @for (p of parts(); track p.key) {
          <button
            type="button"
            class="fe-pc__part fe-pcm__part"
            [class.fe-pc__part--on]="p.on"
            role="checkbox"
            [attr.aria-checked]="p.on"
            [attr.aria-label]="p.label"
            [attr.data-option]="p.key"
            [style.left.%]="p.place.x * 100"
            [style.top.%]="p.place.y * 100"
            [style.width.%]="p.place.w * 100"
            [style.height.%]="p.place.h * 100"
            (click)="pick.emit(p.key)"
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
            <span class="fe-pc__badge" aria-hidden="true"><pf-icon name="check" [size]="10" [stroke]="3.2" /></span>
          </button>
        }
      </div>
    </div>
  `,
})
export class PictureChoiceMiniComponent {
  private readonly urls = pictureUrls(() => this.field());
  readonly field = input.required<FieldDef>();
  readonly picked = input<readonly string[]>([]);
  readonly label = input('Tap the parts');
  readonly pick = output<string>();

  protected readonly aspect = computed(() => pictureChoiceConfig(this.field()).aspect);
  protected readonly bgUrl = computed(() => {
    const id = pictureChoiceConfig(this.field()).background;
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
}
