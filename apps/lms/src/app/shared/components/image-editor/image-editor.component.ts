import {
  ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input,
  OnDestroy, Output, ViewChild, computed, signal,
} from '@angular/core';
import {
  Rect, Handle, clampRect, moveRect, resizeRect, computeOutputSize, centeredCrop,
} from './image-crop';

/**
 * Crop + resize editor (OPS-14). Opened with a picked raster File; the user
 * drags/reshapes a crop box, optionally locks an aspect ratio and sets an
 * output width, then Apply renders the region to a canvas and emits a Blob
 * (PNG, or JPEG for jpeg sources so photos stay small). Cancel emits nothing.
 *
 * Vector (SVG) images are NOT routed here — they can't be canvas-cropped
 * without rasterising; the caller uploads those untouched.
 *
 * Geometry lives in ./image-crop (pure, unit-tested). The crop rect is stored
 * in NATURAL pixels and rendered as % of the image, so it tracks the responsive
 * <img> at any display size without a separate scale factor.
 */
@Component({
  selector: 'pf-image-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-ie__scrim" (pointerdown)="onScrim($event)">
      <div class="pf-ie__panel" role="dialog" aria-modal="true" aria-label="Crop and resize image">
        <header class="pf-ie__head">
          <h2 class="pf-ie__title">Crop &amp; resize</h2>
          <button type="button" class="pf-ie__x" (click)="cancel()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="pf-ie__stage" #stage>
          @if (srcUrl()) {
            <img #img class="pf-ie__img" [src]="srcUrl()" (load)="onImgLoad()" alt="" draggable="false" />
            @if (ready()) {
              <div class="pf-ie__crop" [style.left.%]="pct().x" [style.top.%]="pct().y"
                   [style.width.%]="pct().w" [style.height.%]="pct().h"
                   (pointerdown)="startMove($event)">
                <span class="pf-ie__h pf-ie__h--nw" (pointerdown)="startResize($event, 'nw')"></span>
                <span class="pf-ie__h pf-ie__h--ne" (pointerdown)="startResize($event, 'ne')"></span>
                <span class="pf-ie__h pf-ie__h--sw" (pointerdown)="startResize($event, 'sw')"></span>
                <span class="pf-ie__h pf-ie__h--se" (pointerdown)="startResize($event, 'se')"></span>
              </div>
            }
          }
        </div>

        <div class="pf-ie__controls">
          <div class="pf-ie__group" role="group" aria-label="Aspect ratio">
            <span class="pf-ie__lbl">Shape</span>
            @for (a of ASPECTS; track a.label) {
              <button type="button" class="pf-ie__chip" [class.pf-ie__chip--on]="aspect() === a.value"
                      (click)="setAspect(a.value)">{{ a.label }}</button>
            }
          </div>
          <div class="pf-ie__group">
            <span class="pf-ie__lbl">Width</span>
            <input type="number" class="pf-ie__num" min="16" [max]="cropW()"
                   [value]="targetW() ?? cropW()"
                   (input)="onWidth($any($event.target).value)" />
            <span class="pf-ie__px">px → {{ out().w }}×{{ out().h }}</span>
          </div>
        </div>

        <footer class="pf-ie__foot">
          <button type="button" class="pf-ie__btn" (click)="reset()">Reset</button>
          <span class="pf-ie__spacer"></span>
          <button type="button" class="pf-ie__btn" (click)="cancel()">Cancel</button>
          <button type="button" class="pf-ie__btn pf-ie__btn--primary" [disabled]="busy() || !ready()"
                  (click)="apply()">{{ busy() ? 'Applying…' : 'Apply' }}</button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .pf-ie__scrim { position: fixed; inset: 0; z-index: 1000; display: flex;
      align-items: center; justify-content: center; padding: 16px;
      background: rgba(2,6,23,0.66); backdrop-filter: blur(2px); }
    .pf-ie__panel { width: min(560px, 100%); max-height: 92dvh; overflow: hidden;
      display: flex; flex-direction: column; border-radius: 16px;
      background: var(--surface, #0f172a); border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
      box-shadow: 0 24px 60px rgba(0,0,0,0.5); }
    .pf-ie__head { display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; border-bottom: 1px solid var(--glass-border, rgba(255,255,255,0.1)); }
    .pf-ie__title { font-size: 15px; font-weight: 700; color: var(--text-primary, #e2e8f0); }
    .pf-ie__x { background: transparent; border: 0; color: var(--text-secondary, #94a3b8); cursor: pointer; padding: 4px; }
    .pf-ie__stage { position: relative; flex: 1; min-height: 0; overflow: hidden;
      display: flex; align-items: center; justify-content: center; padding: 16px;
      background: repeating-conic-gradient(#1e293b 0% 25%, #0b1220 0% 50%) 50% / 20px 20px; }
    .pf-ie__img { max-width: 100%; max-height: 56dvh; user-select: none; -webkit-user-drag: none;
      display: block; touch-action: none; }
    .pf-ie__crop { position: absolute; box-sizing: border-box; cursor: move; touch-action: none;
      border: 1.5px solid #fff; box-shadow: 0 0 0 9999px rgba(2,6,23,0.55);
      outline: 1px solid rgba(0,0,0,0.4); }
    .pf-ie__h { position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 3px;
      border: 1px solid rgba(0,0,0,0.4); touch-action: none; }
    .pf-ie__h--nw { top: -8px; left: -8px; cursor: nwse-resize; }
    .pf-ie__h--ne { top: -8px; right: -8px; cursor: nesw-resize; }
    .pf-ie__h--sw { bottom: -8px; left: -8px; cursor: nesw-resize; }
    .pf-ie__h--se { bottom: -8px; right: -8px; cursor: nwse-resize; }
    .pf-ie__controls { padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 14px 20px;
      border-top: 1px solid var(--glass-border, rgba(255,255,255,0.1)); }
    .pf-ie__group { display: flex; align-items: center; gap: 8px; }
    .pf-ie__lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      color: var(--text-tertiary, #64748b); }
    .pf-ie__chip { padding: 5px 11px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
      cursor: pointer; color: var(--text-secondary, #94a3b8);
      background: transparent; border: 1px solid var(--glass-border, rgba(255,255,255,0.14)); }
    .pf-ie__chip--on { color: #fff; background: var(--brand, #a855f7); border-color: transparent; }
    .pf-ie__num { width: 84px; padding: 6px 8px; border-radius: 8px; font-size: 13px;
      color: var(--text-primary, #e2e8f0); background: var(--glass-bg, rgba(255,255,255,0.05));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.14)); }
    .pf-ie__px { font-size: 12px; color: var(--text-tertiary, #64748b); }
    .pf-ie__foot { display: flex; align-items: center; gap: 10px; padding: 12px 16px;
      border-top: 1px solid var(--glass-border, rgba(255,255,255,0.1)); }
    .pf-ie__spacer { flex: 1; }
    .pf-ie__btn { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary, #cbd5e1); background: transparent;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.16)); }
    .pf-ie__btn--primary { color: #fff; background: var(--brand, #a855f7); border-color: transparent; }
    .pf-ie__btn--primary:disabled { opacity: .6; cursor: default; }
  `],
})
export class ImageEditorComponent implements OnDestroy {
  @ViewChild('stage') stageRef?: ElementRef<HTMLDivElement>;
  @ViewChild('img') imgRef?: ElementRef<HTMLImageElement>;

  /** The picked raster file to edit. Setting it (re)initialises the editor. */
  @Input() set file(f: File | null) {
    this._file = f ?? null;
    this.revoke();
    if (f) { this._objUrl = URL.createObjectURL(f); this.srcUrl.set(this._objUrl); }
    else { this.srcUrl.set(null); }
    this.ready.set(false);
  }
  /** Emits the processed image as a Blob (ready to upload). */
  @Output() applied = new EventEmitter<Blob>();
  /** Emits when the user cancels — the caller should discard the pick. */
  @Output() cancelled = new EventEmitter<void>();

  readonly ASPECTS: Array<{ label: string; value: number | null }> = [
    { label: 'Free', value: null }, { label: '1:1', value: 1 },
    { label: '4:1', value: 4 }, { label: '16:9', value: 16 / 9 },
  ];

  readonly srcUrl = signal<string | null>(null);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly aspect = signal<number | null>(null);
  readonly targetW = signal<number | null>(null);
  readonly crop = signal<Rect>({ x: 0, y: 0, w: 1, h: 1 });

  private _file: File | null = null;
  private _objUrl: string | null = null;
  private nat = { w: 1, h: 1 };
  private drag: { mode: 'move' | Handle; sx: number; sy: number; start: Rect; perPx: number } | null = null;

  /** Crop rect as % of the natural image → positions the overlay on the <img>. */
  readonly pct = computed(() => {
    const c = this.crop();
    return { x: c.x / this.nat.w * 100, y: c.y / this.nat.h * 100, w: c.w / this.nat.w * 100, h: c.h / this.nat.h * 100 };
  });
  /** Live output dimensions shown next to the width box. */
  readonly out = computed(() => computeOutputSize(this.crop().w, this.crop().h, this.targetW()));
  /** Rounded crop width — the natural cap for the output-width input. */
  readonly cropW = computed(() => Math.round(this.crop().w));

  onImgLoad() {
    const el = this.imgRef?.nativeElement;
    if (!el) return;
    this.nat = { w: el.naturalWidth || 1, h: el.naturalHeight || 1 };
    this.crop.set({ x: 0, y: 0, w: this.nat.w, h: this.nat.h });
    this.aspect.set(null);
    this.targetW.set(null);
    this.ready.set(true);
  }

  setAspect(a: number | null) {
    this.aspect.set(a);
    this.crop.set(clampRect(centeredCrop(this.nat, a), this.nat));
  }

  onWidth(raw: string) {
    const n = Math.round(Number(raw));
    this.targetW.set(Number.isFinite(n) && n > 0 ? n : null);
  }

  reset() {
    this.crop.set({ x: 0, y: 0, w: this.nat.w, h: this.nat.h });
    this.aspect.set(null);
    this.targetW.set(null);
  }

  // ── Pointer drag: convert display-px deltas to natural px via the live
  //    image scale captured at drag start (naturalWidth / clientWidth). ──
  private naturalPerPx(): number {
    const el = this.imgRef?.nativeElement;
    const cw = el?.clientWidth || this.nat.w;
    return this.nat.w / cw;
  }

  startMove(ev: PointerEvent) {
    if ((ev.target as HTMLElement).classList.contains('pf-ie__h')) return; // handle wins
    ev.preventDefault(); ev.stopPropagation();
    this.beginDrag('move', ev);
  }
  startResize(ev: PointerEvent, h: Handle) {
    ev.preventDefault(); ev.stopPropagation();
    this.beginDrag(h, ev);
  }
  private beginDrag(mode: 'move' | Handle, ev: PointerEvent) {
    this.drag = { mode, sx: ev.clientX, sy: ev.clientY, start: this.crop(), perPx: this.naturalPerPx() };
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }
  private readonly onMove = (ev: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    const dx = (ev.clientX - d.sx) * d.perPx;
    const dy = (ev.clientY - d.sy) * d.perPx;
    this.crop.set(d.mode === 'move'
      ? moveRect(d.start, dx, dy, this.nat)
      : resizeRect(d.start, d.mode, dx, dy, this.nat));
  };
  private readonly onUp = () => {
    this.drag = null;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  };

  onScrim(ev: PointerEvent) {
    if ((ev.target as HTMLElement).classList.contains('pf-ie__scrim')) this.cancel();
  }
  cancel() { this.cancelled.emit(); }

  async apply() {
    const el = this.imgRef?.nativeElement;
    if (!el || this.busy()) return;
    this.busy.set(true);
    try {
      const c = this.crop();
      const o = computeOutputSize(c.w, c.h, this.targetW());
      const canvas = document.createElement('canvas');
      canvas.width = o.w; canvas.height = o.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { this.busy.set(false); return; }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(el, c.x, c.y, c.w, c.h, 0, 0, o.w, o.h);
      const isJpeg = /jpe?g$/i.test(this._file?.type ?? '') || /jpe?g$/i.test(this._file?.name ?? '');
      const type = isJpeg ? 'image/jpeg' : 'image/png';
      const blob: Blob | null = await new Promise(res => canvas.toBlob(res, type, isJpeg ? 0.92 : undefined));
      if (blob) this.applied.emit(blob);
    } finally {
      this.busy.set(false);
    }
  }

  private revoke() { if (this._objUrl) { URL.revokeObjectURL(this._objUrl); this._objUrl = null; } }
  ngOnDestroy() { this.revoke(); this.onUp(); }
}
