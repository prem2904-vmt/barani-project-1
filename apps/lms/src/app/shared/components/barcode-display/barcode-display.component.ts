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
    <div class="pf-code-card">
      <div class="pf-code-card__row">
        <div class="pf-code-card__block">
          <svg #barcode class="pf-code-card__bar" role="img" [attr.aria-label]="'Barcode ' + code"></svg>
          <p class="pf-code-card__caption">Barcode · Code128</p>
        </div>
        <div class="pf-code-card__block">
          <canvas #qr class="pf-code-card__qr" [attr.aria-label]="'QR code ' + code"></canvas>
          <p class="pf-code-card__caption">QR</p>
        </div>
      </div>
      <p class="pf-code-card__value">{{ code }}</p>
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
  `]
})
export class BarcodeDisplayComponent implements AfterViewInit, OnChanges {
  @Input() code = '';

  @ViewChild('barcode', { static: true }) barcodeEl!: ElementRef<SVGSVGElement>;
  @ViewChild('qr', { static: true }) qrEl!: ElementRef<HTMLCanvasElement>;

  ngAfterViewInit(): void { this.render(); }
  ngOnChanges(_: SimpleChanges): void { if (this.barcodeEl && this.qrEl) this.render(); }

  private render(): void {
    const value = (this.code || '').trim();
    if (!value) return;

    try {
      JsBarcode(this.barcodeEl.nativeElement, value, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        height: 64,
        width: 1.6,
        background: '#ffffff',
        lineColor: '#0f172a'
      });
    } catch {
      /* ignore — JsBarcode rejects strings it can't encode */
    }

    QRCode.toCanvas(this.qrEl.nativeElement, value, {
      margin: 0,
      width: 96,
      color: { dark: '#0f172a', light: '#ffffff' }
    }).catch(() => { /* ignore */ });
  }
}
