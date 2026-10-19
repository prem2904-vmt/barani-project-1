import { test, expect, type Page } from '@playwright/test';
import { loginAs, type RoleKey } from './support/auth';
import { registerPatient, createOrder } from './support/flows';

/**
 * REGISTER / ORDER / BILLING RBAC gating.
 *
 * Ground truth is apps/lms/src/app/app.routes.ts (route `canActivate` guards
 * under the `/frontdesk` parent) cross-checked against prefrontal-mw's
 * Prefrontal/Seed/RoleSeeder.cs (the actual permission set each seeded role
 * holds). `permissionGuard(...)` (core/auth/permission.guard.ts) redirects a
 * user lacking every listed permission to `/403` ("Forbidden") — same block
 * signature used by admin-settings.rbac.spec.ts / result-gating.rbac.spec.ts.
 *
 * Per RoleSeeder.cs, among our 5 testable seeded roles (auth.ts ROLE_CREDS):
 *   - Lab Admin (admin) holds register_patient, create_order, create_bill
 *     AND collect_payment — the full register→order→bill path.
 *   - Lab Technician (labTech), Sample Collector (sampleCollector) and
 *     Pathologist (pathologist) hold NONE of register_patient/create_order/
 *     create_bill/collect_payment/manage_branch.
 *   - Branch Manager (manager) holds view_bill (read-only) but NOT
 *     create_bill/collect_payment, and holds NEITHER register_patient NOR
 *     create_order. It DOES hold `manage_branch` (singular — "edit your own
 *     branch's info"), which is distinct from `manage_branches` (plural,
 *     "browse the tenant branch list", the one admin-settings/nav-visibility
 *     specs document leaking Branch Manager into /admin).
 *
 * ⚠ GUARD TOPOLOGY NUANCE (drives the two-tier assertion below):
 * `/frontdesk` itself (the parent shell route) is gated on FRONTDESK_PERMS
 * (layout/nav-items.ts) = ['register_patient','create_order','create_bill',
 * 'collect_payment','manage_branch'] — a deliberately wider set than any one
 * child route, admitting Billing Counter/Receptionist AND a branch manager
 * "overseeing the counter" (OPS-10) into the *shell*. Each child route then
 * re-guards on its OWN narrower permission:
 *   - /frontdesk/patients/new  → permissionGuard('register_patient')
 *   - /frontdesk/order         → permissionGuard('create_order')
 *   - /frontdesk/post-payment  → permissionGuard(['collect_payment','create_bill'])
 * So labTech/sampleCollector/pathologist (holding NONE of FRONTDESK_PERMS)
 * are bounced to /403 at the PARENT guard — they never even reach the
 * frontdesk shell. Branch Manager, holding `manage_branch`, DOES pass the
 * parent guard and reaches the /frontdesk landing shell itself — but is then
 * bounced to /403 by every child guard below (register_patient/create_order/
 * collect_payment+create_bill are each independently absent from its grant).
 * Net effect for all 4 non-admin roles: register/order/billing are
 * unreachable and no data can be created — but the ROUTE where that gets
 * enforced differs for Branch Manager vs the other three.
 *
 * ⚠ FINDING — UI affordance leak (not a real access leak) for Branch
 * Manager: FrontdeskLandingComponent's "New patient" and "Create order" mbar
 * buttons (frontdesk-landing.component.html, showRegister()/showOrder())
 * are gated ONLY on the tenant's process-workflow toggle
 * (`process.isEnabled('patient_registration'/'walk_in_order')`), NOT on the
 * viewer's register_patient/create_order permission. Because Branch Manager
 * reaches the landing shell (see above), it sees both buttons rendered and
 * clickable — but clicking either just navigates to the real child route,
 * which the permission guard then rejects to /403, so nothing is actually
 * creatable. Asserted directly below: do not "fix" by hiding the finding.
 */

const FORBIDDEN_HEADING = /forbidden/i;

async function expectBlocked(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/403$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
  await expect(page.getByText(/you do not have permission/i)).toBeVisible();
}

/** No Frontdesk entry point in the desktop primary nav (register/order/
 *  billing all live under it) — scoped to the real rendered nav, same
 *  selector nav-visibility.rbac.spec.ts uses. */
async function expectNoFrontdeskNavEntry(page: Page) {
  await expect(page.locator('nav.pf-topnav-center').getByRole('link', { name: 'Frontdesk', exact: true })).toHaveCount(0);
}

