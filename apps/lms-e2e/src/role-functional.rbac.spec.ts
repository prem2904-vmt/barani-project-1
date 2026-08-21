import { test, expect, type Browser, type Page } from '@playwright/test';
import { loginAs } from './support/auth';
import { registerPatient, createOrder, collectSample, enterResult } from './support/flows';

/**
 * ROLE-FUNCTIONAL RBAC — "who gets which BUTTONS", not just which routes.
 *
 * Companion to the pure route-guard matrices (admin-config-access /
 * operational-access / inventory / register-billing / result-gating
 * .rbac.spec.ts) — those assert reach-vs-403 at the ROUTE. This file asserts
 * the next layer down: on a screen a role legitimately reaches, does it see
 * (or not see) the specific ACTION CONTROLS its permission set does (or does
 * not) grant? Every negative assertion checks control ABSENCE from the DOM
 * (`toHaveCount(0)`), never a merely-disabled control — per
 * StoresComponent.allowedActions()/SampleResultEntryComponent.hasReopenable()
 * etc., the gated controls are template-`@if`'d out entirely, not disabled.
 *
 * Ground truth, verified live in this repo:
 *   - apps/lms/src/app/features/stores/stores.component.ts — `can(p)` =
 *     hasPermission(p) || hasPermission('manage_inventory'); `allowedActions`
 *     filters the 3 action tabs (Receive/Issue-Consume/Stock-count) by it.
 *     There is NO inventory_transfer action tab in the UI (Inventory Manager's
 *     inventory_transfer permission has no corresponding tab to test).
 *   - apps/lms/src/app/features/admin/inventory/inventory.component.ts —
 *     gated at the route (`manage_inventory` + `moduleGuard('inventory')`);
 *     "New item" always renders once the route itself is reached.
 *   - apps/lms/src/app/features/lab/sample-collection/sample-collection.component.ts
 *     — `canDispatch()` = hasPermission('dispatch_sample') &&
 *     process.dispatchStepEnabled(); the "Dispatch" button (aria-label
 *     "Dispatch") only renders when `g.collected === g.totalVials &&
 *     canDispatch() && !isDispatched(g)` (and no payment hold — confirmed
 *     NOT in effect for this tenant, since support/flows.ts's enterResult()
 *     dispatches a freshly created pay-later order successfully elsewhere).
 *   - apps/lms/src/app/features/lab/sample-result-entry/sample-result-entry.component.ts
 *     — `canEditResult()` = hasPermission('edit_result'); the desktop
 *     "Edit result" footer button (`.pf-sre__reopen`, ≥641px viewport, the
 *     default Desktop Chrome device this suite runs under) only renders via
 *     `hasReopenable()` = canEditResult() && some test is entered/validated.
 *   - apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.ts
 *     — `showRegister()`/`showOrder()` gate ONLY on the tenant's
 *     process-workflow toggle (`process.isEnabled('patient_registration'
 *     /'walk_in_order')`), NEVER on the viewer's register_patient/
 *     create_order permission. register-billing.rbac.spec.ts already proved
 *     this leak for Branch Manager; this file proves the SAME leak recurs for
 *     Billing Counter (same component, same code path, different role).
 *
 * Role → permission facts, cross-checked against prefrontal-mw's
 * Prefrontal/Seed/RoleSeeder.cs directly (not just the task brief):
 *   Receptionist:        register_patient, create_order, create_bill,
 *                         collect_payment, give_discount, collect_sample,
 *                         reject_sample, dispatch_sample, print_barcode,
 *                         deliver_report, view_*.
 *   Billing Counter:      view_patient/order/bill, create_bill,
 *                         collect_payment, give_discount, print_barcode.
 *                         NO register_patient / create_order.
 *   Sample Collector:     view_patient/order, collect_sample, reject_sample,
 *                         print_barcode. NO dispatch_sample.
 *   Home Collection Agent: identical shape to Sample Collector. NO dispatch_sample.
 *   Lab Technician:        view_patient/order, collect_sample, reject_sample,
 *                         print_barcode, receive_sample, enter_result,
 *                         edit_result, view_report/test. NO dispatch_sample.
 *   Pathologist:           view_patient/order, edit_result, validate_result,
 *                         reject_result, reassign_result, view_report,
 *                         deliver_report.
 *   Branch Manager:        view_*, manage_branch/manage_branches,
 *                         view_audit_log, manage_home_collection. NO
 *                         enter_result/edit_result — blocked at the
 *                         /lab/sample/:id route entirely (see result-gating
 *                         .rbac.spec.ts), so the Edit-result control is
 *                         trivially absent (never mounts).
 *   Store Keeper:          view_test, inventory_receive, inventory_issue,
 *                         inventory_count, print_barcode. NO manage_inventory.
 *   Inventory Manager:     view_test, view_dashboard, inventory_receive/
 *                         issue/count/transfer, manage_inventory, print_barcode.
 *   Lab Admin:             superset of everything above.
 */

const FORBIDDEN_HEADING = /forbidden/i;

