import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CasesheetGateService } from './casesheet-gate.service';

/**
 * Route guard for EVERY in-app case-sheet route (lab sheets + /admin/ipd MyPrefrontal). Gate closed ⇒ the same
 * bounce an unknown URL gets (`**` → ''), so a deep link reveals nothing. Runs BEFORE the permission guard, so a
 * closed gate never shows the 403 page either.
 */
export const casesheetGuard: CanActivateFn = async () => {
  const gate = inject(CasesheetGateService);
  const router = inject(Router);
  await gate.ready();
  return gate.visible() ? true : router.createUrlTree(['/']);
};
/** Marker the route specs read to prove a route is case-sheet-gated. */
(casesheetGuard as unknown as { casesheetGate: true }).casesheetGate = true;
