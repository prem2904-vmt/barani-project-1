import { Component, ElementRef, EventEmitter, Input, Output, ViewChild, AfterViewInit, OnDestroy, signal } from '@angular/core';

/**
 * Adobe-Sign-style draw-to-sign modal. The user draws with mouse/stylus/finger
 * on a canvas; Save exports a trimmed transparent PNG data URL (black ink), so
 * it drops cleanly onto invoices and reports. Fully self-contained (own overlay,
 * pointer-event drawing) — no external signature library.
 *
 * Usage:
 *   @if (showPad()) {
 *     <pf-signature-pad [initialDataUrl]="current()"
 *       (saved)="onSaved($event)" (cancelled)="showPad.set(false)"></pf-signature-pad>
 *   }
 */
@Component({
  selector: 'pf-signature-pad',
  standalone: true,
  template: `
    <div class="pf-sig-overlay" (click)="onBackdrop($event)">
      <div class="pf-sig-card" role="dialog" aria-modal="true" aria-label="Draw your signature">
        <div class="pf-sig-head">
          <h3>Draw your signature</h3>
          <button type="button" class="pf-sig-x" (click)="cancel()" aria-label="Close">✕</button>
        </div>

        <div class="pf-sig-canvas-wrap">
          <canvas #pad class="pf-sig-canvas"
            (pointerdown)="down($event)" (pointermove)="move($event)"
            (pointerup)="up($event)" (pointerleave)="up($event)" (pointercancel)="up($event)"></canvas>
          <div class="pf-sig-baseline"></div>
          @if (empty()) { <span class="pf-sig-hint">Sign here</span> }
        </div>

        <div class="pf-sig-actions">
          <button type="button" class="pf-sig-btn pf-sig-btn--ghost" (click)="clear()" [disabled]="empty()">Clear</button>
          <span class="pf-sig-spacer"></span>
          <button type="button" class="pf-sig-btn pf-sig-btn--ghost" (click)="cancel()">Cancel</button>
          <button type="button" class="pf-sig-btn pf-sig-btn--primary" (click)="save()" [disabled]="empty()">Save signature</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pf-sig-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
      background: rgba(2, 6, 23, 0.62); backdrop-filter: blur(4px); padding: 16px; }
    .pf-sig-card { width: min(560px, 100%); background: var(--bg-elevated, #0f172a); color: var(--text-primary, #e2e8f0);
      border: 1px solid var(--glass-border, rgba(148,163,184,0.18)); border-radius: 18px; box-shadow: 0 24px 60px rgba(0,0,0,0.5);
      padding: 18px; }
    .pf-sig-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .pf-sig-head h3 { font-size: 15px; font-weight: 700; margin: 0; }
    .pf-sig-x { background: transparent; border: 0; color: var(--text-tertiary, #94a3b8); font-size: 15px; cursor: pointer;
      width: 30px; height: 30px; border-radius: 8px; }
    .pf-sig-x:hover { background: rgba(148,163,184,0.12); color: var(--text-primary, #e2e8f0); }
    .pf-sig-canvas-wrap { position: relative; border: 1px dashed var(--glass-border, rgba(148,163,184,0.35)); border-radius: 12px;
      background: #ffffff; overflow: hidden; touch-action: none; }
    .pf-sig-canvas { display: block; width: 100%; height: 200px; cursor: crosshair; touch-action: none; }
    .pf-sig-baseline { position: absolute; left: 24px; right: 24px; bottom: 46px; border-bottom: 1px solid #cbd5e1; pointer-events: none; }
    .pf-sig-hint { position: absolute; left: 28px; bottom: 50px; color: #94a3b8; font-size: 13px; pointer-events: none; user-select: none; }
    .pf-sig-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
    .pf-sig-spacer { flex: 1; }
    .pf-sig-btn { border-radius: 10px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .pf-sig-btn--ghost { background: transparent; border-color: var(--glass-border, rgba(148,163,184,0.28)); color: var(--text-secondary, #cbd5e1); }
    .pf-sig-btn--ghost:hover:not(:disabled) { background: rgba(148,163,184,0.12); }
    .pf-sig-btn--primary { background: var(--violet-600, #7c3aed); color: #fff; }
    .pf-sig-btn--primary:hover:not(:disabled) { filter: brightness(1.08); }
    .pf-sig-btn:disabled { opacity: 0.45; cursor: default; }
  
    /* Short viewports (phone landscape): overlay scrolls, canvas shrinks —
       Save/Clear must never sit off-screen. */
    .pf-sig-overlay { overflow-y: auto; }
    .pf-sig-card { max-height: 100dvh; }
    @media (max-height: 500px) {
      .pf-sig-overlay { align-items: flex-start; }
      .pf-sig-canvas { height: 140px; }
    }
`],
})
export class SignaturePadComponent implements AfterViewInit, OnDestroy {
  /** Optional existing signature to seed the canvas for re-editing. */
  @Input() initialDataUrl: string | null = null;
  @Output() saved = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('pad', { static: true }) padRef!: ElementRef<HTMLCanvasElement>;
  readonly empty = signal(true);

