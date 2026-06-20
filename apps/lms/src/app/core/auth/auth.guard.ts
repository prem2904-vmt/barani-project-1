import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitForAuth();
  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  // Forced-password-change gate: an authenticated user who still owes a
  // password change (first login / after an admin reset) is held on
  // /set-password until they set one. Block every in-shell route.
  if (auth.mustChangePassword()) {
    return router.createUrlTree(['/set-password']);
  }
  return true;
};
