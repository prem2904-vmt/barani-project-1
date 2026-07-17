import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService } from '../../core/auth/accounts.service';
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
  { perm: 'inventory_receive',  path: '/stores' },
  { perm: 'inventory_issue',    path: '/stores' },
  { perm: 'inventory_count',    path: '/stores' },
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
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountsService);
  private readonly router = inject(Router);
  private readonly platform = inject(PlatformService);
  private readonly route = inject(ActivatedRoute);

  protected readonly org = signal(this.auth.rememberedOrgs()[0] ?? '');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);

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

  constructor() {
    // Credentials-email deep link (…/login?org=<slug>&username=<u>): pre-fill
    // org + username so the admin only enters the temp password, then the
    // mustChangePassword gate routes them to /set-password.
    const qp = this.route.snapshot.queryParamMap;
    const org = qp.get('org');
    const username = qp.get('username');
    if (org) this.org.set(org);
    if (username) this.username.set(username);

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
  }

  /** Previously-used organizations for the login dropdown. */
  protected readonly orgs = this.auth.rememberedOrgs;

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
    return this.org().trim().length >= 1 && this.username().trim().length >= 1 && this.password().length >= 1;
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
      hasOrg: this.org().length > 0,
      hasUsername: this.username().length > 0,
      hasPassword: this.password().length > 0,
      native: this.isNative(),
      api: environment.apiUrl
    });

    if (!this.canSubmit()) {
      this.error.set('Enter your organization, username and password to continue.');
      return;
    }

    this.error.set(null);
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
          15_000
        ))
      ]);

      // First login (or after an admin reset): force a password change.
      if (this.auth.mustChangePassword()) {
        await this.router.navigateByUrl('/set-password');
        return;
      }

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
      return 'Wrong organization, username or password. Try again.';
    }
    if (msg.includes('401')) {
      return 'Session expired. Try again.';
    }
    return msg || 'Sign-in failed';
  }
}
