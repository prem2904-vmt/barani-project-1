import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FeDialog, PfIconComponent } from '../kit';
import { ApplyFieldChange } from '../build/contract';
import { FieldDef } from '../core/types';
import { AssetRef, FE_ASSETS } from '../fill/contract';
import { AreaEditorComponent } from './area-editor.component';
import { regionPath } from './ink';
import { pictureConfig, pictureMarkers, resolvePicture } from './picture';
import { PictureChooserComponent } from './picture-chooser.component';
import { useStarter, useUpload } from './picture-edits';

/**
 * Studio panel of a picture question (`drawing`, `bodyMap`): the picture
 * (starter tiles, an upload, or a blank sheet), a small view of its areas
 * (and a body map's markers) with their words, and "Edit areas" — the
 * full-screen editor where areas are drawn, reshaped, named and given their
 * sentence right on the picture.
 */
@Component({
  selector: 'fe-picture-panel',
  standalone: true,
  imports: [PictureChooserComponent, AreaEditorComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fe-kpanel" [attr.data-kind-panel]="field().kind">
      <h3 class="fe-kpanel__title">Picture</h3>
      <fe-picture-chooser [field]="field()" [allowBlank]="allowBlank()" (template)="pickStarter($event)" (image)="pickUpload($event)" />
      <h3 class="fe-kpanel__title">
        Areas the doctor can tap · {{ areas().length }}
        @if (allowMarkers()) {
          · markers · {{ markers().length }}
        }
      </h3>
      @if (pic(); as p) {
        <button type="button" class="fe-kpanel__mini pf-touch" data-act="edit-areas" aria-label="Edit the areas on the picture" (click)="openEditor(null)">
          <svg [attr.viewBox]="'0 0 ' + p.w + ' ' + p.h" aria-hidden="true">
            <rect class="fe-cv__paper" x="0" y="0" [attr.width]="p.w" [attr.height]="p.h" />
            @if (p.background.kind === 'image' && p.background.url) {
              <image [attr.href]="p.background.url" x="0" y="0" [attr.width]="p.w" [attr.height]="p.h" />
            }
            @for (r of p.regions; track r.key) {
              <path class="fe-area" [attr.d]="path(r.shape)" />
            }
            @for (m of markers(); track m.key) {
              <circle class="fe-area" [attr.cx]="m.x" [attr.cy]="m.y" [attr.r]="p.w * 0.025" />
            }
          </svg>
        </button>
      }
      <div class="fe-img__acts">
        <button type="button" class="pf-btn pf-btn--secondary" data-act="edit-areas-btn" (click)="openEditor(null)">
          <pf-icon name="shape" [size]="18" />
          {{ allowMarkers() ? 'Edit areas and markers' : 'Edit areas' }}
        </button>
      </div>
      @if (areas().length) {
        <ul class="fe-kpanel__areas">
          @for (r of areas(); track r.key) {
            <li>
              <button type="button" class="fe-kpanel__area pf-touch" [attr.data-area]="r.key" (click)="openEditor(r.key)">
                <span class="fe-kpanel__area-name">{{ r.label }}</span>
                <span class="fe-kpanel__area-says">{{ r.says ? 'says “' + r.says + '”' : 'joins “Marked over …”' }}</span>
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="fe-img__empty">
          {{ pic()?.starter ? 'This picture has no areas.' : 'No areas yet. Draw them on the picture with Edit areas.' }}
        </p>
      }
    </section>
    @if (editing()) {
      <fe-area-editor [field]="field()" [apply]="apply()" [startWith]="startWith()" [allowMarkers]="allowMarkers()" (closed)="editing.set(false)" />
    }
  `,
})
export class PicturePanelComponent {
  private readonly dialog = inject(FeDialog);
  private readonly assets = inject(FE_ASSETS);

  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();
  /** A blank sheet is a choice (drawing yes, body map no). */
  readonly allowBlank = input(true);
  /** Fixed tap markers can be placed (bodyMap). */
  readonly allowMarkers = input(false);

  protected readonly editing = signal(false);
  protected readonly startWith = signal<string | null>(null);
  protected readonly pic = resolvePicture(this.assets, () => this.field());
  protected readonly areas = computed(() => {
    const words = new Map(pictureConfig(this.field()).regions.map((r) => [r.id, r.sentence ?? '']));
    return (this.pic()?.regions ?? []).map((r) => ({ key: r.key, label: r.label, says: words.get(r.key) ?? '' }));
  });
  protected readonly markers = computed(() => {
    const p = this.pic();
    return p && this.allowMarkers() ? pictureMarkers(this.field(), p, []) : [];
  });

  protected path = regionPath;

  protected openEditor(key: string | null): void {
    this.startWith.set(key);
    this.editing.set(true);
  }

  protected async pickStarter(id: string | null): Promise<void> {
    if (id === pictureConfig(this.field()).template && !pictureConfig(this.field()).templateAssetId) return;
    const drawn = pictureConfig(this.field()).regions.filter((r) => r.points?.length).length;
    if (drawn) {
      const ok = await this.dialog.confirm({
        title: id ? 'Use this starter picture?' : 'Use a blank sheet?',
        message: `The ${drawn} ${drawn === 1 ? 'area' : 'areas'} you drew go with the old picture.`,
        confirmLabel: 'Change the picture',
        cancelLabel: 'Keep it',
      });
      if (!ok) return;
    }
    this.apply()((f) => useStarter(f, id));
  }

  protected pickUpload(ref: AssetRef): void {
    this.apply()((f) => useUpload(f, ref.assetId));
  }
}
