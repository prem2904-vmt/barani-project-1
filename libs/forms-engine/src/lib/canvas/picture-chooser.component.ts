import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { PfIconComponent } from '../kit';
import { FieldDef } from '../core/types';
import { AssetRef, FE_ASSETS, StarterInfo } from '../fill/contract';
import { pictureConfig } from './picture';

/**
 * Studio: which picture a picture question uses. Tiles of the API's starter
 * pictures (shown small, so the choice is by sight), a blank sheet when the
 * kind allows it, and "Upload a picture" (PNG, JPEG or a plain SVG, stored as
 * a template picture). It only reports the choice; the kind's panel writes the field.
 */
@Component({
  selector: 'fe-picture-chooser',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-pick" role="radiogroup" aria-label="Picture">
      @if (allowBlank()) {
        <button
          type="button"
          class="fe-pick__tile"
          role="radio"
          data-template="blank"
          [attr.aria-checked]="current() === 'blank'"
          (click)="template.emit(null)"
        >
          <span class="fe-pick__art fe-pick__art--blank" aria-hidden="true"></span>
          <span class="fe-pick__name">Blank page</span>
        </button>
      }
      @for (t of starters(); track t.id) {
        <button
          type="button"
          class="fe-pick__tile"
          role="radio"
          [attr.data-template]="t.id"
          [attr.aria-checked]="current() === t.id"
          (click)="template.emit(t.id)"
        >
          <img class="fe-pick__art fe-pick__img" [src]="t.svgUrl" alt="" draggable="false" />
          <span class="fe-pick__name">{{ t.title }}</span>
        </button>
      }
      @if (uploaded(); as u) {
        <button type="button" class="fe-pick__tile" role="radio" data-template="upload" aria-checked="true">
          @if (uploadUrl(); as url) {
            <img class="fe-pick__art fe-pick__img" [src]="url" alt="" />
          } @else {
            <span class="fe-pick__art" aria-hidden="true"></span>
          }
          <span class="fe-pick__name">Your picture</span>
        </button>
      }
    </div>
    @if (assets) {
      <div class="fe-img__acts">
        <button type="button" class="pf-btn pf-btn--secondary" data-act="upload-template" [disabled]="busy()" (click)="fileIn.click()">
          <pf-icon name="upload" [size]="18" />
          {{ uploaded() ? 'Upload another picture' : 'Upload a picture' }}
        </button>
        <input
          #fileIn
          class="fe-file"
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          tabindex="-1"
          aria-hidden="true"
          data-template-input
          (change)="upload($any($event.target))"
        />
      </div>
    }
    @if (busy()) {
      <p class="fe-img__empty" role="status">Uploading…</p>
    }
    @if (error()) {
      <p class="fe-img__err" role="alert">{{ error() }}</p>
    }
  `,
})
export class PictureChooserComponent {
  protected readonly assets = inject(FE_ASSETS);

  readonly field = input.required<FieldDef>();
  readonly allowBlank = input(true);

  readonly template = output<string | null>();
  readonly image = output<AssetRef>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly starters = signal<StarterInfo[]>([]);
  protected readonly uploadUrl = signal<string | null>(null);

  protected readonly uploaded = computed(() => pictureConfig(this.field()).templateAssetId);
  protected readonly current = computed(() => {
    const p = pictureConfig(this.field());
    return p.templateAssetId ? 'upload' : (p.template ?? 'blank');
  });

  constructor() {
    this.assets
      ?.starters()
      .then((list) => this.starters.set(list))
      .catch(() => this.error.set('The starter pictures could not be loaded. Check the connection.'));
    effect(() => {
      const id = this.uploaded();
      this.uploadUrl.set(null);
      if (id && this.assets)
        this.assets
          .asset(id)
          .then((a) => this.uploadUrl.set(a.url))
          .catch(() => undefined);
    });
  }

  protected async upload(el: HTMLInputElement): Promise<void> {
    const file = el.files?.[0];
    el.value = '';
    if (!file || !this.assets) return;
    if (file.type && !/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) {
      this.error.set('Please choose a PNG, JPEG or SVG picture.');
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.image.emit(await this.assets.uploadTemplate(file));
    } catch {
      this.error.set('The picture could not be uploaded. Check that it is under 4 MB and try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
