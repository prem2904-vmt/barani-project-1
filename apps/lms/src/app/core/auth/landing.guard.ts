import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { ProcessWorkflowService } from '../services/process-workflow.service';
import { TenantEntitlementsService } from '../services/tenant-entitlements.service';
import { OpdGateService } from '../../features/opd/shared/opd-gate.service';
import { ADMIN_PERMS, LAB_SETTINGS_HUB_PERMS, RouteAccess, RouteAccessCtx, canOpenRoute, canPassAccess } from './route-access';

// Picks a landing page so a logged-in user hitting '/' goes to a screen they can
// actually open, instead of bouncing off a guard. Ordered most-specific → most-
// generic; the FIRST route the user can open (same ROUTE_ACCESS table the guards
// and nav use — perms, parents, mode-aware collect_sample, workflow actions,
// module entitlements) wins. `perm` is kept as the historical "primary" permission for readers.
export const LANDINGS: Array<{ perm: string; path: string; /** What admits this row when it differs from the route's own gate. */ gate?: RouteAccess; /** Also require the route's own gate (module + perms) on top of `gate`. */ andRoute?: boolean }> = [
  // Owner 2026-11-19: the ADMIN home is Insights › Overview › This month (/insights defaults to
  // section=overview & period=month). Admin perms AND Insights' own gate (reports module + analytics perms);
  // a tenant without Insights falls through to the old /admin row below.
  { perm: 'manage_tests', path: '/insights', gate: { perms: ADMIN_PERMS }, andRoute: true },
  // Settings now admits every settings role (SETTINGS_ENTRY_PERMS), but landing there stays what it was: the admin
  // perms first, a Test-Master / lab-settings-only role last — each row keeps its own old gate.
  { perm: 'manage_tests', path: '/admin', gate: { perms: ADMIN_PERMS } },
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
  // A Test-Master / lab-settings-only role (no bench work) lands on Settings
  // rather than /403.
  { perm: 'manage_test_master', path: '/admin', gate: { perms: LAB_SETTINGS_HUB_PERMS, module: 'lab' } },
  // Last resort: someone whose only job here is entering expenses (or the
  // cashier / accountant) lands on Expenses rather than /403.
  { perm: 'expense_modifier', path: '/expenses' },
];

/** Landing context, plus the OPD dark-build doctor rule: when set, a user who
 *  would otherwise fall through every LANDINGS row lands on their OPD queue
 *  instead of /403. Only doctors with NO other landing take this path — a
 *  user who is a doctor AND holds a lab permission (e.g. an admin who is also
 *  a doctor) matches a LANDINGS row first and never reaches this rule, so
 *  their landing is unchanged. `opdDoctor` false/undefined ⇒ identical to
 *  today (the '/403' fallback), so lab behaviour never changes. */
export interface LandingCtx extends RouteAccessCtx {
  /** True only when the OPD gate is open AND the user is a doctor. */
  opdDoctor?: boolean;
  /** True when, on top of `opdDoctor`, every role the user holds is an OPD role
   *  (`/me.modules` is exactly ['opd'] — e.g. the seeded "Doctor (OPD)" role).
   *  Such a doctor lands on their queue FIRST, even if the role also grants a
   *  read permission that opens a lab screen (reports, orders). A user with any
   *  lab-scoped role never gets this flag. */
  opdOnlyDoctor?: boolean;
}

/** First landing the user can open, else '/403' (or '/opd/consult' for an
 *  OPD doctor with no other landing — see `opdDoctor`). Pure — shared by the
 *  guard, the top strip's "home" and the RBAC matrix spec. */
export function pickLanding(ctx: LandingCtx): string {
  if (ctx.opdDoctor && ctx.opdOnlyDoctor) return '/opd/consult';
  for (const l of LANDINGS) {
    const ok = l.gate ? canPassAccess(l.gate, ctx) && (!l.andRoute || canOpenRoute(l.path, ctx)) : canOpenRoute(l.path, ctx);
    if (ok) return l.path;
  }
  return ctx.opdDoctor ? '/opd/consult' : '/403';
}

/** The user's roles are ALL OPD-scoped (`/me.modules` exactly ['opd']). */
export function isOpdOnly(modules: readonly string[] | null | undefined): boolean {
  return !!modules && modules.length > 0 && modules.every(m => m === 'opd');
}

export const landingGuard: CanActivateFn = async (): Promise<UrlTree | boolean> => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const process = inject(ProcessWorkflowService);
  const entitlements = inject(TenantEntitlementsService);
  const opdGate = inject(OpdGateService);
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
    opdDoctor: auth.isDoctor() && opdGate.visible(),
    opdOnlyDoctor: isOpdOnly(auth.user()?.modules),
  })]);
};
