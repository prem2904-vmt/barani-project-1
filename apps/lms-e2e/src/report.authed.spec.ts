import { test, expect, type Page } from '@playwright/test';
import { registerPatient, createOrder, collectSample, enterResult } from './support/flows';

/**
 * Stage 5 (final) of the clinical flow — validate an entered result and
 * generate/view its report. Register → order → collect → enter result are
 * stages 1-4 (support/flows.ts); this spec drives them fresh each run so it
 * starts from a clean, deterministic "entered" order-test with no leftover
 * state from other runs, then:
 *
 *  1. Pathologist sign-off — POST /api/validation/{orderTestId}/validate
 *     (ValidationController → ResultService.ValidateAsync). This is the
 *     app's real finalize step: it flips the order-test 'entered' →
 *     'validated' and — server-side, synchronously, inside the same request
 *     — auto-generates the order's FINAL report
 *     (ResultService.TryAutoGenerateFinalReportAsync), the app's own "no one
 *     has to click Generate" behaviour, not a test-only shortcut.
 *
 *  2. Reading the generated report back through the patient's own "Lab
 *     Orders" tab (patient-profile → lab-orders.component.ts): the order
 *     card's test row renders the validated value straight off the server's
 *     OrderTestEntity.currentResult, and its "View report" button fetches
 *     GET /api/reports/by-order/{orderId} and renders the exact PDF the
 *     download/WhatsApp paths would send (client-side jsPDF build + pdf.js
 *     canvas paint — shared/utils/report-pdf.ts + pdf-canvas.component.ts).
 *
 * BIO108 (like every seeded catalogue test) is "direct flow": ResultService.
 * EnterAsync auto-validates a direct-flow test the moment it's submitted
 * (`t.Status = (test.Flow == "direct" && !requireValidation) ? "validated"
 * : "entered"`), UNLESS the branch's "Require validation for all results"
 * lab setting is on (admin/lab-settings → BranchLabConfig.
 * RequireValidationForAllResults) — confirmed empirically: with the setting
 * off, /pathologist/validate/{id} reports "Order test not found in the
 * validation queue" because ListForValidationAsync only lists 'entered'
 * rows, and an auto-validated test never passes through that state. To
 * exercise the real pathologist-validate screen/API (not just the
 * auto-validate side effect of submitting a result), this spec flips that
 * real, first-class app setting on for the duration of the test — via the
 * same toggle a lab admin uses — and restores it afterwards so it doesn't
 * leak into other runs or the tenant's normal (default-off) behaviour.
 *
 * Assertions are anchored on the real server responses (the setting-toggle
 * PATCH, the validate POST, the by-order GET) plus the DOM state changes
 * they drive — not on "no error".
 */

/** Read/set the branch's "Require validation for all results" lab setting
 *  via its real admin UI (admin/lab-settings.component.ts::setRequireValidation).
 *  Trusts the PATCH /api/tenants/branch-lab-config response BODY (the
 *  server's persisted BranchLabConfigEntity) as the source of truth rather
 *  than the live checkbox DOM: the page also fires its own ngOnInit GET on
 *  the same config, and if THAT resolves after our PATCH it silently
 *  reverts the on-screen toggle back to the stale pre-PATCH value — a UI
 *  race, not a persistence failure — so asserting on the DOM is flaky. */
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

  // New design: the setting sits on the "Rules & gates" tab as a
  // role="switch" button whose aria-checked mirrors the server value. The
  // page fires a second config GET of its own, so wait for the switch to
  // show the server truth read above before acting on it.
  await page.getByRole('radio', { name: 'Rules & gates' }).click();
  const toggle = page.getByRole('switch', { name: 'Require validation for all results' });
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  await expect(toggle).toHaveAttribute('aria-checked', String(current), { timeout: 10_000 });

  const [patchResponse] = await Promise.all([
    page.waitForResponse(
      r => /\/api\/tenants\/branch-lab-config$/i.test(r.url()) && r.request().method() === 'PATCH',
    ),
    toggle.click(),
  ]);
  expect(patchResponse.ok()).toBe(true);
  const patchJson = await patchResponse.json();
  expect(patchJson.success).toBe(true);
  expect(patchJson.data?.requireValidationForAllResults).toBe(on);
}

