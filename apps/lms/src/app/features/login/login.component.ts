import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Route-based landing by permission. Ordered from most specific to most generic
 * so that a multi-role user lands on the screen that matches their heaviest role.
 */
const ROLE_LANDINGS: Array<{ perm: string; path: string }> = [
  { perm: 'manage_tests',     path: '/admin' },
  { perm: 'register_patient', path: '/frontdesk' },
  { perm: 'enter_result',     path: '/lab/my-work' },
  { perm: 'validate_result',  path: '/pathologist' },
  { perm: 'collect_sample',   path: '/sample-collection' },
  { perm: 'view_tat_dashboard', path: '/dashboard' },
  { perm: 'view_dashboard',     path: '/dashboard' }
];

// Any of these perms lets a user into /admin/*. Must stay in sync with
// ADMIN_PERMS in app.routes.ts.
const ADMIN_PERMS = ['manage_tests', 'manage_users', 'manage_workflows', 'manage_branches'];

@Component({
  selector: 'pf-login',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-login">
      <div class="pf-login__card">
        <div class="pf-login__brand">
          <span class="pf-login__logo">PF</span>
          <div>
            <div class="pf-login__title">Prefrontal</div>
            <div class="pf-login__sub">Lab Management System</div>
          </div>
        </div>

        <form (ngSubmit)="submit()">
          <label class="pf-login__label">Email</label>
          <input class="pf-login__input"
                 type="email" autocomplete="email" required
                 [ngModel]="email()" (ngModelChange)="email.set($event)" name="email"
                 placeholder="you@example.com" />

          <label class="pf-login__label">Password</label>
          <input class="pf-login__input"
                 type="password" autocomplete="current-password" required
                 [ngModel]="password()" (ngModelChange)="password.set($event)" name="password"
                 placeholder="••••••••" />

          @if (error()) {
            <p class="pf-login__error">{{ error() }}</p>
          }

          <button type="submit"
                  class="pf-login__btn"
                  [disabled]="busy() || !email() || !password()">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>

        <p class="pf-login__hint">Contact your admin if you need access.</p>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pf-login {
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      background:
        radial-gradient(60% 50% at 20% 20%, rgba(45, 212, 191, 0.12) 0%, transparent 60%),
        radial-gradient(50% 40% at 80% 70%, rgba(20, 184, 166, 0.12) 0%, transparent 60%),
        var(--bg-primary, #070b14);
    }
    .pf-login__card {
      width: 100%; max-width: 400px;
      padding: 36px 32px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 20px;
      box-shadow: 0 30px 90px rgba(0,0,0,0.45);
    }
    .pf-login__brand { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
    .pf-login__logo {
      width: 44px; height: 44px; border-radius: 12px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--gradient-primary);
      color: #fff; font-weight: 700; letter-spacing: 0.04em;
    }
    .pf-login__title { font-weight: 700; color: var(--text-primary); }
    .pf-login__sub { font-size: 12px; color: var(--text-muted); }

    .pf-login__label {
      display: block; margin-top: 14px; margin-bottom: 6px;
      font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-login__input {
      width: 100%; height: 44px; padding: 0 14px;
      background: var(--bg-primary, #0a0f1f);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      color: var(--text-primary);
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.2s ease;
    }
    .pf-login__input:focus {
      border-color: rgba(45, 212, 191, 0.65);
      box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.18);
    }
    .pf-login__error {
      margin-top: 14px; padding: 10px 12px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.35);
      border-radius: 10px;
      color: #fca5a5; font-size: 13px;
    }
    .pf-login__btn {
      width: 100%; height: 46px; margin-top: 20px;
      background: var(--gradient-primary); color: #fff;
      border: 0; border-radius: 12px;
      font-weight: 600; cursor: pointer;
      transition: filter 0.2s, transform 0.1s;
    }
    .pf-login__btn:hover:not(:disabled) { filter: brightness(1.08); }
    .pf-login__btn:active:not(:disabled) { transform: scale(0.99); }
    .pf-login__btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pf-login__hint { margin-top: 20px; color: var(--text-muted); font-size: 12px; text-align: center; }
  `]
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private canVisit(url: string): boolean {
    if (url.startsWith('/admin') || url.startsWith('/setup')) {
      return this.auth.hasAnyPermission(ADMIN_PERMS);
    }
    return true;
  }

  async submit() {
    if (this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      // AuthService.signIn already races its internal steps with tighter
      // per-step timeouts (Supabase auth + /api/auth/me) that surface a
      // specific error. This outer race is just a safety net.
      // Safety net; each step inside signIn has its own tighter timeout
      // (token fetch 6s + setSession 2s + loadProfile 6s = 14s worst case).
      await Promise.race([
        this.auth.signIn(this.email().trim(), this.password()),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Sign-in timed out — check your connection')), 15_000))
      ]);
      // Route by permission — first match wins. Honor returnUrl only if the
      // user can actually enter it; otherwise fall through to ROLE_LANDINGS,
      // because the root redirect plants returnUrl=/admin for everyone and a
      // receptionist landing there would just bounce to /403.
      const returnUrl = new URLSearchParams(window.location.search).get('returnUrl');
      if (returnUrl && returnUrl !== '/login' && returnUrl !== '/' && this.canVisit(returnUrl)) {
        await this.router.navigateByUrl(returnUrl);
        return;
      }
      for (const { perm, path } of ROLE_LANDINGS) {
        if (this.auth.hasPermission(perm)) {
          await this.router.navigateByUrl(path);
          return;
        }
      }
      await this.router.navigateByUrl('/dashboard');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Sign-in failed');
    } finally {
      this.busy.set(false);
    }
  }
}
