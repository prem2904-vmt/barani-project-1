import { test, expect } from '@playwright/test';
import { registerPatient, createOrder, collectSample, enterResult } from './support/flows';

/**
 * Amend path — correct a result AFTER it has been finalized/reported, and
 * verify the correction is a real, auditable amendment (not a silent
 * overwrite). Register → order → collect → enter result are stages 1-4
 * (support/flows.ts); this spec drives them fresh each run so it starts from
 * a clean, deterministic "reported" order with no leftover state from other
 * runs, then:
 *
 *  1. BIO108 is direct-flow and the branch's "Require validation for all
 *     results" setting is off by default (verified empirically against
 *     GET /api/tenants/branch-lab-config), so ResultService.EnterAsync
 *     auto-validates the submitted result AND — inside the very same
 *     request — auto-generates the order's first FINAL report
 *     (TryAutoGenerateFinalReportAsync). No explicit pathologist-validate
 *     step is needed to reach "reported" (contrast report.authed.spec.ts,
 *     which forces the setting ON to exercise the manual validate screen).
 *
 *  2. The real app correction path is the "Edit result" button on
 *     SampleResultEntryComponent (visible once a tube's tests are
 *     entered/validated — sample-result-entry.component.ts::hasReopenable).
 *     It prompts for a mandatory reason via the app's themed dialog
 *     (DialogService/pf-dialog-host), then calls
 *     POST /api/results/tube/{sampleId}/reopen-mine — ResultService.
 *     ReopenMyTubeAsync, which flips every entered/validated test on the
 *     tube back to 'in_progress' under the SAME tech, clears validation,
 *     and records a "reopened" result version (audit trail) — the same
 *     path exercised whether the correction comes from this tube-level
 *     button or the order-level department picker (edit-result-dialog).
 *
 *  3. Re-submitting the corrected value re-runs EnterAsync, which — being
 *     direct-flow with validation-for-all off — auto-validates again and
 *     re-enters TryAutoGenerateFinalReportAsync. This time a final report
 *     already exists, so instead of generating a first final it calls
 *     ReportService.AmendAsync("Result corrected after report release"):
 *     a NEW report row is created (AmendedBy = the prior report's id,
 *     AmendmentReason = that fixed string — NOT the free-text reason typed
 *     into the reopen dialog, which only lands in the result-version/
 *     activity audit trail), and the PRIOR final is superseded
 *     (SupersededByReportId/-At set on it) — confirmed by reading
 *     ReportService.AmendAsync + ReportRepository.SupersedeReportAsync.
 *
 * Assertions are anchored on real server responses at every step (the
 * reopen POST, the corrected-value submit POST, and TWO independent report
 * reads — the new report via GET /api/reports/by-order/{orderId} and the
 * OLD report via GET /api/reports/{id} showing it now points at the new
 * one) — not on "no error" or UI-only state.
 */

