import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { LogoMarkComponent } from '../../shared/primitives/logo-mark.component';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';
import { PlatformService } from '../../core/services/platform.service';
import { environment } from '../../../environments/environment';

/**
 * Route-based landing by permission. Ordered from most specific to most generic
 * so that a multi-role user lands on the screen that matches their heaviest role.
 */
const ROLE_LANDINGS: Array<{ perm: string; path: string }> = [
  { perm: 'manage_tests',       path: '/admin' },
  { perm: 'register_patient',   path: '/frontdesk' },
  { perm: 'enter_result',       path: '/lab/my-work' },
  { perm: 'validate_result',    path: '/pathologist' },
  { perm: 'collect_sample',     path: '/sample-collection' },
  { perm: 'view_tat_dashboard', path: '/dashboard' },
  { perm: 'view_dashboard',     path: '/dashboard' }
];

// Any of these perms lets a user into /admin/*. Must stay in sync with
// ADMIN_PERMS in app.routes.ts.
const ADMIN_PERMS = ['manage_tests', 'manage_users', 'manage_workflows', 'manage_branches'];

@Component({
  selector: 'pf-login',
  standalone: true,
  imports: [FormsModule, LogoMarkComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-auth" [class.pf-auth--native]="isNative()">
      <!-- Animated mesh background — drops to a single softer blob on
           Capacitor so the GPU on older iPhones isn't churning on three
           large blurred gradients during keyboard animation. -->
      <div class="pf-auth__mesh" aria-hidden="true">
        <span class="pf-auth__blob pf-auth__blob--1"></span>
        @if (!isNative()) {
          <span class="pf-auth__blob pf-auth__blob--2"></span>
          <span class="pf-auth__blob pf-auth__blob--3"></span>
        }
      </div>

      <!-- The card stack: brand strip on top, form below. Single column
           on mobile/native — the marketing "hero panel" is desktop-only
           so the form is above the fold on a phone. -->
      <main class="pf-auth__stack">
        <header class="pf-auth__brand">
          <pf-logo-mark size="lg" variant="glyph" [pulse]="true" ariaLabel="Prefrontal"></pf-logo-mark>
          <div class="pf-auth__brand-text">
            <p class="pf-auth__wordmark">Prefrontal</p>
            <p class="pf-auth__tagline">Lab software that thinks ahead.</p>
          </div>
        </header>

        <form class="pf-auth__form" (ngSubmit)="submit()" novalidate
              [class.pf-auth__form--busy]="busy()">
          <h1 class="pf-auth__title">Sign in</h1>

          <label class="pf-auth__field">
            <span class="pf-auth__field-label">Email</span>
            <input class="pf-auth__field-input"
                   type="email"
                   inputmode="email"
                   autocomplete="username"
                   autocapitalize="off"
                   autocorrect="off"
                   spellcheck="false"
                   enterkeyhint="next"
                   required
                   [ngModel]="email()"
                   (ngModelChange)="email.set($event); error.set(null)"
                   name="email"
                   placeholder="you@lab.example" />
          </label>

          <label class="pf-auth__field">
            <span class="pf-auth__field-label">Password</span>
            <span class="pf-auth__field-row">
              <input class="pf-auth__field-input"
                     [type]="showPassword() ? 'text' : 'password'"
                     autocomplete="current-password"
                     autocapitalize="off"
                     autocorrect="off"
                     spellcheck="false"
                     enterkeyhint="go"
                     required
                     [ngModel]="password()"
                     (ngModelChange)="password.set($event); error.set(null)"
                     name="password"
                     placeholder="••••••••" />
              <button type="button" class="pf-auth__eye"
                      (click)="showPassword.set(!showPassword())"
                      [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'">
                @if (showPassword()) {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 3l18 18M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6"/>
                    <path d="M9.9 5.1A11 11 0 0 1 12 5c5 0 9 4 10 7a13 13 0 0 1-2.4 3.4M6.4 6.4A13 13 0 0 0 2 12c1 3 5 7 10 7a11 11 0 0 0 4-.7"/>
                  </svg>
                } @else {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                }
              </button>
            </span>
          </label>

          @if (error()) {
            <p class="pf-auth__error" role="alert">
              <span class="pf-auth__error-icon" aria-hidden="true">!</span>
              <span class="pf-auth__error-msg">{{ error() }}</span>
            </p>
          }

          <!-- Belt-and-braces: type="submit" + (click) so the button
               works whether the form's ngSubmit fires or not. On iOS
               WKWebView with certain Angular zone configurations,
               ngSubmit can silently no-op; the (click) handler is the
               fallback. Both call the same method. -->
          <button type="submit"
                  class="pf-auth__submit"
                  (click)="submit($event)"
                  [disabled]="busy()">
            @if (busy()) {
              <pf-loading-logo size="xs" color="white" [inline]="true"></pf-loading-logo>
              <span>Signing in…</span>
            } @else {
              <span>Sign in</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6"/>
              </svg>
            }
          </button>

          <p class="pf-auth__hint">
            Locked out? Ask your admin to reset your password.
          </p>

          @if (isNative()) {
            <!-- Tiny diagnostic strip — visible only on native builds so
                 we can see at a glance which backend the WebView is
                 hitting. If sign-in fails it's usually CORS or the wrong
                 host; this makes that obvious. -->
            <p class="pf-auth__env">
              <span class="pf-auth__env-key">api</span>
              <span class="pf-auth__env-val">{{ apiHost() }}</span>
            </p>
          }
        </form>

        <footer class="pf-auth__foot">
          <span>Prefrontal LMS · v0.1.0</span>
        </footer>
      </main>
    </section>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; min-height: 100dvh; }

    /* ── Page ────────────────────────────────────────────────────────
       Mobile-first single-column auth screen. The hero panel that
       desktop has is intentionally absent — on a phone we want the
       form above the fold without scrolling. */
    .pf-auth {
      position: relative;
      min-height: 100vh; min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: var(--bg-primary, #050816);
      color: var(--text-primary, #e5e7eb);
      /* Safe-area inset for iPhone notch + home indicator. The pf-auth
         class wins over global rules because it's set inline here. */
      padding:
        calc(env(safe-area-inset-top, 0px) + 24px)
        calc(env(safe-area-inset-right, 0px) + 20px)
        calc(env(safe-area-inset-bottom, 0px) + 24px)
        calc(env(safe-area-inset-left, 0px) + 20px);
    }

    /* On Capacitor (iOS Simulator + real device) we get an even tighter
       padding so the form sits centred without scrolling. */
    .pf-auth--native {
      padding-top: calc(env(safe-area-inset-top, 0px) + 16px);
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    }

    /* ── Background blobs (decorative) ─────────────────────────────── */
    .pf-auth__mesh { position: absolute; inset: 0; pointer-events: none; }
    .pf-auth__blob {
      position: absolute;
      border-radius: 9999px;
      filter: blur(80px);
      will-change: transform;
    }
    .pf-auth__blob--1 {
      width: 520px; height: 520px;
      left: -120px; top: -160px;
      background: radial-gradient(circle, rgba(124, 58, 237, 0.55) 0%, transparent 70%);
      animation: pf-auth-blob 22s ease-in-out infinite;
    }
    .pf-auth__blob--2 {
      width: 440px; height: 440px;
      right: -100px; bottom: -120px;
      background: radial-gradient(circle, rgba(20, 184, 166, 0.42) 0%, transparent 70%);
      animation: pf-auth-blob 26s ease-in-out infinite reverse;
    }
    .pf-auth__blob--3 {
      width: 380px; height: 380px;
      right: 15%; top: 25%;
      background: radial-gradient(circle, rgba(236, 72, 153, 0.32) 0%, transparent 70%);
      animation: pf-auth-blob 30s ease-in-out infinite;
    }
    @keyframes pf-auth-blob {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50%      { transform: translate(40px, 60px) scale(1.05); }
    }

    /* ── Stack ─────────────────────────────────────────────────────── */
    .pf-auth__stack {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 420px;
      display: flex;
      flex-direction: column;
      gap: 22px;
    }

    /* ── Brand row ─────────────────────────────────────────────────── */
    .pf-auth__brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .pf-auth__brand-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .pf-auth__wordmark {
      margin: 0;
      font-family: 'Noto Sans', 'Inter', system-ui, sans-serif;
      font-weight: 700;
      font-size: 20px;
      letter-spacing: -0.02em;
      color: var(--text-primary, #f1f5f9);
      line-height: 1.1;
    }
    .pf-auth__tagline {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--text-tertiary, rgba(148, 163, 184, 0.7));
    }

    /* ── Form card ─────────────────────────────────────────────────── */
    .pf-auth__form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 22px 20px 20px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
        rgba(10, 10, 22, 0.7);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
      border-radius: 22px;
      backdrop-filter: blur(24px) saturate(150%);
      -webkit-backdrop-filter: blur(24px) saturate(150%);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
      transition: opacity 0.2s;
    }
    .pf-auth__form--busy { opacity: 0.7; pointer-events: none; }

    .pf-auth__title {
      margin: 0 0 4px;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary, #f8fafc);
    }

    /* ── Field ─────────────────────────────────────────────────────── */
    .pf-auth__field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pf-auth__field-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-muted, rgba(148, 163, 184, 0.6));
    }
    .pf-auth__field-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-right: 6px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      border-radius: 12px;
      transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
    }
    .pf-auth__field-row:focus-within {
      border-color: rgba(168, 85, 247, 0.6);
      background: rgba(255,255,255,0.06);
      box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.14);
    }
    .pf-auth__field-input {
      flex: 1;
      min-width: 0;
      height: 48px;
      padding: 0 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      border-radius: 12px;
      color: var(--text-primary, #f8fafc);
      /* 16px so iOS Safari doesn't zoom on focus. */
      font-size: 16px;
      font-weight: 500;
      outline: none;
      transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
    }
    .pf-auth__field-input::placeholder {
      color: var(--text-muted, rgba(148, 163, 184, 0.4));
      font-weight: 400;
    }
    .pf-auth__field-input:focus {
      border-color: rgba(168, 85, 247, 0.6);
      background: rgba(255,255,255,0.06);
      box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.14);
    }
    /* The password field row hosts the eye button alongside the input. */
    .pf-auth__field-row .pf-auth__field-input {
      border: 0;
      background: transparent;
      box-shadow: none;
    }
    .pf-auth__field-row .pf-auth__field-input:focus { box-shadow: none; }

    .pf-auth__eye {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      color: var(--text-muted, rgba(148, 163, 184, 0.6));
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .pf-auth__eye:active { background: rgba(255,255,255,0.08); color: #c4b5fd; }
    @media (hover: hover) {
      .pf-auth__eye:hover { background: rgba(255,255,255,0.06); color: #c4b5fd; }
    }

    /* ── Submit ────────────────────────────────────────────────────── */
    .pf-auth__submit {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      height: 50px;
      margin-top: 6px;
      border: 0;
      border-radius: 14px;
      background: linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #ec4899 100%);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.01em;
      cursor: pointer;
      box-shadow: 0 12px 28px rgba(124, 58, 237, 0.45);
      transition: filter 0.18s, transform 0.08s;
    }
    .pf-auth__submit:active:not(:disabled) { transform: scale(0.985); filter: brightness(1.04); }
    .pf-auth__submit:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Error pill ────────────────────────────────────────────────── */
    .pf-auth__error {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 0;
      padding: 10px 12px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.36);
      border-radius: 12px;
      color: #fca5a5;
      font-size: 13px;
      line-height: 1.4;
    }
    .pf-auth__error-icon {
      flex-shrink: 0;
      width: 20px; height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.25);
      color: #fef2f2;
      font-weight: 700;
      font-size: 12px;
    }
    .pf-auth__error-msg { flex: 1; min-width: 0; word-break: break-word; }

    /* ── Hint + env strip ──────────────────────────────────────────── */
    .pf-auth__hint {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--text-muted, rgba(148, 163, 184, 0.6));
      text-align: center;
    }
    .pf-auth__env {
      margin: 6px 0 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-muted, rgba(148, 163, 184, 0.5));
      opacity: 0.7;
    }
    .pf-auth__env-key {
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.06);
      letter-spacing: 0.08em;
    }
    .pf-auth__env-val { word-break: break-all; }

    /* ── Footer ────────────────────────────────────────────────────── */
    .pf-auth__foot {
      text-align: center;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted, rgba(148, 163, 184, 0.4));
    }

    /* ── Tablet / desktop refinement ───────────────────────────────── */
    @media (min-width: 768px) {
      .pf-auth { padding: 48px; }
      .pf-auth__stack { max-width: 440px; }
      .pf-auth__form { padding: 28px 26px 24px; }
      .pf-auth__title { font-size: 26px; }
      .pf-auth__wordmark { font-size: 22px; }
    }

    /* ── Reduced motion ────────────────────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      .pf-auth__blob { animation: none; }
    }

    /* ── Light theme ───────────────────────────────────────────────── */
    :host-context([data-theme="light"]) .pf-auth {
      background: #f5f7fb;
      color: #0f172a;
    }
    :host-context([data-theme="light"]) .pf-auth__blob { opacity: 0.32; filter: blur(110px); }
    :host-context([data-theme="light"]) .pf-auth__form {
      background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.8));
      border-color: rgba(15, 23, 42, 0.12);
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.14);
    }
    :host-context([data-theme="light"]) .pf-auth__title,
    :host-context([data-theme="light"]) .pf-auth__wordmark { color: #0f172a; }
    :host-context([data-theme="light"]) .pf-auth__tagline,
    :host-context([data-theme="light"]) .pf-auth__field-label,
    :host-context([data-theme="light"]) .pf-auth__hint,
    :host-context([data-theme="light"]) .pf-auth__env { color: #64748b; }
    :host-context([data-theme="light"]) .pf-auth__field-input {
      background: rgba(255,255,255,0.95);
      border-color: rgba(15, 23, 42, 0.12);
      color: #0f172a;
    }
    :host-context([data-theme="light"]) .pf-auth__field-input::placeholder { color: rgba(15, 23, 42, 0.36); }
    :host-context([data-theme="light"]) .pf-auth__field-row {
      background: rgba(255,255,255,0.95);
      border-color: rgba(15, 23, 42, 0.12);
    }
  `]
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly platform = inject(PlatformService);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  /** True when running inside Capacitor (iOS/Android), false on web. */
  protected readonly isNative = computed(() => this.platform.isCapacitor());

  /** Trimmed display of the configured API host — shown as a tiny
   *  diagnostic strip on native builds so connection issues are
   *  obvious from the login screen ("oh, it's pointed at production
   *  instead of LAN"). */
  protected readonly apiHost = computed(() => {
    try {
      return new URL(environment.apiUrl).host;
    } catch {
      return environment.apiUrl;
    }
  });

  protected canSubmit(): boolean {
    return this.email().trim().length > 3 && this.password().length >= 1;
  }

  private canVisit(url: string): boolean {
    if (url.startsWith('/admin') || url.startsWith('/setup')) {
      return this.auth.hasAnyPermission(ADMIN_PERMS);
    }
    return true;
  }

  async submit(ev?: Event) {
    // Prevent the form's default action so we don't get a duplicate
    // call (button click triggers submit AND form ngSubmit can fire).
    ev?.preventDefault?.();
    if (this.busy()) return;

    // Surface what we have RIGHT NOW so we know the handler fired
    // even if the network step hangs. Visible in Xcode's console
    // when running on simulator/device.
    console.info('[login] submit', {
      hasEmail: this.email().length > 0,
      hasPassword: this.password().length > 0,
      native: this.isNative(),
      api: environment.apiUrl
    });

    if (!this.canSubmit()) {
      this.error.set('Enter your email and password to continue.');
      return;
    }

    this.error.set(null);
    this.busy.set(true);
    try {
      await Promise.race([
        this.auth.signIn(this.email().trim(), this.password()),
        new Promise<never>((_, rej) => setTimeout(
          () => rej(new Error('Sign-in timed out — check your connection')),
          15_000
        ))
      ]);

      // Route by permission — first match wins. Honor returnUrl only if the
      // user can actually enter it; otherwise fall through to ROLE_LANDINGS.
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
      this.error.set(this.humaniseError(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Map raw errors to readable messages — especially CORS/network failures
   *  on Capacitor, which by default just say "Failed to fetch" and stump
   *  everyone. */
  private humaniseError(e: any): string {
    const msg = (e?.message ?? String(e)) as string;
    // Capacitor WKWebView fetch failures
    if (msg.includes('Failed to fetch') || msg.includes('Load failed') || msg.includes('Network request failed')) {
      if (this.isNative()) {
        return `Can't reach the backend (${this.apiHost()}). Either the server is unreachable from this device, or its CORS allowlist is missing capacitor://localhost. Tap the api line below to check.`;
      }
      return `Can't reach the backend (${this.apiHost()}). Check your connection or the API URL.`;
    }
    // Supabase password errors land with a 400/401 status
    if (msg.includes('Invalid login credentials') || msg.includes('400')) {
      return 'Wrong email or password. Try again.';
    }
    if (msg.includes('401')) {
      return 'Session expired. Try again.';
    }
    return msg || 'Sign-in failed';
  }
}
