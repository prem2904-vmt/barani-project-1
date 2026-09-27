import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';

interface PublicReportResult {
  org?: string; patient?: string; reportReady?: boolean; reportPdfUrl?: string;
  report?: { id: string; type: string; createdAt?: string; data?: string | null };
  template?: unknown;
  /** Outsourced tests' partner-lab reports, delivered alongside ours. */
  partnerReports?: { testName: string; partnerLabName?: string | null; url: string; fileName?: string | null }[];
  /** Uploads are private; the verified page gets short-lived signed URLs for
   *  every "/uploads/…" asset its report needs, keyed by the stored path. */
  assetUrls?: Record<string, string>;
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
          <p class="sub">For your privacy, confirm your date of birth (DD/MM), the last 4 digits of your registered phone, or your invoice number to open the report.</p>
          <input class="inp" [(ngModel)]="secret" (keyup.enter)="verify()" placeholder="DOB (DD/MM), last 4 of phone, or invoice no." autocomplete="off"/>
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
          @for (p of result()?.partnerReports ?? []; track p.url) {
            <div class="viewer-bar viewer-bar--partner">
              <span class="viewer-org">{{ p.testName }}@if (p.partnerLabName) { · tested at {{ p.partnerLabName }}}</span>
              <a class="viewer-open" [href]="fileUrl(p.url)" target="_blank" rel="noopener">Partner lab report ↗</a>
            </div>
          }
          @if (isIos) {
            <!-- iOS (Safari + WKWebView) renders ONLY PAGE 1 of a PDF inside
                 an iframe — a patient with a 3-page report would never see
                 pages 2-3 and never know they existed. Hand off to Safari's
                 own full viewer instead, with the first page framed behind
                 the CTA so the page still looks like their report. -->
            <div class="ios-viewer">
              <iframe class="frame frame--peek" [src]="pdfUrl()!" title="Report preview (first page)"></iframe>
              <a class="btn ios-open" [href]="rawPdfUrl()" target="_blank" rel="noopener">
                View full report ({{ '\u2197' }})
              </a>
              <p class="ios-note">Preview shows the first page — tap above for all pages.</p>
            </div>
          } @else {
            <iframe class="frame" [src]="pdfUrl()!" title="Report"></iframe>
          }
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
    /* PDF viewer goes full-bleed on phones AND tablets: the 100dvh viewer
       inside a 24px-padded flex column overflowed on iPad, cutting the
       bottom of the report and the viewer bar. Desktop (>1024px) keeps the
       framed layout. */
    @media (max-width:1024px) {
      .wrap:has(.viewer) { padding:0; gap:0; }
      .viewer { max-width:none; }
      .frame { border-radius:0; }
    }
    @media (pointer:coarse) {
      .btn { min-height:48px; }
      .inp { min-height:48px; font-size:16px; }
      .viewer-open { min-height:44px; display:inline-flex; align-items:center; }
    }
    /* Native: keep the PDF viewer clear of the notch + home indicator */
    :host-context(html.cap-native) .wrap:has(.viewer) { padding:0; gap:0; }
    :host-context(html.cap-native) .viewer { box-sizing:border-box; padding-bottom:env(safe-area-inset-bottom); }
    :host-context(html.cap-native) .viewer-bar {
      padding-top:calc(12px + env(safe-area-inset-top));
      padding-left:calc(14px + env(safe-area-inset-left));
      padding-right:calc(14px + env(safe-area-inset-right));
    }
    .btn { -webkit-tap-highlight-color:transparent; }
  
    .ios-viewer { flex:1; display:flex; flex-direction:column; min-height:0; }
    .frame--peek { pointer-events:none; }
    .ios-open { margin:10px 14px calc(10px + env(safe-area-inset-bottom)); width:auto; }
    .ios-note { text-align:center; color:rgba(255,255,255,.45); font-size:12px; margin:0 0 10px; }
`]
})
export class PublicReportComponent {
  /** iOS renders only page 1 of iframe PDFs — route those users to Safari's
   *  full viewer (see template). */
  readonly isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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

  /** Partner files live on the API host — already signed by the verify call
   *  ("/uploads/…?exp=…&sig=…"). */
  protected fileUrl(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `${environment.apiUrl.replace(/\/$/, '')}${url}`;
  }

  constructor() {
    // Hand-off from the tracking page: the patient already verified there, and
    // the secret rides along in navigation state — verify silently so "View
    // report" lands straight on the PDF instead of asking a second time.
    // (history.state survives only the in-app navigation; a shared/reloaded
    // link has no state and prompts as usual.)
    const carried = (history.state as { secret?: unknown } | null)?.secret;
    if (typeof carried === 'string' && carried.trim()) {
      this.secret = carried.trim();
      void this.verify();
    }
  }

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
          // Best case: serve the exact archived PDF.
          this.rawPdfUrl.set(url);
          this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
        } else if (res.data.report?.data) {
          // No archived PDF — render it client-side from the snapshot so the
          // patient still sees their report (same renderer as the staff app).
          await this.renderFromSnapshot(res.data);
        } else {
          this.error.set('Your report is verified but is not available yet. Please contact the lab.');
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

  /** Render the report PDF client-side from the snapshot returned by verify,
   *  for reports that were never archived to storage. Uses the same renderer
   *  as the staff app with the legacy per-test table fallback (no
   *  authenticated layout resolution available on this public page). */
  private async renderFromSnapshot(data: PublicReportResult) {
    try {
      const { buildReportPdf, preloadReportImages } = await import('../../../shared/utils/report-pdf');
      const baseInput = {
        report: data.report as { id: string; type: string; createdAt?: string; data?: string | null },
        template: (data.template ?? null) as never,
        resolvedLayouts: {},
      };
      const imageCache = await preloadReportImages(baseInput, environment.apiUrl, data.assetUrls);
      const blob = buildReportPdf({ ...baseInput, imageCache }).output('blob');
      const url = URL.createObjectURL(blob);
      this.rawPdfUrl.set(url);
      this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    } catch (e) {
      console.error('[public-report] client render failed', e);
      this.error.set('Your report is verified but could not be displayed. Please contact the lab.');
    }
  }
}