async function expectBlocked(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/403$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
}

async function expectAllowed(page: Page, path: string, headingName: RegExp) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));
  await expect(page.getByRole('heading', { name: headingName, level: 1 })).toBeVisible({ timeout: 15_000 });
}

// ── 1) Stores per-action tabs — Store Keeper vs Inventory Manager vs no-perm ──

function storesTabs(page: Page) {
  return page.locator('nav.tabs');
}

test.describe('Role-functional RBAC — Stores per-action tabs (inventory_receive/issue/count vs manage_inventory)', () => {
  test('storeKeeper: reaches /stores and sees all 3 action tabs (holds inventory_receive+issue+count individually), but is blocked from the /admin/inventory catalogue (no manage_inventory)', async ({ page }) => {
    await loginAs(page, 'storeKeeper');
    await expectAllowed(page, '/stores', /inventory desk/i);

    const tabs = storesTabs(page);
    await expect(tabs.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Receive', exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Issue / Consume', exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Stock count', exact: true })).toBeVisible();

    // Catalogue/BOM admin is a SEPARATE permission (manage_inventory) — Store
    // Keeper does the day-to-day scan-first ops but never configures items.
    await expectBlocked(page, '/admin/inventory');
  });

  test('inventoryManager: reaches /stores (same 3 action tabs, via manage_inventory) AND the /admin/inventory catalogue', async ({ page }) => {
    await loginAs(page, 'inventoryManager');
    await expectAllowed(page, '/stores', /inventory desk/i);

    const tabs = storesTabs(page);
    await expect(tabs.getByRole('button', { name: 'Receive', exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Issue / Consume', exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Stock count', exact: true })).toBeVisible();

    await expectAllowed(page, '/admin/inventory', /^inventory$/i);
    await expect(page.getByRole('button', { name: 'New item', exact: true })).toBeVisible();
  });

  test('receptionist: blocked from /stores entirely — holds no inventory_* permission and not manage_inventory', async ({ page }) => {
    await loginAs(page, 'receptionist');
    await expectBlocked(page, '/stores');
  });
});

// ── 2) Sample-collection Dispatch control (dispatch_sample) ─────────────────

interface CollectedOrderRef {
  orderId: string;
}

/**
 * Register + order + collect a single-test order as ADMIN, leaving it fully
 * collected (1/1) but NOT dispatched — the exact state the Dispatch
 * affordance needs (`g.collected === g.totalVials && !isDispatched(g)`).
 * Admin is the only seeded role holding register_patient + create_order +
 * collect_sample all at once, so setup always runs as admin regardless of
 * which OTHER role's Dispatch-visibility gets checked afterward. Runs in its
 * own throwaway context/page so it never touches the caller's session.
 */
async function setupCollectedOrderAsAdmin(browser: Browser): Promise<CollectedOrderRef> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, 'admin');
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient);
    await collectSample(page, order.orderId);
    return { orderId: order.orderId };
  } finally {
    await context.close();
  }
}

test.describe('Role-functional RBAC — sample-collection Dispatch control (dispatch_sample)', () => {
  test('receptionist: self-serves register→order→collect and sees the Dispatch control on the fully-collected order (holds dispatch_sample)', async ({ page }) => {
    await loginAs(page, 'receptionist');
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient);
    await collectSample(page, order.orderId); // leaves the drawer open, 1/1 collected, undispatched
    await expect(page.getByRole('button', { name: /^dispatch$/i })).toBeVisible();
  });

  test('admin: sees the Dispatch control on a fully-collected order (holds dispatch_sample)', async ({ page }) => {
    await loginAs(page, 'admin');
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient);
    await collectSample(page, order.orderId);
    await expect(page.getByRole('button', { name: /^dispatch$/i })).toBeVisible();
  });

  for (const role of ['sampleCollector', 'homeCollection', 'labTech'] as const) {
    test(`${role}: does NOT see the Dispatch control on a fully-collected order (no dispatch_sample)`, async ({ browser }) => {
      const { orderId } = await setupCollectedOrderAsAdmin(browser);

      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await loginAs(page, role);
        await page.goto(`/lab/collect?orderId=${orderId}&from=/lab/my-work`);

        const drawer = page.locator('.pf-drawer__panel');
        await expect(drawer).toBeVisible({ timeout: 30_000 });
        // Positive proof the drawer legitimately rendered this fully-collected
        // order (not a blank/broken state) before asserting the negative.
        await expect(page.locator('.pf-drawer__done-stamp', { hasText: /all vials collected/i })).toBeVisible({ timeout: 15_000 });

        await expect(page.getByRole('button', { name: /^dispatch$/i })).toHaveCount(0);
        // "Dispatch tubes…" (partial-dispatch) also needs canDispatch() — must
        // be absent too, not just the whole-order button.
        await expect(page.getByRole('button', { name: /dispatch tubes/i })).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
});

// ── 3) Result-entry Edit control (edit_result) ───────────────────────────────

/**
 * Carry a fresh order all the way to an ENTERED result (register → order →
 * collect → dispatch → receive → enter), as ADMIN — the only seeded role
 * holding every permission that end-to-end chain needs. Runs once per test
 * that calls it, in its own throwaway context, so it never shares state
 * across tests.
 */
async function setupEnteredResultSample(browser: Browser): Promise<{ sampleId: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, 'admin');
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient);
    const sample = await collectSample(page, order.orderId);
    const entered = await enterResult(page, order, sample);
    return { sampleId: entered.sampleId };
  } finally {
    await context.close();
  }
}

