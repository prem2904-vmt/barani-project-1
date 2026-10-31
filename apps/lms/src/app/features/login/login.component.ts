import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal,
  untracked, viewChild,
} from '@angular/core';
import { canOpenRoute } from '../../core/auth/route-access';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService } from '../../core/auth/accounts.service';
import { SessionService } from '../../core/auth/session.service';
import { LogoMarkComponent } from '../../shared/primitives/logo-mark.component';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';
import { AmbientBgComponent } from '../../shared/components/ambient-bg/ambient-bg.component';
import { PlatformService } from '../../core/services/platform.service';
import { KeyboardService } from '../../core/services/keyboard.service';
import { environment } from '../../../environments/environment';
import { PasskeyService } from '../../core/auth/passkey.service';
import { PasskeyIconComponent } from '../../shared/primitives/passkey-icon.component';
import { PasskeyOfferService, offerSeen, shouldOfferPasskey } from '../../core/auth/passkey-offer';
import { PasskeyError, passkeyErrorText } from '../../core/auth/passkey-webauthn';

// Post-login routing is owned by the landing guard ('/' → pickLanding), which
// reads the same ROUTE_ACCESS table as the route guards and the nav — so a role
// never lands on a screen that bounces it (Billing Counter used to hit /403).

/** Field order for Enter → next. */
export type LoginField = 'org' | 'username' | 'password';

/** The note shown above the form after the app ended a session. */
export function sessionNotice(reason: string | null): string | null {
  switch (reason) {
    case 'expired': return 'Your session expired. Please sign in again.';
    case 'suspended': return 'This organization’s access is currently suspended. Contact your administrator.';
    case 'elsewhere': return 'You were signed out in another window.';
    default: return null;
  }
}

/** A post-login return URL we may follow: in-app, absolute path, not a
 *  protocol-relative / external URL and not the auth screens themselves. */
export function safeReturnUrl(url: string | null): string | null {
  if (!url) return null;
  return SessionService.isReturnable(url) ? url : null;
}

/** /set-password, keeping a safe return URL for after the new password. */
export function setPasswordUrl(returnUrl: string | null): string {
  const safe = safeReturnUrl(returnUrl);
  return safe ? `/set-password?returnUrl=${encodeURIComponent(safe)}` : '/set-password';
}

