import { test, expect } from '@playwright/test';
import { registerPatient, createOrder, collectSample } from './support/flows';

/**
 * Stage 4 of the clinical flow — enter a result for a collected sample.
 *
 * Each run registers a brand-new patient, places a fresh order and collects
 * its (single) BIO108 — Alkaline Phosphatase — tube (stages 1-3, via
 * support/flows.ts), so this spec starts from a clean, deterministic
 * "collected" sample with no leftover state from other runs.
 *
 * A collected tube isn't enterable yet: the active process workflow for
 * Micro World ("Without Collection Center") has BOTH `lab_intake` and
 * `dispatch` enabled, so ProcessWorkflowService.dispatchStepEnabled() is
 * true and the sample must travel collected → dispatched → received before
 * /lab/sample/:id will let a tech submit a value (verified empirically:
 * the sample-collection drawer's own "Dispatch" button — visible once
 * every vial is drawn — PATCHes /api/orders/{orderId}/dispatch, and the lab
 * intake queue's "Mark Arrived" button PATCHes /api/orders/{orderId}/arrive,
 * which the app now flips straight from dispatched to received, no
 * intermediate in_transit step). Both are real, first-class app actions —
 * not a test-only bypass — so the spec drives them for real before touching
 * result entry.
 *
 * Result entry itself is the sample-level screen (Fix 6 — one barcode scan
 * loads every test on the tube): SampleResultEntryComponent at
 * /lab/sample/:sampleId (my-work.component.ts::enter() is the app's own
 * router.navigate(['/lab/sample', sid]) for a tube). BIO108 has exactly one
 * numeric parameter named after the test itself ("Alkaline Phosphatase",
 * reference range 40-129 U/L), so with a single test on the tube it renders
 * as ONE flat grid row (entryBlocks() puts single-parameter, non-culture
 * tests in the "loose" flat block) — the value input is
 * `input.pf-sre__ginput--num` inside that row.
 */

test.describe('Enter result', () => {
  test('submits and persists a numeric result for a received sample', async ({ page }) => {
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient);
    const sample = await collectSample(page, order.orderId);

    // ── Dispatch (front desk → lab handoff) ───────────────────────────
    // Still sitting in the collect drawer (collectSample leaves it open);
    // every vial is drawn, so the drawer's own "Dispatch" button is live.
    const dispatchBtn = page.getByRole('button', { name: /^dispatch$/i });
    await expect(dispatchBtn).toBeVisible({ timeout: 10_000 });
    const [dispatchResponse] = await Promise.all([
      page.waitForResponse(
        r => /\/api\/orders\/[0-9a-f-]{36}\/dispatch$/i.test(r.url()) && r.request().method() === 'PATCH',
      ),
      dispatchBtn.click(),
    ]);
    expect(dispatchResponse.ok()).toBe(true);
    const dispatchBody = (await dispatchResponse.json())?.data ?? {};
    expect(dispatchBody.dispatched).toBe(1);

    // ── Mark arrived (lab intake receives the tube, TAT starts) ───────
    await page.goto('/lab/receive');
    const row = page.locator('li', { hasText: order.orderId.slice(0, 8) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    const [arriveResponse] = await Promise.all([
      page.waitForResponse(
        r => /\/api\/orders\/[0-9a-f-]{36}\/arrive/i.test(r.url()) && r.request().method() === 'PATCH',
      ),
      row.getByRole('button', { name: /mark arrived/i }).click(),
    ]);
    expect(arriveResponse.ok()).toBe(true);
    const arriveBody = (await arriveResponse.json())?.data ?? {};
    expect(arriveBody.arrived).toBe(1);

    // ── Enter the result ───────────────────────────────────────────────
    await page.goto(`/lab/sample/${sample.sampleId}`);
    await expect(page.locator('.pf-sre__title')).toHaveText(sample.barcode || /.+/, { timeout: 15_000 });

    const paramRow = page.locator('tr.pf-sre__grow', { hasText: 'Alkaline Phosphatase' });
    await expect(paramRow).toBeVisible({ timeout: 10_000 });
    const input = paramRow.locator('input.pf-sre__ginput--num');

    // 85 U/L sits inside BIO108's 40-129 reference band — a normal,
    // in-range value.
    await input.fill('85');
    await expect(input).toHaveValue('85');

    const submitBtn = page.getByRole('button', { name: /submit all results/i });
    await expect(submitBtn).toBeEnabled();

    // Real outcome: the bulk-submit POST must succeed server-side, not just
    // flip the UI optimistically — capture and inspect its actual payload.
    const [submitResponse] = await Promise.all([
      page.waitForResponse(
        r => /\/api\/samples\/[0-9a-f-]{36}\/results$/i.test(r.url()) && r.request().method() === 'POST',
      ),
      submitBtn.click(),
    ]);
    expect(submitResponse.ok()).toBe(true);
    const submitBody = (await submitResponse.json())?.data ?? {};
    expect(submitBody.submitted).toBe(1);

    const submittedTest = submitBody.sample?.tests?.find(
      (t: { test?: { testCode?: string } }) => t.test?.testCode === 'BIO108',
    );
    expect(['entered', 'validated']).toContain(submittedTest?.status);
    const persistedValues = JSON.parse(submittedTest?.currentResult ?? '{}');
    expect(persistedValues?.values?.['Alkaline Phosphatase']).toBe('85');
    // Backend conditions engine independently confirms 85 reads as Normal
    // against the 40-129 band, and doesn't flag it critical.
    expect(persistedValues?.flagged?.['Alkaline Phosphatase']?.flag).toBe('N');
    expect(submitBody.results?.[0]?.flags?.critical).toBe(false);

    // Submitting hands the tech back to My Work — the app's own navigation,
    // not something this test forces.
    await page.waitForURL(/\/lab\/my-work$/i, { timeout: 10_000 });

    // ── Persistence check: re-open the SAME sample fresh from the server ──
    // (a plain reload risks landing on /lab/my-work instead, since submit
    // navigates away — so re-navigate explicitly and re-fetch from
    // GET /api/samples/{id}/tests rather than trusting client-side state.)
    await page.goto(`/lab/sample/${sample.sampleId}`);
    await expect(page.locator('.pf-sre__title')).toHaveText(sample.barcode || /.+/, { timeout: 15_000 });

    const reloadedRow = page.locator('tr.pf-sre__grow', { hasText: 'Alkaline Phosphatase' });
    await expect(reloadedRow.locator('input.pf-sre__ginput--num')).toHaveValue('85');

    // The row's status dot flips to "done" once the test is entered/validated.
    await expect(reloadedRow.locator('.pf-sre__gdot--done')).toBeVisible();

    // The tube is no longer writable (entered/validated), so the header
    // swaps Submit/Save-draft for the reopen-to-edit action.
    await expect(page.getByRole('button', { name: /^edit result$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /submit all results/i })).toHaveCount(0);
  });
});
