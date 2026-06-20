import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

interface Stage { key: string; label: string; done: boolean; }
interface TrackResult {
  org?: string; patient?: string; status?: string; rejected?: boolean;
  timeline?: Stage[]; reportReady?: boolean; reportToken?: string; reportPdfUrl?: string;
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
    :host { display:block; min-height:100vh; background:#0a0a15; color:#fff;
      font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
    .wrap { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; gap:14px;
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
    .timeline { list-style:none; padding:0; margin:10px 0 0; }
    .timeline li { display:flex; align-items:center; gap:12px; padding:9px 0; color:rgba(255,255,255,.5); }
    .timeline li.done { color:#fff; }
    .timeline .dot { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font-size:13px; flex-shrink:0;
      background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14); }
    .timeline li.done .dot { background:linear-gradient(135deg,#7c3aed,#ec4899); border:none; }
    .foot { color:rgba(255,255,255,.3); font-size:11px; }
  `]
})
export class TrackComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  protected secret = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<TrackResult | null>(null);

  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  reportUrl(reportToken: string) { return `${window.location.origin}/reports/public/${reportToken}`; }

  async verify() {
    if (!this.secret.trim() || this.busy()) return;
    this.busy.set(true); this.error.set(null);
    try {
      const res: any = await firstValueFrom(this.http.post(
        `${environment.apiUrl}/api/public/track/${this.token}/verify`, { secret: this.secret.trim() }));
      if (res?.success && res.data) { this.result.set(res.data); }
      else { this.error.set(res?.error?.message ?? 'Could not verify. Check the details and try again.'); }
    } catch (e: any) {
      this.error.set(e?.error?.error?.message ?? 'Could not verify. Try again in a moment.');
    } finally {
      this.busy.set(false);
    }
  }
}
