/**
 * ROUTE ACCESS — the ONE mapping of "route → what it takes to open it".
 *
 * Every nav surface (top strip, bottom nav, More menu, workflow work areas, the
 * admin hubs, the landing redirect) and the route guards in app.routes.ts read
 * this table, so "I can see it" always equals "I can open it". Keep each entry in
 * line with the backend [RequirePermission] of the APIs the page loads on entry
 * (see scratchpad rbac-audit.md / the matrix spec): a nav entry the guard admits
 * but whose entry API 403s is the same bug one layer down.
 *
 * Semantics
 *  • `perms`    — OR: the user needs at least one code (empty/omitted = any
 *                 signed-in user). `*` (super-admin) passes everything.
 *  • `parent`   — a guarded PARENT route (Angular runs the parent's guard too),
 *                 so the effective requirement is parent AND child.
 *  • `effective`— the guard uses AuthService.hasAnyEffectivePermission (a
 *                 hook for mode-aware checks). No route uses it today: sample
 *                 collection is purely permission-based (owner 2026-09-27: "if
 *                 the receptionist is assigned [collect_sample], they can
 *                 collect") + the workflow's Collect/Frontdesk/Lab slots.
 *  • `workflow` — the route's workflowGuard(Any): open only while ANY of these
 *                 process-workflow actions is enabled (fail-open when silent).
 *
 *  • `module`   — the route's moduleGuard (tenant product entitlement).
 *
 * Pure data + pure helpers only (no Angular DI) so nav builders and specs can use
 * it without a TestBed.
 */
import type { ModuleKey } from '../services/tenant-entitlements.service';

export interface RouteAccess {
  perms?: string[];
  parent?: string;
  effective?: boolean;
  workflow?: string[];
  /** Product-module entitlement (moduleGuard): off ⇒ the route bounces. */
  module?: ModuleKey;
}

/** Perms that open the ADMIN CONFIG shell (overview, manage hub, modules, setup,
 *  KPIs). Deliberately EXCLUDES manage_branch(es): read-tier branch browsing held
 *  by Branch Managers, who must NOT reach tenant config. */
export const ADMIN_PERMS = ['manage_tests', 'manage_users', 'manage_workflows'];

/** Canonical permissions that grant the /frontdesk work area (landing +
 *  patient/order creation). Deliberately NOT `view_patient` (a read capability
 *  lab techs hold) or `collect_sample` (Collect has its own area/page). Billing
 *  (create_bill / collect_payment) is admitted because billing happens at the
 *  front desk (OPS-10). NOT manage_branch: a Branch Manager has no front-desk
 *  create actions, so the landing would only surface controls that 403. */
export const FRONTDESK_PERMS = ['register_patient', 'create_order', 'create_bill', 'collect_payment'];

/** Test Master editing. `manage_tests` is the full switch (the tenant admin) and
 *  IMPLIES both finer codes on the server (PermissionImplications.cs → /me);
 *  `manage_test_master` alone is the Lab Admin (Technical) grant — tests,
 *  profiles, packages, ranges, layouts, specimens, masters. Listed together so
 *  the guard reads right even against an older /me. */
export const TEST_MASTER_PERMS = ['manage_tests', 'manage_test_master'];
/** Changing prices / tax slab / "offered here" (the pricing table). */
export const TEST_PRICING_PERMS = ['manage_tests', 'manage_test_pricing'];

export const LAB_SETTINGS_HUB_PERMS = ['manage_tests', 'manage_test_master', 'manage_test_pricing', 'manage_lab_settings', 'manage_report_template', 'manage_notifications', 'manage_departments', 'manage_bridges'];
/** Prefrontal Bridges (bridge-api v1, D12): add / rename / remove / Wi-Fi /
 *  analyzer assignment. Granted to Lab Admin + Lab Admin (Technical). */
