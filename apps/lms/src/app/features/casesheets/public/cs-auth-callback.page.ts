import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, GoogleSignInError } from '../../../core/auth/auth.service';
import { BusyComponent } from '../../../shared/primitives/skeleton-kit.component';
import { CasesheetGateService } from '../shared/casesheet-gate.service';
import { resolvePublicAccess } from './public-access';

/**
 * The Google return (`/auth/callback?code=…`, plan §4.3): AuthService.completeGoogleSignIn swaps the one-time code
 * (PKCE) for a session, enters the personal space (POST /api/casesheets/personal/enter) and runs the shared sign-in
 * tail. Then:
 *  - a personal space, or a lab user whose lab has case sheets → where they were going (Departments by default);
 *  - signed in but case sheets aren't open for them → /sign-in, which shows "not available" + Sign out;
 *  - no session (cancelled, expired link, refused, offline) → /sign-in with the reason (`?e=`).
 * The URL with the code is always REPLACED, so Back never replays it.
 */
@Component({
  selector: 'pf-cs-auth-callback',
  standalone: true,
  imports: [BusyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cb" role="status" aria-live="polite">
      <pf-busy label="Signing you in"></pf-busy>
      <span>Signing you in…</span>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .cb {
      min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 12px; background: var(--bg-primary); color: var(--text-secondary); font-size: 14px;
    }
  `],
})
export class CsAuthCallbackPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly gate = inject(CasesheetGateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  async ngOnInit(): Promise<void> {
    const q = this.route.snapshot.queryParamMap;
    let next = '/';
    try {
      const r = await this.auth.completeGoogleSignIn({ code: q.get('code'), error: q.get('error') });
      next = r.next;
    } catch (e) {
      // The server's refusal reason when there is one (worded on the sign-in page), else the general code.
      const code = e instanceof GoogleSignInError ? (e.reason ?? e.code) : 'transient';
      await this.router.navigate(['/sign-in'], { queryParams: { e: code }, replaceUrl: true });
      return;
    }
    const access = await resolvePublicAccess(this.auth, this.gate);
    if (access === 'allowed') await this.router.navigateByUrl(next, { replaceUrl: true });
    else await this.router.navigate(['/sign-in'], { replaceUrl: true });
  }
}
