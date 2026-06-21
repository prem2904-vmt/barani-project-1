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
        <div class="pf-code-card__block" [style.display]="mode === 'qr' ? 'none' : 'flex'">
          <svg #barcode class="pf-code-card__bar" role="img" [attr.aria-label]="'Barcode ' + code"></svg>
          @if (!bare) { <p class="pf-code-card__caption">Barcode · Code128</p> }
        </div>
        <div class="pf-code-card__block" [style.display]="mode === 'barcode' ? 'none' : 'flex'">
          <canvas #qr class="pf-code-card__qr" [attr.aria-label]="'QR code ' + code"></canvas>
          @if (!bare) { <p class="pf-code-card__caption">QR</p> }
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
   *  tube barcodes (PF-AP-2024-...-HAEM) where the human-readable
   *  value matters; turn OFF for report verification QRs where the
   *  code is just an opaque token URL nobody needs to read. */
  @Input() showValue = true;
  /** Which symbology to display: a 1D Code128 barcode, a 2D QR, or both
   *  side-by-side (default). Both always encode the identical value, so the
   *  choice is purely which label the operator wants to print/scan. */
  @Input() mode: 'both' | 'barcode' | 'qr' = 'both';
  /** Render without the white card chrome / captions — for inline use (e.g. a
   *  small tracking QR inside an invoice) rather than a printable label. */
  @Input() bare = false;
  /** Pixel size for the QR (and a proportional barcode height). Defaults to the
   *  label size (96px QR / 64px barcode) when omitted. */
  @Input() size?: number;

  @ViewChild('barcode', { static: true }) barcodeEl!: ElementRef<SVGSVGElement>;
  @ViewChild('qr', { static: true }) qrEl!: ElementRef<HTMLCanvasElement>;

  ngAfterViewInit(): void { this.render(); }
  ngOnChanges(_: SimpleChanges): void { if (this.barcodeEl && this.qrEl) this.render(); }

  private render(): void {
    const value = (this.code || '').trim();
    if (!value) return;

    const qrPx = this.size ?? 96;
    const barH = this.size ? Math.max(28, Math.round(this.size * 0.7)) : 64;

    try {
      JsBarcode(this.barcodeEl.nativeElement, value, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        height: barH,
        width: 1.6,
        background: '#ffffff',
        lineColor: '#0f172a'
      });
    } catch {
      /* ignore — JsBarcode rejects strings it can't encode */
    }

    // Always dark-on-white so the code stays high-contrast and scannable; in
    // `bare` mode the white sits on a small rounded tile (see styles) rather
    // than the full label card.
    const canvas = this.qrEl.nativeElement;
    canvas.style.width = qrPx + 'px';
    canvas.style.height = qrPx + 'px';
    QRCode.toCanvas(canvas, value, {
      margin: 1,
      width: qrPx,
      color: { dark: '#0f172a', light: '#ffffff' }
    }).catch(() => { /* ignore */ });
  }
}
