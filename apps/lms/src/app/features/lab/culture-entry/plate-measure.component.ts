import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PlatformService } from '../../../core/services/platform.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { ToastService } from '../../../core/services/toast.service';
import { PlateMeasurement } from '../../../shared/models/culture.model';

type Pt = { x: number; y: number };
type Circle = { cx: number; cy: number; r: number; mm: number };
type Mode = 'capture' | 'calibrate' | 'measure';

/**
 * Camera measure-assist for antibiotic susceptibility (disk-diffusion).
 *
 * The bench tech photographs the AST plate, then:
 *   1. Calibrate — taps two opposite points on the dish rim; the known dish
 *      diameter (90 mm default) sets the pixels-per-mm scale.
 *   2. Measure — for each antibiotic, taps the disk centre and drags to the
 *      inhibition-zone edge; radius × 2 × scale = zone diameter in mm.
 *
 * Emits the measured zones (mapped to antibiotic row index) plus the uploaded
 * plate-photo URL. The tech still verifies and the CLSI engine interprets the
 * zones — this only removes the ruler and the retype.
 */
@Component({
  selector: 'pf-plate-measure',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pm-backdrop" (click)="onBackdrop($event)">
      <div class="pm-panel" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="pm-head">
          <div class="min-w-0">
            <div class="text-sm font-bold" style="color: var(--text-primary);">Measure zones from plate</div>
            <div class="text-[11px]" style="color: var(--text-tertiary);">{{ stepHint() }}</div>
          </div>
          <button type="button" class="pm-x" (click)="cancel.emit()" title="Close">×</button>
        </div>

        <!-- Capture step -->
        @if (mode() === 'capture') {
          <div class="pm-capture">
            <div class="text-5xl mb-2">📷</div>
            <p class="text-[13px] text-center mb-4" style="color: var(--text-secondary);">
              Take a clear, top-down photo of the plate with the whole dish in frame.
            </p>
            <div class="flex flex-col gap-2 w-full max-w-xs">
              @if (isNative()) {
                <button type="button" class="pm-btn pm-btn--primary" (click)="capturePhoto()">Take photo</button>
              }
              <label class="pm-btn pm-btn--ghost text-center cursor-pointer">
                {{ isNative() ? 'Choose from gallery' : 'Take / choose photo' }}
                <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" (change)="onFilePick($event)" hidden />
              </label>
            </div>
          </div>
        }

        <!-- Stage (calibrate + measure) -->
        @if (mode() !== 'capture' && imageSrc()) {
          <div class="pm-stage">
            <img class="pm-img" [src]="imageSrc()" (load)="onImgLoad($event)" alt="AST plate" />
            <svg class="pm-svg" [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet"
                 (pointerdown)="onDown($event)" (pointermove)="onMove($event)" (pointerup)="onUp($event)" (pointercancel)="onUp($event)">
              <!-- Calibration line + handles -->
              @if (calPts().length === 2) {
                <line [attr.x1]="calPts()[0].x" [attr.y1]="calPts()[0].y" [attr.x2]="calPts()[1].x" [attr.y2]="calPts()[1].y"
                      stroke="#22d3ee" [attr.stroke-width]="unit()" [attr.stroke-dasharray]="(unit()*2) + ' ' + unit()" />
                <text [attr.x]="(calPts()[0].x + calPts()[1].x)/2" [attr.y]="(calPts()[0].y + calPts()[1].y)/2 - unit()"
                      fill="#22d3ee" [attr.font-size]="unit()*3.2" text-anchor="middle" font-weight="700">{{ dishMm() }} mm</text>
              }
              @for (p of calPts(); track $index) {
                <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="unit()*1.6" fill="#22d3ee" stroke="#0b3b44" [attr.stroke-width]="unit()*0.4" />
              }

              <!-- Finalized measurement circles -->
              @for (c of circleList(); track c.index) {
                <g [attr.opacity]="c.index === activeIndex() ? 1 : 0.7">
                  <circle [attr.cx]="c.cx" [attr.cy]="c.cy" [attr.r]="c.r" fill="rgba(16,185,129,0.12)" stroke="#10b981" [attr.stroke-width]="unit()" />
                  <circle [attr.cx]="c.cx" [attr.cy]="c.cy" [attr.r]="unit()*0.9" fill="#10b981" />
                  <text [attr.x]="c.cx" [attr.y]="c.cy - c.r - unit()" fill="#10b981" [attr.font-size]="unit()*3.2" text-anchor="middle" font-weight="700">{{ c.mm }} mm</text>
                </g>
              }

              <!-- Live drag preview -->
              @if (draft(); as d) {
                <circle [attr.cx]="d.cx" [attr.cy]="d.cy" [attr.r]="draftRadius()" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" [attr.stroke-width]="unit()" />
                <circle [attr.cx]="d.cx" [attr.cy]="d.cy" [attr.r]="unit()*0.9" fill="#f59e0b" />
                <text [attr.x]="d.cx" [attr.y]="d.cy - draftRadius() - unit()" fill="#f59e0b" [attr.font-size]="unit()*3.2" text-anchor="middle" font-weight="700">{{ draftMm() }} mm</text>
              }
            </svg>
          </div>
        }

        <!-- Calibrate controls -->
        @if (mode() === 'calibrate') {
          <div class="pm-controls">
            <div class="flex items-center gap-2 mb-2">
              <label class="text-[12px]" style="color: var(--text-secondary);">Dish Ø</label>
              <input type="number" class="pf-input pf-input--compact w-20 text-center" [ngModel]="dishMm()" (ngModelChange)="dishMm.set($event || 90)" />
              <span class="text-[11px]" style="color: var(--text-tertiary);">mm (standard plate = 90)</span>
            </div>
            <div class="flex gap-2">
              <button type="button" class="pm-btn pm-btn--ghost flex-1" (click)="resetCalibration()">Re-tap rim</button>
              <button type="button" class="pm-btn pm-btn--primary flex-1" [disabled]="!calibrated()" (click)="goMeasure()">Next: measure →</button>
            </div>
          </div>
        }

        <!-- Measure controls: antibiotic chips -->
        @if (mode() === 'measure') {
          <div class="pm-controls">
            <div class="pm-chips">
              @for (ab of antibiotics; track $index) {
                <button type="button" class="pm-chip" [class.pm-chip--active]="$index === activeIndex()" [class.pm-chip--done]="hasMeasure($index)"
                        (click)="activeIndex.set($index)">
                  <span class="truncate max-w-[120px]">{{ ab || ('#' + ($index+1)) }}</span>
                  @if (hasMeasure($index)) { <span class="pm-chip-mm">{{ measureMm($index) }}</span> }
                </button>
              }
            </div>
            <div class="flex gap-2 mt-2">
              <button type="button" class="pm-btn pm-btn--ghost" (click)="mode.set('calibrate')">← Recalibrate</button>
              <button type="button" class="pm-btn pm-btn--ghost" (click)="retake()">Retake photo</button>
              <button type="button" class="pm-btn pm-btn--primary flex-1" [disabled]="busy() || circleList().length === 0" (click)="apply()">
                {{ busy() ? 'Saving…' : ('Apply ' + circleList().length + ' zone' + (circleList().length === 1 ? '' : 's')) }}
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .pm-backdrop { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.72);
      display: flex; align-items: center; justify-content: center; padding: 12px; }
    .pm-panel { width: 100%; max-width: 560px; max-height: 92vh; display: flex; flex-direction: column;
      background: var(--surface-1, #14161c); border: 1px solid var(--glass-border); border-radius: 16px; overflow: hidden; }
    .pm-head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); }
    .pm-x { font-size: 22px; line-height: 1; color: var(--text-tertiary); background: none; border: none; cursor: pointer; padding: 0 4px; }
    .pm-capture { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 20px; }
    .pm-stage { position: relative; flex: 1; min-height: 280px; background: #000; touch-action: none; overflow: hidden; }
    .pm-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; user-select: none; pointer-events: none; }
    .pm-svg { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
    .pm-controls { padding: 12px 14px; border-top: 1px solid var(--border-subtle); }
    .pm-chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
    .pm-chip { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; flex-shrink: 0;
      padding: 5px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; cursor: pointer;
      border: 1px solid var(--border-subtle); color: var(--text-secondary); background: transparent; }
    .pm-chip--active { border-color: #f59e0b; color: #f59e0b; }
    .pm-chip--done { border-color: #10b981; color: #10b981; }
    .pm-chip-mm { font-size: 10px; padding: 0 5px; border-radius: 6px; background: rgba(16,185,129,0.18); }
    .pm-btn { padding: 9px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .pm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pm-btn--primary { background: #7c3aed; color: #fff; }
    .pm-btn--ghost { background: transparent; border-color: var(--border-subtle); color: var(--text-secondary); }
    .pf-input--compact { padding: 4px 8px; font-size: 12px; }
  `]
})
export class PlateMeasureComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private readonly cap = inject(CapacitorService);
  private readonly toasts = inject(ToastService);

  /** Antibiotic row names for the active organism — chip labels + measurement index map. */
  @Input() antibiotics: string[] = [];
  /** Re-open against a previously saved plate photo (relative URL). */
  @Input() existingImageUrl?: string | null;

  @Output() applied = new EventEmitter<{ measurements: PlateMeasurement[]; imageUrl: string | null }>();
  @Output() cancel = new EventEmitter<void>();

  readonly mode = signal<Mode>('capture');
  readonly imageSrc = signal<string | null>(null);
  private photoBlob: Blob | null = null;          // null when reusing existingImageUrl
  private uploadedUrl: string | null = null;      // existing or freshly uploaded

  readonly natW = signal(0);
  readonly natH = signal(0);
  readonly dishMm = signal(90);
  readonly calPts = signal<Pt[]>([]);
  readonly activeIndex = signal(0);
  readonly busy = signal(false);

  // Finalized measurement circles keyed by antibiotic row index.
  private readonly circles = signal<Map<number, Circle>>(new Map());
  // Live drag state (center + current edge), or null when not dragging.
  readonly draft = signal<{ cx: number; cy: number; ex: number; ey: number } | null>(null);

  ngOnInit() {
    if (this.existingImageUrl) {
      this.uploadedUrl = this.existingImageUrl;
      this.imageSrc.set(this.resolve(this.existingImageUrl));
      this.mode.set('calibrate');
    }
  }

  isNative(): boolean { return this.platform.isCapacitor(); }
  readonly viewBox = computed(() => `0 0 ${this.natW() || 1} ${this.natH() || 1}`);
  /** Stroke/handle/text sizing in viewBox units so overlays look consistent at any photo resolution. */
  readonly unit = computed(() => Math.max(this.natW(), this.natH()) / 220 || 1);

  stepHint(): string {
    switch (this.mode()) {
      case 'capture': return 'Step 1 — capture the plate';
      case 'calibrate': return 'Step 2 — tap the two opposite edges of the dish rim';
      case 'measure': return 'Step 3 — tap a disk centre and drag to the zone edge';
    }
  }

  // ── Capture ──────────────────────────────────────────────────────
  async capturePhoto() {
    const dataUrl = await this.cap.captureImage();
    if (dataUrl) await this.setFromDataUrl(dataUrl);
  }
  onFilePick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    this.photoBlob = f;
    this.uploadedUrl = null;
    this.imageSrc.set(URL.createObjectURL(f));
    // Advance out of 'capture' so the photo stage (and its <img>) actually
    // renders — onImgLoad then captures the natural dimensions. Without this
    // the stage stays hidden and the load event never fires (deadlock).
    this.mode.set('calibrate');
  }
  private async setFromDataUrl(dataUrl: string) {
    this.imageSrc.set(dataUrl);
    this.uploadedUrl = null;
    this.mode.set('calibrate');
    this.photoBlob = await (await fetch(dataUrl)).blob();
  }
  retake() {
    this.imageSrc.set(null);
    this.photoBlob = null;
    this.uploadedUrl = null;
    this.calPts.set([]);
    this.circles.set(new Map());
    this.mode.set('capture');
  }

  onImgLoad(ev: Event) {
    const img = ev.target as HTMLImageElement;
    this.natW.set(img.naturalWidth);
    this.natH.set(img.naturalHeight);
    if (this.mode() === 'capture') this.mode.set('calibrate');
  }

  // ── Calibration ──────────────────────────────────────────────────
  readonly calibrated = computed(() => this.calPts().length === 2);
  readonly mmPerPx = computed(() => {
    const p = this.calPts();
    if (p.length !== 2) return 0;
    const px = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    return px > 0 ? this.dishMm() / px : 0;
  });
  resetCalibration() { this.calPts.set([]); }
  goMeasure() {
    if (!this.calibrated()) return;
    this.mode.set('measure');
    if (this.antibiotics.length) this.activeIndex.set(this.firstUnmeasured());
  }

  // ── Pointer handling ─────────────────────────────────────────────
  private toLocal(svg: SVGSVGElement, ev: PointerEvent): Pt | null {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  onDown(ev: PointerEvent) {
    const svg = ev.currentTarget as SVGSVGElement;
    const p = this.toLocal(svg, ev);
    if (!p) return;
    if (this.mode() === 'calibrate') {
      const next = this.calPts().length >= 2 ? [p] : [...this.calPts(), p];
      this.calPts.set(next);
      return;
    }
    if (this.mode() === 'measure') {
      try { svg.setPointerCapture(ev.pointerId); } catch { /* not supported */ }
      this.draft.set({ cx: p.x, cy: p.y, ex: p.x, ey: p.y });
    }
  }
  onMove(ev: PointerEvent) {
    if (this.mode() !== 'measure') return;
    const d = this.draft();
    if (!d) return;
    const svg = ev.currentTarget as SVGSVGElement;
    const p = this.toLocal(svg, ev);
    if (!p) return;
    this.draft.set({ ...d, ex: p.x, ey: p.y });
  }
  onUp(_ev: PointerEvent) {
    if (this.mode() !== 'measure') return;
    const d = this.draft();
    this.draft.set(null);
    if (!d) return;
    const rPx = Math.hypot(d.ex - d.cx, d.ey - d.cy);
    const mmpp = this.mmPerPx();
    if (!mmpp || rPx < this.unit()) return;   // ignore a stray tap with no drag
    const mm = Math.round(2 * rPx * mmpp);
    const idx = this.activeIndex();
    const next = new Map(this.circles());
    next.set(idx, { cx: d.cx, cy: d.cy, r: rPx, mm });
    this.circles.set(next);
    this.advance();
  }

  readonly draftRadius = computed(() => {
    const d = this.draft();
    return d ? Math.hypot(d.ex - d.cx, d.ey - d.cy) : 0;
  });
  draftMm(): number {
    return Math.round(2 * this.draftRadius() * this.mmPerPx());
  }

  // ── Measurement helpers ──────────────────────────────────────────
  readonly circleList = computed(() =>
    [...this.circles().entries()].map(([index, c]) => ({ index, ...c })));
  hasMeasure(i: number): boolean { return this.circles().has(i); }
  measureMm(i: number): number { return this.circles().get(i)?.mm ?? 0; }

  private firstUnmeasured(): number {
    for (let i = 0; i < this.antibiotics.length; i++) if (!this.circles().has(i)) return i;
    return this.activeIndex();
  }
  private advance() { this.activeIndex.set(this.firstUnmeasured()); }

  // ── Apply ────────────────────────────────────────────────────────
  async apply() {
    this.busy.set(true);
    try {
      if (this.photoBlob && !this.uploadedUrl) {
        this.uploadedUrl = await this.upload(this.photoBlob);
      }
    } catch {
      this.toasts.error('Plate photo upload failed — zones not applied');
      this.busy.set(false);
      return;
    }
    const measurements: PlateMeasurement[] =
      [...this.circles().entries()].map(([index, c]) => ({ index, zoneMm: c.mm }));
    this.applied.emit({ measurements, imageUrl: this.uploadedUrl });
    this.busy.set(false);
  }

  private async upload(blob: Blob): Promise<string> {
    const fd = new FormData();
    fd.append('file', blob, 'plate.jpg');
    const base = this.platform.getApiUrl();
    const resp = await firstValueFrom(this.http.post<{ success: boolean; data?: { url: string }; message?: string }>(
      `${base}/api/uploads/culture-plate`, fd));
    if (!resp?.success || !resp.data?.url) throw new Error(resp?.message ?? 'upload failed');
    return resp.data.url;
  }

  private resolve(u: string): string {
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return u;
    return `${this.platform.getApiUrl()}${u}`;
  }

  onBackdrop(_ev: Event) { /* keep open — closing is explicit via × to avoid losing measurements */ }
}
