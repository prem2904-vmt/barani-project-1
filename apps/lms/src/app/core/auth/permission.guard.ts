import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Route guard that admits the user iff they hold any of the given permission
 * codes. With `{ effective: true }` it routes through `hasEffectivePermission`
 * instead, which applies branch-lab-config suppression (e.g. Receptionist
 * loses collect_sample in dedicated-counter mode without a DB change).
 */
export const permissionGuard = (
  required: string | string[],
  opts?: { effective?: boolean }
): CanActivateFn => async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitForAuth();
  const codes = Array.isArray(required) ? required : [required];
  const ok = opts?.effective
    ? auth.hasAnyEffectivePermission(codes)
    : auth.hasAnyPermission(codes);
  if (ok) return true;
  return router.createUrlTree(['/403']);
};
