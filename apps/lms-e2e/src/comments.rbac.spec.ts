import { test, expect, type Page } from '@playwright/test';
import { loginAs, type RoleKey } from './support/auth';
import { registerPatient, createOrder, collectSample, enterResult } from './support/flows';

/**
 * RBAC — RESULT/ORDER-TEST COMMENTS (validator ↔ tech conversation).
 *
 * DISCOVERY: there is no dedicated "comment" permission. CommentsController
 * (prefrontal-mw/Prefrontal/Controllers/CommentsController.cs) gates every
 * route — GET .../results/{id}/comments, GET .../samples/{id}/comments,
 * POST .../results/{id}/comments, POST .../comments/{id}/resolve — with
 * the SAME class-free, per-action attribute:
 *
 *     [RequirePermission("enter_result", "validate_result")]
 *
 * RequirePermissionAttribute is OR-semantics (any listed code is enough —
 * see its own doc comment) and PermissionCheckMiddleware 403s BEFORE the
 * action runs (before any DB lookup), so the gate is purely role-driven.
 *
 * Per RoleSeeder.cs:
 *   - enter_result    → Lab Technician, Lab Admin
 *   - validate_result → Pathologist, Lab Admin
 *   - Sample Collector, Branch Manager, Receptionist → NEITHER code
 *
 * So the REAL policy is: comments are NOT gated behind a distinct
 * "can comment" permission and are NOT simply "anyone who can view the
 * order" either — they're scoped to exactly the two roles that own the
 * result lifecycle (the tech who enters it, the validator who signs it
 * off), matching the feature's own intent (comment-thread.component.ts:
 * "Reusable conversation thread between validator and tech"). Lab Admin
 * gets in via the `*` wildcard AND via holding both codes directly.
 * CommentService.AddAsync resolves the caller's authorRole server-side
 * from validate_result (→ "validator") else "tech" — never trusts the
 * client — so Lab Admin's own comments post as "validator".
 *
 * This spec asserts that ACTUAL policy:
 *  1. Two DIFFERENT roles (Lab Technician via enter_result, Pathologist via
 *     validate_result) can both add a comment on the SAME order-test AND
 *     see each other's message — proving it's a genuinely shared,
 *     cross-role thread, not a role-private note. Lab Admin is included as
 *     a direct-backend check (both codes + wildcard).
 *  2. Roles holding NEITHER code (Sample Collector, Branch Manager) are
 *     403'd by the backend on every comment route — the real gate,
 *     independent of and in addition to the route guards on
 *     /lab/sample/:id and /pathologist/validate/:id already proven by
 *     result-gating.rbac.spec.ts and validate-gating.rbac.spec.ts (a role
 *     that can't reach either screen has no UI path to comment anyway).
 */

const MW_ORIGIN = 'http://localhost:5270';

/** Read/set the branch's "Require validation for all results" lab setting.
 *  Duplicated from validate-gating.rbac.spec.ts (not exported anywhere,
 *  and this spec must only touch its own file) — needed so the fixture
 *  order-test stays 'entered' (not auto-validated) long enough for the
 *  pathologist to open /pathologist/validate/:id and read/reply to it. */
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

/** Pull the bearer token straight out of the app's persisted session
 *  (AuthService.SESSION_KEY = 'pf.session') — duplicated from
 *  validate-gating.rbac.spec.ts / result-gating.rbac.spec.ts's own pattern
 *  — so we can hit the mw API directly under a specific role's real token,
 *  bypassing the Angular UI/interceptor to prove the BACKEND'S OWN gate. */
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

const TEST_CODE = 'BIO108';
const TEST_NAME = 'Alkaline Phosphatase';

/** A syntactically-valid GUID that will never resolve to a real order-test
 *  / sample. Fine for the negative checks — PermissionCheckMiddleware 403s
 *  purely on the caller's permission set, before the id is ever looked up
 *  (see CommentsController's [RequirePermission] + the middleware's own
 *  doc comment), so no real fixture is needed. */
const FAKE_ID = '00000000-0000-0000-0000-000000000000';

