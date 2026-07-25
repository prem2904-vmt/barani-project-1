import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { ApiError } from '../../models/api-response.model';
import { BarcodeScannerModalComponent } from '../barcode-scanner/barcode-scanner-modal.component';

/**
 * Pull a 14-digit ABHA number out of a scanned/pasted string — the ABHA card QR
 * (JSON with `hidn`), a plain number, or a hyphenated one. null if not found.
 */
export function extractAbhaNumber(text: string): string | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text.trim()) as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const norm = k.toLowerCase().replace(/[^a-z]/g, '');
      if (['hidn', 'abhanumber', 'abha', 'healthid', 'healthidnumber'].includes(norm)) {
        const d = String(o[k]).replace(/\D/g, '');
        if (d.length === 14) return d;
      }
    }
  } catch { /* not JSON */ }
  const m = text.match(/\d[\d-]{12,}\d/);
  if (m) { const d = m[0].replace(/\D/g, ''); if (d.length === 14) return d; }
  const digits = text.replace(/\D/g, '');
  return digits.length === 14 ? digits : null;
}

/** Normalised demographics returned by lookup / QR — mapped into the form. */
export interface AbhaPrefillData {
  abhaNumber?: string; abhaAddress?: string;
  firstName?: string; middleName?: string; lastName?: string; fullName?: string;
  gender?: string; dob?: string; yearOfBirth?: number; mobile?: string;
  address?: string; pincode?: string; state?: string; district?: string;
  photo?: string;
}

/**
 * ABHA prefill for NEW patient registration — fetch an existing patient's
 * details from their ABHA to auto-populate the form, before a patient record
 * exists. Two ways: enter the 14-digit ABHA + OTP (login), or scan/paste the
 * ABHA card QR (its JSON already carries the demographics — no OTP). Emits
 * (fetched) with normalised demographics.
 */
