import { test, expect, type Page } from '@playwright/test';
import { loginAs, type RoleKey } from './support/auth';
import { registerPatient, createOrder, collectSample, enterResult } from './support/flows';

/**
 * RBAC — VALIDATE / SIGN-OFF GATING.
 *
 * Only roles holding the `validate_result` permission may validate/sign-off
 * an entered result into a final report. Per mw's RoleSeeder
 * (Prefrontal/Seed/RoleSeeder.cs), that's exactly **Pathologist** and
 * **Lab Admin** — Lab Technician has enter_result/edit_result but NOT
 * validate_result (can enter, cannot sign off); Sample Collector and
 * Branch Manager have neither.
 *
 * Gating is enforced TWICE, and this spec proves both layers:
 *
 *  1. Frontend route guard — app.routes.ts gates both
 *     `/pathologist` (the pending-validation queue) and
 *     `/pathologist/validate/:id` (the validate screen) behind
 *     `permissionGuard('validate_result')`, which redirects to `/403` when
 *     the signed-in user lacks the code (permission.guard.ts).
 *
 *  2. Backend permission middleware — ValidationController carries a
 *     class-level `[RequirePermission("validate_result")]`
 *     (Prefrontal/Controllers/ValidationController.cs). Per
 *     PermissionCheckMiddleware, this check runs BEFORE the action (and
 *     before any DB lookup of the order-test), short-circuiting with a
 *     plain HTTP 403 for any role missing the code. Because the check never
 *     touches the resource, the negative assertions below hit
 *     `/api/validation/{id}/validate` with a well-formed but non-existent
 *     GUID — the 403 is purely role-driven, so it needs no real fixture.
 *
 * Positive ("CAN") proof needs a REAL order-test sitting in the validation
 * queue. Every seeded catalogue test (incl. BIO108) is Flow:'direct', which
 * auto-validates the moment a result is submitted UNLESS the branch's
 * "Require validation for all results" lab setting is on
 * (BranchLabConfig.RequireValidationForAllResults, admin/lab-settings —
 * only an admin/Lab Admin can flip it). So each positive test:
 *   (a) signs in as admin (Lab Admin holds every permission needed for the
 *       whole register → order → collect → receive → enter-result chain,
 *       see RoleSeeder's ["Lab Admin"] permission list),
 *   (b) flips the setting on for the duration of the test (restored in a
 *       `finally`, exactly like report.authed.spec.ts's
 *       `setRequireValidationForAllResults` — duplicated here rather than
 *       imported since that helper isn't exported and this spec must not
 *       edit any support/other spec file),
 *   (c) drives a fresh patient/order/sample/result to 'entered',
 *   (d) then (switching login to `pathologist` where relevant) reaches the
 *       validate screen and actually submits Validate — asserting the real
 *       `POST /api/validation/{id}/validate` response flips the order-test
 *       to 'validated'.
 *
 * Each positive test is fully self-contained (builds its own fixture,
 * restores the setting itself) so it's safe under Playwright's `retries: 2`
 * — a retry just builds a fresh order-test rather than re-touching an
 * already-validated one.
 */

const MW_ORIGIN = 'http://localhost:5270';

/** A syntactically-valid GUID that will never resolve to a real order-test.
 *  Fine for the negative checks: PermissionCheckMiddleware 403s before the
 *  id is ever looked up, and the Angular route guard 403s before the
 *  component even requests the validation queue. */
const FAKE_ORDER_TEST_ID = '00000000-0000-0000-0000-000000000000';

/** Read/set the branch's "Require validation for all results" lab setting.
 *  Duplicated from report.authed.spec.ts (not exported there, and this spec
 *  must only touch its own file) — see that spec for the full rationale on
 *  trusting the PATCH response body over the live checkbox DOM (a real
 *  ngOnInit-vs-our-PATCH race, not flakiness). */
async function setRequireValidationForAllResults(page: Page, on: boolean): Promise<void> {
  const [cfgResponse] = await Promise.all([
    page.waitForResponse(
      r => /\/api\/tenants\/branch-lab-config$/i.test(r.url()) && r.request().method() === 'GET',
    ),
    page.goto('/admin/lab-settings'),
  ]);
  const cfgJson = await cfgResponse.json();
  const current = (cfgJson?.data ?? cfgJson)?.requireValidationForAllResults === true;
  if (current === on) return;

  const tile = page.locator('pf-tile', { hasText: 'Require validation for all results' });
  const toggleLabel = tile.locator('label.pf-ls__toggle');
  const checkbox = tile.locator('input[type="checkbox"]');
  await expect(toggleLabel).toBeVisible({ timeout: 15_000 });
  await expect(checkbox).toBeChecked({ checked: current, timeout: 10_000 });

  const [patchResponse] = await Promise.all([
    page.waitForResponse(
      r => /\/api\/tenants\/branch-lab-config$/i.test(r.url()) && r.request().method() === 'PATCH',
    ),
    toggleLabel.click(),
  ]);
  expect(patchResponse.ok()).toBe(true);
  const patchJson = await patchResponse.json();
  expect(patchJson.success).toBe(true);
  expect(patchJson.data?.requireValidationForAllResults).toBe(on);
}

/** Build a fresh order-test sitting in 'entered' (awaiting validation) —
 *  the full register → order → collect → dispatch → arrive → enter-result
 *  chain (support/flows.ts), driven by whoever is currently signed in on
 *  `page`. Callers must already be signed in as a role that holds every
 *  permission the chain needs (admin/Lab Admin does). */
