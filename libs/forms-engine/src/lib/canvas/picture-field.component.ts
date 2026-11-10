import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FeDialog, PfIconComponent } from '../kit';
import { FieldDef } from '../core/types';
import { FE_ASSETS, feId } from '../fill/contract';
import { CanvasAnswer, patchAnswer, readAnswer } from './answer';
import { CanvasComponent, CanvasTool } from './canvas.component';
import { CanvasPin, CanvasValue, DEFAULT_MAX_PINS, MAX_DESCRIPTION, MAX_NOTE, MAX_PINS } from './canvas-model';
import { shrinkPhoto } from './photo';
import { PinPanelComponent } from './pin-panel.component';
import { CanvasReader, pictureMarkers, resolvePicture } from './picture';

/**
 * The doctor's side of a picture question (`drawing`, `bodyMap`,
 * `photoMarkup` all use it; each kind says what it starts with):
 *  - the picture (a starter, an uploaded template, a blank sheet, or the
 *    photo just taken) on the canvas engine, with the tools the form allows
 *    (`allowInk`, `allowLabels`, `maxPins`, areas when the picture has them);
 *  - marked areas as rows under the picture: the area's name, a short note,
 *    clear;
 *  - bodyMap's fixed markers (each is one of the field's options, so its
 *    follow-up questions open under the field like any choice);
 *  - a pin's card (what / note / remove);
 *  - the description box when the form asks for one.
 * Everything is ONE answer in the API's shape (fractions), written on each finished action.
 */
