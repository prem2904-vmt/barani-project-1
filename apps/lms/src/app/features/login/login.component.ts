import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { LogoMarkComponent } from '../../shared/primitives/logo-mark.component';

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
  imports: [FormsModule, LogoMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-login">
      <!-- Animated mesh background. Three slow-drifting gradient blobs in
           the brand violet / teal / pink, sitting behind everything. -->
      <div class="pf-login__mesh" aria-hidden="true">
        <span class="pf-login__blob pf-login__blob--1"></span>
        <span class="pf-login__blob pf-login__blob--2"></span>
        <span class="pf-login__blob pf-login__blob--3"></span>
        <span class="pf-login__grid"></span>
      </div>

      <div class="pf-login__shell">

        <!-- Hero panel — brand identity + a single voice line. -->
        <aside class="pf-login__hero">
          <div class="pf-login__brand">
            <!-- 'glyph' variant — gradient on the PF mark itself, no pill
                 background. Pulse stays on for the heartbeat ring. -->
            <pf-logo-mark size="xl" variant="glyph" [pulse]="true" ariaLabel="Prefrontal"></pf-logo-mark>
            <p class="pf-login__wordmark">Prefrontal</p>
          </div>

          <h1 class="pf-login__headline">
            <span>Lab software</span>
            <span class="pf-login__headline-accent">that thinks ahead.</span>
          </h1>

          <p class="pf-login__sub">
            Patient-to-report on one screen. GST-clean billing, NABL-ready reports,
            TAT you can see before it slips.
          </p>

          <ul class="pf-login__bullets">
            <li><span class="pf-login__dot"></span>Multi-branch · sub-branch routing</li>
            <li><span class="pf-login__dot"></span>ABHA-aware patient registration</li>
            <li><span class="pf-login__dot"></span>Live TAT, dispatch, and validation queues</li>
          </ul>

          <p class="pf-login__foot">
            <span class="pf-login__build">Build · v0.1.0</span>
            <span class="pf-login__sep">·</span>
            <span>For lab teams in India</span>
          </p>
        </aside>

        <!-- Sign-in card. -->
        <form class="pf-login__form" (ngSubmit)="submit()" novalidate>
          <header class="pf-login__form-head">
            <p class="pf-login__form-eyebrow">Welcome back</p>
            <h2 class="pf-login__form-title">Sign in to continue</h2>
            <p class="pf-login__form-sub">Use the credentials your admin shared.</p>
          </header>

          <label class="pf-field" [class.pf-field--has-value]="!!email()">
            <span class="pf-field__label">Email</span>
            <span class="pf-field__row">
              <svg class="pf-field__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2.5"/>
                <path d="m3 7 9 7 9-7"/>
              </svg>
              <input class="pf-field__input"
                     type="email" autocomplete="email" required
                     [ngModel]="email()" (ngModelChange)="email.set($event)" name="email"
                     placeholder="you@lab.example" />
            </span>
          </label>

          <label class="pf-field" [class.pf-field--has-value]="!!password()">
            <span class="pf-field__label">Password</span>
            <span class="pf-field__row">
              <svg class="pf-field__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2.5"/>
                <path d="M8 11V8a4 4 0 1 1 8 0v3"/>
              </svg>
              <input class="pf-field__input"
                     [type]="showPassword() ? 'text' : 'password'"
                     autocomplete="current-password" required
                     [ngModel]="password()" (ngModelChange)="password.set($event)" name="password"
                     placeholder="••••••••" />
              <button type="button" class="pf-field__toggle press"
                      (click)="showPassword.set(!showPassword())"
                      [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'">
                @if (showPassword()) {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 3l18 18M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6"/>
                    <path d="M9.9 5.1A11 11 0 0 1 12 5c5 0 9 4 10 7a13 13 0 0 1-2.4 3.4M6.4 6.4A13 13 0 0 0 2 12c1 3 5 7 10 7a11 11 0 0 0 4-.7"/>
                  </svg>
                } @else {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                }
              </button>
            </span>
          </label>

          @if (error()) {
            <p class="pf-login__error" role="alert">
              <span aria-hidden="true">⚠</span> {{ error() }}
            </p>
          }

          <button type="submit"
                  class="pf-login__submit press"
                  [disabled]="busy() || !email() || !password()">
            <span class="pf-login__submit-shine" aria-hidden="true"></span>
            @if (busy()) {
              <svg class="pf-login__spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-6.2-8.55" opacity="0.85"/>
              </svg>
              Signing you in…
            } @else {
              <span>Sign in</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6"/>
              </svg>
            }
          </button>

          <p class="pf-login__hint">
            Locked out? Ask your lab admin to reset your password from
            <span class="pf-login__hint-em">Users &amp; Access</span>.
          </p>
        </form>

      </div>
    </section>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; min-height: 100dvh; }

    /* ── Page shell ─────────────────────────────────────────── */
    .pf-login {
      position: relative;
      min-height: 100vh; min-height: 100dvh;
      display: flex;
      align-items: stretch;
      overflow: hidden;
      background: var(--bg-primary, #070b14);
      color: var(--text-primary, #e5e7eb);
    }

    /* ── Animated mesh background ───────────────────────────── */
    .pf-login__mesh { position: absolute; inset: 0; pointer-events: none; }
    .pf-login__blob {
      position: absolute;
      border-radius: 9999px;
      filter: blur(96px);
      opacity: 0.55;
      will-change: transform;
    }
    .pf-login__blob--1 {
      width: 540px; height: 540px;
      left: -120px; top: -180px;
      background: radial-gradient(circle, #7c3aed 0%, transparent 70%);
      animation: pf-blob-drift-1 22s ease-in-out infinite;
    }
    .pf-login__blob--2 {
      width: 480px; height: 480px;
      right: -100px; bottom: -160px;
      background: radial-gradient(circle, #14b8a6 0%, transparent 70%);
      animation: pf-blob-drift-2 26s ease-in-out infinite;
    }
    .pf-login__blob--3 {
      width: 420px; height: 420px;
      right: 10%; top: 20%;
      background: radial-gradient(circle, #ec4899 0%, transparent 70%);
      opacity: 0.32;
      animation: pf-blob-drift-3 30s ease-in-out infinite;
    }
    @keyframes pf-blob-drift-1 {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50%      { transform: translate(60px, 80px) scale(1.08); }
    }
    @keyframes pf-blob-drift-2 {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50%      { transform: translate(-80px, -40px) scale(1.06); }
    }
    @keyframes pf-blob-drift-3 {
      0%, 100% { transform: translate(0, 0) scale(0.95); }
      50%      { transform: translate(40px, -60px) scale(1.05); }
    }

    /* Faint hex-grid texture so the mesh has a "lab notebook" feel
       without competing with the gradients. */
    .pf-login__grid {
      position: absolute; inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
      background-size: 56px 56px;
      mask-image: radial-gradient(ellipse 70% 60% at 50% 50%, #000 0%, transparent 80%);
      -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 50%, #000 0%, transparent 80%);
      opacity: 0.7;
    }

    /* ── Two-pane shell ─────────────────────────────────────── */
    .pf-login__shell {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 28px;
      align-items: center;
    }
    @media (min-width: 960px) {
      .pf-login__shell {
        grid-template-columns: 1.05fr 0.95fr;
        gap: 56px;
        padding: 48px;
      }
    }

    /* ── Hero panel ─────────────────────────────────────────── */
    .pf-login__hero {
      display: flex;
      flex-direction: column;
      gap: 22px;
      max-width: 540px;
    }
    .pf-login__brand { display: flex; align-items: center; gap: 14px; }
    .pf-login__wordmark {
      margin: 0;
      font-family: 'Noto Sans', 'Inter', system-ui, sans-serif;
      font-weight: 700;
      font-size: 26px;
      letter-spacing: -0.02em;
      color: var(--text-primary, #f1f5f9);
    }
    .pf-login__headline {
      margin: 0;
      font-size: clamp(28px, 5vw, 46px);
      font-weight: 700;
      line-height: 1.05;
      letter-spacing: -0.025em;
      color: var(--text-primary, #f1f5f9);
      display: flex; flex-direction: column; gap: 4px;
    }
    .pf-login__headline-accent {
      background: linear-gradient(120deg, #c4b5fd 0%, #5eead4 50%, #f9a8d4 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .pf-login__sub {
      margin: 0;
      font-size: 15px;
      line-height: 1.6;
      color: var(--text-tertiary, rgba(148, 163, 184, 0.85));
      max-width: 460px;
    }
    .pf-login__bullets {
      list-style: none;
      margin: 4px 0 0; padding: 0;
      display: grid; gap: 10px;
    }
    .pf-login__bullets li {
      display: flex; align-items: center; gap: 10px;
      font-size: 13.5px;
      color: var(--text-secondary, #cbd5e1);
    }
    .pf-login__dot {
      width: 6px; height: 6px;
      border-radius: 9999px;
      background: linear-gradient(135deg, #a855f7, #ec4899);
      box-shadow: 0 0 12px rgba(168, 85, 247, 0.55);
      flex-shrink: 0;
    }
    .pf-login__foot {
      margin: 28px 0 0;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--text-muted, rgba(148, 163, 184, 0.55));
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    }
    .pf-login__build {
      padding: 4px 8px;
      border-radius: 6px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
    }
    .pf-login__sep { opacity: 0.4; }

    /* ── Sign-in card ───────────────────────────────────────── */
    .pf-login__form {
      width: 100%;
      max-width: 440px;
      justify-self: center;
      padding: 36px 32px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)),
        rgba(10, 10, 21, 0.62);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
      border-radius: 24px;
      backdrop-filter: blur(28px) saturate(140%);
      -webkit-backdrop-filter: blur(28px) saturate(140%);
      box-shadow:
        0 32px 80px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(255, 255, 255, 0.03) inset;
      display: flex; flex-direction: column; gap: 18px;
    }
    @media (min-width: 960px) {
      .pf-login__form { justify-self: end; }
    }

    .pf-login__form-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
    .pf-login__form-eyebrow {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-muted, rgba(148, 163, 184, 0.55));
    }
    .pf-login__form-title {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary, #f8fafc);
    }
    .pf-login__form-sub {
      margin: 0;
      font-size: 13px;
      color: var(--text-tertiary, rgba(148, 163, 184, 0.8));
    }

    /* ── Field ──────────────────────────────────────────────── */
    .pf-field { display: flex; flex-direction: column; gap: 6px; }
    .pf-field__label {
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted, rgba(148, 163, 184, 0.6));
      transition: color 0.18s ease;
    }
    .pf-field__row {
      display: flex; align-items: center;
      height: 48px;
      padding: 0 12px 0 14px;
      gap: 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      border-radius: 12px;
      transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
    }
    .pf-field__row:has(.pf-field__input:focus) {
      border-color: rgba(168, 85, 247, 0.55);
      background: rgba(255,255,255,0.06);
      box-shadow:
        0 0 0 4px rgba(168, 85, 247, 0.14),
        0 8px 24px rgba(124, 58, 237, 0.18);
    }
    .pf-field__icon {
      color: var(--text-muted, rgba(148, 163, 184, 0.55));
      flex-shrink: 0;
      transition: color 0.18s ease;
    }
    .pf-field__row:has(.pf-field__input:focus) .pf-field__icon { color: #c4b5fd; }
    .pf-field__row:has(.pf-field__input:focus) ~ * .pf-field__label,
    .pf-field:focus-within .pf-field__label { color: var(--text-secondary, #cbd5e1); }

    .pf-field__input {
      flex: 1; min-width: 0;
      background: transparent;
      border: 0;
      outline: none;
      color: var(--text-primary, #f8fafc);
      font-size: 14.5px;
      font-weight: 500;
    }
    .pf-field__input::placeholder { color: var(--text-muted, rgba(148, 163, 184, 0.4)); font-weight: 400; }

    .pf-field__toggle {
      all: unset;
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text-muted, rgba(148, 163, 184, 0.55));
      transition: background 0.15s ease, color 0.15s ease;
    }
    .pf-field__toggle:hover { background: rgba(255,255,255,0.06); color: var(--text-secondary, #cbd5e1); }
    .pf-field__toggle:focus-visible { outline: 2px solid rgba(168, 85, 247, 0.55); outline-offset: 1px; }

    /* ── Submit ─────────────────────────────────────────────── */
    .pf-login__submit {
      position: relative;
      overflow: hidden;
      height: 50px;
      border-radius: 14px;
      border: 0;
      cursor: pointer;
      color: #ffffff;
      font-size: 14.5px;
      font-weight: 600;
      letter-spacing: 0.01em;
      background: linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #ec4899 100%);
      box-shadow:
        0 12px 28px rgba(124, 58, 237, 0.45),
        0 0 0 1px rgba(255, 255, 255, 0.08) inset;
      display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      transition: transform 0.12s ease, box-shadow 0.18s ease, filter 0.2s ease;
      margin-top: 6px;
    }
    .pf-login__submit:hover:not(:disabled) {
      filter: brightness(1.06);
      box-shadow:
        0 18px 36px rgba(124, 58, 237, 0.55),
        0 0 0 1px rgba(255, 255, 255, 0.12) inset;
    }
    .pf-login__submit:active:not(:disabled) { transform: translateY(1px); }
    .pf-login__submit:disabled { opacity: 0.55; cursor: not-allowed; }
    .pf-login__submit-shine {
      position: absolute; inset: 0;
      background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%);
      transform: translateX(-110%);
      transition: transform 0.6s ease;
      pointer-events: none;
    }
    .pf-login__submit:hover:not(:disabled) .pf-login__submit-shine { transform: translateX(110%); }
    .pf-login__spin {
      animation: pf-spin 0.85s linear infinite;
      transform-origin: 50% 50%;
    }
    @keyframes pf-spin { to { transform: rotate(360deg); } }

    /* ── Error + hint ───────────────────────────────────────── */
    .pf-login__error {
      margin: 0;
      padding: 11px 14px;
      border-radius: 12px;
      background: rgba(239, 68, 68, 0.10);
      border: 1px solid rgba(239, 68, 68, 0.32);
      color: #fca5a5;
      font-size: 13px;
      display: flex; align-items: center; gap: 8px;
    }
    .pf-login__hint {
      margin: 6px 0 0;
      font-size: 12px;
      line-height: 1.55;
      color: var(--text-muted, rgba(148, 163, 184, 0.65));
      text-align: center;
    }
    .pf-login__hint-em {
      color: var(--text-secondary, #cbd5e1);
      font-weight: 500;
    }

    /* Press feedback for tap targets */
    .press { transition: transform 0.1s ease; }
    .press:active { transform: scale(0.97); }

    /* ── Reduced motion ─────────────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      .pf-login__blob { animation: none; }
      .pf-login__submit-shine { display: none; }
      .pf-login__spin { animation-duration: 1.5s; }
    }

    /* ── Light theme tuning ─────────────────────────────────── */
    :host-context([data-theme="light"]) .pf-login {
      background: #f5f7fb;
      color: #0f172a;
    }
    :host-context([data-theme="light"]) .pf-login__blob { opacity: 0.32; filter: blur(110px); }
    :host-context([data-theme="light"]) .pf-login__blob--3 { opacity: 0.22; }
    :host-context([data-theme="light"]) .pf-login__grid {
      background-image:
        linear-gradient(rgba(15, 23, 42, 0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(15, 23, 42, 0.04) 1px, transparent 1px);
    }
    :host-context([data-theme="light"]) .pf-login__form {
      background:
        linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.78));
      border-color: rgba(15, 23, 42, 0.10);
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.16);
    }
    :host-context([data-theme="light"]) .pf-login__form-eyebrow,
    :host-context([data-theme="light"]) .pf-login__hint,
    :host-context([data-theme="light"]) .pf-login__field-label,
    :host-context([data-theme="light"]) .pf-field__label { color: #64748b; }
    :host-context([data-theme="light"]) .pf-login__form-title,
    :host-context([data-theme="light"]) .pf-login__wordmark,
    :host-context([data-theme="light"]) .pf-login__headline { color: #0f172a; }
    :host-context([data-theme="light"]) .pf-login__sub,
    :host-context([data-theme="light"]) .pf-login__bullets li { color: #475569; }
    :host-context([data-theme="light"]) .pf-field__row {
      background: rgba(255,255,255,0.85);
      border-color: rgba(15, 23, 42, 0.10);
    }
    :host-context([data-theme="light"]) .pf-field__input { color: #0f172a; }
    :host-context([data-theme="light"]) .pf-field__input::placeholder { color: rgba(15, 23, 42, 0.35); }
  `]
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);

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
