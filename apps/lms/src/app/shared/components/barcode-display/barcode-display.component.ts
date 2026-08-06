import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js/browser';

/**
 * Renders a scannable Code128 barcode AND a QR code for the same value.
 * Scanning either yields the identical string — so receive/scan flows can
 * accept whichever the operator picks up first.
 */
@Component({
  selector: 'pf-barcode-display',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-code-card" [class.pf-code-card--bare]="bare">
      <div class="pf-code-card__row">
        <div class="pf-code-card__block" [style.display]="(mode === 'barcode' || mode === 'both') ? 'flex' : 'none'">
          <svg #barcode class="pf-code-card__bar" role="img" [attr.aria-label]="'Barcode ' + code"></svg>
          @if (!bare) { <p class="pf-code-card__caption">Barcode · Code128</p> }
        </div>
        <div class="pf-code-card__block" [style.display]="(mode === 'qr' || mode === 'both') ? 'flex' : 'none'">
          <canvas #qr class="pf-code-card__qr" [attr.aria-label]="'QR code ' + code"></canvas>
          @if (!bare) { <p class="pf-code-card__caption">QR</p> }
        </div>
        <div class="pf-code-card__block" [style.display]="mode === 'datamatrix' ? 'flex' : 'none'">
          <canvas #dmx class="pf-code-card__dmx" [attr.aria-label]="'Data Matrix ' + code"></canvas>
          @if (!bare) { <p class="pf-code-card__caption">Data Matrix</p> }
        </div>
      </div>
      @if (showValue) {
        <p class="pf-code-card__value">{{ code }}</p>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-block; }
    .pf-code-card {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      background: #ffffff;
      border: 1px solid var(--border-muted);
      border-radius: 14px;
      box-shadow: var(--shadow-sm);
    }
    .pf-code-card__row {
      display: flex;
      align-items: flex-start;
      gap: 18px;
    }
    .pf-code-card__block {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .pf-code-card__bar {
      display: block;
      height: 64px;
      width: auto;
      max-width: 260px;
    }
    .pf-code-card__qr {
      display: block;
      width: 96px;
      height: 96px;
      image-rendering: pixelated;
    }
    .pf-code-card__dmx {
      display: block;
      width: 96px;
      height: 96px;
      image-rendering: pixelated;
    }
    .pf-code-card__caption {
      margin: 0;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #64748b;
    }
    .pf-code-card__value {
      margin: 0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 12px;
      letter-spacing: 0.04em;
      color: #0f172a;
    }
    /* Bare: a compact white tile (keeps the code high-contrast + scannable),
       no captions/value/border — for inline use on a dark UI. Sized by [size]. */
    .pf-code-card--bare {
      padding: 5px;
      gap: 0;
      border: 0;
      border-radius: 8px;
      box-shadow: none;
    }
    .pf-code-card--bare .pf-code-card__row { gap: 8px; }
    .pf-code-card--bare .pf-code-card__bar { height: auto; }
  `]
})
export class BarcodeDisplayComponent implements AfterViewInit, OnChanges {
  @Input() code = '';
  /** Show the raw code/URL underneath the codes. Useful for sample
   *  tube barcodes (e.g. HAEM260800001) where the human-readable
   *  value matters; turn OFF for report verification QRs where the
   *  code is just an opaque token URL nobody needs to read. */
  @Input() showValue = true;
  /** Which symbology to display: a 1D Code128 barcode, a 2D QR, both
   *  side-by-side (default), or a Data Matrix (2D, fits a tiny tube area and
   *  scans well). All encode the identical value, so the choice is purely which
   *  label the operator wants to print/scan. */
  @Input() mode: 'both' | 'barcode' | 'qr' | 'datamatrix' = 'both';
  /** Render without the white card chrome / captions — for inline use (e.g. a
   *  small tracking QR inside an invoice) rather than a printable label. */
  @Input() bare = false;
  /** Stamp the Prefrontal mark in the centre of the QR (level-H, so it stays
   *  scannable). On by default; auto-skipped on QRs under 64px. */
  @Input() brandLogo = true;
  /** Pixel size for the QR (and a proportional barcode height). Defaults to the
   *  label size (96px QR / 64px barcode) when omitted. */
  @Input() size?: number;

  @ViewChild('barcode', { static: true }) barcodeEl!: ElementRef<SVGSVGElement>;
  @ViewChild('qr', { static: true }) qrEl!: ElementRef<HTMLCanvasElement>;
  @ViewChild('dmx', { static: true }) dmxEl!: ElementRef<HTMLCanvasElement>;

  ngAfterViewInit(): void { this.render(); }
  ngOnChanges(_: SimpleChanges): void { if (this.barcodeEl && this.qrEl) this.render(); }

  private render(): void {
    const value = (this.code || '').trim();
    if (!value) return;

    const px = this.size ?? 96;
    const barH = this.size ? Math.max(28, Math.round(this.size * 0.7)) : 64;

    // Only render the active symbology (the others are display:none). Always
    // dark-on-white so codes stay high-contrast and scannable.
    if (this.mode === 'barcode' || this.mode === 'both') {
      try {
        JsBarcode(this.barcodeEl.nativeElement, value, {
          format: 'CODE128', displayValue: false, margin: 0,
          height: barH, width: 1.6, background: '#ffffff', lineColor: '#0f172a'
        });
      } catch {
        /* ignore — JsBarcode rejects strings it can't encode */
      }
    }

    if (this.mode === 'qr' || this.mode === 'both') {
      const canvas = this.qrEl.nativeElement;
      canvas.style.width = px + 'px';
      canvas.style.height = px + 'px';
      // Level H (~30% recoverable) so the centred PF mark — which occludes a
      // small slice of the modules — never breaks decoding.
      QRCode.toCanvas(canvas, value, {
        margin: 1, width: px, errorCorrectionLevel: 'H',
        color: { dark: '#0f172a', light: '#ffffff' }
      }).then(() => this.stampLogo(canvas, px)).catch(() => { /* ignore */ });
    }

    // Data Matrix is left clean on purpose: it's chosen for its tiny footprint
    // on tube labels, and its ECC-200 layout doesn't tolerate a central
    // occlusion the way QR's does — a logo here would risk unreadable samples.
    if (this.mode === 'datamatrix') {
      // Data Matrix packs the same value into a square that stays scannable at
      // a fraction of a QR's area — ideal for narrow tube labels.
      const canvas = this.dmxEl.nativeElement;
      try {
        bwipjs.toCanvas(canvas, {
          bcid: 'datamatrix', text: value, scale: 4, paddingwidth: 1, paddingheight: 1,
          barcolor: '000000', backgroundcolor: 'ffffff'
        });
        canvas.style.width = px + 'px';
        canvas.style.height = px + 'px';
      } catch {
        /* ignore — bwip-js rejects strings it can't encode */
      }
    }
  }

  // The canonical Prefrontal glyph (viewBox 0 0 228 292) — same two paths as
  // pf-logo-mark, kept in sync here so we can paint it onto a raster canvas.
  private static readonly GLYPH = new Path2D(
    'M0 131.126V292H30.1634C29.572 247.788 28.744 156.113 30.1634 143.106C31.5829 130.099 40.2179 118.861 44.358 114.867C79.8444 80.639 117.696 104.599 132.187 120.857V81.4947C125.799 74.649 101.136 70.0852 89.6031 68.659C39.9222 63.1824 9.16731 108.022 0 131.126Z' +
    'M99 204C76.2887 212.215 47.6109 193.023 38.1479 182.469V220.976C126.154 259.996 162.35 199.583 169.447 164.499H227.113V136.26L171.222 137.116V72.0819C177.609 35.1151 211.735 26.4439 228 26.7291V0.201972C161.463 -4.07659 142.833 60.9576 140.171 68.659C137.51 76.3604 141.058 161.932 136.623 172.2L136.585 172.287C132.16 182.532 127.31 193.76 99 204Z'
  );

  /** Paint the PF mark on a white tile at the centre of a rendered QR. Skipped
   *  on tiny QRs so small inline tracking codes stay unobstructed. */
  private stampLogo(canvas: HTMLCanvasElement, px: number): void {
    if (!this.brandLogo || px < 64) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Backing store may be a device-pixel multiple of the CSS px — scale so our
    // maths is in the same units the QR was drawn in.
    const s = canvas.width / px;
    ctx.save();
    ctx.scale(s, s);

    const tile = Math.round(px * 0.28);            // white knock-out ≈ 8% area
    const cx = px / 2, cy = px / 2;
    const r = Math.max(3, tile * 0.22);            // rounded corners

    // White rounded tile with a hairline so it reads as a deliberate badge.
    ctx.beginPath();
    ctx.roundRect(cx - tile / 2, cy - tile / 2, tile, tile, r);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Glyph fills ~72% of the tile, centred, in brand violet.
    const g = tile * 0.72;
    const scale = g / 292;                         // viewBox height
    const gw = 228 * scale;
    ctx.translate(cx - gw / 2, cy - g / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#7c3aed';
    ctx.fill(BarcodeDisplayComponent.GLYPH);
    ctx.restore();
  }
}