test.describe('Role-functional RBAC — Result-entry Edit control (edit_result)', () => {
  // One seed, reused read-only within THIS SINGLE TEST across several
  // throwaway role-scoped contexts — no state is shared ACROSS tests (every
  // other test in this file seeds its own data), and nothing here mutates
  // the sample (we only ever assert control visibility, never click Edit).
  test('labTech/pathologist/admin see "Edit result" on an entered result; sampleCollector/manager never reach the screen at all (route-blocked, so the control is naturally absent)', async ({ browser }) => {
    test.slow(); // one full 6-step seed + 5 separate role logins/navigations

    const { sampleId } = await setupEnteredResultSample(browser);

    for (const role of ['labTech', 'pathologist', 'admin'] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await loginAs(page, role);
        await page.goto(`/lab/sample/${sampleId}`);
        await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);

        const editBtn = page.locator('.pf-sre__reopen');
        await expect(editBtn).toBeVisible({ timeout: 20_000 });
        await expect(editBtn).toHaveText(/edit result/i);
      } finally {
        await context.close();
      }
    }

    for (const role of ['sampleCollector', 'manager'] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await loginAs(page, role);
        await page.goto(`/lab/sample/${sampleId}`);
        await expect(page).toHaveURL(/\/403(\/|$|\?)/, { timeout: 15_000 });
        await expect(page.locator('.pf-sre__reopen')).toHaveCount(0);
      } finally {
        await context.close();
      }
    }
  });
});

// ── 4) Frontdesk New-patient / Create-order affordances ─────────────────────

function frontdeskButtons(page: Page) {
  return {
    newPatientBtn: page.locator('.pf-mbar').getByRole('button', { name: 'New patient' }),
    createOrderLink: page.getByRole('link', { name: 'Create order' }),
  };
}

test.describe('Role-functional RBAC — Frontdesk New-patient / Create-order affordances', () => {
  test('receptionist: sees New patient + Create order on the landing and both are fully functional (holds register_patient + create_order)', async ({ page }) => {
    await loginAs(page, 'receptionist');
    await page.goto('/frontdesk');
    await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);

    const { newPatientBtn, createOrderLink } = frontdeskButtons(page);
    await expect(newPatientBtn).toBeVisible({ timeout: 15_000 });
    await expect(createOrderLink).toBeVisible();

    await newPatientBtn.click();
    await expect(page).toHaveURL(/\/frontdesk\/patients\/new$/, { timeout: 15_000 });

    await page.goto('/frontdesk');
    await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);
    await frontdeskButtons(page).createOrderLink.click();
    await expect(page).not.toHaveURL(/\/403(\/|$|\?)/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/frontdesk\/order/);
  });

  test('billingCounter: sees the SAME New-patient/Create-order buttons on the landing (documented affordance leak — showRegister()/showOrder() gate on the tenant workflow toggle only, never the viewer\'s permission) but both dead-end at /403 (lacks register_patient/create_order)', async ({ page }) => {
    test.info().annotations.push({
      type: 'finding',
      description:
        'Same root cause register-billing.rbac.spec.ts documents for Branch Manager: FrontdeskLandingComponent\'s ' +
        "showRegister()/showOrder() gate ONLY on process.isEnabled('patient_registration'/'walk_in_order'), never on " +
        "the viewer's register_patient/create_order permission. Billing Counter reaches the /frontdesk shell via " +
        'FRONTDESK_PERMS (create_bill/collect_payment), sees both buttons rendered and clickable, but each child ' +
        'route (register_patient / create_order) correctly rejects it to /403 — a UI affordance leak, not a data leak.',
    });

    await loginAs(page, 'billingCounter');
    await page.goto('/frontdesk');
    await expect(page).not.toHaveURL(/\/403(\/|$|\?)/); // parent guard passes via create_bill/collect_payment

    const { newPatientBtn, createOrderLink } = frontdeskButtons(page);
    await expect(newPatientBtn, 'billingCounter should not see a live New-patient affordance per a strict RBAC reading — documented leak, see file header').toBeVisible({ timeout: 15_000 });
    await expect(createOrderLink, 'billingCounter should not see a live Create-order affordance per a strict RBAC reading — documented leak, see file header').toBeVisible();

    await newPatientBtn.click();
    await page.waitForURL(/\/403$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();

    await page.goto('/frontdesk');
    await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);
    await frontdeskButtons(page).createOrderLink.click();
    await page.waitForURL(/\/403$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
  });
});
