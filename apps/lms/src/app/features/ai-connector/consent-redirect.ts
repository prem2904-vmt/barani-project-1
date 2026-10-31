import { Injectable, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { PlatformService } from '../../core/services/platform.service';

/**
 * /oauth/consent gate. Outside the shell (like /login): signed out → the
 * login screen, carrying the EXACT consent URL (authorization_id included)
 * as the return URL; a temporary password still owed → /set-password with
 * the same return URL, so the user lands back here after setting it.
 */
export const consentGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitForAuth();
  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  if (auth.mustChangePassword()) {
    return router.createUrlTree(['/set-password'], { queryParams: { returnUrl: state.url } });
  }
  return true;
};

/**
 * Leaves the app for the OAuth client's redirect URL (already checked by
 * `safeRedirectUrl`). Web / phone app: a normal navigation (Capacitor hands
 * an outside host to the system browser). Desktop app: never navigate the
 * main window away — `window.open` goes to the default browser through
 * main.js's setWindowOpenHandler. A class so specs can swap it.
 */
@Injectable({ providedIn: 'root' })
export class ConsentRedirector {
  private readonly platform = inject(PlatformService);

  go(url: string): void {
    if (this.platform.isElectron()) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    window.location.assign(url);
  }
}