export const BRIDGE_PERMS = ['manage_bridges'];
// inventory_transfer included: the Stores entry APIs (/api/inventory/items, /alerts) accept it.
export const INVENTORY_WORK_PERMS = ['inventory_receive', 'inventory_issue', 'inventory_count', 'inventory_transfer', 'manage_inventory'];
export const FINANCE_PERMS = ['collect_payment', 'create_bill', 'manage_tenant'];
/** Expenses — a PRIMARY screen: expense_modifier = My expenses (own entries),
 *  expense_viewer = read-only oversight of everyone's, expense_admin = the
 *  cashier (everyone's + Day closing). The server enforces each action. */
export const EXPENSE_ROUTE_PERMS = ['expense_viewer', 'expense_modifier', 'expense_admin'];
/** Settings → Communication (WhatsApp / Email / SMS) — who may open and change it (the server enforces each PUT). */
/** Communication is shared by every department (Settings → All departments): the OPD / IPD / Pharmacy admins open it too (the server accepts the same codes). */
export const COMMS_SETTINGS_PERMS = ['manage_lab_settings', 'manage_notifications', 'manage_opd', 'manage_ipd', 'manage_pharmacy'];
/** Settings → Files: the tenant admin (the server's `manage_tenant`). */
export const FILES_SETTINGS_PERMS = ['manage_tenant'];
/** WhatsApp spend / credits (the billing card) — never manage_lab_settings alone. */
export const WA_BILLING_VIEW_PERMS = ['manage_tenant', 'manage_notifications'];
/** Payment rules on the branch lab config (payment gate, payments-due tab). */
export const PAYMENT_RULE_PERMS = ['manage_tenant', 'manage_billing_config'];

/** Analytics / Lab Insights (Phase 1, owner 2026-10-01). view_analytics opens
 *  the whole area (charts + non-PII operations lists); view_financial_analytics
 *  additionally reveals money (withheld server-side when absent — the UI mirrors
 *  it, it doesn't enforce it); export_patient_data additionally covers the
 *  Patients list (every column is PII) and exporting any list with patient
 *  name/phone/DOB. The route itself only needs view_analytics — the two money/
 *  PII tiers are checked per-surface inside the feature, same pattern as
 *  TEST_PRICING_PERMS gating a view inside Test Master rather than the route. */
export const ANALYTICS_PERMS = ['view_analytics'];
export const FINANCIAL_ANALYTICS_PERMS = ['view_financial_analytics'];
export const PATIENT_DATA_EXPORT_PERMS = ['export_patient_data'];

/** Case sheets (part of IPD; plan §2). The route ALSO carries casesheetGuard (the case-sheet gate: dev && explicit
 *  IPD / personal tenant / pf.casesheets()) BEFORE these permission guards — features/casesheets/casesheets.routes.ts.
 *  Not a `module` entry on purpose: IPD must be EXPLICITLY on and the gate also opens for a personal tenant, which
 *  moduleGuard ('no row ⇒ on' for live modules) cannot express. */
export const CASESHEET_FORMS_PERMS = ['casesheet_forms_manage'];
export const CASESHEET_READ_PERMS = ['casesheet_view', 'casesheet_fill'];
export const CASESHEET_FILL_PERMS = ['casesheet_fill'];

