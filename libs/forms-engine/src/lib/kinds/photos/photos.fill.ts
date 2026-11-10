import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FeDialog, PfIconComponent } from '../../kit';
import { CanvasAnswer } from '../../canvas/answer';
import { CanvasComponent, CanvasTool } from '../../canvas/canvas.component';
import { CanvasPin, CanvasValue } from '../../canvas/canvas-model';
import { strokePath } from '../../canvas/ink';
import { MAX_CAPTION, MAX_GALLERY, PhotoItem, parsePhotos, shrinkPhoto } from '../../canvas/photo';
import { PinPanelComponent } from '../../canvas/pin-panel.component';
import { CanvasReader } from '../../canvas/picture';
import { AssetLink, FE_ASSETS, KindFill, feId } from '../../fill/contract';

/**
 * photos (legacy imageGallery, redone): a few photos from the camera or the
 * library (as the form allows), shrunk on the device and uploaded to this
 * case sheet (never base64 in the answer). Each has a caption and can be
 * opened and marked up with the pen, numbered pins and text on the canvas
 * engine; thumbnails show the markup.
 */
@Component({
  selector: 'fe-photos-fill',
  standalone: true,
  imports: [CanvasComponent, PinPanelComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-img" role="group" [attr.aria-labelledby]="labelId()">
      <input #cameraIn class="fe-file" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" data-camera-input (change)="add($any($event.target))" />
      <input #libraryIn class="fe-file" type="file" accept="image/jpeg,image/png,image/heic,image/heif" multiple tabindex="-1" aria-hidden="true" data-photo-input (change)="add($any($event.target))" />
      @if (photos().length) {
        <div class="fe-photos" [attr.data-layout]="layout()">
          @for (p of photos(); track p.id; let i = $index) {
            <button
              type="button"
              class="fe-photo"
              [attr.data-photo]="i"
              [attr.aria-pressed]="openId() === p.id"
              [attr.aria-label]="'Photo ' + (i + 1) + (p.description ? ': ' + p.description : '') + '. Open to mark it up.'"
              (click)="openId.set(openId() === p.id ? null : p.id!)"
            >
              <span class="fe-photo__frame">
                @if (links()[p.photo]; as l) {
                  <img class="fe-photo__img" [src]="l.url" alt="" draggable="false" />
                  @if (thumbInk(p, l); as t) {
                    <svg class="fe-photo__ink" [attr.viewBox]="t.box" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                      @for (d of t.paths; track $index) {
                        <path class="fe-ink" [attr.data-color]="d.color" [attr.fill]="d.color" [attr.d]="d.d" />
                      }
                    </svg>
                  }
                } @else {
                  <span class="fe-photo__img" aria-hidden="true"></span>
                }
              </span>
              <span class="fe-photo__cap" [class.fe-photo__cap--empty]="!p.description">{{
                p.description || (requireCaption() ? 'Caption needed' : 'No caption')
              }}</span>
            </button>
          }
        </div>
      } @else {
        <p class="fe-img__empty">{{ canAdd() ? 'No photos yet.' : 'Photos can be added on an open case sheet.' }}</p>
      }
      @if (!disabled() && canAdd() && photos().length < max()) {
        <div class="fe-img__acts">
          @if (source() !== 'upload') {
            <button type="button" class="pf-btn pf-btn--secondary" data-act="camera" [disabled]="busy()" (click)="cameraIn.click()">
              <pf-icon name="camera" [size]="18" />
              Take a photo
            </button>
          }
          @if (source() !== 'camera') {
            <button type="button" class="pf-btn pf-btn--secondary" data-act="library" [disabled]="busy()" (click)="libraryIn.click()">
              <pf-icon name="upload" [size]="18" />
              Choose photos
            </button>
          }
        </div>
      }
      @if (busy()) {
        <p class="fe-img__empty" role="status">Adding the photo…</p>
      }
      @if (error()) {
        <p class="fe-img__err" role="alert">{{ error() }}</p>
      }
      @if (open(); as p) {
        @if (links()[p.photo]; as l) {
          <section class="fe-photo-edit" [attr.aria-label]="'Photo ' + (openIndex() + 1)">
            <fe-canvas
              #cvEl
              [value]="markupOf(p, l)"
              [background]="{ kind: 'image', url: l.url, w: l.width, h: l.height }"
              [tools]="tools"
              [disabled]="disabled()"
              [label]="'Photo ' + (openIndex() + 1)"
              [openPin]="openPin()"
              [pinsOpenWhenDisabled]="true"
              [maxPins]="50"
              (changed)="writeMarkup(p, $event)"
              (pinTapped)="openPin.set($event)"
            />
            @if (pinOpen(p, l); as pin) {
              <fe-pin-panel
                [pin]="pin"
                [disabled]="disabled()"
                (changed)="cvEl.updatePin(pin.id, $event)"
                (removed)="cvEl.removePin(pin.id); openPin.set(null)"
                (closed)="openPin.set(null)"
              />
            }
            <div class="fe-img__acts fe-photo-edit__row">
              <label class="fe-sub fe-photo-edit__cap" [attr.for]="capId">
                <span class="fe-sub__lbl">Caption</span>
                <input
                  class="fe-text__input"
                  type="text"
                  data-caption
                  [id]="capId"
                  [value]="p.description ?? ''"
                  [attr.maxlength]="maxCaption"
                  [placeholder]="placeholder()"
                  [disabled]="disabled()"
                  (change)="setCaption(p.id!, $any($event.target).value)"
                />
              </label>
              @if (!disabled()) {
                <button type="button" class="pf-btn pf-btn--secondary" data-act="remove-photo" (click)="remove(p)">
                  <pf-icon name="trash" [size]="18" />
                  Remove photo
                </button>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
})
export class PhotosFill extends KindFill {
  protected readonly assets = inject(FE_ASSETS);
  private readonly dialog = inject(FeDialog);
  private readonly readers = new Map<string, CanvasReader>();
  /** The markup answer last written per photo (same arrays → same object, so the canvas keeps its undo steps). */
  private readonly written = new Map<string, CanvasAnswer>();

  protected readonly tools: CanvasTool[] = ['pen', 'pin', 'text', 'eraser'];
  protected readonly maxCaption = MAX_CAPTION;
  protected readonly capId = feId('fe-cap');
  protected readonly photos = computed(() => parsePhotos(this.value()));
  protected readonly max = computed(() => Math.min(MAX_GALLERY, Number(this.config()['maxPhotos'] ?? 4) || 4));
  protected readonly layout = computed(() => (this.config()['layout'] as string) ?? '2x2');
  protected readonly source = computed(() => (this.config()['photoSource'] as string) ?? 'either');
  protected readonly requireCaption = computed(() => this.config()['requireDescription'] === true);
  protected readonly placeholder = computed(
    () => (this.config()['descriptionPlaceholder'] as string) || 'e.g. Left shin, day 3',
  );
  protected readonly openId = signal<string | null>(null);
  protected readonly openPin = signal<string | null>(null);
  protected readonly open = computed(() => this.photos().find((p) => p.id === this.openId()) ?? null);
  protected readonly openIndex = computed(() => this.photos().findIndex((p) => p.id === this.openId()));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly links = signal<Record<string, AssetLink | null>>({});
  protected readonly canAdd = computed(() => !!this.assets?.canAddPhotos());

  constructor() {
    super();
    // signed links + sizes for the thumbnails (fetched once per photo)
    effect(() => {
      const have = this.links();
      for (const p of this.photos()) {
        if (p.photo in have || !this.assets) continue;
        this.links.update((u) => ({ ...u, [p.photo]: null }));
        this.assets
          .asset(p.photo)
          .then((l) => this.links.update((u) => ({ ...u, [p.photo]: l })))
          .catch(() => undefined);
      }
    });
  }

  private reader(id: string): CanvasReader {
    let r = this.readers.get(id);
    if (!r) {
      r = new CanvasReader();
      this.readers.set(id, r);
    }
    return r;
  }

  private markupAnswer(p: PhotoItem): CanvasAnswer | null {
    const w = this.written.get(p.id!);
    if (w && w.pins === p.pins && w.strokes === p.strokes && w.labels === p.labels) return w;
    return p.pins?.length || p.strokes?.length || p.labels?.length
      ? { pins: p.pins, strokes: p.strokes, labels: p.labels }
      : null;
  }

  protected markupOf(p: PhotoItem, l: AssetLink): CanvasValue {
    return this.reader(p.id!).read(this.markupAnswer(p), l.width, l.height);
  }

  protected pinOpen(p: PhotoItem, l: AssetLink): CanvasPin | null {
    return this.markupOf(p, l).pins.find((x) => x.id === this.openPin()) ?? null;
  }

  protected thumbInk(p: PhotoItem, l: AssetLink): { box: string; paths: { d: string; color: string }[] } | null {
    if (!p.strokes?.length) return null;
    const m = this.markupOf(p, l);
    return { box: `0 0 ${m.w} ${m.h}`, paths: m.ink.map((s) => ({ d: strokePath(s), color: s.color })) };
  }

  protected async add(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || !this.assets) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      let list = this.photos();
      for (const f of files) {
        if (list.length >= this.max()) break;
        const ref = await this.assets.uploadPhoto(await shrinkPhoto(f));
        const item: PhotoItem = { id: `ph${Date.now().toString(36)}${list.length}`, photo: ref.assetId };
        list = [...list, item];
        this.emit({ photos: list });
        this.openId.set(item.id!);
      }
    } catch {
      this.error.set('The photo could not be added. Check the connection and try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected writeMarkup(p: PhotoItem, v: CanvasValue): void {
    const a = this.reader(p.id!).write(v, {});
    const next: PhotoItem = { id: p.id, photo: p.photo, ...(p.description ? { description: p.description } : {}) };
    if (a?.pins) next.pins = a.pins;
    if (a?.strokes) next.strokes = a.strokes;
    if (a?.labels) next.labels = a.labels;
    if (a) this.written.set(p.id!, { pins: next.pins, strokes: next.strokes, labels: next.labels });
    if (a) this.reader(p.id!).keep(this.written.get(p.id!), v);
    this.emit({ photos: this.photos().map((x) => (x.id === p.id ? next : x)) });
  }

  protected setCaption(id: string, text: string): void {
    const description = text.trim().slice(0, MAX_CAPTION);
    this.emit({
      photos: this.photos().map((p) => {
        if (p.id !== id) return p;
        const { description: _old, ...rest } = p;
        return description ? { ...rest, description } : rest;
      }),
    });
  }

  protected async remove(p: PhotoItem): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Remove this photo?',
      message: 'The photo and its markings are removed from this case sheet.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!ok) return;
    const rest = this.photos().filter((x) => x.id !== p.id);
    this.openId.set(null);
    this.emit(rest.length ? { photos: rest } : undefined);
  }
}