@Component({
  selector: 'pf-abha-prefill',
  standalone: true,
  imports: [BarcodeScannerModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (scanning()) {
      <pf-barcode-scanner-modal title="Scan the ABHA QR / card"
        (matched)="onScanned($event)" (cancelled)="scanning.set(false)"></pf-barcode-scanner-modal>
    }
    <div class="pf-abp__backdrop" (click)="close.emit()">
      <div class="pf-abp" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <div class="pf-abp__head">
          @if (mode() !== 'choose') {
            <button type="button" class="pf-abp__ic" (click)="back()" aria-label="Back"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
          }
          <span class="pf-abp__title">Fetch details from ABHA</span>
          <button type="button" class="pf-abp__ic" (click)="close.emit()" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>

        <div class="pf-abp__body">
          @if (mode() === 'choose') {
            <p class="pf-abp__lead">The patient already has an ABHA? Pull their KYC details to fill the form.</p>
            <button type="button" class="pf-abp__opt" (click)="openScanner()">
              <span class="pf-abp__opt-t">Scan ABHA QR</span>
              <span class="pf-abp__opt-s">Point the camera at the ABHA card — we read the number and send the OTP</span>
            </button>
            <button type="button" class="pf-abp__opt" (click)="mode.set('enter')">
              <span class="pf-abp__opt-t">Enter ABHA number</span>
              <span class="pf-abp__opt-s">14-digit number, verify by OTP</span>
            </button>
            <button type="button" class="pf-abp__link" (click)="mode.set('qr')">or paste the QR data</button>
          } @else if (mode() === 'qr') {
            <label class="pf-abp__label">Paste the ABHA card QR content</label>
            <textarea class="pf-abp__input pf-abp__area" rows="4" placeholder="Paste the ABHA QR content…"
                      [value]="qr()" (input)="qr.set($any($event.target).value)"></textarea>
            @if (error()) { <p class="pf-abp__err">{{ error() }}</p> }
            <button type="button" class="pf-abp__go" [disabled]="!qr().trim()" (click)="parseQr()">Use these details</button>
          } @else {
            @if (step() === 'input') {
              <label class="pf-abp__label">ABHA number</label>
              <input class="pf-abp__input" inputmode="numeric" maxlength="17" placeholder="14-digit ABHA"
                     [value]="abha()" (input)="abha.set(digits($any($event.target).value, 14))" />
              @if (error()) { <p class="pf-abp__err">{{ error() }}</p> }
              <button type="button" class="pf-abp__go" [disabled]="busy() || abha().length !== 14" (click)="requestOtp()">{{ busy() ? 'Sending…' : 'Send OTP' }}</button>
            } @else {
              @if (info()) { <p class="pf-abp__info">{{ info() }}</p> }
              <label class="pf-abp__label">Enter OTP</label>
              <input class="pf-abp__input pf-abp__otp" inputmode="numeric" maxlength="8" placeholder="6-digit OTP"
                     [value]="otp()" (input)="otp.set(digits($any($event.target).value, 8))" />
              @if (error()) { <p class="pf-abp__err">{{ error() }}</p> }
              <button type="button" class="pf-abp__go" [disabled]="busy() || otp().length < 4" (click)="confirm()">{{ busy() ? 'Fetching…' : 'Fetch details' }}</button>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pf-abp__backdrop { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(4,4,12,0.7); backdrop-filter: blur(4px); }
    .pf-abp { width: 100%; max-width: 420px; border-radius: 18px; background: var(--bg-card-solid); border: 1px solid var(--glass-border); box-shadow: 0 30px 90px rgba(0,0,0,0.5); overflow: hidden; }
    .pf-abp__head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border-muted, var(--glass-border)); }
    .pf-abp__title { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: var(--text-primary); }
    .pf-abp__ic { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); cursor: pointer; }
    .pf-abp__ic:hover { color: var(--text-primary); }
    .pf-abp__body { padding: 18px; display: flex; flex-direction: column; gap: 10px; }
    .pf-abp__lead { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
    .pf-abp__opt { text-align: left; padding: 14px; border-radius: 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
    .pf-abp__opt:hover { border-color: rgba(168,85,247,0.5); }
    .pf-abp__opt-t { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-abp__opt-s { font-size: 12px; color: var(--text-tertiary); }
    .pf-abp__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
    .pf-abp__input { width: 100%; padding: 11px 12px; border-radius: 10px; font-size: 16px; background: var(--input-bg, var(--glass-bg)); border: 1px solid var(--input-border, var(--glass-border)); color: var(--input-text, var(--text-primary)); outline: none; }
    .pf-abp__input:focus { border-color: rgba(139,92,246,0.6); box-shadow: 0 0 0 3px rgba(139,92,246,0.18); }
    .pf-abp__area { font-family: monospace; font-size: 12px; resize: vertical; }
    .pf-abp__otp { font-size: 20px; letter-spacing: 0.4em; text-align: center; font-family: monospace; }
    .pf-abp__info { font-size: 12.5px; color: #6ee7b7; }
    .pf-abp__err { font-size: 12.5px; color: #fca5a5; }
    .pf-abp__go { margin-top: 6px; padding: 12px; border-radius: 11px; border: 0; font-size: 14px; font-weight: 700; color: #fff; cursor: pointer; background: linear-gradient(135deg, #7c3aed, #a855f7); }
    .pf-abp__go:disabled { opacity: 0.5; cursor: not-allowed; }
    .pf-abp__link { align-self: center; margin-top: 2px; padding: 4px; background: none; border: 0; color: var(--text-tertiary); font-size: 12px; text-decoration: underline; cursor: pointer; }
    .pf-abp__link:hover { color: var(--text-secondary); }
  `],
})
export class AbhaPrefillComponent {
  private readonly api = inject(ApiService);

  readonly close = output<void>();
  readonly fetched = output<AbhaPrefillData>();

  readonly mode = signal<'choose' | 'enter' | 'qr'>('choose');
  readonly step = signal<'input' | 'otp'>('input');
  readonly abha = signal('');
  readonly otp = signal('');
  readonly qr = signal('');
  readonly txnId = signal('');
  readonly info = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly scanning = signal(false);

  digits(v: string, max: number): string { return (v || '').replace(/\D/g, '').slice(0, max); }

  openScanner() { this.error.set(''); this.scanning.set(true); }

  /** Camera/QR scan result → pull the ABHA number and auto-request the OTP. */
  onScanned(text: string) {
    this.scanning.set(false);
    const abha = extractAbhaNumber(text || '');
    if (abha) {
      this.abha.set(abha);
      this.mode.set('enter');
      this.requestOtp();
      return;
    }
    // No number in the scan — maybe it's a demographics-only QR; try that.
    this.qr.set(text || '');
    this.mode.set('qr');
    this.parseQr();
  }
  back() {
    this.error.set('');
    if (this.mode() === 'enter' && this.step() === 'otp') { this.step.set('input'); this.otp.set(''); }
    else this.mode.set('choose');
  }

  requestOtp() {
    if (this.busy() || this.abha().length !== 14) return;
    this.busy.set(true); this.error.set('');
    this.api.post<{ txnId: string; message: string }>('/api/abdm/lookup/request-otp', { abhaId: this.abha() }).subscribe({
      next: r => { this.txnId.set(r?.txnId ?? ''); this.info.set(r?.message ?? 'OTP sent.'); this.step.set('otp'); this.busy.set(false); },
      error: e => { this.error.set(ApiError.from(e).message); this.busy.set(false); },
    });
  }
  confirm() {
    if (this.busy() || this.otp().length < 4) return;
    this.busy.set(true); this.error.set('');
    this.api.post<AbhaPrefillData>('/api/abdm/lookup/confirm', { txnId: this.txnId(), otp: this.otp() }).subscribe({
      next: d => { this.busy.set(false); this.fetched.emit(d ?? {}); },
      error: e => { this.error.set(ApiError.from(e).message); this.busy.set(false); },
    });
  }

  /** Parse the ABHA card QR JSON (client-side) into normalised demographics. */
  parseQr() {
    this.error.set('');
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(this.qr().trim()); } catch { this.error.set('That does not look like ABHA QR data (expected JSON).'); return; }
    const g = (k: string): string | undefined => {
      const hit = Object.keys(raw).find(x => x.toLowerCase().replace(/[^a-z]/g, '') === k);
      const v = hit ? raw[hit] : undefined;
      return v === undefined || v === null ? undefined : String(v);
    };
    const num = (g('hidn') || g('abhanumber') || '').replace(/\D/g, '');
    const data: AbhaPrefillData = {
      abhaNumber: num || undefined,
      abhaAddress: g('hid') || g('phraddress') || g('abhaaddress'),
      fullName: g('name') || g('fullname'),
      gender: g('gender'),
      dob: g('dob') || g('dateofbirth'),
      yearOfBirth: g('yob') || g('yearofbirth') ? Number((g('yob') || g('yearofbirth'))!.replace(/\D/g, '')) || undefined : undefined,
      mobile: g('mobile'),
      address: g('address'),
      pincode: g('pincode') || g('pin'),
      state: g('statename') || g('state'),
      district: g('distname') || g('districtname') || g('district'),
    };
    if (!data.abhaNumber && !data.fullName) { this.error.set('Could not read name/ABHA from that QR.'); return; }
    this.fetched.emit(data);
  }
}
