import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { ProcessWorkflowService } from '../services/process-workflow.service';
import { TenantEntitlementsService } from '../services/tenant-entitlements.service';
import { RouteAccessCtx, canOpenRoute } from './route-access';

// Picks a landing page so a logged-in user hitting '/' goes to a screen they can
// actually open, instead of bouncing off a guard. Ordered most-specific → most-
// generic; the FIRST route the user can open (same ROUTE_ACCESS table the guards
// and nav use — perms, parents, mode-aware collect_sample, workflow actions,
// module entitlements) wins. `perm` is kept as the historical "primary" permission for readers.
export const LANDINGS: Array<{ perm: string; path: string }> = [
  { perm: 'manage_tests', path: '/admin' },
  // /frontdesk admits FRONTDESK_PERMS, so this also lands the Billing Counter
  // (create_bill / collect_payment) — which used to match no landing and hit /403.
  { perm: 'register_patient', path: '/frontdesk' },
  { perm: 'enter_result', path: '/lab/my-work' },
  { perm: 'validate_result', path: '/pathologist' },
  { perm: 'collect_sample', path: '/sample-collection' },
  { perm: 'collect_sample', path: '/home-collections' },
  { perm: 'inventory_receive', path: '/stores' },
  { perm: 'view_tat_dashboard', path: '/dashboard' },
  { perm: 'deliver_report', path: '/reports' },
  { perm: 'view_audit_log', path: '/admin/audit' },
  { perm: 'manage_branches', path: '/admin/branches' },
];

/** First landing the user can open, else '/403'. Pure — shared by the guard,
 *  the top strip's "home" and the RBAC matrix spec. */
export function pickLanding(ctx: RouteAccessCtx): string {
  for (const l of LANDINGS) {
    if (canOpenRoute(l.path, ctx)) return l.path;
  }
  return '/403';
}

export const landingGuard: CanActivateFn = async (): Promise<UrlTree | boolean> => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const process = inject(ProcessWorkflowService);
  const entitlements = inject(TenantEntitlementsService);
  await auth.waitForAuth();
  await Promise.all([
    process.ensureLoaded().catch(() => undefined),
    entitlements.ensureLoaded().catch(() => undefined),
  ]);
  return router.createUrlTree([pickLanding({
    hasAny: p => auth.hasAnyPermission(p),
    hasAnyEffective: p => auth.hasAnyEffectivePermission(p),
    isEnabled: a => process.isEnabled(a),
    isSuper: auth.permissions().includes('*'),
    moduleEnabled: m => entitlements.moduleEnabled(m),
  })]);
};
