import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Route guard that admits the user iff they hold any of the given permission
 * codes. With `{ effective: true }` it routes through `hasEffectivePermission`
 * instead, which applies branch-lab-config suppression (e.g. Receptionist
 * loses collect_sample in dedicated-counter mode without a DB change).
 */
export type PermissionGuardFn = CanActivateFn & { readonly requiredPerms: readonly string[]; readonly effective: boolean };

export const permissionGuard = (
  required: string | string[],
  opts?: { effective?: boolean }
): PermissionGuardFn => {
  const codes = Array.isArray(required) ? [...required] : [required];
  const guard: CanActivateFn = async () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.waitForAuth();
    const ok = opts?.effective
      ? auth.hasAnyEffectivePermission(codes)
      : auth.hasAnyPermission(codes);
    if (ok) return true;
    return router.createUrlTree(['/403']);
  };
  // Introspectable (read by the RBAC matrix spec to prove nav == guard).
  return Object.assign(guard, { requiredPerms: codes, effective: !!opts?.effective });
};