async function buildEnteredOrderTest(page: Page): Promise<string> {
  const patient = await registerPatient(page);
  const order = await createOrder(page, patient);
  const sample = await collectSample(page, order.orderId);
  const result = await enterResult(page, order, sample);
  expect(result.status).toBe('entered');
  return result.orderTestId;
}

/** Pull the bearer token straight out of the app's persisted session
 *  (AuthService.SESSION_KEY = 'pf.session', a JSON blob with access_token)
 *  so we can hit the mw API directly under a specific role's real token —
 *  bypassing the Angular UI/interceptor entirely to prove the BACKEND'S OWN
 *  gate, not merely the frontend route guard. */
async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('pf.session');
      return raw ? (JSON.parse(raw)?.access_token ?? null) : null;
    } catch {
      return null;
    }
  });
  if (!token) throw new Error('No access_token found in localStorage("pf.session") after login');
  return token as string;
}

test.describe('Validate / sign-off gating (RBAC)', () => {
  // ── CAN validate ──────────────────────────────────────────────────────
  // Pathologist and Lab Admin ('admin' role key) hold validate_result.

  test('pathologist CAN reach the validate screen and submit Validate', async ({ page }) => {
    // Build the fixture as admin (Lab Admin has every permission the chain
    // needs; Pathologist alone does not — it can't register/order/collect/
    // enter, only validate/reject/reassign already-entered results).
    await loginAs(page, 'admin');
    try {
      await setRequireValidationForAllResults(page, true);
      const orderTestId = await buildEnteredOrderTest(page);

      // Switch the session to the role under test.
      await loginAs(page, 'pathologist');
      await page.goto(`/pathologist/validate/${orderTestId}`);

      // Route guard let it through (no /403 bounce), and the screen actually
      // found this order-test in its own /api/validation/queue?mine=false
      // fetch (ngOnInit) — not just "the URL didn't 403".
      await expect(page).not.toHaveURL(/\/403/);
      const validateBtn = page.getByRole('button', { name: /^validate/i });
      await expect(validateBtn).toBeVisible({ timeout: 15_000 });
      await expect(validateBtn).toBeEnabled();

      const [validateResponse] = await Promise.all([
        page.waitForResponse(
          r => new RegExp(`/api/validation/${orderTestId}/validate$`, 'i').test(r.url())
            && r.request().method() === 'POST',
        ),
        validateBtn.click(),
      ]);
      expect(validateResponse.ok()).toBe(true);
      const json = await validateResponse.json();
      expect(json.success).toBe(true);
      expect(json.data?.id).toBe(orderTestId);
      expect(json.data?.status).toBe('validated');
    } finally {
      // Restore under admin regardless of which role the session ended on.
      await loginAs(page, 'admin');
      await setRequireValidationForAllResults(page, false);
    }
  });

  test('admin (Lab Admin) CAN reach the validate screen and submit Validate', async ({ page }) => {
    await loginAs(page, 'admin');
    try {
      await setRequireValidationForAllResults(page, true);
      const orderTestId = await buildEnteredOrderTest(page);

      // Same session — Lab Admin holds validate_result directly, no switch.
      await page.goto(`/pathologist/validate/${orderTestId}`);
      await expect(page).not.toHaveURL(/\/403/);
      const validateBtn = page.getByRole('button', { name: /^validate/i });
      await expect(validateBtn).toBeVisible({ timeout: 15_000 });
      await expect(validateBtn).toBeEnabled();

      const [validateResponse] = await Promise.all([
        page.waitForResponse(
          r => new RegExp(`/api/validation/${orderTestId}/validate$`, 'i').test(r.url())
            && r.request().method() === 'POST',
        ),
        validateBtn.click(),
      ]);
      expect(validateResponse.ok()).toBe(true);
      const json = await validateResponse.json();
      expect(json.success).toBe(true);
      expect(json.data?.id).toBe(orderTestId);
      expect(json.data?.status).toBe('validated');
    } finally {
      await setRequireValidationForAllResults(page, false);
    }
  });

  // ── CANNOT validate ───────────────────────────────────────────────────
  // Lab Technician has enter_result/edit_result but not validate_result
  // (can enter a result, cannot sign it off). Sample Collector and Branch
  // Manager hold neither. All three should be blocked at BOTH layers.
  const deniedRoles: RoleKey[] = ['labTech', 'sampleCollector', 'manager'];

  for (const role of deniedRoles) {
    test(`${role} CANNOT validate — route guard + backend both deny`, async ({ page }) => {
      await loginAs(page, role);

      // Layer 1a: the pending-validation queue itself is route-guarded.
      await page.goto('/pathologist');
      await expect(page).toHaveURL(/\/403/, { timeout: 15_000 });

      // Layer 1b: the validate screen for a specific order-test is
      // independently route-guarded (permissionGuard runs before the
      // component even fetches the queue) — a fake id is enough since the
      // guard never gets far enough to look the id up.
      await page.goto(`/pathologist/validate/${FAKE_ORDER_TEST_ID}`);
      await expect(page).toHaveURL(/\/403/, { timeout: 15_000 });

      // Layer 2: the backend's own gate — POST straight to the API with
      // this role's real bearer token, bypassing the Angular UI entirely.
      // PermissionCheckMiddleware 403s purely on the caller's permission
      // set, before the order-test id is ever resolved, so the fake id is
      // fine here too.
      const token = await accessToken(page);
      const resp = await page.request.post(
        `${MW_ORIGIN}/api/validation/${FAKE_ORDER_TEST_ID}/validate`,
        { headers: { Authorization: `Bearer ${token}` }, data: { note: null } },
      );
      expect(resp.status()).toBe(403);
      const body = await resp.json().catch(() => null);
      if (body) expect(body.success).toBe(false);
    });
  }
});
