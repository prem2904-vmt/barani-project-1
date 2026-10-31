import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { GoogleSignInService } from '../../core/auth/google-oauth';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';
import { setPasswordUrl } from './login.component';

/**
 * /auth/callback — where Supabase's Google sign-in comes back with ?code=….
 * Exchanges the code (PKCE, google-oauth.ts), runs the normal session tail
 * (AuthService → /me), then goes to the return URL it started with (the
 * OAuth consent page) or the landing. Errors in plain words + back to sign in.
 */
@Component({
  selector: 'pf-auth-callback',
  standalone: true,
  imports: [LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="pf-acb" [attr.aria-busy]="!error()">
      <section class="pf-card pf-acb__card" aria-labelledby="pf-acb-title">
        <div class="pf-card__body pf-acb__body">
          @if (!error()) {
            <pf-loading-logo size="sm" [inline]="true"></pf-loading-logo>
            <h1 class="pf-acb__title" id="pf-acb-title">Signing you in…</h1>
            <p class="pf-acb__text">Finishing your Google sign-in.</p>
          } @else {
            <h1 class="pf-acb__title" id="pf-acb-title">Couldn’t sign you in</h1>
            <p class="pf-acb__text" role="alert">{{ error() }}</p>
            <button type="button" class="pf-btn pf-btn--primary press" (click)="back()">Back to sign in</button>
          }
        </div>
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100dvh; background: var(--bg-primary); }
    .pf-acb { min-height: 100dvh; display: grid; place-items: center; padding: 16px; }
    .pf-acb__card { width: min(420px, 100%); }
    .pf-acb__body { align-items: center; text-align: center; gap: 10px; padding: 28px 20px; }
    .pf-acb__title { margin: 0; font-size: 17px; font-weight: 600; color: var(--text-primary); }
    .pf-acb__text { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text-secondary); text-wrap: pretty; }
    .pf-acb .pf-btn { margin-top: 6px; min-width: 180px; }
  `],
})
export class AuthCallbackPage implements OnInit {
  private readonly google = inject(GoogleSignInService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly error = signal<string | null>(null);
  private returnUrl: string | null = null;

  ngOnInit(): void { void this.finish(); }

  private async finish(): Promise<void> {
    try {
      this.returnUrl = await this.google.complete(window.location.search, window.location.hash);
    } catch (e) {
      this.error.set((e as Error)?.message || 'Google sign-in didn’t work.');
      return;
    }
    const url = this.auth.mustChangePassword() ? setPasswordUrl(this.returnUrl) : (this.returnUrl || '/');
    await this.router.navigateByUrl(url, { replaceUrl: true });
  }

  back(): void {
    void this.router.navigate(['/login'], { replaceUrl: true, queryParams: this.returnUrl ? { returnUrl: this.returnUrl } : {} });
  }
}