@Component({
  selector: 'fe-picture-field',
  standalone: true,
  imports: [CanvasComponent, PinPanelComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-img" role="group" [attr.aria-labelledby]="labelId()">
      <input #cameraIn class="fe-file" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" data-camera-input (change)="addPhoto($any($event.target))" />
      <input #libraryIn class="fe-file" type="file" accept="image/jpeg,image/png,image/heic,image/heif" tabindex="-1" aria-hidden="true" data-photo-input (change)="addPhoto($any($event.target))" />
      @if (photoMode() && !answer().photo) {
        <div class="fe-img__photo-empty">
          <pf-icon name="camera" [size]="28" />
          @if (canAddPhotos()) {
            <p class="fe-img__empty">Take a photo, then mark it up.</p>
            <div class="fe-img__acts">
              @if (source() !== 'upload') {
                <button type="button" class="pf-btn pf-btn--primary" data-act="camera" [disabled]="busy() || disabled()" (click)="cameraIn.click()">
                  <pf-icon name="camera" [size]="18" />
                  Take a photo
                </button>
              }
              @if (source() !== 'camera') {
                <button type="button" class="pf-btn pf-btn--secondary" data-act="library" [disabled]="busy() || disabled()" (click)="libraryIn.click()">
                  <pf-icon name="upload" [size]="18" />
                  Choose a photo
                </button>
              }
            </div>
          } @else {
            <p class="fe-img__empty">Photos can be added on an open case sheet.</p>
          }
        </div>
      } @else if (pic(); as p) {
        @if (p.missing) {
          <p class="fe-img__err" role="status">The picture can’t be shown right now. You can still draw; it will appear when the connection is back.</p>
        }
        <fe-canvas
          #cvEl
          [value]="doc()!"
          [background]="p.background"
          [regions]="p.regions"
          [tools]="tools()"
          [disabled]="disabled()"
          [label]="field().label"
          [openPin]="openPin()"
          [pinsOpenWhenDisabled]="true"
          [inks]="inks()"
          [maxPins]="maxPins()"
          [markers]="markers()"
          (changed)="write($event)"
          (pinTapped)="openPin.set($event)"
          (markerTapped)="toggleMarker($event)"
        />
        @if (marked().length) {
          <ul class="fe-marks" aria-label="Marked areas">
            @for (r of marked(); track r.key) {
              <li class="fe-mark" [attr.data-marked]="r.key">
                <span class="fe-mark__name">{{ r.label }}</span>
                <input
                  class="fe-text__input fe-mark__note"
                  type="text"
                  [attr.aria-label]="r.label + ': note'"
                  placeholder="Note (optional)"
                  [attr.maxlength]="maxNote"
                  [value]="noteOf(r.key)"
                  [disabled]="disabled()"
                  (change)="setNote(r.key, $any($event.target).value)"
                />
                @if (!disabled()) {
                  <button type="button" class="fe-iconbtn" [attr.aria-label]="'Clear ' + r.label" (click)="cvEl.toggleRegion(r.key)">
                    <pf-icon name="x" [size]="18" />
                  </button>
                }
              </li>
            }
          </ul>
        } @else if (!disabled() && p.regions.length && tools()[0] === 'mark') {
          <p class="fe-img__empty">Tap an area on the picture to mark it.</p>
        }
        @if (doc()!.pins.length) {
          <div class="fe-img__list" aria-label="Pins">
            @for (pin of doc()!.pins; track pin.id) {
              <button
                type="button"
                class="fe-chip"
                [attr.data-pin-chip]="pin.n"
                [attr.aria-pressed]="openPin() === pin.id"
                (click)="openPin.set(openPin() === pin.id ? null : pin.id)"
              >
                <span class="fe-pin-panel__n" aria-hidden="true">{{ pin.n }}</span>
                {{ pin.label || 'Pin ' + pin.n }}
              </button>
            }
          </div>
        }
        @if (pinOpen(); as pin) {
          <fe-pin-panel
            [pin]="pin"
            [picks]="pinLabels()"
            [where]="regionName(pin.region)"
            [disabled]="disabled()"
            (changed)="cvEl.updatePin(pin.id, $event)"
            (removed)="cvEl.removePin(pin.id); openPin.set(null)"
            (closed)="openPin.set(null)"
          />
        }
        @if (photoMode() && !disabled() && canAddPhotos()) {
          <div class="fe-img__acts">
            <button type="button" class="pf-btn pf-btn--secondary" data-act="retake" [disabled]="busy()" (click)="source() === 'upload' ? libraryIn.click() : cameraIn.click()">
              <pf-icon name="camera" [size]="18" />
              Another photo
            </button>
          </div>
        }
      } @else {
        <div class="fe-img__loading" role="status">Loading the picture…</div>
      }
      @if (showDescription()) {
        <label class="fe-sub" [attr.for]="descId">
          <span class="fe-sub__lbl">Description</span>
        </label>
        <textarea
          class="fe-text__input fe-img__desc"
          rows="2"
          data-description
          [id]="descId"
          [attr.maxlength]="maxDescription"
          [placeholder]="descriptionPlaceholder()"
          [value]="answer().description ?? ''"
          [disabled]="disabled()"
          (change)="setDescription($any($event.target).value)"
        ></textarea>
      }
      @if (busy()) {
        <p class="fe-img__empty" role="status">Adding the photo…</p>
      }
      @if (error()) {
        <p class="fe-img__err" role="alert">{{ error() }}</p>
      }
    </div>
  `,
})
export class PictureFieldComponent {
  private readonly assets = inject(FE_ASSETS);
  private readonly dialog = inject(FeDialog);
  private readonly reader = new CanvasReader();

  readonly field = input.required<FieldDef>();
  readonly value = input<unknown>(null);
  readonly disabled = input(false);
  readonly labelId = input('');
  readonly write$ = input.required<(v: unknown) => void>();
  /** The kind starts on "Mark areas" (bodyMap) rather than the pen. */
  readonly markFirst = input(false);
  /** The kind is one photo taken on the spot (photoMarkup). */
  readonly photoMode = input(false);
  /** The kind's own default for `showDescription` when the form does not say. */
  readonly descriptionDefault = input(false);

  protected readonly descId = feId('fe-desc');
  protected readonly maxNote = MAX_NOTE;
  protected readonly maxDescription = MAX_DESCRIPTION;
  protected readonly openPin = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly cfg = computed(() => (this.field().config ?? {}) as Record<string, unknown>);
  protected readonly answer = computed<CanvasAnswer>(() => readAnswer(this.value()));
  protected readonly pic = resolvePicture(
    this.assets,
    () => this.field(),
    () => this.answer().photo,
  );
  protected readonly doc = computed<CanvasValue | null>(() => {
    const p = this.pic();
    return p ? this.reader.read(this.value(), p.w, p.h) : null;
  });

  protected readonly source = computed(() => (this.cfg()['photoSource'] as string) ?? 'either');
  protected readonly showDescription = computed(() => {
    const v = this.cfg()['showDescription'];
    return typeof v === 'boolean' ? v : this.descriptionDefault();
  });
  protected readonly descriptionPlaceholder = computed(
    () => (this.cfg()['descriptionPlaceholder'] as string) || 'What you see, in a line or two',
  );
  protected readonly inks = computed(() => {
    const c = this.cfg()['inkColors'];
    return Array.isArray(c) && c.length ? (c as string[]) : null;
  });
  protected readonly maxPins = computed(() => {
    const n = Number(this.cfg()['maxPins'] ?? DEFAULT_MAX_PINS);
    return Number.isFinite(n) ? Math.min(MAX_PINS, Math.max(0, n)) : DEFAULT_MAX_PINS;
  });
  protected readonly pinLabels = computed(() => {
    const l = this.cfg()['pinLabels'];
    return Array.isArray(l) ? (l as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  });

  protected readonly tools = computed<CanvasTool[]>(() => {
    const c = this.cfg();
    const regions = (this.pic()?.regions.length ?? 0) > 0;
    const ink: CanvasTool[] = c['allowInk'] === false ? [] : ['pen', 'eraser'];
    const text: CanvasTool[] = c['allowLabels'] === false ? [] : ['text'];
    const pin: CanvasTool[] = this.maxPins() > 0 ? ['pin'] : [];
    const mark: CanvasTool[] = regions ? ['mark'] : [];
    const order = this.markFirst() ? [...mark, ...pin, ...ink, ...text] : [...ink, ...mark, ...pin, ...text];
    return order.length ? order : ['pin'];
  });

  protected readonly markers = computed(() => {
    const p = this.pic();
    return p ? pictureMarkers(this.field(), p, this.answer().markers ?? []) : [];
  });

  protected readonly marked = computed(() => {
    const p = this.pic();
    const d = this.doc();
    if (!p || !d) return [];
    const on = new Set(d.regions);
    return p.regions.filter((r) => on.has(r.key));
  });

  protected readonly pinOpen = computed<CanvasPin | null>(
    () => this.doc()?.pins.find((p) => p.id === this.openPin()) ?? null,
  );

  protected readonly canAddPhotos = computed(() => !!this.assets?.canAddPhotos());

  protected regionName(key: string | undefined): string | null {
    return key ? (this.pic()?.regions.find((r) => r.key === key)?.label ?? null) : null;
  }

  protected noteOf(key: string): string {
    return this.answer().regions?.find((r) => r.id === key)?.note ?? '';
  }

  /** The canvas finished an action: the picture part of the answer changes, the rest is kept. */
  protected write(v: CanvasValue): void {
    if (this.disabled()) return;
    this.write$()(this.reader.write(v, this.answer()));
  }

  private patch(p: Partial<CanvasAnswer>): void {
    if (this.disabled()) return;
    const d = this.doc();
    const next = patchAnswer(this.answer(), p);
    this.write$()(d ? this.reader.keep(next, d) : next);
  }

  protected setDescription(text: string): void {
    this.patch({ description: text.trim().slice(0, MAX_DESCRIPTION) || undefined });
  }

  protected setNote(key: string, text: string): void {
    const note = text.trim().slice(0, MAX_NOTE);
    this.patch({
      regions: (this.answer().regions ?? []).map((r) => (r.id === key ? (note ? { id: r.id, note } : { id: r.id }) : r)),
    });
  }

  protected toggleMarker(key: string): void {
    const now = this.answer().markers ?? [];
    this.patch({ markers: now.includes(key) ? now.filter((k) => k !== key) : [...now, key] });
  }

  protected async addPhoto(el: HTMLInputElement): Promise<void> {
    const file = el.files?.[0];
    el.value = '';
    if (!file || !this.assets) return;
    if (this.answer().photo && this.doc() && (this.doc()!.ink.length || this.doc()!.pins.length || this.doc()!.labels.length)) {
      const ok = await this.dialog.confirm({
        title: 'Use the new photo?',
        message: 'The marks on the old photo are removed with it.',
        confirmLabel: 'Use the new photo',
        cancelLabel: 'Keep the old one',
      });
      if (!ok) return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      const ref = await this.assets.uploadPhoto(await shrinkPhoto(file));
      const a = this.answer();
      this.write$()(patchAnswer({ description: a.description }, { photo: ref.assetId }));
    } catch {
      this.error.set('The photo could not be added. Check the connection and try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
