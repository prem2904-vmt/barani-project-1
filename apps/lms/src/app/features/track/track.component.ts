import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import QRCode from 'qrcode';
import { environment } from '../../../environments/environment';
import { upiLink } from '../../shared/utils/upi';

interface Stage { key: string; label: string; done: boolean; }
interface TrackResult {
  org?: string; patient?: string; status?: string; rejected?: boolean;
  timeline?: Stage[]; reportReady?: boolean; reportToken?: string; reportPdfUrl?: string;
  // Payment (only present when there's a balance + the lab configured UPI).
  balanceDue?: number; invoiceNumber?: string; upiVpa?: string; upiPayeeName?: string;
}

/**
 * Public, no-login result-tracking page reached by scanning the invoice QR
 * (/track/:token). The patient enters their DOB or phone (step-up) to reveal a
 * status timeline and, when ready, a link to the finished report. The token is
 * opaque; all PHI is gated behind the verification.
 */
@Component({
  selector: 'pf-track',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="card">
        <div class="brand">Prefrontal</div>
        @if (!result()) {
          <h1 class="h1">Track your report</h1>
          <p class="sub">Enter your date of birth or registered phone number to view your status.</p>
          <input class="inp" [(ngModel)]="secret" (keyup.enter)="verify()" placeholder="DOB (YYYY-MM-DD) or phone" autocomplete="off"/>
          @if (error()) { <p class="err">{{ error() }}</p> }
          <button class="btn" [disabled]="busy() || !secret.trim()" (click)="verify()">{{ busy() ? 'Checking…' : 'View status' }}</button>
        } @else {
          <h1 class="h1">{{ result()!.org || 'Your lab' }}</h1>
          <p class="sub">Status for {{ result()!.patient }}</p>
          @if (result()!.rejected) {
            <p class="err">A sample was rejected — please contact the lab for a recollection.</p>
          }
          <ol class="timeline">
            @for (s of result()!.timeline; track s.key) {
              <li [class.done]="s.done">
                <span class="dot">@if (s.done) { ✓ }</span>
                <span class="lbl">{{ s.label }}</span>
              </li>
            }
          </ol>

          @if ((result()!.balanceDue ?? 0) > 0 && result()!.upiVpa) {
            <div class="pay">
              <div class="pay-head">
                <span class="pay-lbl">Amount due</span>
                <span class="pay-amt">₹{{ result()!.balanceDue }}</span>
              </div>
              <a class="btn btn-upi" [href]="upiHref()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
                </svg>
                Pay ₹{{ result()!.balanceDue }} via UPI
              </a>
              @if (upiQr()) {
                <div class="pay-qr">
                  <img [src]="upiQr()!" alt="UPI payment QR" width="150" height="150"/>
                  <span class="pay-qr-cap">or scan with Google Pay / PhonePe / any UPI app</span>
                </div>
              }
              <p class="pay-note">After paying, show the confirmation at the front desk — your report is released once the payment is verified.</p>
            </div>
          }

          @if (result()!.reportReady && (result()!.reportPdfUrl || result()!.reportToken)) {
            <a class="btn" [href]="result()!.reportPdfUrl || reportUrl(result()!.reportToken!)" target="_blank" rel="noopener">View report</a>
          } @else {
            <p class="sub" style="margin-top:14px">Your report isn't ready yet. Scan again later.</p>
          }
        }
      </div>
      <p class="foot">Secure result tracking · Prefrontal</p>
    </div>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:#0a0a15; color:#fff;
      font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
    .wrap { min-height:100dvh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; gap:14px;
      background:radial-gradient(680px 420px at 12% -8%, rgba(124,58,237,.18), transparent 70%), radial-gradient(560px 380px at 96% 2%, rgba(236,72,153,.12), transparent 70%); }
    .card { width:100%; max-width:420px; background:#14141f; border:1px solid rgba(255,255,255,.08); border-radius:18px; padding:30px 26px; box-shadow:0 24px 60px -20px rgba(0,0,0,.6); }
    .brand { font-weight:800; letter-spacing:-.01em; background:linear-gradient(135deg,#a855f7,#ec4899); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
    .h1 { font-size:22px; font-weight:800; margin:12px 0 4px; }
    .sub { color:rgba(255,255,255,.6); font-size:14px; margin:0 0 16px; }
    .inp { width:100%; padding:12px 14px; border-radius:12px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.12); color:#fff; font-size:15px; }
    .inp:focus { outline:none; border-color:#8b5cf6; }
    .btn { display:inline-flex; align-items:center; justify-content:center; width:100%; margin-top:14px; padding:12px; border-radius:12px; border:none;
      background:linear-gradient(135deg,#7c3aed,#ec4899); color:#fff; font-weight:700; font-size:14px; cursor:pointer; text-decoration:none; box-sizing:border-box; }
    .btn:disabled { opacity:.5; cursor:default; }
    .err { color:var(--red-text); font-size:13px; margin:6px 0 0; }
    .timeline { list-style:none; padding:0; margin:10px 0 0; }
    .timeline li { display:flex; align-items:center; gap:12px; padding:9px 0; color:rgba(255,255,255,.5); }
    .timeline .lbl { min-width:0; overflow-wrap:anywhere; }
    .timeline li.done { color:#fff; }
    .timeline .dot { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font-size:13px; flex-shrink:0;
      background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14); }
    .timeline li.done .dot { background:linear-gradient(135deg,#7c3aed,#ec4899); border:none; }
    .foot { color:rgba(255,255,255,.3); font-size:11px; }

    /* ── Pay via UPI ── */
    .pay { margin-top:18px; padding:16px; border-radius:14px; background:rgba(139,92,246,.08); border:1px solid rgba(139,92,246,.28); }
    .pay-head { display:flex; align-items:baseline; justify-content:space-between; }
    .pay-lbl { font-size:12px; color:rgba(255,255,255,.55); text-transform:uppercase; letter-spacing:.08em; }
    .pay-amt { font-size:22px; font-weight:800; color:#fff; }
    .btn-upi { gap:8px; background:linear-gradient(135deg,#7c3aed,#8b5cf6); }
    .pay-qr { display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:14px; }
    .pay-qr img { width:150px; height:150px; border-radius:10px; background:#fff; padding:8px; box-sizing:content-box; }
    .pay-qr-cap { font-size:11.5px; color:rgba(255,255,255,.5); text-align:center; max-width:220px; }
    .pay-note { margin:12px 0 0; font-size:12px; color:rgba(255,255,255,.5); line-height:1.5; text-align:center; }

    /* ── Cross-platform additive overrides (do not touch base/desktop rules) ── */
    /* Capacitor native: this public page is full-bleed chrome of its own, so absorb the notch/home-indicator. */
    :host-context(html.cap-native) .wrap {
      padding-top:calc(24px + env(safe-area-inset-top));
      padding-bottom:calc(24px + env(safe-area-inset-bottom));
      padding-left:calc(24px + env(safe-area-inset-left));
      padding-right:calc(24px + env(safe-area-inset-right));
    }
    /* Phone: prevent iOS auto-zoom on input focus (needs >=16px) and ensure comfortable tap targets. */
    @media (max-width:640px) {
      .inp { font-size:16px; }
      .btn { min-height:48px; }
      .timeline .dot { width:28px; height:28px; }
    }
    /* Touch devices (incl. iPad >640px): comfortable tap targets + 16px input to block focus-zoom. */
    @media (pointer:coarse) {
      .btn { min-height:48px; }
      .inp { min-height:48px; font-size:16px; }
    }
    /* Taps shouldn't leave a sticky highlight on touch. */
    .btn { -webkit-tap-highlight-color:transparent; }
  `]
})
export class TrackComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  protected secret = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<TrackResult | null>(null);
  /** Data-URL QR of the upi://pay link, rendered client-side for cross-device scan. */
  protected readonly upiQr = signal<string | null>(null);

  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  reportUrl(reportToken: string) { return `${window.location.origin}/reports/public/${reportToken}`; }

  /** upi://pay deep-link for the "Pay via UPI" button (opens the UPI app). */
  upiHref(): string {
    const r = this.result();
    if (!r?.upiVpa) return '';
    return upiLink(r.upiVpa, r.upiPayeeName, r.balanceDue, r.invoiceNumber);
  }

  async verify() {
    if (!this.secret.trim() || this.busy()) return;
    this.busy.set(true); this.error.set(null);
    try {
      const res: any = await firstValueFrom(this.http.post(
        `${environment.apiUrl}/api/public/track/${this.token}/verify`, { secret: this.secret.trim() }));
      if (res?.success && res.data) {
        this.result.set(res.data);
        const r = res.data as TrackResult;
        this.upiQr.set(null);
        if (r.upiVpa && (r.balanceDue ?? 0) > 0) {
          try {
            const dataUrl = await QRCode.toDataURL(
              upiLink(r.upiVpa, r.upiPayeeName, r.balanceDue, r.invoiceNumber),
              { margin: 1, width: 300, color: { dark: '#0f172a', light: '#ffffff' } });
            this.upiQr.set(dataUrl);
          } catch { /* QR is a nice-to-have; the button still works */ }
        }
      }
      else { this.error.set(res?.error?.message ?? 'Could not verify. Check the details and try again.'); }
    } catch (e: any) {
      this.error.set(e?.error?.error?.message ?? 'Could not verify. Try again in a moment.');
    } finally {
      this.busy.set(false);
    }
  }
}
