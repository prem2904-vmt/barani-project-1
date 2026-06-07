import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PlatformService } from '../../../core/services/platform.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { ToastService } from '../../../core/services/toast.service';
import { PlateMeasurement } from '../../../shared/models/culture.model';

type Pt = { x: number; y: number };
type Mode = 'capture' | 'calibrate' | 'measure';
/** An editable inhibition-zone circle on the plate (image px), optionally
 *  assigned to an antibiotic row. */
interface Zone { cx: number; cy: number; r: number; abIndex: number | null; auto: boolean; conf?: number; }
type DragKind = 'move' | 'resize' | 'create';

interface AnalyzedCircle { cx: number; cy: number; r: number; }
interface AnalyzedZone { cx: number; cy: number; r: number; diameterMm: number; confidence: number; }
interface PlateAnalysis {
  imageWidth: number; imageHeight: number;
  dish?: AnalyzedCircle | null; mmPerPx?: number | null; zones: AnalyzedZone[];
}

/**
 * Full-screen plate measure-assist. Capture/upload a plate photo → calibrate
 * (auto or tap the dish rim) → measure zones. Auto-detect proposes circles; the
 * tech then edits them like a drawing tool — drag the centre to move, drag the
 * edge to resize — and assigns each to its antibiotic. Emits measured zone
 * diameters (mm) per antibiotic row + the uploaded plate photo.
 */
