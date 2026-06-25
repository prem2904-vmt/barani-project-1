import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';

interface PublicReportResult {
  org?: string; patient?: string; reportReady?: boolean; reportPdfUrl?: string;
}

/**
 * Public, no-login report page reached from the WhatsApp/QR link
 * (/reports/public/:token). The patient enters their DOB or phone (the same
 * step-up as the tracking page) and the finished report PDF opens inline — it
 * must NEVER bounce through the staff login. The token is opaque; the PDF is
 * only revealed after the DOB/phone verification.
 */
@Component({
  selector: 'pf-public-report',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      @if (!pdfUrl()) {
        <div class="card">
          <div class="brand">Prefrontal</div>
          <h1 class="h1">View your report</h1>
          <p class="sub">For your privacy, confirm your date of birth or registered phone number to open the report.</p>
          <input class="inp" [(ngModel)]="secret" (keyup.enter)="verify()" placeholder="DOB (YYYY-MM-DD) or phone" autocomplete="off"/>
          @if (error()) { <p class="err">{{ error() }}</p> }
          <button class="btn" [disabled]="busy() || !secret.trim()" (click)="verify()">{{ busy() ? 'Checking…' : 'Open report' }}</button>
        </div>
        <p class="foot">Secure report access · Prefrontal</p>
      } @else {
        <div class="viewer">
          <div class="viewer-bar">
            <span class="viewer-org">{{ result()?.org || 'Your lab' }}</span>
            <a class="viewer-open" [href]="rawPdfUrl()" target="_blank" rel="noopener">Open in new tab ↗</a>
          </div>
          <iframe class="frame" [src]="pdfUrl()!" title="Report"></iframe>
        </div>
      }
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
    .err { color:#fca5a5; font-size:13px; margin:6px 0 0; }
    .foot { color:rgba(255,255,255,.3); font-size:11px; }

    /* ── Inline PDF viewer (post-verify) — full-bleed so the report is readable ── */
    .viewer { width:100%; max-width:980px; height:100dvh; display:flex; flex-direction:column; }
    .viewer-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; }
    .viewer-org { font-weight:700; font-size:14px; }
    .viewer-open { color:#c4b5fd; font-size:13px; text-decoration:none; font-weight:600; }
    .frame { flex:1; width:100%; border:0; border-radius:14px 14px 0 0; background:#fff; }

    /* ── Cross-platform additive overrides (do not touch base/desktop rules) ── */
    :host-context(html.cap-native) .wrap {
      padding-top:calc(24px + env(safe-area-inset-top));
      padding-bottom:calc(24px + env(safe-area-inset-bottom));
      padding-left:calc(24px + env(safe-area-inset-left));
      padding-right:calc(24px + env(safe-area-inset-right));
    }
    @media (max-width:640px) {
      .inp { font-size:16px; }
      .btn { min-height:48px; }
    }
    @media (pointer:coarse) {
      .btn { min-height:48px; }
      .inp { min-height:48px; font-size:16px; }
    }
    .btn { -webkit-tap-highlight-color:transparent; }
  `]
})
export class PublicReportComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  protected secret = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<PublicReportResult | null>(null);
  protected readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  protected readonly rawPdfUrl = signal<string>('');

  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  async verify() {
    if (!this.secret.trim() || this.busy()) return;
    this.busy.set(true); this.error.set(null);
    try {
      const res: any = await firstValueFrom(this.http.post(
        `${environment.apiUrl}/api/public/report/${this.token}/verify`, { secret: this.secret.trim() }));
      if (res?.success && res.data) {
        this.result.set(res.data);
        const url = res.data.reportPdfUrl as string | undefined;
        if (url) {
          this.rawPdfUrl.set(url);
          this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
        } else {
          this.error.set('Your report is verified but the PDF is not available yet. Please contact the lab.');
        }
      } else {
        this.error.set(res?.error?.message ?? 'Could not verify. Check the details and try again.');
      }
    } catch (e: any) {
      this.error.set(e?.error?.error?.message ?? 'Could not verify. Try again in a moment.');
    } finally {
      this.busy.set(false);
    }
  }
}