test.describe('Amend a finalized result', () => {
  test('re-opens a reported result, corrects the value, and issues a superseding amended report', async ({ page }) => {
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient);
    const sample = await collectSample(page, order.orderId);
    const result = await enterResult(page, order, sample); // value '85' — in-range (40-129)

    // Direct-flow + validation-for-all off (the tenant default) means the
    // submit above already auto-validated AND auto-generated the first
    // final report server-side — no separate validate step required here.
    expect(result.status).toBe('validated');

    // ── Read the ORIGINAL report — the amend must supersede exactly this row ──
    await page.goto(`/frontdesk/patients/${patient.patientId}`);
    // Clinical-first profile: the PATIENT card's timeline → the order row
    // zooms into the order (tests + results + View report) in the main column.
    const row = page.locator('.pf-tl__row[data-kind="order"]');
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await row.click();
    const card = page.locator('.pf-lo-detail');

    const testRow = card.locator('.pf-lo-test', { hasText: result.testName });
    await expect(testRow).toBeVisible({ timeout: 10_000 });
    await expect(testRow.locator('.pf-lo-res__val')).toContainText('85');

    const viewReportBtn = card.locator('.pf-lo-act--report');
    const [firstReportResponse] = await Promise.all([
      page.waitForResponse(
        r => new RegExp(`/api/reports/by-order/${order.orderId}`, 'i').test(r.url())
          && r.request().method() === 'GET',
      ),
      viewReportBtn.click(),
    ]);
    expect(firstReportResponse.ok()).toBe(true);
    const firstReportJson = await firstReportResponse.json();
    expect(firstReportJson.success).toBe(true);
    const firstReport = firstReportJson.data;
    expect(firstReport?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstReport.type).toBe('final');
    expect(firstReport.amendedBy).toBeFalsy();
    expect(firstReport.supersededByReportId).toBeFalsy();
    const firstSnapshot = JSON.parse(firstReport.data ?? '{}');
    expect(firstSnapshot.amendment).toBeFalsy();
    const firstReportedTest = (firstSnapshot.tests ?? []).find((t: { name?: string }) => t.name === result.testName);
    const firstReportedValues = Object.values(firstReportedTest?.result?.values ?? {}) as Array<{ value?: unknown; flag?: string }>;
    expect(String(firstReportedValues[0]?.value)).toBe('85');
    expect(firstReportedValues[0]?.flag).toBe('N');

    // ── Open the result for correction ("Edit result") ────────────────────
    await page.goto(`/lab/sample/${sample.sampleId}`);
    await expect(page.locator('tr.pf-sre__grow').first()).toBeVisible({ timeout: 15_000 });

    const editResultBtn = page.getByRole('button', { name: /^edit result$/i });
    await expect(editResultBtn).toBeVisible({ timeout: 10_000 });
    // The write path (submit) must not be visible on an already-reported tube.
    // New design keeps the primary in place as a disabled "Submitted".
    const submitPrimary = page.getByRole('button', { name: /^submit (all )?results$/i });
    if (await submitPrimary.count()) await expect(submitPrimary).toBeDisabled();
    await editResultBtn.click();

    // The app's themed prompt dialog (DialogService/pf-dialog-host) —
    // reason is mandatory and is recorded in the audit trail, not on the
    // report (the report's own AmendmentReason is a fixed server string).
    const dialogRoot = page.locator('.pf-dh-root');
    await expect(dialogRoot).toBeVisible({ timeout: 10_000 });
    const reasonInput = dialogRoot.locator('.pf-dh-textarea');
    await reasonInput.fill('Amend: instrument transcription error, re-reading original sample.');

    const confirmBtn = dialogRoot.getByRole('button', { name: /^edit$/i });
    // reopenSample() chains TWO requests off this one click: the reopen-mine
    // POST itself, then (only once that resolves) a GET .../tests refetch
    // whose response repopulates the form's values signal
    // (prefillValues()) — overwriting whatever's in the input at that
    // moment. Both listeners are armed before the click so neither response
    // can slip past unobserved regardless of which settles first; waiting
    // for BOTH before touching the input avoids a real race where typing
    // the corrected value too early gets silently clobbered by that refetch.
    const [reopenResponse, refetchResponse] = await Promise.all([
      page.waitForResponse(
        r => new RegExp(`/api/results/tube/${sample.sampleId}/reopen-mine`, 'i').test(r.url())
          && r.request().method() === 'POST',
      ),
      page.waitForResponse(
        r => new RegExp(`/api/samples/${sample.sampleId}/tests$`, 'i').test(r.url())
          && r.request().method() === 'GET',
      ),
      confirmBtn.click(),
    ]);
    expect(reopenResponse.ok()).toBe(true);
    const reopenJson = await reopenResponse.json();
    expect(reopenJson.success).toBe(true);
    // Exactly the one BIO108 test on this tube got re-opened.
    expect(reopenJson.data?.reopened).toBe(1);
    expect(refetchResponse.ok()).toBe(true);
    await expect(dialogRoot).toHaveCount(0);

    // ── Correct the value and re-submit ────────────────────────────────
    // 150 sits ABOVE BIO108's 40-129 band — deliberately out-of-range so the
    // amended report's re-derived flag (N → H) is an independent, second
    // proof the correction actually landed, not just the raw number.
    const paramRow = page.locator('tr.pf-sre__grow', { hasText: result.testName });
    await expect(paramRow).toBeVisible({ timeout: 10_000 });
    const input = paramRow.locator('input.pf-sre__ginput--num');
    await expect(input).toHaveValue('85'); // reopened form is pre-filled with the prior value
    await input.fill('150');
    await expect(input).toHaveValue('150');

    const submitBtn = page.getByRole('button', { name: /^submit (all )?results$/i });
    await expect(submitBtn).toBeEnabled();

    const [resubmitResponse] = await Promise.all([
      page.waitForResponse(
        r => /\/api\/samples\/[0-9a-f-]{36}\/results$/i.test(r.url()) && r.request().method() === 'POST',
      ),
      submitBtn.click(),
    ]);
    expect(resubmitResponse.ok()).toBe(true);
    const resubmitBody = (await resubmitResponse.json())?.data ?? {};
    expect(resubmitBody.submitted).toBe(1);
    const resubmittedTest = resubmitBody.sample?.tests?.find(
      (t: { test?: { testCode?: string } }) => t.test?.testCode === result.testCode,
    );
    expect(resubmittedTest?.id).toBe(result.orderTestId);
    // Direct-flow + validation-for-all off ⇒ auto-validates again on submit,
    // exactly the state TryAutoGenerateFinalReportAsync needs to re-issue.
    expect(resubmittedTest?.status).toBe('validated');
    const resubmittedValues = JSON.parse(resubmittedTest?.currentResult ?? '{}');
    expect(resubmittedValues?.values?.[result.testName]).toBe('150');
    expect(resubmittedValues?.flagged?.[result.testName]?.flag).toBe('H');

    // ── Read the AMENDED report — must be a NEW row superseding the first ──
    await page.goto(`/frontdesk/patients/${patient.patientId}`);
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await row.click();

    await expect(testRow.locator('.pf-lo-res__val')).toContainText('150', { timeout: 15_000 });

    const [amendedReportResponse] = await Promise.all([
      page.waitForResponse(
        r => new RegExp(`/api/reports/by-order/${order.orderId}`, 'i').test(r.url())
          && r.request().method() === 'GET',
      ),
      card.locator('.pf-lo-act--report').click(),
    ]);
    expect(amendedReportResponse.ok()).toBe(true);
    const amendedReportJson = await amendedReportResponse.json();
    expect(amendedReportJson.success).toBe(true);
    const amendedReport = amendedReportJson.data;

    // Real proof #1: a genuinely NEW report row, not the same one mutated.
    expect(amendedReport.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(amendedReport.id.toLowerCase()).not.toBe(firstReport.id.toLowerCase());
    expect(amendedReport.type).toBe('final');
    // Real proof #2: it explicitly points back at the report it replaces,
    // and carries the server's fixed amendment reason.
    expect((amendedReport.amendedBy as string).toLowerCase()).toBe(firstReport.id.toLowerCase());
    expect(amendedReport.amendmentReason).toBe('Result corrected after report release');

    // Real proof #3: the snapshot the PDF is built from carries the
    // corrected value/flag AND its own "isAmended" marker.
    const amendedSnapshot = JSON.parse(amendedReport.data ?? '{}');
    expect(amendedSnapshot.amendment?.isAmended).toBe(true);
    expect(amendedSnapshot.amendment?.reason).toBe('Result corrected after report release');
    const amendedReportedTest = (amendedSnapshot.tests ?? []).find((t: { name?: string }) => t.name === result.testName);
    expect(amendedReportedTest).toBeTruthy();
    expect(amendedReportedTest.status).toBe('validated');
    const amendedReportedValues = Object.values(amendedReportedTest.result?.values ?? {}) as Array<{ value?: unknown; flag?: string }>;
    expect(amendedReportedValues).toHaveLength(1);
    expect(String(amendedReportedValues[0]?.value)).toBe('150');
    expect(amendedReportedValues[0]?.flag).toBe('H');

    // Real proof #4: an INDEPENDENT read of the OLD report row (by its own
    // id — GET /api/reports/{id}, not derived from the by-order "latest"
    // lookup, which by design excludes superseded rows) shows the server
    // actually flipped it to superseded — the audit trail stays intact
    // rather than the old row vanishing or being overwritten in place.
    // Fired from inside the page so it reuses the app's own logged-in
    // session (AuthService persists it at localStorage['pf.session']
    // .access_token) rather than fabricating a separate auth context.
    const oldReportJson = await page.evaluate(async ({ apiBase, reportId }) => {
      const raw = localStorage.getItem('pf.session');
      const token = raw ? JSON.parse(raw)?.access_token : null;
      const res = await fetch(`${apiBase}/api/reports/${reportId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: res.status, body: await res.json() };
    }, { apiBase: 'http://localhost:5270', reportId: firstReport.id as string });

    expect(oldReportJson.status).toBe(200);
    expect(oldReportJson.body.success).toBe(true);
    const oldReport = oldReportJson.body.data;
    expect((oldReport.supersededByReportId as string).toLowerCase()).toBe(amendedReport.id.toLowerCase());
    expect(oldReport.supersededAt).toBeTruthy();

    // The report actually renders as a PDF, not just a fetched blob.
    await expect(card.locator('.pf-pdfc canvas').first()).toBeVisible({ timeout: 20_000 });
  });
});