test.describe('Comments RBAC — enter_result OR validate_result (no dedicated comment permission)', () => {
  test('Lab Technician and Pathologist share ONE comment thread on the same order-test — both can add and see each other\'s message; Lab Admin also gets in (both codes + wildcard)', async ({ page }) => {
    test.setTimeout(120_000);

    await loginAs(page, 'admin');
    try {
      // Keep the fixture 'entered' (not auto-validated) so the pathologist
      // still finds it in the pending-validation queue.
      await setRequireValidationForAllResults(page, true);

      const patient = await registerPatient(page);
      const order = await createOrder(page, patient, TEST_CODE, TEST_NAME);
      const sample = await collectSample(page, order.orderId);
      const result = await enterResult(page, order, sample, TEST_CODE, TEST_NAME);
      expect(result.status).toBe('entered');
      const orderTestId = result.orderTestId;

      // ── Lab Admin direct-backend check (still logged in as admin) ──
      // Lab Admin holds BOTH enter_result and validate_result directly
      // (RoleSeeder.cs) AND the '*' wildcard — either is enough per
      // PermissionCheckMiddleware. CommentService resolves the caller's
      // authorRole server-side from validate_result, so admin's own post
      // lands as "validator" regardless of the commentType it requests.
      const adminToken = await accessToken(page);
      const adminGet = await page.request.get(
        `${MW_ORIGIN}/api/results/${orderTestId}/comments`,
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      expect(adminGet.ok()).toBe(true);
      const adminGetJson = await adminGet.json();
      expect(adminGetJson.success).toBe(true);
      expect(Array.isArray(adminGetJson.data)).toBe(true);
      expect(adminGetJson.data.length).toBe(0); // nothing posted yet

      const adminPost = await page.request.post(
        `${MW_ORIGIN}/api/results/${orderTestId}/comments`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: { parameterName: null, parentId: null, commentType: 'observation', body: 'Admin QA check-in' },
        },
      );
      expect(adminPost.ok()).toBe(true);
      const adminPostJson = await adminPost.json();
      expect(adminPostJson.success).toBe(true);
      expect(adminPostJson.data?.authorRole).toBe('validator'); // Lab Admin holds validate_result
      expect(adminPostJson.data?.body).toBe('Admin QA check-in');

      // ── Lab Technician: add a real UI comment via enter_result ──────
      await loginAs(page, 'labTech');
      await page.goto(`/lab/sample/${sample.sampleId}`);
      await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);
      await expect(page.locator('.pf-sre__title')).toHaveText(sample.barcode || /.+/, { timeout: 30_000 });

      // Open the per-test overall-comment thread via its note pencil.
      const noteBtn = page.locator('.pf-sre__gnote');
      await expect(noteBtn).toBeVisible({ timeout: 20_000 });
      await noteBtn.click();

      const addBtn = page.getByRole('button', { name: /add overall observation/i });
      await expect(addBtn).toBeVisible({ timeout: 10_000 });
      await addBtn.click();

      const techBody = `Tech note ${Date.now()}`;
      await page.locator('.pf-ct__textarea').fill(techBody);

      const [techPostResp] = await Promise.all([
        page.waitForResponse(
          r => new RegExp(`/api/results/${orderTestId}/comments$`, 'i').test(r.url())
            && r.request().method() === 'POST',
        ),
        page.getByRole('button', { name: /^post observation$/i }).click(),
      ]);
      expect(techPostResp.ok()).toBe(true);
      const techPostJson = await techPostResp.json();
      expect(techPostJson.success).toBe(true);
      expect(techPostJson.data?.authorRole).toBe('tech');
      expect(techPostJson.data?.commentType).toBe('observation');

      // Real state change: the tech's own message renders in the thread.
      await expect(page.locator('.pf-ct__body', { hasText: techBody })).toBeVisible({ timeout: 10_000 });
      // ...and so does admin's earlier message — same shared thread.
      await expect(page.locator('.pf-ct__body', { hasText: 'Admin QA check-in' })).toBeVisible({ timeout: 10_000 });

      // ── Pathologist: reads the SAME thread and replies (correction) ─
      await loginAs(page, 'pathologist');
      const [validateGetResp] = await Promise.all([
        page.waitForResponse(
          r => new RegExp(`/api/results/${orderTestId}/comments$`, 'i').test(r.url())
            && r.request().method() === 'GET',
        ),
        page.goto(`/pathologist/validate/${orderTestId}`),
      ]);
      expect(validateGetResp.ok()).toBe(true);
      await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);

      // Cross-role READ: the pathologist's screen renders the tech's and
      // admin's comments, fetched from the SAME backend endpoint.
      await expect(page.locator('.pf-ct__body', { hasText: techBody })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.pf-ct__body', { hasText: 'Admin QA check-in' })).toBeVisible();

      // Cross-role WRITE: reply (not a new root) to the tech's thread —
      // proves a real threaded conversation, not just two independent
      // role-private notes. validate-result.component's replyToOverall()
      // requests commentType 'correction', but CommentService.AddAsync
      // IGNORES the requested type for replies and inherits the ROOT
      // thread's type instead (root here is the tech's 'observation') —
      // "a tech replying to a validator's correction stays in the
      // correction thread" applies symmetrically to a validator replying
      // to a tech's observation.
      const techThread = page.locator('.pf-ct__thread', { hasText: techBody });
      await techThread.getByRole('button', { name: /^reply$/i }).click();
      const replyBody = `Validator reply ${Date.now()}`;
      await techThread.locator('.pf-ct__composer--reply .pf-ct__textarea').fill(replyBody);

      const [replyResp] = await Promise.all([
        page.waitForResponse(
          r => new RegExp(`/api/results/${orderTestId}/comments$`, 'i').test(r.url())
            && r.request().method() === 'POST',
        ),
        techThread.getByRole('button', { name: /^send reply$/i }).click(),
      ]);
      expect(replyResp.ok()).toBe(true);
      const replyJson = await replyResp.json();
      expect(replyJson.success).toBe(true);
      expect(replyJson.data?.authorRole).toBe('validator');
      expect(replyJson.data?.commentType).toBe('observation'); // inherits the ROOT's type, not the request's
      expect(replyJson.data?.parentId).toBeTruthy(); // a real reply, not a new root

      await expect(page.locator('.pf-ct__body', { hasText: replyBody })).toBeVisible({ timeout: 10_000 });

      // ── Full round trip: fetch the thread with the TECH's own token and
      // confirm all three messages (admin, tech, pathologist) are there —
      // one genuinely shared thread, readable/writable by every role that
      // holds either enter_result or validate_result. ──
      await loginAs(page, 'labTech');
      const finalToken = await accessToken(page);
      const finalGet = await page.request.get(
        `${MW_ORIGIN}/api/results/${orderTestId}/comments`,
        { headers: { Authorization: `Bearer ${finalToken}` } },
      );
      expect(finalGet.ok()).toBe(true);
      const finalJson = await finalGet.json();
      const bodies = (finalJson.data ?? []).map((c: { body: string }) => c.body);
      expect(bodies).toEqual(expect.arrayContaining(['Admin QA check-in', techBody, replyBody]));
      const roles = (finalJson.data ?? []).map((c: { authorRole: string }) => c.authorRole);
      expect(roles).toEqual(expect.arrayContaining(['validator', 'tech', 'validator']));
    } finally {
      await loginAs(page, 'admin');
      await setRequireValidationForAllResults(page, false);
    }
  });

  // ── Roles holding NEITHER enter_result NOR validate_result ──────────
  // Sample Collector and Branch Manager are blocked on every comment
  // route by the backend itself — independent of (and in addition to) the
  // route guards on /lab/sample/:id and /pathologist/validate/:id already
  // proven by result-gating.rbac.spec.ts / validate-gating.rbac.spec.ts.
  const deniedRoles: RoleKey[] = ['sampleCollector', 'manager'];

  for (const role of deniedRoles) {
    test(`${role} (no enter_result, no validate_result) is 403'd on every comment route`, async ({ page }) => {
      await loginAs(page, role);
      const token = await accessToken(page);
      const headers = { Authorization: `Bearer ${token}` };

      const listByTest = await page.request.get(`${MW_ORIGIN}/api/results/${FAKE_ID}/comments`, { headers });
      expect(listByTest.status()).toBe(403);
      const listByTestJson = await listByTest.json().catch(() => null);
      if (listByTestJson) expect(listByTestJson.success).toBe(false);

      const listBySample = await page.request.get(`${MW_ORIGIN}/api/samples/${FAKE_ID}/comments`, { headers });
      expect(listBySample.status()).toBe(403);

      const add = await page.request.post(`${MW_ORIGIN}/api/results/${FAKE_ID}/comments`, {
        headers,
        data: { parameterName: null, parentId: null, commentType: 'observation', body: 'should never persist' },
      });
      expect(add.status()).toBe(403);
      const addJson = await add.json().catch(() => null);
      if (addJson) expect(addJson.success).toBe(false);

      const resolve = await page.request.post(`${MW_ORIGIN}/api/comments/${FAKE_ID}/resolve`, { headers });
      expect(resolve.status()).toBe(403);
    });
  }
});
