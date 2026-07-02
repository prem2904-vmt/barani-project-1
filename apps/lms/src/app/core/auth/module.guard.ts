import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ModuleKey, TenantEntitlementsService } from '../services/tenant-entitlements.service';

/**
 * Route guard tied to the tenant's MODULE ENTITLEMENTS. Admits the route only
 * when the named product module is enabled for the tenant. Disabling a module
 * (in the control plane) therefore blocks its screens + deep links, not just
 * the nav item.
 *
 * Fail-open: a tenant with no module config (legacy / unconfigured) has every
 * module enabled, so this never locks out an already-live tenant. Only a module
 * explicitly turned OFF is blocked, and the user is sent back to the landing.
 * Do NOT apply to the core order → collect → result → per-order report flow.
 */
export const moduleGuard = (key: ModuleKey): CanActivateFn => async () => {
  const entitlements = inject(TenantEntitlementsService);
  const router = inject(Router);
  await entitlements.ensureLoaded();
  if (entitlements.moduleEnabled(key)) return true;
  return router.createUrlTree(['/']);
};
