import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  ViewChild,
} from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { OrderSample } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';

export interface TubeSpec {
  label: string;
  color: 'lavender' | 'yellow' | 'red' | 'green' | 'container' | 'grey';
  volume: string;
}

const TUBE_MAP: Record<string, TubeSpec> = {
  HAEM:         { label: 'Lavender',  color: 'lavender',  volume: '3 mL' },
  HAEMATOLOGY:  { label: 'Lavender',  color: 'lavender',  volume: '3 mL' },
  ENDO:         { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  ENDOCRINOLOGY:{ label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  BIO:          { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  BIOCHEM:      { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  BIOCHEMISTRY: { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  MICRO:        { label: 'Red',       color: 'red',       volume: '5 mL' },
  MICROBIOLOGY: { label: 'Red',       color: 'red',       volume: '5 mL' },
  CPA:          { label: 'Container', color: 'container', volume: '30 mL' },
  PATHOLOGY:    { label: 'Container', color: 'container', volume: '30 mL' },
  IMMUNO:       { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  IMMUNOLOGY:   { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
};
const DEFAULT_TUBE: TubeSpec = { label: 'Grey', color: 'grey', volume: '5 mL' };

export function tubeSpec(s: OrderSample): TubeSpec {
  const code = (s.department?.code ?? s.department?.name ?? '').toUpperCase().trim();
  return TUBE_MAP[code] ?? DEFAULT_TUBE;
}

@Component({
  selector: 'pf-label-card',
  standalone: true,
  imports: [UpperCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-lc" [class.pf-lc--on]="selected" [class.pf-lc--printing]="printing">

      <!-- Header: checkbox · label number · dept · tube chip -->
      <div class="pf-lc__hdr">
        <button type="button" class="pf-lc__chk" [class.pf-lc__chk--on]="selected"
                (click)="selectToggle.emit()" [attr.aria-label]="selected ? 'Deselect' : 'Select'">
          @if (selected) {
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 12 4 4L19 6"/>
          </svg>
          }
        </button>
        <span class="pf-lc__title">
          Label {{ num }}
          <span class="pf-lc__dept">· {{ deptName }}</span>
        </span>
        <span class="pf-lc__tube-chip" [attr.data-color]="spec.color">
          <span class="pf-lc__tube-dot"></span>
          {{ spec.label }} · {{ spec.volume }}
        </span>
      </div>

      <!-- White label preview area -->
      <div class="pf-lc__preview" [attr.data-color]="spec.color">
        <div class="pf-lc__stripe"></div>
        <div class="pf-lc__preview-grid">
          <!-- Left: patient info + barcode -->
          <div class="pf-lc__preview-left">
            <p class="pf-lc__pname">
              {{ patientName }}
              @if (agesex) { <span class="pf-lc__agesex"> {{ agesex }}</span> }
            </p>
            <p class="pf-lc__demo">
              MRN {{ mrnStr }}
              @if (dobStr) { · DOB {{ dobStr }} }
            </p>
            <div class="pf-lc__bar-wrap">
              <svg #barSvg class="pf-lc__bar" role="img" [attr.aria-label]="'Barcode ' + barcode"></svg>
            </div>
          </div>
          <!-- Right: QR + dept code + volume -->
          <div class="pf-lc__preview-right">
            <canvas #qrCanvas class="pf-lc__qr" [attr.aria-label]="'QR ' + barcode"></canvas>
            <span class="pf-lc__deptcode">{{ deptCode }}</span>
            <span class="pf-lc__vol">{{ spec.volume }}</span>
          </div>
        </div>
        <p class="pf-lc__bartext">{{ barcode }}</p>
      </div>

      <!-- Tests in this tube -->
      <!-- <div class="pf-lc__tests-hdr">
        <span class="pf-lc__tests-label">Tests in this tube</span>
        <span class="pf-lc__tube-info" [attr.data-color]="spec.color">
          {{ spec.label | uppercase }} · {{ spec.volume }}
        </span>
      </div>
      <div class="pf-lc__chips">
        @for (t of sample.tests; track t.id) {
          <span class="pf-lc__chip">{{ t.test?.name ?? 'Test' }}</span>
        }
      </div> -->

      <!-- Footer -->
      <div class="pf-lc__footer">
        <span class="pf-lc__barcode-id">{{ barcode }}</span>
        <div class="pf-lc__actions">
          <button type="button" class="pf-lc__action-btn" title="Copy barcode"
                  (click)="copyRequest.emit(barcode)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button type="button" class="pf-lc__action-btn" title="Download"
                  (click)="downloadRequest.emit()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button type="button" class="pf-lc__print-btn" (click)="printRequest.emit()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 9V2h12v7"/>
              <rect x="6" y="13" width="12" height="9"/>
              <path d="M6 18H3a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-3"/>
            </svg>
            Print
          </button>
        </div>
      </div>

    </div>
  `,
  styles: [`
    .pf-lc {
      border-radius: 16px;
      background: var(--surface-elevated);
      border: 1.5px solid var(--border-primary);
      overflow: hidden;
      transition: border-color 0.18s, box-shadow 0.18s;
    }
    .pf-lc--on {
      border-color: #10b981;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
    }

    /* ── Header ─────────────────────────────────────────── */
    .pf-lc__hdr {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px 10px;
      border-bottom: 1px solid var(--border-primary);
    }
    .pf-lc__chk {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      background: var(--glass-bg);
      border: 1.5px solid var(--border-primary);
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s, border-color 0.15s;
    }
    .pf-lc__chk--on {
      background: #10b981;
      border-color: #10b981;
    }
    .pf-lc__title {
      flex: 1;
      min-width: 0;
      font-size: 11.5px;
      font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }
    .pf-lc__dept {
      color: var(--text-tertiary);
      font-weight: 600;
    }
    .pf-lc__tube-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      background: var(--glass-bg);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      flex-shrink: 0;
    }
    .pf-lc__tube-dot {
      width: 9px;
      height: 9px;
      border-radius: 9999px;
      flex-shrink: 0;
    }
    .pf-lc__tube-chip[data-color='lavender'] { background: rgba(196,181,253,0.18); border-color: rgba(196,181,253,0.5); color: #a78bfa; }
    .pf-lc__tube-chip[data-color='lavender'] .pf-lc__tube-dot { background: #c4b5fd; }
    .pf-lc__tube-chip[data-color='yellow']   { background: rgba(253,230,138,0.18); border-color: rgba(253,230,138,0.6); color: #f59e0b; }
    .pf-lc__tube-chip[data-color='yellow']   .pf-lc__tube-dot { background: #fde68a; border: 1px solid #f59e0b; }
    .pf-lc__tube-chip[data-color='red']      { background: rgba(252,165,165,0.18); border-color: rgba(252,165,165,0.5); color: #f87171; }
    .pf-lc__tube-chip[data-color='red']      .pf-lc__tube-dot { background: #fca5a5; }
    .pf-lc__tube-chip[data-color='green']    { background: rgba(110,231,183,0.18); border-color: rgba(110,231,183,0.5); color: #34d399; }
    .pf-lc__tube-chip[data-color='green']    .pf-lc__tube-dot { background: #6ee7b7; }
    .pf-lc__tube-chip[data-color='container'] { background: var(--glass-bg); border-color: var(--border-primary); color: var(--text-tertiary); }
    .pf-lc__tube-chip[data-color='container'] .pf-lc__tube-dot { background: #d1d5db; }

    /* ── White label preview (always light — represents printed paper label) ── */
    .pf-lc__preview {
      position: relative;
      margin: 10px 14px;
      border-radius: 10px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      overflow: hidden;
      padding: 12px 12px 8px 20px;
    }
    .pf-lc__stripe {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 7px;
      background: #d1d5db;
    }
    .pf-lc__preview[data-color='lavender'] .pf-lc__stripe { background: #c4b5fd; }
    .pf-lc__preview[data-color='yellow']   .pf-lc__stripe { background: #fde68a; border-right: 1px solid #f59e0b; }
    .pf-lc__preview[data-color='red']      .pf-lc__stripe { background: #fca5a5; }
    .pf-lc__preview[data-color='green']    .pf-lc__stripe { background: #6ee7b7; }
    .pf-lc__preview[data-color='container'] .pf-lc__stripe { background: #e5e7eb; }

    .pf-lc__preview-grid {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: start;
    }
    .pf-lc__preview-left {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .pf-lc__pname {
      margin: 0;
      font-size: 13.5px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.3;
    }
    .pf-lc__agesex {
      font-size: 11.5px;
      font-weight: 600;
      color: #374151;
    }
    .pf-lc__demo {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: #475569;
      letter-spacing: 0.02em;
    }
    .pf-lc__bar-wrap {
      margin-top: 6px;
      overflow: hidden;
    }
    .pf-lc__bar {
      display: block;
      height: 36px;
      width: auto;
      max-width: 100%;
    }

    .pf-lc__preview-right {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
    }
    .pf-lc__qr {
      display: block;
      width: 76px;
      height: 76px;
      image-rendering: pixelated;
    }
    .pf-lc__deptcode {
      font-size: 10px;
      font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #374151;
    }
    .pf-lc__vol {
      font-size: 9.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: #6b7280;
    }

    .pf-lc__bartext {
      margin: 6px 0 0;
      font-size: 9px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: #64748b;
      letter-spacing: 0.04em;
    }

    /* ── Tests section ───────────────────────────────────── */
    .pf-lc__tests-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 14px 4px;
    }
    .pf-lc__tests-label {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--text-tertiary);
    }
    .pf-lc__tube-info {
      font-size: 9.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }
    .pf-lc__tube-info[data-color='lavender'] { color: #a78bfa; }
    .pf-lc__tube-info[data-color='yellow']   { color: #f59e0b; }
    .pf-lc__tube-info[data-color='red']      { color: #f87171; }
    .pf-lc__tube-info[data-color='green']    { color: #34d399; }

    .pf-lc__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 0 14px 10px;
    }
    .pf-lc__chip {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      background: var(--glass-bg);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
    }

    /* ── Footer ─────────────────────────────────────────── */
    .pf-lc__footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px 12px;
      border-top: 1px solid var(--border-primary);
    }
    .pf-lc__barcode-id {
      flex: 1;
      min-width: 0;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pf-lc__actions {
      display: inline-flex;
      gap: 4px;
      flex-shrink: 0;
    }
    .pf-lc__action-btn {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: var(--glass-bg);
      border: 1px solid var(--border-primary);
      color: var(--text-tertiary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.14s, color 0.14s;
    }
    .pf-lc__action-btn:hover {
      background: var(--glass-bg-hover);
      color: var(--text-secondary);
    }
    .pf-lc__print-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 30px;
      padding: 0 14px;
      border-radius: 8px;
      background: #0d9488;
      border: none;
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.14s;
    }
    .pf-lc__print-btn:hover { background: #0f766e; }

    /* ── Print ─────────────────────────────────────────────── */
    @media print {
      .pf-lc:not(.pf-lc--printing) { display: none !important; }
      .pf-lc--printing {
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
        border-radius: 0 !important;
        overflow: visible !important;
        break-inside: avoid;
      }
      .pf-lc--printing .pf-lc__hdr,
      .pf-lc--printing .pf-lc__footer { display: none !important; }
      .pf-lc--printing .pf-lc__preview { margin: 0 !important; border-radius: 4px !important; }
    }
  `],
})
export class LabelCardComponent implements AfterViewInit, OnChanges {
  @Input() sample!: OrderSample;
  @Input() patient: Patient | null | undefined;
  @Input() index = 0;
  @Input() selected = false;
  @Input() printing = false;

  @Output() selectToggle = new EventEmitter<void>();
  @Output() printRequest = new EventEmitter<void>();
  @Output() copyRequest = new EventEmitter<string>();
  @Output() downloadRequest = new EventEmitter<void>();

  @ViewChild('barSvg', { static: true }) barSvg!: ElementRef<SVGElement>;
  @ViewChild('qrCanvas', { static: true }) qrCanvas!: ElementRef<HTMLCanvasElement>;

  get spec(): TubeSpec { return tubeSpec(this.sample); }
  get num(): string { return String(this.index + 1).padStart(2, '0'); }
  get deptName(): string { return (this.sample.department?.name ?? 'Sample').toUpperCase(); }
  get deptCode(): string { return (this.sample.department?.code ?? '').toUpperCase(); }
  get barcode(): string { return this.sample.barcode ?? this.sample.id; }
  get patientName(): string { return this.patient?.displayName ?? 'Patient'; }

  get agesex(): string {
    const p = this.patient;
    if (!p) return '';
    const age = p.age ?? (p.dateOfBirth ? this.calcAge(p.dateOfBirth) : null);
    const s = p.sex ? p.sex.charAt(0).toUpperCase() : '';
    return [age, s].filter(Boolean).join('');
  }

  get mrnStr(): string {
    // Patient.mrn is the server-issued lifetime MRN (e.g. DEL-2605-004217-3).
    // Falls back to "—" for legacy NULL-MRN patients pre-2026-05-16; never
    // print the raw GUID slice — it was misleading patient staff into
    // treating order UUIDs as patient identifiers.
    return this.patient?.mrn?.trim() || '—';
  }

  get dobStr(): string { return this.patient?.dateOfBirth ?? ''; }

  ngAfterViewInit(): void { this.render(); }
  ngOnChanges(): void { if (this.barSvg && this.qrCanvas) this.render(); }

  private render(): void {
    const code = this.barcode;
    if (!code) return;
    try {
      JsBarcode(this.barSvg.nativeElement, code, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        height: 36,
        width: 1.3,
        background: '#ffffff',
        lineColor: '#0f172a',
      });
    } catch { /* ignore un-encodable strings */ }
    QRCode.toCanvas(this.qrCanvas.nativeElement, code, {
      margin: 1,
      width: 76,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).catch(() => {});
  }

  private calcAge(dob: string): number {
    const d = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  }
}