test.describe('Generate report', () => {
  test('validates an entered result and generates the final report', async ({ page }) => {
    // Force direct-flow BIO108 to land in 'entered' (awaiting validation)
    // instead of auto-validating on submit, so the pathologist validate
    // screen/API is genuinely exercised — always restored in `finally`
    // below, even if this setup step itself throws.
    try {
      await setRequireValidationForAllResults(page, true);
      const patient = await registerPatient(page);
      const order = await createOrder(page, patient);
      const sample = await collectSample(page, order.orderId);
      const result = await enterResult(page, order, sample);
      expect(result.status).toBe('entered');

      // ── Validate (pathologist sign-off — the real finalize step) ────────
      await page.goto(`/pathologist/validate/${result.orderTestId}`);

      // The screen loads the order-test off /api/validation/queue?mine=false
      // and only renders the sticky validate bar once it resolves.
      const validateBtn = page.getByRole('button', { name: /^validate/i });
      await expect(validateBtn).toBeVisible({ timeout: 15_000 });
      await expect(validateBtn).toBeEnabled();

      const [validateResponse] = await Promise.all([
        page.waitForResponse(
          r => new RegExp(`/api/validation/${result.orderTestId}/validate$`, 'i').test(r.url())
            && r.request().method() === 'POST',
        ),
        // KNOWN LAYOUT ISSUE (on origin/main too, 2026-11-01): at 1440×900 the
        // validate action bar sits under the bottom nav, so a pointer click is
        // intercepted — dispatch the click on the button itself.
        validateBtn.dispatchEvent('click'),
      ]);
      expect(validateResponse.ok()).toBe(true);
      const validateJson = await validateResponse.json();
      expect(validateJson.success).toBe(true);
      expect(validateJson.data?.id).toBe(result.orderTestId);
      expect(validateJson.data?.status).toBe('validated');

      // Real state change: validate() navigates back to the pathologist
      // landing (pending-validation queue) — the app's own navigation.
      await page.waitForURL(/\/pathologist$/i, { timeout: 10_000 });

      // ── Reach the report via the patient's order detail ────────────────
      // New design: the profile has no Lab Orders tab; an order opens as a
      // detail card (the timeline row, or the `?order=<id>` deep link).
      await page.goto(`/frontdesk/patients/${patient.patientId}?order=${order.orderId}`);
      const card = page.locator('.pf-lo-detail');
      await expect(card).toBeVisible({ timeout: 20_000 });

      // The test's result renders inline, parsed straight off the server's
      // OrderTest.currentResult — a second, independent read of the value.
      await expect(card).toContainText(result.testName, { timeout: 10_000 });
      await expect(card.locator('.pf-lo-res')).toContainText(result.value);

      // ── Generate/view the final report ───────────────────────────────
      const viewReportBtn = card.locator('.pf-lo-act--report');
      const [reportResponse] = await Promise.all([
        page.waitForResponse(
          r => new RegExp(`/api/reports/by-order/${order.orderId}`, 'i').test(r.url())
            && r.request().method() === 'GET',
        ),
        viewReportBtn.click(),
      ]);
      expect(reportResponse.ok()).toBe(true);
      const reportJson = await reportResponse.json();
      expect(reportJson.success).toBe(true);
      const report = reportJson.data;
      expect(report).toBeTruthy();
      // Auto-generated by ValidateAsync the moment every test on the order
      // signed off — a real "final" report, not a preliminary/partial one.
      expect(report.type).toBe('final');
      expect((report.orderId as string).toLowerCase()).toBe(order.orderId.toLowerCase());

      // The report's own snapshot (frozen at generation time) carries the
      // patient + the exact validated value — the artifact the PDF is built
      // from, independent of the DOM read above.
      const snapshot = JSON.parse(report.data ?? '{}');
      expect(snapshot.patient?.displayName).toContain(patient.firstName);
      const reportedTest = (snapshot.tests ?? []).find((t: { name?: string }) => t.name === result.testName);
      expect(reportedTest).toBeTruthy();
      expect(reportedTest.status).toBe('validated');
      // BIO108 has exactly one parameter (named after the test itself); the
      // backend's Newtonsoft camelCase resolver also camelCases DICTIONARY
      // keys, so the values map is keyed "alkaline Phosphatase" (lowercased
      // first letter), not the exact "Alkaline Phosphatase" — read the
      // single entry directly rather than depending on that transform.
      const reportedValues = Object.values(reportedTest.result?.values ?? {}) as Array<{ value?: unknown; flag?: string }>;
      expect(reportedValues).toHaveLength(1);
      expect(String(reportedValues[0]?.value)).toBe(result.value);
      // 85 sits inside BIO108's 40-129 reference band — the report's own
      // (re-derived) flagging independently agrees it's Normal.
      expect(reportedValues[0]?.flag).toBe('N');

      // Real state change: the fetched report actually renders as a PDF
      // (client-side jsPDF build, then painted page-by-page onto canvases
      // by pdf.js — shared/utils/report-pdf.ts + pdf-canvas.component.ts),
      // not just a successfully-fetched blob nobody looked at.
      await expect(card.locator('.pf-pdfc canvas').first()).toBeVisible({ timeout: 20_000 });
    } finally {
      // Never leave the branch permanently requiring validation because of
      // this test — restore the tenant's default (direct-flow auto-validate).
      await setRequireValidationForAllResults(page, false);
    }
  });
});
