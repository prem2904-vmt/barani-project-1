import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { OpdGateService } from './opd-gate.service';

/**
 * Route guard for EVERY OPD route (OPD dark build). Not visible ⇒ the same
 * bounce an unknown URL gets (`**` → ''), so a deep link reveals nothing.
 */
export const opdGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const gate = inject(OpdGateService);
  const router = inject(Router);
  await auth.waitForAuth();
  return gate.visible() ? true : router.createUrlTree(['/']);
};
/** Marker the route specs read to prove a route is OPD-gated. */
(opdGuard as unknown as { opdGate: true }).opdGate = true;

/**
 * Legacy OPD URL → its new home, only when OPD is visible (else the unknown-URL
 * bounce). Query params (e.g. `patientId`) are carried over.
 */
export function opdRedirect(target: string): CanActivateFn {
  const fn: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
    const auth = inject(AuthService);
    const gate = inject(OpdGateService);
    const router = inject(Router);
    await auth.waitForAuth();
    if (!gate.visible()) return router.createUrlTree(['/']);
    const path = target.replace(/:(\w+)/g, (_, k: string) => route.paramMap.get(k) ?? '');
    return router.createUrlTree([path], { queryParams: route.queryParams });
  };
  (fn as unknown as { opdGate: true }).opdGate = true;
  return fn;
}

/**
 * `/admin/opd/pharmacy[?tab=drugs]` → Settings → Pharmacy (`/admin/pharmacy`, `/admin/pharmacy/drugs`), only when OPD
 * is visible (else the unknown-URL bounce). The Settings re-home moved the pharmacy settings + drug master out of OPD.
 */
export const opdPharmacyRedirect: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthService);
  const gate = inject(OpdGateService);
  const router = inject(Router);
  await auth.waitForAuth();
  if (!gate.visible()) return router.createUrlTree(['/']);
  return router.createUrlTree([route.queryParamMap.get('tab') === 'drugs' ? '/admin/pharmacy/drugs' : '/admin/pharmacy']);
};
(opdPharmacyRedirect as unknown as { opdGate: true }).opdGate = true;
