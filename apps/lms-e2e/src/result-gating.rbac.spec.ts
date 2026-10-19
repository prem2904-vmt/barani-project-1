import { test, expect, type Browser, type Page } from '@playwright/test';
import { registerPatient, createOrder, collectSample, type PlacedOrder } from './support/flows';
import { loginAs, type RoleKey } from './support/auth';

/**
 * RBAC gate on RESULT ENTRY.
 *
 * mw RoleSeeder awards `enter_result` to Lab Technician + Lab Admin ONLY.
 * Sample Collector, Pathologist and Branch Manager do NOT hold it —
 * Pathologist specifically holds `edit_result` + `validate_result` (for
 * re-opening/validating an ALREADY-entered result) but must not be able to
 * perform the INITIAL entry on a freshly-received, never-entered sample.
 *
 * The gate has two layers in the LMS UI, both exercised here:
 *   1. Route guard — `lab/sample/:sampleId` is
 *      `permissionGuard(['enter_result', 'edit_result'])` (app.routes.ts),
 *      which is OR-semantics: holding EITHER permission admits the route.
 *      So Pathologist (edit_result, no enter_result) is NOT bounced to
 *      /403 — only Sample Collector and Branch Manager (neither permission)
 *      are.
 *   2. The "Submit All Results" affordance itself
 *      (SampleResultEntryComponent.hasWritable()) is gated ONLY on test
 *      STATUS (not yet entered/validated/rejected) — it does not re-check
 *      `enter_result`. So on a writable (received, never-entered) sample,
 *      a Pathologist who reached the route via edit_result sees an
 *      ENABLED Submit button too.
 *      The real backstop is the backend: `POST /api/samples/{id}/results`
 *      and `.../results/draft` both carry
 *      `[RequirePermission("enter_result")]` (SamplesController.cs), so a
 *      submit attempt from a role without enter_result 403s server-side
 *      even though the client-side control looked enabled.
 *
 * This spec asserts BOTH real gates directly:
 *   - Sample Collector / Branch Manager: blocked at the ROUTE (redirected
 *     to /403, entry UI never renders).
 *   - Pathologist: NOT blocked at the route, DOES see an enabled submit
 *     control (documented as a UI leak below), but a submit attempt is
 *     rejected by the backend with 403 and the result does NOT persist.
 *   - Lab Technician / Lab Admin: reach the screen and a submit succeeds
 *     end-to-end (200, value persisted).
 */

const TEST_CODE = 'BIO108';
const TEST_NAME = 'Alkaline Phosphatase';
const VALUE = '85';

interface ReceivedSample {
  sampleId: string;
  barcode: string;
  orderId: string;
}

/** Carry a fresh patient/order through register → order → collect →
 *  dispatch → receive (as ADMIN, who holds every permission needed for
 *  front-desk + lab-intake actions) so callers land on a "received",
 *  never-entered, writable sample. Mirrors support/flows.ts's own
 *  dispatch/receive block (flows.enterResult) but stops short of
 *  submitting a result, since THAT is exactly what each role test needs
 *  to attempt for itself. */
async function setupReceivedSample(browser: Browser): Promise<ReceivedSample> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, 'admin');
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient, TEST_CODE, TEST_NAME);
    const sample = await collectSample(page, order.orderId);
    await dispatchAndReceive(page, order);
    return { sampleId: sample.sampleId, barcode: sample.barcode, orderId: order.orderId };
  } finally {
    await context.close();
  }
}

/** Front-desk → lab-intake handoff (dispatch + mark arrived), extracted
 *  from flows.enterResult's own dispatch/receive block so this spec can
 *  stop right at "received" without also submitting a result. */
async function dispatchAndReceive(page: Page, order: PlacedOrder): Promise<void> {
  const dispatchBtn = page.getByRole('button', { name: /^dispatch$/i });
  await expect(dispatchBtn).toBeVisible({ timeout: 20_000 });
  const [dispatchResponse] = await Promise.all([
    page.waitForResponse(
      r => /\/api\/orders\/[0-9a-f-]{36}\/dispatch$/i.test(r.url()) && r.request().method() === 'PATCH',
    ),
    dispatchBtn.click(),
  ]);
  expect(dispatchResponse.ok()).toBe(true);

  await page.goto('/lab/receive');
  const row = page.locator('li', { hasText: order.orderId.slice(0, 8) });
  await expect(row).toBeVisible({ timeout: 30_000 });
  const [arriveResponse] = await Promise.all([
    page.waitForResponse(
      r => /\/api\/orders\/[0-9a-f-]{36}\/arrive/i.test(r.url()) && r.request().method() === 'PATCH',
    ),
    row.getByRole('button', { name: /mark arrived/i }).click(),
  ]);
  expect(arriveResponse.ok()).toBe(true);
}

/** Sign in as `role` in a fresh, isolated context/page and navigate to the
 *  sample's result-entry screen. Caller is responsible for closing the
 *  returned context. */
async function openResultEntryAs(
  browser: Browser,
  role: RoleKey,
  sampleId: string,
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, role);
  await page.goto(`/lab/sample/${sampleId}`);
  return { context, page };
}

