import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PfGoogleMarkComponent } from '@prefrontal/forms-engine';
import { AuthService, GoogleSignInError } from '../../../core/auth/auth.service';
import { SessionService } from '../../../core/auth/session.service';
import { LogoMarkComponent } from '../../../shared/primitives/logo-mark.component';
import { AmbientBgComponent } from '../../../shared/components/ambient-bg/ambient-bg.component';
import { CasesheetGateService } from '../shared/casesheet-gate.service';
import { ENTER_REFUSALS } from './google-pkce';
import { resolvePublicAccess } from './public-access';

/** The `?e=` codes the callback page sends back with (GoogleSignInError.code) → plain words. */
export const SIGN_IN_ERRORS: Record<string, string> = {
  ...ENTER_REFUSALS,
  cancelled: 'Google sign-in didn’t finish. Please try again.',
  stale: 'That sign-in has expired. Please try again.',
  refused: 'This Google account can’t be used for case sheets.',
  transient: 'Couldn’t reach Prefrontal. Check your connection and try again.',
  unavailable: 'Case sheets aren’t available for this account.',
};

/** `?reason=` from the LMS sign-out sequence (SessionService.loginParams). */
const REASONS: Record<string, string> = {
  expired: 'You were signed out. Please sign in again.',
  suspended: 'This account is paused. Ask the person who manages it.',
};

/**
 * The public case-sheet site's sign-in (plan §4.3): Prefrontal case sheets branding, ONE "Continue with Google"
 * button, short copy. Same shell / card / button as the LMS sign-in (login.component.scss is the base stylesheet,
 * ENGINEERING-RULES "auth screens share ONE look").
 *
 * Signed in but not allowed here (a lab user whose lab has no case sheets, a closed gate): the plain "Case sheets
 * aren't available for this account" card with Sign out instead — nothing else is reachable.
 */
@Component({
  selector: 'pf-cs-sign-in',
  standalone: true,
  imports: [LogoMarkComponent, AmbientBgComponent, PfGoogleMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../login/login.component.scss'],
  styles: [`
    .cs-g__mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 999px; background: #fff; flex: none;
    }
    .cs-who { margin: 0 0 16px; font-size: 14px; line-height: 1.5; color: var(--text-secondary); overflow-wrap: anywhere; }
    .cs-who strong { color: var(--text-primary); font-weight: 600; }
  `],
  template: `
    <div class="lg">
      <pf-ambient-bg></pf-ambient-bg>
      <div class="lg__content">
        <div class="lg__layout">
          <header class="lg__brand">
            <div class="lg__id">
              <pf-logo-mark size="md" variant="glyph" ariaLabel="Prefrontal"></pf-logo-mark>
              <p class="lg__wordmark">Prefrontal</p>
            </div>
            <p class="lg__tagline">Case sheets</p>
            <p class="lg__statement">Fill a department’s case sheet at the bedside and get a clean PDF for the file.</p>
          </header>

          <main class="lg__card" [attr.aria-busy]="busy()">
            @if (state() === 'unavailable') {
              <div class="lg__head">
                <h1 class="lg__title" data-testid="cs-unavailable">Case sheets aren’t available for this account</h1>
              </div>
              @if (email()) {
                <p class="cs-who">You’re signed in as <strong>{{ email() }}</strong>.</p>
              }
              <button type="button" class="pf-btn pf-btn--primary lg__submit" data-testid="cs-sign-out"
                      [disabled]="busy()" (click)="signOut()">
                {{ busy() ? 'Signing out…' : 'Sign out' }}
              </button>
              <p class="lg__hint">Sign out to use a different Google account.</p>
            } @else {
              <div class="lg__head">
                <h1 class="lg__title">Sign in to case sheets</h1>
                <p class="lg__sub">Case sheets for your patients, ready on your tablet.</p>
              </div>

              @if (message(); as m) {
                <div class="lg__notice" role="status" data-testid="cs-sign-in-notice">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>
                  </svg>
                  <span>{{ m }}</span>
                </div>
              }

              <button type="button" class="pf-btn pf-btn--primary lg__submit" data-testid="google-sign-in"
                      [disabled]="busy() || state() === 'checking'"
                      [attr.aria-busy]="busy() ? 'true' : null"
                      (click)="signIn()">
                <span class="cs-g__mark"><pf-google-mark [size]="18" /></span>
                {{ busy() ? 'Opening Google…' : 'Continue with Google' }}
              </button>
              <p class="lg__hint">Your case sheets stay in your own private space. Only you can see them.</p>
            }
          </main>
        </div>
      </div>
    </div>
  `,
})
export class CsSignInPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly gate = inject(CasesheetGateService);
  private readonly session = inject(SessionService);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly state = signal<'checking' | 'signed-out' | 'unavailable'>('checking');
  protected readonly busy = signal(false);
  private readonly error = signal<string | null>(null);
  protected readonly email = computed(() => {
    const e = this.auth.user()?.email ?? '';
    // Synthetic staff auth addresses are not something a person recognises.
    return /\.tenant\.prefrontal$/i.test(e) ? '' : e;
  });

  protected readonly message = computed(() =>
    this.error()
    ?? SIGN_IN_ERRORS[this.query.get('e') ?? '']
    ?? REASONS[this.query.get('reason') ?? '']
    ?? null);

  async ngOnInit(): Promise<void> {
    const access = await resolvePublicAccess(this.auth, this.gate);
    // 'allowed' never reaches here (casesheetsSignInGuard sends it to Departments).
    this.state.set(access === 'signed-out' ? 'signed-out' : 'unavailable');
  }

  protected async signIn(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.signInWithGoogle(this.query.get('next') ?? this.query.get('returnUrl'));
      // Still here = the page didn't leave (blocked); let them try again.
    } catch (e) {
      this.error.set(e instanceof GoogleSignInError ? e.message : SIGN_IN_ERRORS['transient']);
    } finally {
      this.busy.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.session.logout();
    } finally {
      this.busy.set(false);
      this.state.set('signed-out');
    }
  }
}