@Component({
  selector: 'pf-plate-measure',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pm-root">
      <!-- Header -->
      <div class="pm-head">
        <div class="min-w-0">
          <div class="text-sm font-bold" style="color: var(--text-primary);">Measure zones from plate</div>
          <div class="text-[11px]" style="color: var(--text-tertiary);">{{ stepHint() }}</div>
        </div>
        <button type="button" class="pm-x" (click)="close()" title="Close">×</button>
      </div>

      <!-- Capture step -->
      @if (mode() === 'capture') {
        <div class="pm-capture">
          @if (!isNative() && camStream()) {
            <video #cam class="pm-cam" autoplay playsinline muted></video>
            <p class="text-[12px] text-center mt-2 mb-3" style="color: var(--text-tertiary);">Frame the whole dish, top-down, then capture.</p>
            <div class="flex flex-col gap-2 w-full max-w-xs">
              <button type="button" class="pm-btn pm-btn--primary" (click)="captureFromVideo()">📸 Capture</button>
              <label class="pm-btn pm-btn--ghost text-center cursor-pointer">
                Upload a photo instead
                <input type="file" accept="image/png,image/jpeg,image/webp" (change)="onFilePick($event)" hidden />
              </label>
            </div>
          } @else {
            <div class="text-5xl mb-2">📷</div>
            <p class="text-[13px] text-center mb-1" style="color: var(--text-secondary);">Take a clear, top-down photo of the plate with the whole dish in frame.</p>
            @if (camError()) { <p class="text-[12px] text-center mb-2" style="color: #fca5a5;">{{ camError() }}</p> }
            <div class="flex flex-col gap-2 w-full max-w-xs">
              @if (isNative()) {
                <button type="button" class="pm-btn pm-btn--primary" (click)="capturePhoto()">Take photo</button>
              } @else {
                <button type="button" class="pm-btn pm-btn--primary" (click)="startCamera()">Open camera</button>
              }
              <label class="pm-btn pm-btn--ghost text-center cursor-pointer">
                {{ isNative() ? 'Choose from gallery' : 'Upload a photo' }}
                <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" (change)="onFilePick($event)" hidden />
              </label>
            </div>
          }
        </div>
      }

      <!-- Stage -->
      @if (mode() !== 'capture' && imageSrc()) {
        <div class="pm-stage">
          <img class="pm-img" [src]="imageSrc()" (load)="onImgLoad($event)" alt="AST plate" />
          <svg class="pm-svg" [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet"
               (pointerdown)="onDown($event)" (pointermove)="onMove($event)" (pointerup)="onUp($event)" (pointercancel)="onUp($event)">
            <!-- Calibration -->
            @if (calPts().length === 2) {
              <line [attr.x1]="calPts()[0].x" [attr.y1]="calPts()[0].y" [attr.x2]="calPts()[1].x" [attr.y2]="calPts()[1].y"
                    stroke="#22d3ee" [attr.stroke-width]="unit()" [attr.stroke-dasharray]="(unit()*2) + ' ' + unit()" />
              <text [attr.x]="(calPts()[0].x + calPts()[1].x)/2" [attr.y]="(calPts()[0].y + calPts()[1].y)/2 - unit()"
                    fill="#22d3ee" [attr.font-size]="unit()*3" text-anchor="middle" font-weight="700">{{ dishMm() }} mm</text>
            }
            @for (p of calPts(); track $index) {
              <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="unit()*1.6" fill="#22d3ee" stroke="#0b3b44" [attr.stroke-width]="unit()*0.4" />
            }

            <!-- Editable zones -->
            @if (mode() === 'measure') {
              @for (z of zones(); track $index) {
                <g [attr.opacity]="$index === selected() ? 1 : 0.85">
                  <circle [attr.cx]="z.cx" [attr.cy]="z.cy" [attr.r]="z.r"
                          [attr.fill]="zoneFill($index)" [attr.stroke]="zoneStroke(z)"
                          [attr.stroke-width]="$index === selected() ? unit()*1.6 : unit()" />
                  <!-- centre move-handle -->
                  <circle [attr.cx]="z.cx" [attr.cy]="z.cy" [attr.r]="unit()*1.5" [attr.fill]="zoneStroke(z)" />
                  <!-- resize handles on the selected zone (N/E/S/W) -->
                  @if ($index === selected()) {
                    <rect [attr.x]="z.cx + z.r - unit()*1.4" [attr.y]="z.cy - unit()*1.4" [attr.width]="unit()*2.8" [attr.height]="unit()*2.8" fill="#fff" [attr.stroke]="zoneStroke(z)" [attr.stroke-width]="unit()*0.5" />
                    <rect [attr.x]="z.cx - z.r - unit()*1.4" [attr.y]="z.cy - unit()*1.4" [attr.width]="unit()*2.8" [attr.height]="unit()*2.8" fill="#fff" [attr.stroke]="zoneStroke(z)" [attr.stroke-width]="unit()*0.5" />
                    <rect [attr.x]="z.cx - unit()*1.4" [attr.y]="z.cy + z.r - unit()*1.4" [attr.width]="unit()*2.8" [attr.height]="unit()*2.8" fill="#fff" [attr.stroke]="zoneStroke(z)" [attr.stroke-width]="unit()*0.5" />
                    <rect [attr.x]="z.cx - unit()*1.4" [attr.y]="z.cy - z.r - unit()*1.4" [attr.width]="unit()*2.8" [attr.height]="unit()*2.8" fill="#fff" [attr.stroke]="zoneStroke(z)" [attr.stroke-width]="unit()*0.5" />
                  }
                  <text [attr.x]="z.cx" [attr.y]="z.cy - z.r - unit()" [attr.fill]="zoneStroke(z)" [attr.font-size]="unit()*3" text-anchor="middle" font-weight="700">{{ mmOf(z) }}mm {{ abShort(z.abIndex) }}</text>
                </g>
              }
            }
          </svg>
        </div>
      }

      <!-- Calibrate controls -->
      @if (mode() === 'calibrate') {
        <div class="pm-controls">
          <button type="button" class="pm-btn pm-btn--primary w-full mb-2" [disabled]="analyzing()" (click)="autoDetect()">
            {{ analyzing() ? 'Analyzing…' : '✨ Auto-detect dish + zones' }}
          </button>
          <div class="text-[11px] text-center mb-2" style="color: var(--text-tertiary);">— or calibrate manually: tap the two rim edges —</div>
          <div class="flex items-center gap-2 mb-2">
            <label class="text-[12px]" style="color: var(--text-secondary);">Dish Ø</label>
            <input type="number" class="pf-input pf-input--compact w-20 text-center" [ngModel]="dishMm()" (ngModelChange)="dishMm.set($event || 90)" />
            <span class="text-[11px]" style="color: var(--text-tertiary);">mm (standard plate = 90)</span>
          </div>
          <div class="flex gap-2">
            <button type="button" class="pm-btn pm-btn--ghost flex-1" (click)="resetCalibration()">Re-tap rim</button>
            <button type="button" class="pm-btn pm-btn--primary flex-1" [disabled]="!calibrated()" (click)="goMeasure()">Measure →</button>
          </div>
        </div>
      }

      <!-- Measure controls -->
      @if (mode() === 'measure') {
        <div class="pm-controls">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-[11px]" style="color: var(--text-tertiary);">
              Drag a circle's centre to move, its edge to resize. Tap empty agar to add one. Tap a chip to assign the selected circle.
            </span>
            @if (selected() >= 0) {
              <button type="button" class="ml-auto text-[11px] font-semibold text-rose-400" (click)="deleteSelected()">Delete circle</button>
            }
          </div>
          <div class="pm-chips">
            @for (ab of antibiotics; track $index) {
              <button type="button" class="pm-chip" [class.pm-chip--active]="$index === activeIndex()" [class.pm-chip--done]="hasZone($index)"
                      (click)="onChip($index)">
                <span class="truncate max-w-[120px]">{{ ab || ('#' + ($index+1)) }}</span>
                @if (hasZone($index)) { <span class="pm-chip-mm">{{ mmFor($index) }}</span> }
              </button>
            }
          </div>
          <div class="flex gap-2 mt-2">
            <button type="button" class="pm-btn pm-btn--ghost" (click)="mode.set('calibrate')">← Recalibrate</button>
            <button type="button" class="pm-btn pm-btn--ghost" (click)="retake()">Retake</button>
            <button type="button" class="pm-btn pm-btn--ghost" [disabled]="analyzing()" (click)="autoDetect()">{{ analyzing() ? '…' : '✨ Re-detect' }}</button>
            <button type="button" class="pm-btn pm-btn--primary flex-1" [disabled]="busy() || assignedCount() === 0" (click)="apply()">
              {{ busy() ? 'Saving…' : ('Apply ' + assignedCount() + ' zone' + (assignedCount() === 1 ? '' : 's')) }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .pm-root { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column;
      background: var(--surface-1, #0e1016); }
    .pm-head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
    .pm-x { font-size: 24px; line-height: 1; color: var(--text-tertiary); background: none; border: none; cursor: pointer; padding: 0 6px; }
    .pm-capture { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 20px; }
    .pm-cam { width: 100%; max-width: 520px; aspect-ratio: 4 / 3; border-radius: 12px; background: #000; object-fit: cover; border: 1px solid var(--glass-border); }
    .pm-stage { position: relative; flex: 1; min-height: 0; background: #000; touch-action: none; overflow: hidden; }
    .pm-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; user-select: none; pointer-events: none; }
    .pm-svg { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
    .pm-controls { padding: 12px 14px; border-top: 1px solid var(--border-subtle); flex-shrink: 0; max-height: 42vh; overflow-y: auto; }
    .pm-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .pm-chip { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
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
export class PlateMeasureComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private readonly cap = inject(CapacitorService);
  private readonly toasts = inject(ToastService);

  @Input() antibiotics: string[] = [];
  @Input() existingImageUrl?: string | null;

  @Output() applied = new EventEmitter<{ measurements: PlateMeasurement[]; imageUrl: string | null }>();
  @Output() cancel = new EventEmitter<void>();

  readonly mode = signal<Mode>('capture');
  readonly imageSrc = signal<string | null>(null);
  private photoBlob: Blob | null = null;
  private uploadedUrl: string | null = null;

  readonly natW = signal(0);
  readonly natH = signal(0);
  readonly dishMm = signal(90);
  readonly calPts = signal<Pt[]>([]);
  readonly activeIndex = signal(0);
  readonly busy = signal(false);
  readonly analyzing = signal(false);

  // Editable zones + current selection (index into the array, -1 = none).
  readonly zones = signal<Zone[]>([]);
  readonly selected = signal(-1);
  private drag: { kind: DragKind; i: number; offx: number; offy: number } | null = null;

  // Live web camera
  private readonly camEl = viewChild<ElementRef<HTMLVideoElement>>('cam');
  private readonly _camStream = signal<MediaStream | null>(null);
  readonly camStream = this._camStream.asReadonly();
  readonly camError = signal('');

  constructor() {
    effect(() => {
      const v = this.camEl()?.nativeElement;
      const s = this._camStream();
      if (v && s && v.srcObject !== s) { v.srcObject = s; v.play().catch(() => undefined); }
    });
  }

  ngOnInit() {
    if (this.existingImageUrl) {
      this.uploadedUrl = this.existingImageUrl;
      this.imageSrc.set(this.resolve(this.existingImageUrl));
      this.mode.set('calibrate');
      return;
    }
    if (!this.isNative()) void this.startCamera();
  }

  ngOnDestroy() { this.stopCamera(); }
  close() { this.stopCamera(); this.cancel.emit(); }

  isNative(): boolean { return this.platform.isCapacitor(); }
  readonly viewBox = computed(() => `0 0 ${this.natW() || 1} ${this.natH() || 1}`);
  readonly unit = computed(() => Math.max(this.natW(), this.natH()) / 220 || 1);

  stepHint(): string {
    switch (this.mode()) {
      case 'capture': return 'Step 1 — capture the plate';
      case 'calibrate': return 'Step 2 — auto-detect, or tap the two opposite rim edges';
      case 'measure': return 'Step 3 — drag circles to fit each zone, assign to an antibiotic';
    }
  }

  // ── Camera ───────────────────────────────────────────────────────
  async capturePhoto() { const d = await this.cap.captureImage(); if (d) await this.setFromDataUrl(d); }
  onFilePick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0]; input.value = '';
    if (!f) return;
    this.stopCamera();
    this.photoBlob = f; this.uploadedUrl = null;
    this.imageSrc.set(URL.createObjectURL(f)); this.mode.set('calibrate');
  }
  private async setFromDataUrl(dataUrl: string) {
    this.imageSrc.set(dataUrl); this.uploadedUrl = null; this.mode.set('calibrate');
    this.photoBlob = await (await fetch(dataUrl)).blob();
  }
  retake() {
    this.imageSrc.set(null); this.photoBlob = null; this.uploadedUrl = null;
    this.calPts.set([]); this.zones.set([]); this.selected.set(-1);
    this.mode.set('capture');
    if (!this.isNative()) void this.startCamera();
  }
  async startCamera() {
    this.camError.set('');
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) { this.camError.set('Camera not supported here — upload a photo instead.'); return; }
    try { this._camStream.set(await md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })); }
    catch { this.camError.set('Camera unavailable or blocked — upload a photo instead.'); }
  }
  stopCamera() {
    const s = this._camStream();
    if (s) { s.getTracks().forEach(t => t.stop()); this._camStream.set(null); }
  }
  captureFromVideo() {
    const v = this.camEl()?.nativeElement;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    this.stopCamera();
    void this.setFromDataUrl(canvas.toDataURL('image/jpeg', 0.92));
  }
  onImgLoad(ev: Event) {
    const img = ev.target as HTMLImageElement;
    this.natW.set(img.naturalWidth); this.natH.set(img.naturalHeight);
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
  goMeasure() { if (this.calibrated()) this.mode.set('measure'); }

  // ── Auto-detect ──────────────────────────────────────────────────
  async autoDetect() {
    const blob = this.photoBlob;
    if (!blob) { this.toasts.error('Take or upload a photo first.'); return; }
    this.analyzing.set(true);
    try {
      const fd = new FormData();
      fd.append('file', blob, 'plate.jpg'); fd.append('dishMm', String(this.dishMm()));
      const resp = await firstValueFrom(this.http.post<{ success: boolean; data?: PlateAnalysis; message?: string }>(
        `${this.platform.getApiUrl()}/api/microbiology/analyze-plate`, fd));
      const data = resp?.data;
      if (!resp?.success || !data?.dish) { this.toasts.error(resp?.message || 'Could not find the dish — calibrate and measure manually.'); return; }
      const d = data.dish;
      this.calPts.set([{ x: d.cx - d.r, y: d.cy }, { x: d.cx + d.r, y: d.cy }]);
      const detected = (data.zones ?? []).map((z, i) => ({
        cx: z.cx, cy: z.cy, r: z.r, abIndex: i < this.antibiotics.length ? i : null, auto: true, conf: z.confidence,
      } as Zone));
      this.zones.set(detected);
      this.selected.set(-1);
      this.mode.set('measure');
      const n = detected.length;
      if (n) this.toasts.success(`Detected ${n} zone${n === 1 ? '' : 's'} — drag each to fit, then Apply.`);
      else this.toasts.warning('Dish calibrated, but no zones detected — draw them manually.');
    } catch { this.toasts.error('Auto-detect failed — measure manually.'); }
    finally { this.analyzing.set(false); }
  }

  // ── Pointer handling ─────────────────────────────────────────────
  private toLocal(svg: SVGSVGElement, ev: PointerEvent): Pt | null {
    const ctm = svg.getScreenCTM(); if (!ctm) return null;
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  onDown(ev: PointerEvent) {
    const svg = ev.currentTarget as SVGSVGElement;
    const p = this.toLocal(svg, ev); if (!p) return;

    if (this.mode() === 'calibrate') {
      const next = this.calPts().length >= 2 ? [p] : [...this.calPts(), p];
      this.calPts.set(next);
      return;
    }
    if (this.mode() !== 'measure') return;

    const tol = this.unit() * 5;
    const zs = this.zones();
    // Topmost first.
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      const d = Math.hypot(p.x - z.cx, p.y - z.cy);
      if (d <= Math.max(tol, this.unit() * 2)) {                 // centre → move
        this.selectZone(i); this.drag = { kind: 'move', i, offx: p.x - z.cx, offy: p.y - z.cy };
        try { svg.setPointerCapture(ev.pointerId); } catch { /* */ }
        return;
      }
      if (Math.abs(d - z.r) <= tol) {                            // edge → resize
        this.selectZone(i); this.drag = { kind: 'resize', i, offx: 0, offy: 0 };
        try { svg.setPointerCapture(ev.pointerId); } catch { /* */ }
        return;
      }
    }
    // Empty agar → create a new circle for the active antibiotic.
    const abIndex = this.firstFreeAntibiotic();
    const next = [...zs, { cx: p.x, cy: p.y, r: 0, abIndex, auto: false } as Zone];
    this.zones.set(next); this.selectZone(next.length - 1);
    this.drag = { kind: 'create', i: next.length - 1, offx: 0, offy: 0 };
    try { svg.setPointerCapture(ev.pointerId); } catch { /* */ }
  }

  onMove(ev: PointerEvent) {
    if (!this.drag || this.mode() !== 'measure') return;
    const p = this.toLocal(ev.currentTarget as SVGSVGElement, ev); if (!p) return;
    const i = this.drag.i;
    this.zones.update(zs => zs.map((z, k) => {
      if (k !== i) return z;
      if (this.drag!.kind === 'move') return { ...z, cx: p.x - this.drag!.offx, cy: p.y - this.drag!.offy };
      return { ...z, r: Math.max(1, Math.hypot(p.x - z.cx, p.y - z.cy)) };   // resize / create
    }));
  }

  onUp(_ev: PointerEvent) {
    if (!this.drag) return;
    const { kind, i } = this.drag;
    this.drag = null;
    if (kind === 'create' && (this.zones()[i]?.r ?? 0) < this.unit() * 2) {
      // Tiny accidental tap — discard.
      this.zones.update(zs => zs.filter((_, k) => k !== i));
      this.selected.set(-1);
    }
  }

  // ── Zones / antibiotic assignment ────────────────────────────────
  private selectZone(i: number) {
    this.selected.set(i);
    const ab = this.zones()[i]?.abIndex;
    if (ab != null) this.activeIndex.set(ab);
  }
  /** First antibiotic without a zone yet (so new circles auto-assign sensibly). */
  private firstFreeAntibiotic(): number | null {
    const taken = new Set(this.zones().map(z => z.abIndex).filter(v => v != null));
    if (!taken.has(this.activeIndex())) return this.activeIndex();
    for (let i = 0; i < this.antibiotics.length; i++) if (!taken.has(i)) return i;
    return null;
  }
  /** Tap a chip: set it active, and assign the selected circle to it (one zone per antibiotic). */
  onChip(i: number) {
    this.activeIndex.set(i);
    const sel = this.selected();
    if (sel < 0) return;
    this.zones.update(zs => zs.map((z, k) => {
      if (k === sel) return { ...z, abIndex: i };
      if (z.abIndex === i) return { ...z, abIndex: null };   // steal the assignment
      return z;
    }));
  }
  deleteSelected() {
    const sel = this.selected();
    if (sel < 0) return;
    this.zones.update(zs => zs.filter((_, k) => k !== sel));
    this.selected.set(-1);
  }

  mmOf(z: Zone): number { return Math.round(2 * z.r * this.mmPerPx()); }
  zoneFor(i: number): Zone | undefined { return this.zones().find(z => z.abIndex === i); }
  hasZone(i: number): boolean { return this.zones().some(z => z.abIndex === i); }
  mmFor(i: number): number { const z = this.zoneFor(i); return z ? this.mmOf(z) : 0; }
  abShort(i: number | null): string {
    if (i == null) return '?';
    const n = this.antibiotics[i] ?? '';
    return n ? n.slice(0, 10) : '#' + (i + 1);
  }
  zoneStroke(z: Zone): string { return z.abIndex == null ? '#f59e0b' : '#10b981'; }
  zoneFill(i: number): string { return i === this.selected() ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.08)'; }
  readonly assignedCount = computed(() => this.zones().filter(z => z.abIndex != null && z.r > 0).length);

  // ── Apply ────────────────────────────────────────────────────────
  async apply() {
    this.busy.set(true);
    try { if (this.photoBlob && !this.uploadedUrl) this.uploadedUrl = await this.upload(this.photoBlob); }
    catch { this.toasts.error('Plate photo upload failed — zones not applied'); this.busy.set(false); return; }
    const measurements: PlateMeasurement[] = this.zones()
      .filter(z => z.abIndex != null && z.r > 0)
      .map(z => ({ index: z.abIndex as number, zoneMm: this.mmOf(z) }));
    this.applied.emit({ measurements, imageUrl: this.uploadedUrl });
    this.busy.set(false);
  }
  private async upload(blob: Blob): Promise<string> {
    const fd = new FormData(); fd.append('file', blob, 'plate.jpg');
    const resp = await firstValueFrom(this.http.post<{ success: boolean; data?: { url: string }; message?: string }>(
      `${this.platform.getApiUrl()}/api/uploads/culture-plate`, fd));
    if (!resp?.success || !resp.data?.url) throw new Error(resp?.message ?? 'upload failed');
    return resp.data.url;
  }
  private resolve(u: string): string {
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return u;
    return `${this.platform.getApiUrl()}${u}`;
  }
}