test.describe('Result-entry RBAC gating (enter_result)', () => {
  // ── Roles WITHOUT enter_result AND WITHOUT edit_result: blocked at the
  // route guard entirely. Both can safely share one sample — neither can
  // touch it, so there's nothing to isolate between them.
  test.describe('blocked at the route (no enter_result, no edit_result)', () => {
    let sample: ReceivedSample;

    test.beforeAll(async ({ browser }) => {
      sample = await setupReceivedSample(browser);
    });

    for (const role of ['sampleCollector', 'manager'] as const) {
      test(`${role} is redirected to /403 and never sees the result-entry screen`, async ({ browser }) => {
        const { context, page } = await openResultEntryAs(browser, role, sample.sampleId);
        try {
          await expect(page).toHaveURL(/\/403(\/|$|\?)/, { timeout: 15_000 });
          // The result-entry chrome (title, submit control) must never mount.
          await expect(page.locator('.pf-sre__title')).toHaveCount(0);
          await expect(page.getByRole('button', { name: /submit all results/i })).toHaveCount(0);
        } finally {
          await context.close();
        }
      });
    }
  });

  // ── Pathologist: holds edit_result (+ validate_result) but NOT
  // enter_result. The route's OR-semantics guard admits them, and the
  // component's writable-check doesn't re-verify enter_result either — so
  // the client-side UI is NOT the real gate here. Assert the actual
  // backstop: the submit POST is rejected server-side and nothing persists.
  test('pathologist reaches the screen (edit_result) but a real submit is rejected server-side (no enter_result)', async ({ browser }) => {
    const sample = await setupReceivedSample(browser);
    const { context, page } = await openResultEntryAs(browser, 'pathologist', sample.sampleId);
    try {
      // Not bounced to /403 — edit_result satisfies the OR-permission route guard.
      await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);
      await expect(page.locator('.pf-sre__title')).toHaveText(sample.barcode || /.+/, { timeout: 20_000 });

      const paramRow = page.locator('tr.pf-sre__grow', { hasText: TEST_NAME });
      await expect(paramRow).toBeVisible({ timeout: 20_000 });
      const input = paramRow.locator('input.pf-sre__ginput--num');
      await input.fill(VALUE);

      // FINDING: the submit control renders ENABLED for a pathologist on a
      // writable (never-entered) sample — hasWritable() only checks test
      // status, not enter_result. This is a client-side affordance leak:
      // a role without enter_result is shown a live "Submit All Results"
      // button for INITIAL entry (not just editing an already-entered
      // result, which edit_result legitimately covers).
      const submitBtn = page.getByRole('button', { name: /submit all results/i });
      await expect(submitBtn).toBeEnabled();

      // The real gate: backend 403s the submit. SamplesController's
      // POST {id}/results carries [RequirePermission("enter_result")].
      const [submitResponse] = await Promise.all([
        page.waitForResponse(r => /\/api\/samples\/[0-9a-f-]{36}\/results$/i.test(r.url()) && r.request().method() === 'POST'),
        submitBtn.click(),
      ]);
      expect(submitResponse.status()).toBe(403);
      expect(submitResponse.ok()).toBe(false);

      // Confirm nothing persisted: re-fetch the sample fresh and the test
      // must still be in its pre-submit (not entered/validated) state.
      const refetch = await page.request.get(`/api/samples/${sample.sampleId}/tests`, {
        headers: { Accept: 'application/json' },
      });
      const body = await refetch.json().catch(() => ({}));
      const tests = (body?.data ?? body)?.tests ?? [];
      const submittedTest = tests.find((t: { test?: { testCode?: string } }) => t.test?.testCode === TEST_CODE);
      expect(['entered', 'validated']).not.toContain(submittedTest?.status);
    } finally {
      await context.close();
    }
  });

  // ── Roles WITH enter_result: full end-to-end submit must succeed.
  for (const role of ['labTech', 'admin'] as const) {
    test(`${role} CAN enter and submit a result end-to-end`, async ({ browser }) => {
      const sample = await setupReceivedSample(browser);
      const { context, page } = await openResultEntryAs(browser, role, sample.sampleId);
      try {
        await expect(page).not.toHaveURL(/\/403(\/|$|\?)/);
        await expect(page.locator('.pf-sre__title')).toHaveText(sample.barcode || /.+/, { timeout: 20_000 });

        const paramRow = page.locator('tr.pf-sre__grow', { hasText: TEST_NAME });
        await expect(paramRow).toBeVisible({ timeout: 20_000 });
        const input = paramRow.locator('input.pf-sre__ginput--num');
        await input.fill(VALUE);
        await expect(input).toHaveValue(VALUE);

        const submitBtn = page.getByRole('button', { name: /submit all results/i });
        await expect(submitBtn).toBeEnabled();

        const [submitResponse] = await Promise.all([
          page.waitForResponse(r => /\/api\/samples\/[0-9a-f-]{36}\/results$/i.test(r.url()) && r.request().method() === 'POST'),
          submitBtn.click(),
        ]);
        expect(submitResponse.ok()).toBe(true);
        const submitBody = (await submitResponse.json())?.data ?? {};
        expect(submitBody.submitted).toBe(1);

        const submittedTest = submitBody.sample?.tests?.find(
          (t: { test?: { testCode?: string } }) => t.test?.testCode === TEST_CODE,
        );
        expect(['entered', 'validated']).toContain(submittedTest?.status);

        // Real navigation back to My Work confirms the app itself treated
        // this as a completed, accepted submission.
        await page.waitForURL(/\/lab\/my-work$/i, { timeout: 20_000 });
      } finally {
        await context.close();
      }
    });
  }
});
