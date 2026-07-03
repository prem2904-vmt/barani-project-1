import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { printLabelOnly } from '../../../shared/utils/print-label';

/**
 * A printable patient ID card. Shows the patient's identity + a QR that encodes
 * the app's `/p/:id` open-route — scanning it at the front desk (via the global
 * scanner) jumps straight to this patient's profile. The card body is wrapped in
 * `.pf-print-label` so "Print" prints ONLY the card (global print stylesheet in
 * styles.scss). Uses the shared `pf-barcode-display` (QR via the qrcode lib).
 */
@Component({
  selector: 'pf-patient-id-card',
  standalone: true,
  imports: [DatePipe, BarcodeDisplayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-idc">
      <!-- Only this block prints (printLabelOnly hides everything else). -->
      <div class="pf-print-label pf-idc__card">
        <div class="pf-idc__head">
          <span class="pf-idc__brand">PATIENT ID CARD</span>
          @if (patient.mrn) { <span class="pf-idc__mrn">{{ patient.mrn }}</span> }
        </div>
        <div class="pf-idc__body">
          <div class="pf-idc__info">
            <p class="pf-idc__name">{{ name }}</p>
            <p class="pf-idc__meta">{{ ageSex }}</p>
            @if (patient.phone) { <p class="pf-idc__meta">Ph: {{ patient.phone }}</p> }
            @if (patient.dateOfBirth) { <p class="pf-idc__meta">DOB: {{ patient.dateOfBirth | date:'dd MMM yyyy' }}</p> }
            @if (patient.bloodGroup) { <p class="pf-idc__meta">Blood: {{ patient.bloodGroup }}</p> }
          </div>
          <div class="pf-idc__qr">
            <div class="pf-idc__qrbox">
              <pf-barcode-display mode="qr" [code]="qrValue" [bare]="true" [showValue]="false" [size]="112"></pf-barcode-display>
            </div>
            <p class="pf-idc__scan">Scan at front desk</p>
          </div>
        </div>
      </div>
      <button type="button" class="pf-idc__print" (click)="print()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>
        Print ID card
      </button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-idc { display: flex; flex-direction: column; gap: 10px; width: 100%; }
    .pf-idc__card {
      width: 100%; border-radius: 14px; overflow: hidden;
      background: var(--bg-card-solid, #fff); color: var(--text-primary, #0f172a);
      border: 1px solid var(--glass-border, rgba(0,0,0,0.08));
      box-shadow: var(--shadow-md, 0 6px 20px rgba(0,0,0,0.10));
    }
    .pf-idc__head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 14px; background: var(--gradient-primary, #6d28d9); color: #fff;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .pf-idc__brand { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; }
    .pf-idc__mrn { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; font-weight: 700; }
    .pf-idc__body { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; }
    .pf-idc__name { font-size: 17px; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 6px; }
    .pf-idc__meta { font-size: 12.5px; color: var(--text-tertiary, #475569); margin: 2px 0; }
    .pf-idc__qr { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    /* White backing so the QR stays scannable on a dark card (and on paper). */
    .pf-idc__qrbox { display: inline-flex; padding: 6px; border-radius: 8px; background: #fff; }
    .pf-idc__scan { font-size: 9.5px; color: var(--text-muted, #64748b); letter-spacing: 0.04em; margin: 0; }
    .pf-idc__print {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
      border: 1px solid var(--glass-border, rgba(0,0,0,0.1)); background: var(--glass-bg, #f8fafc); color: var(--text-primary, #0f172a);
    }
    .pf-idc__print:hover { background: var(--glass-bg-hover, #f1f5f9); }
    @media (pointer: coarse) { .pf-idc__print { min-height: 44px; } }

    /* Print: force a light card + dark text so the paper copy is legible even
       when the app is in dark mode (on screen the card follows the theme). */
    @media print {
      .pf-idc__card { background: #fff !important; color: #0f172a !important; }
      .pf-idc__meta { color: #475569 !important; }
      .pf-idc__scan { color: #64748b !important; }
    }
  `]
})
export class PatientIdCardComponent {
  @Input({ required: true }) patient!: Patient;

  get name(): string { return patientDisplayName(this.patient); }
  get ageSex(): string {
    return [this.patient.age != null ? this.patient.age + ' yrs' : null, this.patient.sex]
      .filter(Boolean).join(' · ') || '—';
  }
  /** The QR encodes the app's patient open-route so a phone camera OR the in-app
   *  scanner both resolve it to this patient (see /p/:id + the top-strip scan). */
  get qrValue(): string {
    const origin = typeof location !== 'undefined' ? location.origin : '';
    return `${origin}/p/${this.patient.id}`;
  }
  print(): void { printLabelOnly(); }
}