  private ctx: CanvasRenderingContext2D | null = null;
  private drawing = false;
  private last: { x: number; y: number } | null = null;
  private ro: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    this.setupCanvas();
    // Re-fit to the device pixel ratio when the modal (or window) resizes so
    // strokes stay crisp; preserves what's already drawn.
    this.ro = new ResizeObserver(() => this.setupCanvas(true));
    this.ro.observe(this.padRef.nativeElement);
  }

  ngOnDestroy(): void { this.ro?.disconnect(); }

  private setupCanvas(preserve = false): void {
    const canvas = this.padRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const prev = preserve && this.ctx ? canvas.toDataURL('image/png') : this.initialDataUrl;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#111111';
    this.ctx = ctx;
    if (prev) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, rect.width, rect.height); this.empty.set(false); };
      img.src = prev;
    }
  }

  private pos(e: PointerEvent): { x: number; y: number } {
    const rect = this.padRef.nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  down(e: PointerEvent): void {
    if (!this.ctx) return;
    e.preventDefault();
    this.padRef.nativeElement.setPointerCapture(e.pointerId);
    this.drawing = true;
    this.last = this.pos(e);
    // A dot so a tap registers.
    this.ctx.beginPath();
    this.ctx.arc(this.last.x, this.last.y, 1.2, 0, Math.PI * 2);
    this.ctx.fillStyle = '#111111';
    this.ctx.fill();
    this.empty.set(false);
  }

  move(e: PointerEvent): void {
    if (!this.drawing || !this.ctx || !this.last) return;
    e.preventDefault();
    const p = this.pos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(this.last.x, this.last.y);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
    this.last = p;
  }

  up(e: PointerEvent): void {
    if (!this.drawing) return;
    e.preventDefault();
    this.drawing = false;
    this.last = null;
  }

  clear(): void {
    const canvas = this.padRef.nativeElement;
    this.ctx?.clearRect(0, 0, canvas.width, canvas.height);
    this.empty.set(true);
  }

  save(): void {
    if (this.empty()) return;
    const trimmed = this.trimmed();
    this.saved.emit(trimmed);
  }

  cancel(): void { this.cancelled.emit(); }
  onBackdrop(e: MouseEvent): void { if ((e.target as HTMLElement).classList.contains('pf-sig-overlay')) this.cancel(); }

  /** Crop the transparent canvas to the drawn ink bounding box (with a small
   *  margin) so the exported PNG is a tight signature, not a big empty frame. */
  private trimmed(): string {
    const canvas = this.padRef.nativeElement;
    const w = canvas.width, h = canvas.height;
    const ctx = this.ctx;
    if (!ctx) return canvas.toDataURL('image/png');
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 12) { // alpha
          found = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return canvas.toDataURL('image/png');
    const pad = 8;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d')!.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
    return out.toDataURL('image/png');
  }
}
