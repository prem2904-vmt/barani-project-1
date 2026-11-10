import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { CasesheetGateService } from '../shared/casesheet-gate.service';

/**
 * Who may use the public case-sheet site (plan §4.2 / §4.4) — the ONE rule the public guards and pages read.
 *
 *  - `signed-out`  — no session: the sign-in page.
 *  - `allowed`     — a personal space, or a lab user whose lab has case sheets (the case-sheet gate is open:
 *                    CasesheetGateService.visible — dev && (ipd explicitly on || personal || console flag)).
 *  - `unavailable` — signed in, but case sheets aren't open for this account (or it still owes a password change,
 *                    which only the LMS can take): the plain "not available" screen with Sign out.
 */
export type PublicAccess = 'signed-out' | 'allowed' | 'unavailable';

export function publicAccess(i: { signedIn: boolean; mustChangePassword: boolean; gateOpen: boolean }): PublicAccess {
  if (!i.signedIn) return 'signed-out';
  if (i.mustChangePassword || !i.gateOpen) return 'unavailable';
  return 'allowed';
}

/** Resolve {@link publicAccess} for the current session (waits for the restored session + the gate's inputs). */
export async function resolvePublicAccess(auth: AuthService, gate: CasesheetGateService): Promise<PublicAccess> {
  await auth.waitForAuth();
  if (!auth.isAuthenticated()) return 'signed-out';
  await gate.ready();
  return publicAccess({ signedIn: auth.isAuthenticated(), mustChangePassword: auth.mustChangePassword(), gateOpen: gate.visible() });
}

/**
 * The public shell's guard: only an `allowed` session gets Departments / Cases / Settings. Everything else goes to
 * /sign-in (which shows the sign-in button, or — signed in but not allowed — "Case sheets aren't available").
 */
export const casesheetsSignedInGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const gate = inject(CasesheetGateService);
  const router = inject(Router);
  const access = await resolvePublicAccess(auth, gate);
  if (access === 'allowed') return true;
  const next = state.url && state.url !== '/' ? { next: state.url } : undefined;
  return router.createUrlTree(['/sign-in'], access === 'signed-out' && next ? { queryParams: next } : {});
};
/** Marker the route specs read. */
(casesheetsSignedInGuard as unknown as { casesheetsPublicGuard: true }).casesheetsPublicGuard = true;

/** The sign-in page's guard: an `allowed` session has nothing to do there → Departments. */
export const casesheetsSignInGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const gate = inject(CasesheetGateService);
  const router = inject(Router);
  return (await resolvePublicAccess(auth, gate)) === 'allowed' ? router.createUrlTree(['/']) : true;
};