@Component({
  selector: 'pf-login',
  standalone: true,
  imports: [FormsModule, LogoMarkComponent, LoadingLogoComponent, AmbientBgComponent, PasskeyIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  host: { '[class.lg-host--kb]': 'kb.visible()' },
})
export class LoginComponent implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountsService);
  private readonly router = inject(Router);
  private readonly platform = inject(PlatformService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly kb = inject(KeyboardService);
  private readonly passkeys = inject(PasskeyService);
  private readonly passkeyOffer = inject(PasskeyOfferService);

  protected readonly org = signal(this.auth.rememberedOrgs()[0] ?? '');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  /** Signed in, the app's first screen is on its way (lazy chunk + guards):
   *  the button stays busy until the navigation lands, so there is no dead
   *  "Sign in" button to press again in between (PF-PATTERN "Loading feedback"). */
  protected readonly entering = signal(false);
  /** The submit button's busy look: signing in OR entering the app. */
  protected readonly working = computed(() => this.busy() || this.entering() || this.passkeyBusy());
  protected readonly error = signal<string | null>(null);
  /** Which field the error is about (inline + aria-invalid); null = the form. */
  protected readonly errorField = signal<LoginField | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly notice = signal<string | null>(null);

  // ── Passkeys (WebAuthn, discoverable — no username needed) ──────────
  /** Beta flag on (dev only) + browser + host may use passkeys (hidden in the
   *  desktop / phone apps). Reactive: the beta answer can land after first paint. */
  private readonly passkeyOk = computed(() => this.passkeys.available());
  /** "Sign in with a passkey" shows (never while adding a profile on a shared machine). */
  protected readonly showPasskey = computed(() => this.passkeyOk() && !this.addMode());
  protected readonly passkeyBusy = signal(false);
  /** A calm, non-error note (the person cancelled the passkey prompt). */
  protected readonly passkeyNote = signal<string | null>(null);
  /** Autofill (conditional UI) is listening on the username field. */
  protected readonly passkeyAutofill = signal(false);
  private autofillAbort: AbortController | null = null;

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly orgInput = viewChild<ElementRef<HTMLInputElement>>('orgInput');
  private readonly userInput = viewChild<ElementRef<HTMLInputElement>>('userInput');
  private readonly passInput = viewChild<ElementRef<HTMLInputElement>>('passInput');
  private readonly submitBtn = viewChild<ElementRef<HTMLButtonElement>>('submitBtn');

  /**
   * "Add account" mode (…/login?add=1): a signed-in user is appending another
   * profile on this shared device. The tenant is LOCKED to the account that
   * launched it — every appended profile must belong to the same organization,
   * so the org field is pre-filled + read-only and the sign-in is tenant-guarded.
   */
  protected readonly addMode = signal(false);
  private readonly lockedTenantId = signal<string | null>(null);
  protected readonly lockedOrg = signal<string | null>(null);
  /** Org field is fixed when adding an account onto an existing tenant. */
  protected readonly orgLocked = computed(() => this.addMode() && !!this.lockedTenantId());

  /** Remembered organizations other than the one in the field — tap to use
   *  (a themed chip row; never a native datalist). */
  protected readonly otherOrgs = computed(() => {
    const cur = this.org().trim().toLowerCase();
    return this.auth.rememberedOrgs().filter(o => o.toLowerCase() !== cur).slice(0, 4);
  });

  /** True when running inside Capacitor (iOS/Android), false on web. */
  protected readonly isNative = computed(() => this.platform.isCapacitor());
  /** Touch host: never auto-focus (no surprise keyboard); dodge the keyboard. */
  private readonly touch = typeof window !== 'undefined'
    && (this.platform.isCapacitor() || (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches));
  private navigating = false;
  /** Where to go after signing in (captured on arrival; in-app paths only). */
  private readonly returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
  /** Split layout (brand panel + card): iPad landscape and desktop. */
  protected readonly wide = signal(false);

  constructor() {
    // Credentials-email deep link (…/login?org=<name>&username=<u>): pre-fill
    // org + username so the admin only enters the temp password, then the
    // mustChangePassword gate routes them to /set-password.
    const qp = this.route.snapshot.queryParamMap;
    const org = qp.get('org');
    const username = qp.get('username');
    if (org) this.org.set(org);
    if (username) this.username.set(username);
    this.notice.set(sessionNotice(qp.get('reason')));

    // Add-account: lock the organization to the currently-active profile's
    // tenant. Prefer the on-device registry (survives on the login screen);
    // fall back to the live user. No active account ⇒ behave as a normal login.
    if (qp.get('add') === '1') {
      const active = this.accounts.active();
      const tenantId = active?.tenantId ?? this.auth.user()?.tenantId ?? null;
      const orgName = active?.org ?? this.auth.user()?.tenantName ?? null;
      if (tenantId && orgName) {
        this.addMode.set(true);
        this.lockedTenantId.set(tenantId);
        this.lockedOrg.set(orgName);
        this.org.set(orgName);
      }
    }

    // A restored session whose profile arrived late (slow cold start): the
    // guard booted to this screen, but the person IS signed in — follow the
    // session in instead of asking for the password again.
    effect(() => {
      const authed = this.auth.isAuthenticated();
      untracked(() => {
        if (!authed || this.addMode() || this.busy() || this.passkeyBusy() || this.navigating) return;
        void this.enterApp();
      });
    });

    // Passkey autofill starts once the beta flag (dev only) says passkeys are on.
    effect(() => {
      if (this.showPasskey()) untracked(() => void this.startPasskeyAutofill());
    });

    this.wireKeyboardDodge();
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(min-width: 1024px)');
      this.wide.set(mq.matches);
      const onChange = (e: MediaQueryListEvent) => this.wide.set(e.matches);
      mq.addEventListener?.('change', onChange);
      this.destroyRef.onDestroy(() => mq.removeEventListener?.('change', onChange));
    }
  }

  ngAfterViewInit(): void {
    // Keyboard-first on web: focus the first empty field. Never on touch.
    if (this.touch) return;
    queueMicrotask(() => this.focusField(this.firstEmptyField()));
  }

  protected canSubmit(): boolean {
    return this.org().trim().length >= 1 && this.username().trim().length >= 1 && this.password().length >= 1;
  }

  private firstEmptyField(): LoginField {
    if (!this.orgLocked() && !this.org().trim()) return 'org';
    if (!this.username().trim()) return 'username';
    return 'password';
  }

  private inputFor(f: LoginField): HTMLInputElement | undefined {
    return (f === 'org' ? this.orgInput() : f === 'username' ? this.userInput() : this.passInput())?.nativeElement;
  }

  protected focusField(f: LoginField): void {
    const el = this.inputFor(f) ?? (f === 'org' ? this.userInput()?.nativeElement : undefined);
    el?.focus({ preventScroll: true });
    if (el) this.revealSoon(el);
  }

  /** Enter moves to the next field in reading order; Enter on the last
   *  field submits. The soft keyboard's key reads Next / Go to match. */
  protected onEnter(ev: Event, from: LoginField): void {
    const kev = ev as KeyboardEvent;
    if (kev.isComposing) return;
    ev.preventDefault();
    if (from === 'org') { this.focusField('username'); return; }
    if (from === 'username') { this.focusField('password'); return; }
    void this.submit();
  }

  protected useOrg(o: string): void {
    this.org.set(o);
    this.clearError();
    this.focusField(this.username().trim() ? 'password' : 'username');
  }

  protected clearError(): void {
    this.error.set(null);
    this.errorField.set(null);
    this.passkeyNote.set(null);
  }

  private canVisit(url: string): boolean {
    return canOpenRoute(url, {
      hasAny: p => this.auth.hasAnyPermission(p),
      hasAnyEffective: p => this.auth.hasAnyEffectivePermission(p),
      isSuper: this.auth.permissions().includes('*'),
    });
  }

  /** Leave the login screen for the app: forced password change first,
   *  then the return URL when the user may open it, else the landing. */
  private async enterApp(): Promise<void> {
    if (this.navigating) return;
    this.navigating = true;
    this.entering.set(true);
    let ok = false;
    try {
      if (this.auth.mustChangePassword()) {
        // Carry the return URL through the temporary-password step (an AI
        // connector consent link must land back on its exact URL).
        ok = await this.router.navigateByUrl(setPasswordUrl(this.returnUrl), { replaceUrl: true });
        return;
      }
      const returnUrl = this.returnUrl;
      if (returnUrl && this.canVisit(returnUrl)) {
        ok = await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
        return;
      }
      ok = await this.router.navigateByUrl('/', { replaceUrl: true });
    } finally {
      // One-shot once we have left: a late auth signal must not navigate again.
      if (!ok) { this.navigating = false; this.entering.set(false); }
    }
  }

  protected cancelAdd(): void {
    void this.router.navigateByUrl('/');
  }

  async submit(ev?: Event) {
    // Prevent the form's default action so we don't get a duplicate
    // call (button click triggers submit AND form ngSubmit can fire).
    ev?.preventDefault?.();
    if (this.busy() || this.entering()) return;

    console.info('[login] submit', {
      hasOrg: this.org().length > 0,
      hasUsername: this.username().length > 0,
      hasPassword: this.password().length > 0,
      native: this.isNative(),
      api: environment.apiUrl
    });

    if (!this.canSubmit()) {
      const f = this.firstEmptyField();
      this.error.set(f === 'org' ? 'Enter your organization name.'
        : f === 'username' ? 'Enter your username.' : 'Enter your password.');
      this.errorField.set(f);
      this.focusField(f);
      return;
    }

    this.clearError();
    this.notice.set(null);
    this.busy.set(true);
    try {
      await Promise.race([
        // In add-account mode the sign-in is tenant-locked: signIn rejects with
        // `tenant_mismatch` (before touching the current session) if the account
        // belongs to a different organization.
        this.auth.signIn(this.org().trim(), this.username().trim(), this.password(),
          this.orgLocked() ? this.lockedTenantId()! : undefined),
        new Promise<never>((_, rej) => setTimeout(
          () => rej(new Error('Sign-in timed out — check your connection')),
          20_000
        ))
      ]);
      this.busy.set(false);
      this.notePasswordSignIn();
      await this.enterApp();
    } catch (e: unknown) {
      const msg = this.humaniseError(e);
      this.error.set(msg);
      this.errorField.set(null);
      // Wrong credentials: keep org + username, clear and refocus the
      // password. A network error keeps everything — just try again.
      if (/(wrong|invalid) organization/i.test(msg)) {
        this.password.set('');
        if (!this.touch) this.focusField('password');
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** "Sign in with a passkey": the browser's own passkey dialog (this
   *  device, a security key, or "use a phone" cross-device). */
  async signInWithPasskey(): Promise<void> {
    if (this.working() || !this.showPasskey()) return;
    this.stopPasskeyAutofill();
    this.clearError();
    this.notice.set(null);
    await this.runPasskeySignIn({});
    // Cancelled / failed: listen in the username field again.
    if (!this.navigating) void this.startPasskeyAutofill();
  }

  /** One passkey sign-in, modal or autofill. Same downstream as the password
   *  path: AuthService's session tail, then enterApp (gate → returnUrl → landing). */
  private async runPasskeySignIn(o: { mediation?: 'conditional'; signal?: AbortSignal }): Promise<'ok' | 'aborted' | PasskeyError['kind'] | 'error'> {
    const autofill = o.mediation === 'conditional';
    if (!autofill) this.passkeyBusy.set(true);
    try {
      const tokens = await this.passkeys.authenticate({ ...o, onPicked: () => this.passkeyBusy.set(true) });
      this.passkeyBusy.set(true);
      await this.auth.signInWithPasskeySession(tokens);
      this.passkeyOffer.clear();
      this.passkeyBusy.set(false);
      await this.enterApp();
      return 'ok';
    } catch (e: unknown) {
      if (o.signal?.aborted) return 'aborted';   // we stopped it (modal button / leaving)
      this.errorField.set(null);
      // Autofill runs in the background: before the person picked a passkey
      // its failures stay silent (the password form is right there). Once they
      // picked one (we got as far as the session), the error is shown.
      const picked = this.passkeyBusy();
      if (e instanceof PasskeyError) {
        if (e.kind === 'cancelled') {
          if (!autofill) this.passkeyNote.set(passkeyErrorText('cancelled'));
        } else if (!autofill || (picked && e.kind !== 'expired')) {
          this.error.set(e.message);
        }
        return e.kind;
      }
      if (!autofill || picked) this.error.set(this.humaniseError(e));
      return 'error';
    } finally {
      this.passkeyBusy.set(false);
    }
  }

  /** WebAuthn conditional UI: passkeys appear in the username field's
   *  autofill. Restarts after an expired challenge (5 min server window). */
  private autofillRestarts = 0;
  private async startPasskeyAutofill(): Promise<void> {
    if (!this.showPasskey() || this.autofillAbort || this.navigating) return;
    if (!(await this.passkeys.conditionalAvailable())) return;
    if (this.autofillAbort || this.navigating) return;
    const ctrl = new AbortController();
    this.autofillAbort = ctrl;
    this.passkeyAutofill.set(true);
    this.destroyRef.onDestroy(() => ctrl.abort());
    let outcome: Awaited<ReturnType<LoginComponent['runPasskeySignIn']>>;
    try {
      outcome = await this.runPasskeySignIn({ mediation: 'conditional', signal: ctrl.signal });
    } finally {
      if (this.autofillAbort === ctrl) this.autofillAbort = null;
    }
    // Only an expired challenge re-arms the autofill on its own (a few times) —
    // never a loop on a browser that rejects at once.
    if (outcome === 'expired' && !this.navigating && this.autofillRestarts++ < 3) void this.startPasskeyAutofill();
  }

  private stopPasskeyAutofill(): void {
    this.autofillAbort?.abort();
    this.autofillAbort = null;
  }

  /** After a PASSWORD sign-in: maybe suggest a passkey once (shared-PC rule,
   *  passkey-offer.ts). Never in Electron / phone apps / Add-account. */
  private notePasswordSignIn(): void {
    this.stopPasskeyAutofill();
    const userId = this.auth.user()?.id;
    if (!userId) return;
    const ok = shouldOfferPasskey({
      available: this.passkeyOk(),
      isElectron: this.platform.isElectron(),
      isCapacitor: this.platform.isCapacitor(),
      signedInWith: 'password',
      addMode: this.addMode(),
      accountsOnDevice: this.accounts.accounts?.().length ?? 0,
      seen: offerSeen(userId),
    });
    if (ok) this.passkeyOffer.offer(userId);
  }

  /** Map raw errors to readable messages — especially CORS/network failures
   *  on Capacitor, which by default just say "Failed to fetch" and stump
   *  everyone. */
  private humaniseError(e: unknown): string {
    const msg = ((e as { message?: string })?.message ?? String(e)) as string;
    // Capacitor WKWebView fetch failures
    if (msg.includes('Failed to fetch') || msg.includes('Load failed') || msg.includes('Network request failed')) {
      // Deliberately no backend host/URL here — this is a professional
      // login screen, infrastructure details stay out of it. The full
      // error is still in the console for diagnosis.
      return `Can't reach the server. Check your internet connection and try again.`;
    }
    // Supabase password errors land with a 400/401 status
    if (msg.includes('Invalid login credentials') || msg.includes('400')) {
      return 'Wrong organization, username or password. Try again.';
    }
    if (msg.includes('401')) {
      return 'Session expired. Try again.';
    }
    return msg || 'Sign-in failed';
  }

  // ── Soft keyboard: keep the focused field above it ─────────────────
  // The old screen centred a fixed-height, overflow:hidden column: when the
  // keyboard came up (Capacitor resize:'native' shrinks the WebView; mobile
  // Safari overlays it) the 2nd / 3rd field sat under it and nothing could
  // scroll. Now the page is its own scroller whose content keeps the
  // pre-keyboard height (no re-centring jump), gains a bottom inset equal to
  // the keyboard overlap (--lg-kb, for browsers that overlay), and the
  // focused field is scrolled into the visible viewport.

  private revealTimers: ReturnType<typeof setTimeout>[] = [];

  private wireKeyboardDodge(): void {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const onViewport = () => {
      this.syncInsets();
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && this.scroller()?.nativeElement.contains(el)) this.reveal(el);
    };
    const onResize = () => this.syncInsets();
    vv?.addEventListener('resize', onViewport);
    vv?.addEventListener('scroll', onViewport);
    window.addEventListener('resize', onResize);
    this.destroyRef.onDestroy(() => {
      vv?.removeEventListener('resize', onViewport);
      vv?.removeEventListener('scroll', onViewport);
      window.removeEventListener('resize', onResize);
      for (const t of this.revealTimers) clearTimeout(t);
      // Convention: a view that owns an input resets the keyboard latches
      // on the way out, or the next screen's navbar can stay hidden.
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.scroller()?.nativeElement.contains(active)) active.blur();
      this.kb.reset();
    });
    queueMicrotask(() => this.syncInsets());
  }

  /** Keyboard overlap + the stable content height, as CSS variables. */
  private syncInsets(): void {
    const host = this.scroller()?.nativeElement;
    if (!host || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const focused = document.activeElement instanceof HTMLInputElement && host.contains(document.activeElement);
    const overlap = vv && focused ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    host.style.setProperty('--lg-kb', `${overlap > 80 ? overlap : 0}px`);
    // Freeze the content height while the keyboard is up, so a WebView that
    // shrinks under it doesn't re-centre the card (the "jump").
    if (!focused && !this.kb.visible()) host.style.setProperty('--lg-h', `${host.clientHeight}px`);
  }

  /** Reveal after the keyboard has animated in (iOS ~250ms, Android later). */
  protected revealSoon(el: HTMLElement): void {
    if (!this.touch) return;
    for (const t of this.revealTimers) clearTimeout(t);
    this.revealTimers = [60, 320, 650].map(ms => setTimeout(() => { this.syncInsets(); this.reveal(el); }, ms));
  }

  protected onFieldFocus(ev: FocusEvent): void {
    const el = ev.target as HTMLElement | null;
    if (el) this.revealSoon(el);
  }

  /** Scroll so the focused field's block (label + input; for the password,
   *  down to the Sign in button) sits inside the visible viewport. */
  private reveal(el: HTMLElement): void {
    const host = this.scroller()?.nativeElement;
    if (!host || !this.touch) return;
    const field = (el.closest('.lg-field') as HTMLElement | null) ?? el;
    const top = field.getBoundingClientRect().top;
    let bottom = field.getBoundingClientRect().bottom;
    const btn = this.submitBtn()?.nativeElement;
    if (el === this.passInput()?.nativeElement && btn) bottom = Math.max(bottom, btn.getBoundingClientRect().bottom);
    const vv = window.visualViewport;
    const visTop = (vv?.offsetTop ?? 0) + 12;
    const visBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 16;
    let delta = 0;
    if (bottom > visBottom) delta = bottom - visBottom;
    if (top - delta < visTop) delta = top - visTop;   // never push the label off the top
    if (Math.abs(delta) < 2) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    host.scrollTo({ top: host.scrollTop + delta, behavior: reduce ? 'auto' : 'smooth' });
  }
}
