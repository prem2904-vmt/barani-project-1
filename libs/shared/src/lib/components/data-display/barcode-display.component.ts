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
    <div [class]="bare ? 'inline-flex flex-col items-center rounded-lg bg-white p-[5px]' : 'inline-flex flex-col items-center gap-2.5 rounded-[14px] border border-[var(--border-muted)] bg-white px-4 py-3.5 shadow-sm'">
      <div [class]="'flex items-start' + (bare ? ' gap-2' : ' gap-[18px]')">
        <div class="flex flex-col items-center gap-1" [class.hidden]="mode !== 'barcode' && mode !== 'both'">
          <svg #barcode [class]="'block w-auto max-w-[260px]' + (bare ? ' h-auto' : ' h-16')" role="img" [attr.aria-label]="'Barcode ' + code"></svg>
          @if (!bare) { <p class="m-0 text-[10px] uppercase tracking-[0.12em] text-slate-500">Barcode · Code128</p> }
        </div>
        <div class="flex flex-col items-center gap-1" [class.hidden]="mode !== 'qr' && mode !== 'both'">
          <canvas #qr class="block size-24 [image-rendering:pixelated]" [attr.aria-label]="'QR code ' + code"></canvas>
          @if (!bare) { <p class="m-0 text-[10px] uppercase tracking-[0.12em] text-slate-500">QR</p> }
        </div>
        <div class="flex flex-col items-center gap-1" [class.hidden]="mode !== 'datamatrix'">
          <canvas #dmx class="block size-24 [image-rendering:pixelated]" [attr.aria-label]="'Data Matrix ' + code"></canvas>
          @if (!bare) { <p class="m-0 text-[10px] uppercase tracking-[0.12em] text-slate-500">Data Matrix</p> }
        </div>
      </div>
      @if (showValue) {
        <p class="m-0 text-xs tracking-wide tabular-nums text-slate-900">{{ code }}</p>
      }
    </div>
  `,
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
  // Built lazily on first paint (not in a static initializer): Path2D is a
  // browser API, and creating it at class-load time breaks any environment
  // without it (jsdom specs that merely import a page embedding this).
  private static glyph: Path2D | null = null;
  private static readonly GLYPH_D =
    'M0 131.126V292H30.1634C29.572 247.788 28.744 156.113 30.1634 143.106C31.5829 130.099 40.2179 118.861 44.358 114.867C79.8444 80.639 117.696 104.599 132.187 120.857V81.4947C125.799 74.649 101.136 70.0852 89.6031 68.659C39.9222 63.1824 9.16731 108.022 0 131.126Z' +
    'M99 204C76.2887 212.215 47.6109 193.023 38.1479 182.469V220.976C126.154 259.996 162.35 199.583 169.447 164.499H227.113V136.26L171.222 137.116V72.0819C177.609 35.1151 211.735 26.4439 228 26.7291V0.201972C161.463 -4.07659 142.833 60.9576 140.171 68.659C137.51 76.3604 141.058 161.932 136.623 172.2L136.585 172.287C132.16 182.532 127.31 193.76 99 204Z';
  private static get GLYPH(): Path2D {
    return (BarcodeDisplayComponent.glyph ??= new Path2D(BarcodeDisplayComponent.GLYPH_D));
  }

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
