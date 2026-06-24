import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { LogoMarkComponent } from '../../shared/primitives/logo-mark.component';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';

/**
 * Forced-password-change gate. Reached when a user signs in with a temporary
 * password (first login or after an admin reset) — auth.guard holds every
 * in-shell route here until `mustChangePassword` clears.
 *
 * Client-side policy mirrors the server (NIST 800-63B): length 8–64, no
 * composition rules. The server independently re-checks length AND screens the
 * password against the Pwned k-anonymity list, so the breach check is
 * authoritative there; here we only do cheap length + match validation for
 * instant feedback.
 */
@Component({
  selector: 'pf-set-password',
  standalone: true,
  imports: [FormsModule, LogoMarkComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './set-password.component.html',
  styleUrls: ['../login/login.component.scss', './set-password.component.scss'],
})
export class SetPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly pw = signal('');
  protected readonly confirm = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  /** Live, non-blocking strength/validity hints shown under the field. */
  protected readonly tooShort = computed(() => this.pw().length > 0 && this.pw().length < 8);
  protected readonly mismatch = computed(() => this.confirm().length > 0 && this.confirm() !== this.pw());

  protected canSubmit(): boolean {
    const p = this.pw();
    return p.length >= 8 && p.length <= 64 && p === this.confirm();
  }

  async submit(ev?: Event) {
    ev?.preventDefault?.();
    if (this.busy()) return;

    if (this.pw().length < 8 || this.pw().length > 64) {
      this.error.set('Password must be 8–64 characters.');
      return;
    }
    if (this.pw() !== this.confirm()) {
      this.error.set('The two passwords don’t match.');
      return;
    }

    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.changePassword(this.pw());
      // Gate cleared — land on the app root and let the landing guard route
      // by permission.
      await this.router.navigateByUrl('/');
    } catch (e: any) {
      this.error.set(e?.message || 'Could not update your password. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
