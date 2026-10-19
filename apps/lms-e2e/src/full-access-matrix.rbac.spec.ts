import { test, expect, type Page } from '@playwright/test';
import { loginAs, type RoleKey } from './support/auth';

/**
 * FULL PER-PERMISSION ACCESS MATRIX — all 10 seeded/e2e roles × every guarded
 * screen. Data-driven: expected reach is COMPUTED from (role's permission set ∩
 * screen's effective guard set), then asserted against LIVE behavior — so a
 * mismatch is either a model error here or a real app finding, never a silently
 * wrong hardcoded cell.
 *
 * Sources of truth:
 *   - ROLE_PERMS: prefrontal-mw Prefrontal/Seed/RoleSeeder.cs (RolePermissionMap).
 *   - SCREENS.effective: the route guard's permission OR-set from app.routes.ts,
 *     with PARENT-route gates folded in (the /frontdesk/* children are really
 *     gated by the shell's FRONTDESK_PERMS, not their own child perms).
 *   - `stacked: true` = the route also has moduleGuard/workflowGuard, which
 *     redirect to `/` (NOT /403) when the tenant toggle is off. So a permission
 *     HOLDER asserts "not /403" (reach OR /); a non-holder still /403 (the
 *     permission guard runs first).
 *
 * permissionGuard → /403 on fail; module/workflow guard → / on fail.
 */

// ── Role → permission set (RoleSeeder.cs, guard-relevant perms kept verbatim) ──
const ROLE_PERMS: Record<RoleKey, ReadonlySet<string>> = {
  receptionist: new Set([
    'register_patient', 'edit_patient', 'view_patient', 'create_order', 'view_order',
    'create_bill', 'collect_payment', 'give_discount', 'view_bill',
    'collect_sample', 'reject_sample', 'dispatch_sample',
    'deliver_report', 'view_report', 'print_barcode', 'view_test',
  ]),
  billingCounter: new Set([
    'view_patient', 'view_order', 'view_bill', 'create_bill', 'collect_payment',
    'give_discount', 'print_barcode',
  ]),
  sampleCollector: new Set([
    'view_patient', 'view_order', 'collect_sample', 'reject_sample', 'print_barcode',
  ]),
  labTech: new Set([
    'view_patient', 'view_order', 'collect_sample', 'reject_sample', 'print_barcode',
    'receive_sample', 'enter_result', 'edit_result', 'view_report', 'view_test',
  ]),
  homeCollection: new Set([
    'view_patient', 'view_order', 'collect_sample', 'reject_sample', 'print_barcode',
  ]),
  pathologist: new Set([
    'view_patient', 'view_order', 'edit_result', 'validate_result', 'reject_result',
    'reassign_result', 'view_report', 'deliver_report',
  ]),
  manager: new Set([
    'view_patient', 'view_order', 'view_report', 'view_bill', 'view_test',
    'view_dashboard', 'view_tat_dashboard', 'manage_branch', 'manage_branches',
    'view_audit_log', 'manage_home_collection',
  ]),
  storeKeeper: new Set([
    'view_test', 'inventory_receive', 'inventory_issue', 'inventory_count', 'print_barcode',
  ]),
  inventoryManager: new Set([
    'view_test', 'view_dashboard', 'inventory_receive', 'inventory_issue',
    'inventory_count', 'inventory_transfer', 'manage_inventory', 'print_barcode',
  ]),
  admin: new Set([
    'register_patient', 'edit_patient', 'view_patient', 'create_order', 'view_order',
    'cancel_order', 'modify_order', 'collect_sample', 'reject_sample', 'print_barcode',
    'receive_sample', 'dispatch_sample', 'enter_result', 'edit_result', 'validate_result',
    'validate_own_result', 'reject_result', 'reassign_result', 'deliver_report',
    'view_report', 'view_bill', 'view_test', 'create_bill', 'collect_payment',
    'give_discount', 'process_refund', 'override_discount', 'approve_discount',
    'manage_tests', 'manage_users', 'manage_roles', 'manage_tenant',
    'manage_billing_config', 'manage_report_template', 'manage_notifications',
    'manage_workflows', 'manage_lab_settings', 'manage_inventory', 'inventory_receive',
    'inventory_issue', 'inventory_count', 'inventory_transfer', 'manage_branch',
    'manage_branches', 'manage_departments', 'view_dashboard', 'view_tat_dashboard',
    'view_audit_log', 'manage_home_collection',
  ]),
};

interface Screen {
  path: string;
  /** OR-set: holding ANY of these passes the route's OWN permission guard.
   *  Empty = ungated (everyone). */
  effective: string[];
  /** Second OR-set that must ALSO be satisfied (AND semantics) — used for the
   *  /frontdesk/* children, which sit under the shell's FRONTDESK_PERMS parent
   *  gate AND carry their own narrower child guard. Reach requires passing BOTH.
   */
  parent?: string[];
  /** true = also module/workflow-guarded (holder may land on / instead of the
   *  screen — assert "not /403"); false = permission-only (holder lands on it). */
  stacked?: boolean;
  note?: string;
}