export const ROUTE_ACCESS: Record<string, RouteAccess> = {
  // ── Front desk (parent guard + per-child perms) ────────────────────────
  '/frontdesk':                  { perms: FRONTDESK_PERMS },
  '/frontdesk/order':            { parent: '/frontdesk', perms: ['create_order'], workflow: ['walk_in_order', 'appointment'] },
  '/frontdesk/appointments':     { parent: '/frontdesk', perms: ['register_patient', 'create_order', 'view_order'], workflow: ['appointment'] },
  '/frontdesk/appointments/new': { parent: '/frontdesk', perms: ['register_patient', 'create_order'], workflow: ['appointment'] },
  '/frontdesk/queue':            { parent: '/frontdesk', perms: ['register_patient', 'create_order', 'view_order', 'collect_sample'], workflow: ['queue'] },
  '/frontdesk/home-collection':  { parent: '/frontdesk', perms: ['manage_home_collection', 'register_patient', 'create_order'], workflow: ['home_visits'], module: 'homeCollection' },
  '/frontdesk/patients/new':     { parent: '/frontdesk', perms: ['register_patient'], workflow: ['patient_registration'] },
  '/frontdesk/post-payment':     { parent: '/frontdesk', perms: ['collect_payment', 'create_bill'] },

  // ── Collection ─────────────────────────────────────────────────────────
  '/sample-collection':  { perms: ['collect_sample'], workflow: ['sample_collection'] },
  '/lab/collect':        { perms: ['collect_sample'], workflow: ['sample_collection'] },
  '/home-collections':   { perms: ['collect_sample'], workflow: ['home_visits'], module: 'homeCollection' },

  // ── Lab ────────────────────────────────────────────────────────────────
  // My Work = result entry + the embedded Lab Intake tab. collect_sample is NOT
  // enough (the page's queues are enter_result/receive_sample APIs).
  '/lab/my-work':        { perms: ['enter_result', 'receive_sample'], workflow: ['result_entry'] },
  '/lab/receive':        { perms: ['receive_sample'], workflow: ['lab_intake'] },
  '/lost-and-found':     { perms: ['receive_sample', 'reject_sample', 'cancel_order', 'manage_users'], workflow: ['lost_and_found'] },
  '/pathologist':        { perms: ['validate_result'], workflow: ['validate'] },
  // The critical-result acknowledgement register (NABL): bench, validators and the audit reader.
  '/lab/critical-results': { perms: ['enter_result', 'validate_result', 'view_audit_log'], module: 'lab' },
  // Analyzer runs that matched no tube (+ QC runs): the bench attaches them — result-entry perms.
  '/lab/analyzer-results': { perms: ['enter_result', 'edit_result'], module: 'lab' },
  // Results. deliver_report = the delivery desk (Share / WhatsApp / Print as a
  // recorded delivery / Generate). view_report alone (Lab Tech, Branch
  // Manager, Quality Manager) opens the SAME branch-scoped list VIEW-ONLY:
  // View + Download + Print (a plain print — no delivery is recorded), no send
  // or (re)generate — the backend gates those on deliver_report|validate_result.
  '/reports':            { perms: ['deliver_report', 'view_report'], workflow: ['results'] },

  // ── Counters / other work areas ────────────────────────────────────────
  '/billing-counter':    { perms: ['create_bill', 'collect_payment'], workflow: ['billing'] },
  '/messages':           { workflow: ['messages'] },
  '/stores':             { perms: INVENTORY_WORK_PERMS, module: 'inventory' },
  '/dashboard':          { perms: ['view_tat_dashboard', 'view_dashboard'], module: 'reports' },
  '/insights':           { perms: ANALYTICS_PERMS, module: 'reports' },
  '/finance':            { perms: FINANCE_PERMS },
  '/finance/daily':      { perms: FINANCE_PERMS },
  // (/finance/expenses is a plain redirect to /expenses — no entry of its own.)
  '/expenses':           { perms: EXPENSE_ROUTE_PERMS },

  // ── Admin / settings ───────────────────────────────────────────────────
  '/admin':                   { perms: ADMIN_PERMS },
  '/admin/manage':            { perms: ADMIN_PERMS },
  '/admin/modules':           { perms: ADMIN_PERMS },
  '/admin/kpis':              { perms: ADMIN_PERMS },
  '/setup':                   { perms: ADMIN_PERMS },
  '/lab/settings':            { perms: LAB_SETTINGS_HUB_PERMS, module: 'lab' },
  '/admin/microbiology':      { perms: ['manage_lab_settings'], module: 'lab' },
  // AI connectors (MCP): anyone who opens the Lab settings hub sees the status;
  // the switch inside is admin-only (the server enforces the PUT).
  '/admin/ai-connectors':     { perms: LAB_SETTINGS_HUB_PERMS },
  // Prefrontal Bridges — list, add, one Bridge (the server enforces each action).
  '/admin/bridges':           { perms: BRIDGE_PERMS, module: 'lab' },
  // Lab analyzers (instrument connector) — the same lab-admin perm as Lab settings / Microbiology.
  '/admin/instruments':       { perms: ['manage_lab_settings'], module: 'lab' },
  '/admin/users':             { perms: ['manage_users'] },
  '/admin/users/invite':      { perms: ['manage_users'] },
  '/admin/roles/new':         { perms: ['manage_users'] },
  '/admin/tests':             { perms: [...TEST_MASTER_PERMS, 'manage_test_pricing'] },
  '/admin/tests/new':         { perms: TEST_MASTER_PERMS },
  '/admin/branches':          { perms: ['manage_branches'] },
  '/admin/vendors':           { perms: ['manage_tenant'] },
  '/admin/referral-labs':     { perms: TEST_MASTER_PERMS },
  '/admin/partner-prices':    { perms: TEST_MASTER_PERMS },
  '/admin/lab-settings':      { perms: ['manage_lab_settings'] },
  // Lab › merged settings pages (Settings re-home, 2026-11-17). Same perms as the screens they merge.
  '/admin/lab/sample-numbers': { perms: ['manage_lab_settings'] },
  '/admin/lab/collection':    { perms: ['manage_lab_settings'] },
  '/admin/lab/results':       { perms: ['manage_lab_settings'] },
  '/admin/lab/report-options': { perms: ['manage_lab_settings'] },
  '/admin/lab/home-collection': { perms: ['manage_home_collection', 'manage_tenant'], module: 'homeCollection' },
  '/admin/lab/front-desk':    { perms: ['manage_tenant', 'manage_admin'] },
  '/admin/lab/alerts':        { perms: ['manage_tenant', 'manage_notifications'] },
  '/admin/lab/numbers':       { perms: ADMIN_PERMS },
  // Settings → Communication (WhatsApp, Email, SMS): the perms the WhatsApp lab settings use.
  '/admin/communication':     { perms: COMMS_SETTINGS_PERMS },
  '/admin/files':             { perms: FILES_SETTINGS_PERMS },
  '/admin/organization':      { perms: ['manage_tenant'] },
  // Billing config APIs accept manage_billing_config as well as manage_tenant.
  '/admin/billing':           { perms: ['manage_tenant', 'manage_billing_config'] },
  '/admin/inventory':         { perms: ['manage_inventory'], module: 'inventory' },
  // Report design saves on manage_report_template (ConfigController / ReportLayoutController).
  '/admin/reports':           { perms: ['manage_tenant', 'manage_tests', 'manage_report_template'] },
  '/admin/referring-network': { perms: ['manage_tenant', 'manage_admin'] },
  // The Referral & Vendors hub is the ONE home of Referral Labs / Partner
  // Prices / Vendor Wallets / Referring Network (links only — each tile keeps
  // its own guard and the hub hides tiles a person can't open). Test-master
  // perms open it so a Lab Admin (Technical) still reaches Referral Labs +
  // Partner Prices, which the Lab hub used to list directly.
  '/admin/partners':          { perms: ['manage_tenant', 'manage_admin', ...TEST_MASTER_PERMS] },
  '/admin/notifications':     { perms: ['manage_tenant', 'manage_notifications'] },
  '/admin/workflows':         { perms: ['manage_workflows'] },
  '/admin/process':           { perms: ['manage_workflows'] },
  '/admin/audit':             { perms: ['view_audit_log'] },
  '/admin/appointments':      { perms: ['manage_tenant'] },
  // Home collection = entitlement AND the workflow's Home Visits action (the
  // ONE rule, core/modules/lab-features) — same pair as its work screens.
  '/admin/home-collection':   { perms: ['manage_home_collection'], workflow: ['home_visits'], module: 'homeCollection' },

  // ── Case sheets (part of IPD; every route also behind casesheetGuard) ─
  // Admin → IPD → MyPrefrontal: author the lab's case-sheet forms.
  '/admin/ipd/myprefrontal':                   { perms: CASESHEET_FORMS_PERMS },
  '/admin/ipd/myprefrontal/forms/:id':         { perms: CASESHEET_FORMS_PERMS },
  '/admin/ipd/myprefrontal/forms/:id/history': { perms: CASESHEET_FORMS_PERMS },
  '/admin/ipd/myprefrontal/pending':           { perms: CASESHEET_FORMS_PERMS },
  '/admin/ipd/departments':                    { perms: CASESHEET_FORMS_PERMS },
  // The lab's sheets: read with casesheet_view (tenant-wide, branch-filtered, §11 Q2) or casesheet_fill; start one with fill.
  // The Prepare tab (owner 2026-11-11): Departments to start a sheet (fill), every sheet the user may read (view or fill).
  '/prepare':                                  { perms: CASESHEET_FILL_PERMS },
  '/prepare/cases':                            { perms: CASESHEET_READ_PERMS },
  '/casesheets/patient/:patientId':            { perms: CASESHEET_READ_PERMS },
  '/casesheets/new':                           { perms: CASESHEET_FILL_PERMS },
  '/casesheets/:id':                           { perms: CASESHEET_READ_PERMS },
};

