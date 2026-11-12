import { ChangeDetectionStrategy, Component, ElementRef, computed, output, signal, viewChild } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { InkStroke, canvasId } from '../../canvas/canvas-model';
import { strokePath } from '../../canvas/ink';
import { PointerRouter, capturePointer, readPointer } from '../../canvas/pointer';
import { DRAW_BOX, MAX_DRAWN, safePath } from './pictureChoice-model';

const PEN_SIZE = 4.5;
/** Points closer than this (in the 100-unit pad) are dropped: a small drawing stays a short path. */
const MIN_STEP = 1.1;

/**
 * Studio: draw one part's picture with the canvas engine's own pen (same pointer router: pen draws, palm is
 * ignored, a finger or mouse draws). The result is ONE path of filled ink outlines in a 0–100 square (`drawn`).
 * Inline (never a floating window): Undo, Clear, Cancel, Use this drawing.
 */
@Component({
  selector: 'fe-picturechoice-draw',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-pcd" data-draw-pad>
      <div
        #surface
        class="fe-pcd__surface"
        role="img"
        aria-label="Drawing area for this part"
        (pointerdown)="down($event)"
        (pointermove)="move($event)"
        (pointerup)="up($event)"
        (pointercancel)="cancelPtr($event)"
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          @for (s of strokes(); track s.id) {
            <path class="fe-pcd__ink" [attr.d]="d(s)" />
          }
          @if (live(); as l) {
            <path class="fe-pcd__ink" [attr.d]="d(l)" />
          }
        </svg>
        @if (!strokes().length && !live()) {
          <span class="fe-pcd__hint">Draw here</span>
        }
      </div>
      @if (tooLong()) {
        <p class="fe-img__err" role="alert">This drawing is too detailed to keep. Undo a line or draw it simpler.</p>
      }
      <div class="fe-img__acts">
        <button type="button" class="pf-btn pf-btn--tertiary" data-act="draw-undo" [disabled]="!strokes().length" (click)="undo()">
          <pf-icon name="undo" [size]="18" /> Undo
        </button>
        <button type="button" class="pf-btn pf-btn--tertiary" data-act="draw-clear" [disabled]="!strokes().length" (click)="strokes.set([])">
          <pf-icon name="eraser" [size]="18" /> Clear
        </button>
        <button type="button" class="pf-btn pf-btn--secondary" data-act="draw-cancel" (click)="cancelled.emit()">Cancel</button>
        <button type="button" class="pf-btn pf-btn--primary" data-act="draw-done" [disabled]="!path() || tooLong()" (click)="done.emit(path()!)">
          Use this drawing
        </button>
      </div>
    </div>
  `,
})
export class PictureChoiceDrawComponent {
  private readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  readonly done = output<string>();
  readonly cancelled = output<void>();

  protected readonly strokes = signal<InkStroke[]>([]);
  protected readonly live = signal<InkStroke | null>(null);
  protected readonly d = (s: InkStroke) => strokePath(s);
  /** All strokes as one path. */
  protected readonly raw = computed(() => this.strokes().map((s) => strokePath(s)).filter(Boolean).join(' '));
  protected readonly tooLong = computed(() => this.raw().length > MAX_DRAWN);
  protected readonly path = computed(() => (this.tooLong() ? null : safePath(this.raw())));

  private rect(): DOMRect {
    return this.surface().nativeElement.getBoundingClientRect();
  }
  private toUnit(x: number, y: number): [number, number] {
    const r = this.rect();
    const k = DRAW_BOX / (r.width || DRAW_BOX);
    return [Math.min(DRAW_BOX, Math.max(0, x * k)), Math.min(DRAW_BOX, Math.max(0, y * (DRAW_BOX / (r.height || DRAW_BOX))))];
  }

  private readonly router = new PointerRouter({
    strokeStart: (x, y, p, pen) => {
      const [ux, uy] = this.toUnit(x, y);
      this.live.set({ id: canvasId('d'), color: '#111827', size: PEN_SIZE, points: [ux, uy, p || 0.5], pen });
    },
    strokeMove: (pts) => {
      const s = this.live();
      if (!s) return;
      const next = s.points.slice();
      for (const q of pts) {
        const [ux, uy] = this.toUnit(q.x, q.y);
        const n = next.length;
        if (Math.hypot(ux - next[n - 3], uy - next[n - 2]) >= MIN_STEP) next.push(ux, uy, q.pressure || 0.5);
      }
      this.live.set({ ...s, points: next });
    },
    strokeEnd: (keep) => {
      const s = this.live();
      this.live.set(null);
      if (s && keep) this.strokes.update((l) => [...l, s]);
    },
    pan: () => undefined,
    pinch: () => undefined,
  });

  protected down(ev: PointerEvent): void {
    capturePointer(ev.currentTarget as Element, ev.pointerId);
    ev.preventDefault();
    this.router.down(readPointer(ev, this.rect()));
  }
  protected move(ev: PointerEvent): void {
    this.router.move(readPointer(ev, this.rect()));
  }
  protected up(ev: PointerEvent): void {
    this.router.up(readPointer(ev, this.rect()));
  }
  protected cancelPtr(ev: PointerEvent): void {
    this.router.cancel(readPointer(ev, this.rect()));
  }
  protected undo(): void {
    this.strokes.update((l) => l.slice(0, -1));
  }
}