const BLOCKED_AT_PARENT_ROLES: RoleKey[] = ['labTech', 'sampleCollector', 'pathologist'];
const DUMMY_ORDER_ID = '00000000-0000-0000-0000-000000000000';

test.describe('Register/Order/Billing RBAC gating', () => {
  test('admin (Lab Admin): reaches patient registration, order creation, and the payment surface', async ({ page }) => {
    await loginAs(page, 'admin');

    // Real registration — full form fill + POST assertion, live in flows.ts.
    const patient = await registerPatient(page);

    // Real order creation off that patient — full cart + "pay later" POST
    // assertion, also live in flows.ts. Confirms /frontdesk/order is reachable
    // and functional end-to-end for admin.
    const order = await createOrder(page, patient);

    // Billing surface — admin (collect_payment + create_bill) must reach
    // the post-payment screen for the order just placed.
    await page.goto(`/frontdesk/post-payment?orderId=${order.orderId}`);
    await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);
    await expect(page.getByRole('heading', { name: /order complete/i, level: 1 })).toBeVisible({ timeout: 15_000 });
  });

  for (const role of BLOCKED_AT_PARENT_ROLES) {
    test(`${role}: blocked from the whole /frontdesk shell (no FRONTDESK_PERMS) — register/order/billing all 403`, async ({ page }) => {
      await loginAs(page, role);

      // Blocked at the PARENT guard already — never reaches the landing shell.
      await expectBlocked(page, '/frontdesk');
      await expectBlocked(page, '/frontdesk/patients/new');
      await expectBlocked(page, '/frontdesk/order');
      await expectBlocked(page, `/frontdesk/post-payment?orderId=${DUMMY_ORDER_ID}`);

      await expectNoFrontdeskNavEntry(page);
    });
  }

  test('manager (Branch Manager): reaches the /frontdesk shell (manage_branch) but every ' +
       'create surface (register/order/billing) is still 403 at the child guard', async ({ page }) => {
    await loginAs(page, 'manager');

    // Blocked — register_patient/create_order/collect_payment+create_bill
    // are each absent from Branch Manager's grant.
    await expectBlocked(page, '/frontdesk/patients/new');
    await expectBlocked(page, '/frontdesk/order');
    await expectBlocked(page, `/frontdesk/post-payment?orderId=${DUMMY_ORDER_ID}`);

    // No Frontdesk entry in the primary nav either (menusFromWorkflow never
    // surfaces it for manage_branch — matches nav-visibility.rbac.spec.ts's
    // documented gap finding for this same role).
    await expectNoFrontdeskNavEntry(page);
  });

  test('manager (Branch Manager): reaches the /frontdesk LANDING itself (manage_branch passes ' +
       'the parent guard) — FINDING: sees live-looking New-patient/Create-order buttons, but ' +
       'clicking either dead-ends at /403 (child guard is the real, working gate)', async ({ page }) => {
    await loginAs(page, 'manager');

    // NOT blocked — manage_branch satisfies FRONTDESK_PERMS on the parent
    // /frontdesk route, unlike the 3 roles above which hold none of it.
    await page.goto('/frontdesk');
    await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);

    // The mbar's "New patient" aria-labelled button is the canonical
    // register-entry affordance (there's also a same-labelled empty-state
    // CTA further down the landing that calls the identical openRegister()
    // handler — scope to the mbar one so the locator stays unambiguous).
    const newPatientBtn = page.locator('.pf-mbar').getByRole('button', { name: 'New patient' });
    const createOrderLink = page.getByRole('link', { name: 'Create order' });

    // FINDING: both render — FrontdeskLandingComponent's showRegister()/
    // showOrder() gate only on the tenant process-workflow toggle, not on
    // the viewer's register_patient/create_order permission.
    await expect(newPatientBtn, 'Branch Manager should not see a live New-patient affordance per a strict RBAC reading — documented leak, see file header').toBeVisible({ timeout: 15_000 });
    await expect(createOrderLink, 'Branch Manager should not see a live Create-order affordance per a strict RBAC reading — documented leak, see file header').toBeVisible();

    // But the real gate holds: clicking "New patient" navigates to the
    // child route, whose own guard (register_patient) rejects Branch
    // Manager to /403 — nothing is actually creatable.
    await newPatientBtn.click();
    await page.waitForURL(/\/403$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();

    // Same dead-end for "Create order".
    await page.goto('/frontdesk');
    await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);
    await page.getByRole('link', { name: 'Create order' }).click();
    await page.waitForURL(/\/403$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
  });
});
