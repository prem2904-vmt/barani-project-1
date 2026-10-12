import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { ApiError } from '../../models/api-response.model';
import { Patient } from '../../models/patient.model';
import { BusyDirective } from '../../directives/busy.directive';

/**
 * ABHA wizard — real ABDM (India health ID) create + verify via OTP. Two flows:
 *  - Create a NEW ABHA via Aadhaar-OTP (KYC): Aadhaar → OTP (+ mobile) → enrol.
 *  - Verify + link an EXISTING 14-digit ABHA via login-OTP.
 * The client secret + RSA encryption stay server-side; this only posts the
 * plain Aadhaar/ABHA/OTP to our own backend (`/api/abdm/...`), which returns the
 * updated patient on success. Self-contained modal — open with [patientId],
 * listen to (done)=updated patient / (close).
 */
@Component({
  selector: 'pf-abha-wizard',
  standalone: true,
  imports: [BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-abw__backdrop" (click)="close.emit()">
      <div class="pf-abw" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <div class="pf-abw__head">
          @if (mode() !== 'choose') {
            <button type="button" class="pf-abw__back" (click)="back()" aria-label="Back">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          }
          <span class="pf-abw__title">
            {{ mode() === 'create' ? 'Create ABHA' : mode() === 'link' ? (refresh() ? 'Refresh ABHA' : 'Verify existing ABHA') : 'ABHA (Health ID)' }}
          </span>
          <button type="button" class="pf-abw__x" (click)="close.emit()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="pf-abw__body">
          @if (mode() === 'choose') {
            <p class="pf-abw__lead">Link this patient's ABHA — the ABDM digital health ID.</p>
            <button type="button" class="pf-abw__opt" (click)="pick('create')">
              <span class="pf-abw__opt-t">Create a new ABHA</span>
              <span class="pf-abw__opt-s">Aadhaar + OTP (KYC verified)</span>
            </button>
            <button type="button" class="pf-abw__opt" (click)="pick('link')">
              <span class="pf-abw__opt-t">Verify an existing ABHA</span>
              <span class="pf-abw__opt-s">Enter the 14-digit number, verify by OTP</span>
            </button>
          } @else if (step() === 'input') {
            @if (mode() === 'create') {
              <label class="pf-abw__label">Aadhaar number</label>
              <input class="pf-abw__input" inputmode="numeric" maxlength="14" placeholder="12-digit Aadhaar"
                     [value]="aadhaar()" (input)="aadhaar.set(digits($any($event.target).value, 12))" />
              <p class="pf-abw__hint">An OTP will be sent to the Aadhaar-registered mobile.</p>
            } @else {
              <label class="pf-abw__label">ABHA number</label>
              <input class="pf-abw__input" inputmode="numeric" maxlength="17" placeholder="14-digit ABHA"
                     [value]="abha()" (input)="abha.set(digits($any($event.target).value, 14))" />
              <p class="pf-abw__hint">An OTP will be sent to the ABHA-linked mobile / Aadhaar.</p>
            }
            @if (error()) { <p class="pf-abw__err">{{ error() }}</p> }
            <button type="button" class="pf-abw__go" [disabled]="busy() || !inputValid()" [pfBusy]="busy()" pfBusyLabel="Sending OTP…" (click)="requestOtp()">
              {{ busy() ? 'Sending OTP…' : 'Send OTP' }}
            </button>
          } @else {
            @if (info()) { <p class="pf-abw__info">{{ info() }}</p> }
            <label class="pf-abw__label">Enter OTP</label>
            <input class="pf-abw__input pf-abw__otp" inputmode="numeric" maxlength="8" placeholder="6-digit OTP"
                   [value]="otp()" (input)="otp.set(digits($any($event.target).value, 8))" />
            @if (mode() === 'create') {
              <label class="pf-abw__label">Mobile linked to this Aadhaar</label>
              <input class="pf-abw__input" inputmode="numeric" maxlength="10" placeholder="10-digit mobile"
                     [value]="mobile()" (input)="mobile.set(digits($any($event.target).value, 10))" />
              <p class="pf-abw__hint">Must be the number registered with the Aadhaar — the same one that received the OTP.</p>
            }
            @if (error()) { <p class="pf-abw__err">{{ error() }}</p> }
            <button type="button" class="pf-abw__go"
                    [disabled]="busy() || otp().length < 4 || (mode() === 'create' && mobile().length !== 10)"
                    [pfBusy]="busy()" pfBusyLabel="Verifying…" (click)="verify()">
              {{ busy() ? 'Verifying…' : (mode() === 'create' ? 'Create ABHA' : 'Verify & link') }}
            </button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pf-abw__backdrop { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(4,4,12,0.7); backdrop-filter: blur(4px); }
    .pf-abw { width: 100%; max-width: 420px; border-radius: 18px; background: var(--bg-card-solid); border: 1px solid var(--glass-border); box-shadow: 0 30px 90px rgba(0,0,0,0.5); overflow: hidden; }
    .pf-abw__head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border-muted, var(--glass-border)); }
    .pf-abw__title { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: var(--text-primary); }
    .pf-abw__back, .pf-abw__x { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); cursor: pointer; }
    .pf-abw__back:hover, .pf-abw__x:hover { color: var(--text-primary); }
    .pf-abw__body { padding: 18px; display: flex; flex-direction: column; gap: 10px; }
    .pf-abw__lead { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
    .pf-abw__opt { text-align: left; padding: 14px; border-radius: 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
    .pf-abw__opt:hover { border-color: rgba(168,85,247,0.5); }
    .pf-abw__opt-t { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-abw__opt-s { font-size: 12px; color: var(--text-tertiary); }
    .pf-abw__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
    .pf-abw__input { width: 100%; padding: 11px 12px; border-radius: 10px; font-size: 16px; letter-spacing: 0.04em; background: var(--input-bg, var(--glass-bg)); border: 1px solid var(--input-border, var(--glass-border)); color: var(--input-text, var(--text-primary)); outline: none; }
    .pf-abw__input:focus { border-color: rgba(139,92,246,0.6); box-shadow: 0 0 0 3px rgba(139,92,246,0.18); }
    .pf-abw__otp { font-size: 20px; letter-spacing: 0.4em; text-align: center; font-family: monospace; }
    .pf-abw__hint { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-abw__info { font-size: 12.5px; color: var(--green-text); }
    .pf-abw__err { font-size: 12.5px; color: var(--red-text); }
    .pf-abw__go { margin-top: 6px; padding: 12px; border-radius: 11px; border: 0; font-size: 14px; font-weight: 700; color: #fff; cursor: pointer; background: linear-gradient(135deg, #7c3aed, #a855f7); }
    .pf-abw__go:disabled { opacity: 0.5; cursor: not-allowed; }

    /* NEW DESIGN (PF-PATTERN "Patient registration"): an pf-card modal —
       16px radius, kit inputs, Noto tabular numbers (never monospace),
       neutral info text (never green); phones: a sheet ABOVE the navbar. */
    :host-context(.design-new) .pf-abw__backdrop { background: rgba(15, 23, 42, 0.45); }
    :host-context(.design-new) .pf-abw { border-radius: var(--pf-radius-card, 16px); background: var(--pf-card-bg); border: 1px solid var(--pf-line); box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22); }
    :host-context(.design-new) .pf-abw__head { border-bottom-color: var(--pf-line); }
    :host-context(.design-new) .pf-abw__title { font-size: 16px; font-weight: 600; }
    :host-context(.design-new) .pf-abw__label { font-size: 12px; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--text-secondary); }
    :host-context(.design-new) .pf-abw__input {
      min-height: 40px; border-radius: var(--pf-radius-sm, 10px); font-size: 13.5px; font-weight: 500; letter-spacing: 0;
      font-family: inherit; font-variant-numeric: tabular-nums;
      border: 1px solid color-mix(in srgb, var(--text-primary) 22%, transparent);
      background: color-mix(in srgb, var(--text-primary) 4%, var(--pf-card-bg)); color: var(--text-primary);
    }
    :host-context(.design-new) .pf-abw__input:focus { border-color: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent); }
    :host-context(.design-new) .pf-abw__otp { font-family: inherit; font-size: 20px; letter-spacing: 0.3em; }
    :host-context(.design-new) .pf-abw__info { color: var(--text-secondary); }
    :host-context(.design-new) .pf-abw__go { border-radius: 12px; font-weight: 600; }
    @media (max-width: 640px) {
      :host-context(.design-new) .pf-abw__backdrop { align-items: flex-end; padding: 0; bottom: var(--pf-nav-h, 0px); }
      :host-context(.design-new) .pf-abw { max-width: none; border-radius: 20px 20px 0 0; max-height: calc(100% - env(safe-area-inset-top, 0px)); overflow-y: auto; }
      :host-context(.design-new) .pf-abw__input { min-height: 44px; font-size: 16px; }
    }
  `],
})
export class AbhaWizardComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly patientId = input.required<string>();
  /** When set, open straight into "verify existing" with this ABHA prefilled —
   *  used by the profile's "Refresh ABHA" action to re-pull KYC (incl. photo). */
  readonly presetAbha = input<string>('');
  readonly close = output<void>();
  readonly done = output<Patient>();

  readonly refresh = signal(false);
  readonly mode = signal<'choose' | 'create' | 'link'>('choose');

  ngOnInit() {
    const a = (this.presetAbha() || '').replace(/\D/g, '').slice(0, 14);
    if (a.length === 14) {
      this.refresh.set(true);
      this.mode.set('link');
      this.abha.set(a);
      this.step.set('input');
    }
  }
  readonly step = signal<'input' | 'otp'>('input');
  readonly txnId = signal('');
  readonly info = signal('');
  readonly aadhaar = signal('');
  readonly abha = signal('');
  readonly otp = signal('');
  readonly mobile = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  digits(v: string, max: number): string { return (v || '').replace(/\D/g, '').slice(0, max); }

  inputValid(): boolean {
    return this.mode() === 'create' ? this.aadhaar().length === 12 : this.abha().length === 14;
  }

  pick(m: 'create' | 'link') { this.mode.set(m); this.step.set('input'); this.error.set(''); this.info.set(''); this.otp.set(''); this.txnId.set(''); }
  back() {
    this.error.set('');
    if (this.step() === 'otp') { this.step.set('input'); this.otp.set(''); }
    else this.mode.set('choose');
  }

  requestOtp() {
    if (this.busy() || !this.inputValid()) return;
    this.busy.set(true); this.error.set('');
    const req = this.mode() === 'create'
      ? this.api.post<{ txnId: string; message: string }>('/api/abdm/enrol/aadhaar/otp', { aadhaar: this.aadhaar() })
      : this.api.post<{ txnId: string; message: string }>('/api/abdm/verify/request-otp', { abhaId: this.abha() });
    req.subscribe({
      next: r => { this.txnId.set(r?.txnId ?? ''); this.info.set(r?.message ?? 'OTP sent.'); this.step.set('otp'); this.busy.set(false); },
      error: e => { this.error.set(ApiError.from(e).message); this.busy.set(false); },
    });
  }

  verify() {
    if (this.busy() || this.otp().length < 4) return;
    this.busy.set(true); this.error.set('');
    const req = this.mode() === 'create'
      ? this.api.post<Patient>('/api/abdm/enrol/aadhaar/verify', { patientId: this.patientId(), txnId: this.txnId(), otp: this.otp(), mobile: this.mobile() })
      : this.api.post<Patient>('/api/abdm/verify/confirm', { patientId: this.patientId(), txnId: this.txnId(), otp: this.otp() });
    req.subscribe({
      next: p => { this.busy.set(false); this.done.emit(p); },
      error: e => { this.error.set(ApiError.from(e).message); this.busy.set(false); },
    });
  }
}