/** Strip query/fragment and a trailing slash: '/admin/manage?cat=x' → '/admin/manage'. */
export function normRoute(href: string): string {
  const p = (href ?? '').split(/[?#]/)[0];
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function routeAccess(href: string): RouteAccess | undefined {
  return ROUTE_ACCESS[normRoute(href)];
}

/** The route's OWN guard permissions (what its permissionGuard checks). */
export function routePerms(href: string): string[] {
  return routeAccess(href)?.perms ?? [];
}

/** The chain of access levels from the outermost parent to the route itself. */
export function routeAccessChain(href: string): RouteAccess[] {
  const chain: RouteAccess[] = [];
  let key: string | undefined = normRoute(href);
  const seen = new Set<string>();
  while (key && ROUTE_ACCESS[key] && !seen.has(key)) {
    seen.add(key);
    chain.unshift(ROUTE_ACCESS[key]);
    key = ROUTE_ACCESS[key].parent;
  }
  return chain;
}

export interface RouteAccessCtx {
  /** OR-check over raw permissions (`*` handled by the caller or here). */
  hasAny: (perms: string[]) => boolean;
  /** OR-check with mode-aware suppression; defaults to `hasAny`. */
  hasAnyEffective?: (perms: string[]) => boolean;
  /** Is this process-workflow action enabled? Omit = don't evaluate workflow. */
  isEnabled?: (action: string) => boolean;
  isSuper?: boolean;
  /** Is this tenant module enabled? Omit = don't evaluate modules. */
  moduleEnabled?: (m: ModuleKey) => boolean;
}

/**
 * Would the route guards admit this user to `href`? Mirrors permissionGuard
 * (+effective) for the route and every guarded parent, workflowGuard(Any) and
 * moduleGuard.
 * Routes not in the table are treated as open (their guard, if any, is a detail
 * page reached from inside an already-gated screen).
 */
export function canOpenRoute(href: string, ctx: RouteAccessCtx): boolean {
  for (const lvl of routeAccessChain(href)) {
    if (lvl.perms?.length && !ctx.isSuper) {
      const check = lvl.effective ? (ctx.hasAnyEffective ?? ctx.hasAny) : ctx.hasAny;
      if (!check(lvl.perms)) return false;
    }
    if (lvl.workflow?.length && ctx.isEnabled && !lvl.workflow.some(a => ctx.isEnabled!(a))) return false;
    if (lvl.module && ctx.moduleEnabled && !ctx.moduleEnabled(lvl.module)) return false;
  }
  return true;
}