// FRONTDESK_PERMS (nav-items.ts) — the effective gate on every /frontdesk/* child.
const FRONTDESK = ['register_patient', 'create_order', 'create_bill', 'collect_payment', 'manage_branch'];
const ADMIN_GUARD = ['manage_tests', 'manage_users', 'manage_workflows', 'manage_branches'];

const SCREENS: Screen[] = [
  // ── Admin config ──
  { path: '/admin/billing', effective: ['manage_tenant', 'manage_branches'] },
  { path: '/admin/lab-settings', effective: ['manage_lab_settings', 'manage_branches'] },
  { path: '/admin/branches', effective: ['manage_branches'] },
  { path: '/admin/organization', effective: ['manage_branches', 'manage_tenant'] },
  { path: '/admin/modules', effective: ADMIN_GUARD },
  { path: '/admin/notifications', effective: ['manage_tenant', 'manage_branches'] },
  { path: '/admin/reports', effective: ['manage_tenant', 'manage_tests'] },
  { path: '/admin/inventory', effective: ['manage_inventory'], stacked: true, note: 'moduleGuard(inventory)' },
  { path: '/admin/users', effective: ['manage_users'] },
  { path: '/printing', effective: [], note: 'UNGATED — any signed-in user' },
  // ── Operations / relationships ──
  { path: '/admin/appointments', effective: ['manage_branches', 'manage_tenant'] },
  { path: '/admin/vendors', effective: ['manage_tenant'] },
  { path: '/admin/referral-labs', effective: ['manage_tests'] },
  { path: '/admin/referring-network', effective: ['manage_tenant'], note: 'guard also lists dead manage_admin' },
  { path: '/admin/partners', effective: ['manage_tenant', 'manage_tests'], note: 'guard also lists dead manage_admin' },
  { path: '/admin/kpis', effective: ADMIN_GUARD },
  { path: '/admin/audit', effective: ['view_audit_log'] },
  { path: '/finance', effective: ['collect_payment', 'create_bill', 'manage_tenant'] },
  { path: '/finance/daily', effective: ['collect_payment', 'create_bill', 'manage_tenant'] },
  { path: '/admin/home-collection', effective: ['manage_home_collection', 'manage_branches'], stacked: true, note: 'moduleGuard(homeCollection)' },
  // ── Frontdesk shell children: parent FRONTDESK_PERMS gate AND the child's
  //    own narrower permissionGuard — reach requires passing BOTH. ──
  { path: '/frontdesk/appointments', parent: FRONTDESK, effective: ['register_patient', 'create_order', 'view_order'], stacked: true, note: 'workflowGuard(appointment)' },
  { path: '/frontdesk/queue', parent: FRONTDESK, effective: ['register_patient', 'create_order', 'view_order', 'collect_sample'], stacked: true, note: 'workflowGuard(queue)' },
  { path: '/frontdesk/home-collection', parent: FRONTDESK, effective: ['manage_home_collection', 'register_patient', 'create_order'], stacked: true, note: 'workflow+moduleGuard' },
  // ── Top-level operational ──
  { path: '/lost-and-found', effective: ['receive_sample', 'reject_sample', 'cancel_order', 'manage_users'], stacked: true, note: 'workflowGuard(lost_and_found)' },
];

const ALL_ROLES = Object.keys(ROLE_PERMS) as RoleKey[];
const hasAny = (role: RoleKey, perms: string[]) =>
  perms.length === 0 || perms.some((p) => ROLE_PERMS[role].has(p));
// Reach requires passing the route's own guard AND (if present) the parent gate.
const holds = (role: RoleKey, s: Screen) =>
  hasAny(role, s.effective) && (s.parent ? hasAny(role, s.parent) : true);
const pathOf = (page: Page) => new URL(page.url()).pathname;

async function assertScreen(page: Page, role: RoleKey, s: Screen) {
  const shouldReach = holds(role, s);
  await page.goto(s.path);
  await page.waitForLoadState('domcontentloaded');
  if (shouldReach) {
    // Holder: permission guard must NOT bounce to /403. (Stacked screens may
    // land on / when a module/workflow toggle is off — still "not forbidden".)
    await expect(page, `${role} holds a perm for ${s.path} → must not be /403`).not.toHaveURL(/\/403(\/|$)/, { timeout: 10_000 });
    await page.waitForTimeout(300);
    expect(pathOf(page), `${role} @ ${s.path} settled on /403 unexpectedly`).not.toMatch(/\/403$/);
  } else {
    // Non-holder: the permission guard runs first → exact /403.
    await page.waitForURL(/\/403(\/|$)/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /forbidden/i })).toBeVisible();
  }
}

for (const role of ALL_ROLES) {
  test(`access matrix — ${role}`, async ({ page }) => {
    test.setTimeout(150_000); // ~24 sequential real navigations per role (test.slow() doesn't re-timeout reliably here)
    await loginAs(page, role);
    for (const s of SCREENS) {
      await assertScreen(page, role, s);
    }
  });
}
