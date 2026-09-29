import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { ApiError } from '../../models/api-response.model';
import { BarcodeScannerModalComponent } from '../barcode-scanner/barcode-scanner-modal.component';
import { ScanIconComponent } from '../icons/scan-icon.component';
import { BusyDirective } from '../../directives/busy.directive';

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
  imports: [BarcodeScannerModalComponent, ScanIconComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (scanning()) {
      <!-- Camera scan replaces this dialog (one modal at a time); its Cancel/×
           returns here. -->
      <pf-barcode-scanner-modal [title]="mode() === 'create' ? 'Scan the Aadhaar QR' : 'Scan the ABHA QR / card'"
        (matched)="onScanned($event)" (cancelled)="scanning.set(false)"></pf-barcode-scanner-modal>
    } @else {
    <div class="pf-abp__backdrop" (click)="close.emit()">
      <div class="pf-abp" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <div class="pf-abp__head">
          @if (step() === 'otp') {
            <button type="button" class="pf-abp__ic" (click)="back()" aria-label="Back"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
          }
          <span class="pf-abp__title">{{ mode() === 'create' ? 'Create ABHA' : 'Fetch details from ABHA' }}</span>
          <button type="button" class="pf-abp__ic" (click)="close.emit()" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>

        <div class="pf-abp__body">
          @if (step() === 'input') {
            @if (mode() === 'create') {
              <p class="pf-abp__lead">Create a new ABHA via Aadhaar OTP (KYC). Enter or scan the Aadhaar, verify by OTP — it fills the form and registers.</p>
              <label class="pf-abp__label">Aadhaar number</label>
              <div class="pf-abp__field">
                <input class="pf-abp__input" inputmode="numeric" maxlength="14" placeholder="12-digit Aadhaar"
                       [value]="aadhaar()" (input)="aadhaar.set(digits($any($event.target).value, 12))" />
                <button type="button" class="pf-abp__scan" (click)="openScanner()" aria-label="Scan Aadhaar QR">
                  <pf-scan-icon [size]="18" />
                </button>
              </div>
              @if (error()) { <p class="pf-abp__err">{{ error() }}</p> }
              <button type="button" class="pf-abp__go" [disabled]="busy() || aadhaar().length !== 12" [pfBusy]="busy()" pfBusyLabel="Sending OTP…" (click)="createRequestOtp()">{{ busy() ? 'Sending…' : 'Send OTP' }}</button>
            } @else {
              <p class="pf-abp__lead">Enter or scan the patient's ABHA number, then verify by OTP to auto-fill the form.</p>
              <label class="pf-abp__label">ABHA number</label>
              <div class="pf-abp__field">
                <input class="pf-abp__input" inputmode="numeric" maxlength="17" placeholder="14-digit ABHA"
                       [value]="abha()" (input)="abha.set(digits($any($event.target).value, 14))" />
                <button type="button" class="pf-abp__scan" (click)="openScanner()" aria-label="Scan ABHA QR">
                  <pf-scan-icon [size]="18" />
                </button>
              </div>
              @if (error()) { <p class="pf-abp__err">{{ error() }}</p> }
              <button type="button" class="pf-abp__go" [disabled]="busy() || abha().length !== 14" [pfBusy]="busy()" pfBusyLabel="Sending OTP…" (click)="requestOtp()">{{ busy() ? 'Sending…' : 'Send OTP' }}</button>
            }
          } @else {
            @if (info()) { <p class="pf-abp__info">{{ info() }}</p> }
            <label class="pf-abp__label">Enter OTP</label>
            <input class="pf-abp__input pf-abp__otp" inputmode="numeric" maxlength="8" placeholder="6-digit OTP"
                   [value]="otp()" (input)="otp.set(digits($any($event.target).value, 8))" />
            @if (mode() === 'create') {
              <label class="pf-abp__label">Mobile linked to this Aadhaar</label>
              <input class="pf-abp__input" inputmode="numeric" maxlength="10" placeholder="10-digit mobile"
                     [value]="mobile()" (input)="mobile.set(digits($any($event.target).value, 10))" />
            }
            @if (error()) { <p class="pf-abp__err">{{ error() }}</p> }
            @if (mode() === 'create') {
              <button type="button" class="pf-abp__go" [disabled]="busy() || otp().length < 4 || mobile().length !== 10" [pfBusy]="busy()" pfBusyLabel="Creating ABHA…" (click)="createConfirm()">{{ busy() ? 'Creating…' : 'Create ABHA' }}</button>
            } @else {
              <button type="button" class="pf-abp__go" [disabled]="busy() || otp().length < 4" [pfBusy]="busy()" pfBusyLabel="Fetching details…" (click)="confirm()">{{ busy() ? 'Fetching…' : 'Fetch details' }}</button>
            }
          }
        </div>
      </div>
    </div>
    }
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
    /* Number field with an inline scan icon (type OR scan into the same box). */
    .pf-abp__field { position: relative; }
    .pf-abp__field .pf-abp__input { padding-right: 46px; }
    .pf-abp__scan { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); width: 34px; height: 34px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 0; color: var(--text-tertiary); cursor: pointer; }
    .pf-abp__scan:hover { color: var(--color-violet-500, #a855f7); background: var(--bg-hover); }
    .pf-abp__area { font-family: monospace; font-size: 12px; resize: vertical; }
    .pf-abp__otp { font-size: 20px; letter-spacing: 0.4em; text-align: center; font-family: monospace; }
    .pf-abp__info { font-size: 12.5px; color: var(--green-text); }
    .pf-abp__err { font-size: 12.5px; color: var(--red-text); }
    .pf-abp__go { margin-top: 6px; padding: 12px; border-radius: 11px; border: 0; font-size: 14px; font-weight: 700; color: #fff; cursor: pointer; background: linear-gradient(135deg, #7c3aed, #a855f7); }
    .pf-abp__go:disabled { opacity: 0.5; cursor: not-allowed; }

    /* NEW DESIGN (ND-PATTERN "Patient registration"): an nd-card modal —
       16px radius, kit inputs, Noto tabular numbers (never monospace),
       neutral info text (never green); phones: a sheet ABOVE the navbar. */
    :host-context(.design-new) .pf-abp__backdrop { background: rgba(15, 23, 42, 0.45); }
    :host-context(.design-new) .pf-abp { border-radius: var(--nd-radius-card, 16px); background: var(--nd-card-bg); border: 1px solid var(--nd-line); box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22); }
    :host-context(.design-new) .pf-abp__head { border-bottom-color: var(--nd-line); }
    :host-context(.design-new) .pf-abp__title { font-size: 16px; font-weight: 600; }
    :host-context(.design-new) .pf-abp__label { font-size: 12px; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--text-secondary); }
    :host-context(.design-new) .pf-abp__input {
      min-height: 40px; border-radius: var(--nd-radius-sm, 10px); font-size: 13.5px; font-weight: 500; letter-spacing: 0;
      font-family: inherit; font-variant-numeric: tabular-nums;
      border: 1px solid color-mix(in srgb, var(--text-primary) 22%, transparent);
      background: color-mix(in srgb, var(--text-primary) 4%, var(--nd-card-bg)); color: var(--text-primary);
    }
    :host-context(.design-new) .pf-abp__input:focus { border-color: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent); }
    :host-context(.design-new) .pf-abp__otp { font-family: inherit; font-size: 20px; letter-spacing: 0.3em; }
    :host-context(.design-new) .pf-abp__info { color: var(--text-secondary); }
    :host-context(.design-new) .pf-abp__go { border-radius: 12px; font-weight: 600; }
    @media (max-width: 640px) {
      :host-context(.design-new) .pf-abp__backdrop { align-items: flex-end; padding: 0; bottom: var(--nd-nav-h, 0px); }
      :host-context(.design-new) .pf-abp { max-width: none; border-radius: 20px 20px 0 0; max-height: calc(100% - env(safe-area-inset-top, 0px)); overflow-y: auto; }
      :host-context(.design-new) .pf-abp__input { min-height: 44px; font-size: 16px; }
    }
    .pf-abp__link { align-self: center; margin-top: 2px; padding: 4px; background: none; border: 0; color: var(--text-tertiary); font-size: 12px; text-decoration: underline; cursor: pointer; }
    .pf-abp__link:hover { color: var(--text-secondary); }
  `],
})
export class AbhaPrefillComponent implements OnInit {
  private readonly api = inject(ApiService);

  /** Open straight into Fetch (existing ABHA) or Create (new ABHA via Aadhaar). */
  readonly startMode = input<'fetch' | 'create'>('fetch');
  readonly close = output<void>();
  readonly fetched = output<AbhaPrefillData>();

  readonly mode = signal<'fetch' | 'create'>('fetch');
  readonly step = signal<'input' | 'otp'>('input');
  readonly abha = signal('');
  readonly aadhaar = signal('');
  readonly mobile = signal('');
  readonly otp = signal('');
  readonly txnId = signal('');
  readonly info = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly scanning = signal(false);

  ngOnInit() { this.mode.set(this.startMode()); this.step.set('input'); }

  digits(v: string, max: number): string { return (v || '').replace(/\D/g, '').slice(0, max); }

  openScanner() { this.error.set(''); this.scanning.set(true); }

  /** Create ABHA — request the Aadhaar OTP. */
  createRequestOtp() {
    if (this.busy() || this.aadhaar().length !== 12) return;
    this.busy.set(true); this.error.set('');
    this.api.post<{ txnId: string; message: string }>('/api/abdm/enrol/aadhaar/otp', { aadhaar: this.aadhaar() }).subscribe({
      next: r => { this.txnId.set(r?.txnId ?? ''); this.info.set(r?.message ?? 'OTP sent to the Aadhaar-linked mobile.'); this.step.set('otp'); this.busy.set(false); },
      error: e => { this.error.set(ApiError.from(e).message); this.busy.set(false); },
    });
  }

  /** Create ABHA — verify OTP + mobile → enrol → return KYC demographics
   *  (incl. the new ABHA number) to pre-fill the registration form. */
  createConfirm() {
    if (this.busy() || this.otp().length < 4 || this.mobile().length !== 10) return;
    this.busy.set(true); this.error.set('');
    this.api.post<AbhaPrefillData>('/api/abdm/enrol/aadhaar/create', { txnId: this.txnId(), otp: this.otp(), mobile: this.mobile() }).subscribe({
      next: d => { this.busy.set(false); this.fetched.emit(d ?? {}); },
      error: e => { this.error.set(ApiError.from(e).message); this.busy.set(false); },
    });
  }

  /** Camera scan → fill the number field in place (ABHA for fetch, Aadhaar for
   *  create). The user reviews it and taps Send OTP. */
  onScanned(text: string) {
    this.scanning.set(false);
    if (this.mode() === 'create') {
      const aadhaar = this.extractAadhaar(text || '');
      if (aadhaar) { this.aadhaar.set(aadhaar); this.error.set(''); }
      else this.error.set('Could not read a 12-digit Aadhaar from that QR — type it in.');
    } else {
      const abha = extractAbhaNumber(text || '');
      if (abha) { this.abha.set(abha); this.error.set(''); }
      else this.error.set('Could not read the ABHA number from that QR — type it in.');
    }
  }

  /** Best-effort 12-digit Aadhaar out of a scanned string. */
  private extractAadhaar(text: string): string | null {
    const m = (text || '').match(/(\d[\d\s-]{10,}\d)/);
    if (m) { const d = m[0].replace(/\D/g, ''); if (d.length === 12) return d; }
    const all = (text || '').replace(/\D/g, '');
    return all.length === 12 ? all : null;
  }

  back() {
    this.error.set('');
    if (this.step() === 'otp') { this.step.set('input'); this.otp.set(''); }
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
}
