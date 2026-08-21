import { test, expect, type Page, type Locator } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * REPORT TEMPLATE + LABEL/PRINT CUSTOMIZATION — functional (admin, real
 * persistence) + permission gate.
 *
 * Ground truth read from source, not assumed:
 *   - apps/lms/src/app/features/admin/report-template/report-template.component.ts
 *     (route /admin/reports) — 6 tabs (Identity, Header & logo, Style & table,
 *     Patient block, Report columns, Footer). Saves the WHOLE ReportTemplate
 *     row in one shot via POST /api/config/report-template.
 *   - apps/lms/src/app/features/admin/report-template/report-columns-editor.component.ts
 *     — embedded in the "Report columns" tab. PER-DEPARTMENT columns
 *     (POST /api/report-layout/department/:id) and PER-DEPARTMENT
 *     signatories (POST /api/report-layout/department/:id/signatories) —
 *     each its own save action, independent of the template's top Save.
 *   - apps/lms/src/app/features/admin/lab-settings/lab-settings.component.ts
 *     (route /admin/lab-settings) — the specimen label CODE (barcode / QR /
 *     data-matrix) is an org-wide policy here, PATCH /api/tenants/branch-lab-config.
 *   - apps/lms/src/app/features/admin/label-printer/label-printer.component.ts
 *     (route /printing, "Printing") — label WIDTH/HEIGHT, alignment, and
 *     print-quality (darkness/speed/code-size) are PER-STATION and persist to
 *     localStorage only (PrintConfigService) — there is no backend save API
 *     for these; confirmed by reading print-config.service.ts.
 *
 * ⚠ FINDING — permission mismatch on the /admin/reports guard. The nav entry
 * for "Report Template" (layout/nav-items.ts line ~343) is gated on
 * `permissions: ['manage_report_template']` alone, but the ROUTE guard
 * (app.routes.ts, `path: 'admin/reports'`) is actually
 * `permissionGuard(['manage_tenant', 'manage_tests'])` — it does NOT check
 * manage_report_template at all. Per prefrontal-mw's RoleSeeder.cs only "Lab
 * Admin" holds manage_tenant/manage_tests/manage_report_template together, so
 * today this is invisible in practice (every seeded role that would reach the
 * nav link also passes the route guard, and vice-versa). But it's a latent
 * bug: a hypothetical role granted manage_report_template WITHOUT
 * manage_tenant/manage_tests would see the nav link and then bounce to /403,
 * and a role granted manage_tests/manage_tenant WITHOUT manage_report_template
 * would reach the real screen despite the nav declaring it hidden. Asserted
 * against actual (not intended) behavior below.
 *
 * ⚠ FINDING — dead code. ReportTemplateComponent still carries
 * addSignature()/removeSignature()/updateSignature() and a `signatures`
 * computed over `signaturesJson` (report-template.component.ts ~L957-981),
 * but no template case renders them — the live "Sign-off & Footer" tab only
 * has a one-line note pointing at the per-department Signatories UI in the
 * Columns tab. So a template-level "signatory label" field (implied by the
 * task's item 1) does not exist in the live UI; the real signatory
 * configuration is per-department (covered below) with mode/role/designation
 * — no template-level "label" field either.
 */

// nxE2EPreset sets `fullyParallel: true`, so tests in this file would
// otherwise run concurrently across workers. Several tests below mutate the
// SAME tenant-wide singleton rows (ReportTemplate via /api/config/report-template,
// BranchLabConfig via /api/tenants/branch-lab-config) — running them in
// parallel causes one test's save/reload to race another's, so this file
// runs serially (one worker, registration order).
test.describe.configure({ mode: 'serial' });

// These are heavy real save+reload+restore round-trips against ONE local
// backend. Green in isolation, but when the full 17-spec rbac suite runs
// concurrently they can brush past the 30s default under load contention.
// Give every test in this file headroom so the suite is stable without leaning
// on retries. (Isolated runtime is unaffected — this is only a ceiling.)
test.beforeEach(() => {
  test.setTimeout(75_000);
});

const FORBIDDEN_HEADING = /forbidden/i;

async function expectBlocked(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/403$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
}

async function gotoReportTemplate(page: Page) {
  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: /report template/i, level: 1 })).toBeVisible({ timeout: 15_000 });
}

async function saveTemplate(page: Page) {
  const resp = page.waitForResponse(
    r => r.url().includes('/api/config/report-template') && r.request().method() === 'POST',
    { timeout: 15_000 }
  );
  await page.getByRole('button', { name: /^save$/i }).first().click();
  const r = await resp;
  expect(r.ok(), 'POST /api/config/report-template should succeed').toBe(true);
  // .last() — a same-text toast from a PRIOR save in this test may still be
  // fading out when this one appears (stacked, identical text).
  await expect(page.getByText(/template saved/i).last()).toBeVisible({ timeout: 10_000 });
}

/** Nth color-picker input in DOM order == colorFields[] order in the Theme
 *  tab: 0 Primary, 1 Accent, 2 Table header bg, 3 Table header text,
 *  4 Body text, 5 Divider / hairline. */
async function colorInputValue(page: Page, idx: number): Promise<string> {
  const loc = page.locator('input.pf-color-picker').nth(idx);
  await loc.waitFor({ state: 'visible', timeout: 10_000 });
  return loc.inputValue();
}
async function setColorInput(page: Page, idx: number, hex: string) {
  const loc = page.locator('input.pf-color-picker').nth(idx);
  await loc.waitFor({ state: 'visible', timeout: 10_000 });
  await loc.evaluate((el, value) => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, hex);
}

test.describe('Report Template — Identity / Header / Theme / Footer (admin, real save + restore)', () => {
  test('style preset, tagline, accent colour, footer text and watermark all persist across reload', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoReportTemplate(page);

    // ── Capture originals ────────────────────────────────────────────
    await page.getByRole('button', { name: /header & logo/i }).click();
    const headerThumbs = page.locator('.pf-wys-thumbs').first();
    const originalPreset = await headerThumbs.locator('.pf-wys-thumb--on .pf-wys-thumb__name').innerText();
    // Pick a different preset than whatever is currently active.
    const newPresetName = originalPreset.trim() === 'Banner' ? 'Minimal' : 'Banner';

    await page.getByRole('button', { name: /lab identity/i }).click();
    const taglineInput = page.getByPlaceholder('e.g. Accurate | Caring | Instant');
    const originalTagline = await taglineInput.inputValue();
    const newTagline = 'E2E QA Tagline ' + Date.now();

    await page.getByRole('button', { name: /style & table/i }).click();
    const originalAccent = await colorInputValue(page, 1);
    const newAccent = originalAccent.toLowerCase() === '#123456' ? '#654321' : '#123456';

    await page.getByRole('button', { name: /^footer/i }).click();
    const footerTextInput = page.locator('label:text-is("Footer text (legal / contact line)")')
      .locator('xpath=following-sibling::input[1]');
    const originalFooterText = await footerTextInput.inputValue();
    const newFooterText = 'E2E QA footer line ' + Date.now();

    const watermarkInput = page.getByPlaceholder('e.g. DRAFT, COPY');
    const originalWatermark = await watermarkInput.inputValue();
    const newWatermark = 'E2E-DRAFT';

    // ── Apply every change, then ONE save (matches how the page actually
    //    works — a single template row, single Save button). ──────────
    await page.getByRole('button', { name: /header & logo/i }).click();
    await headerThumbs.getByRole('button', { name: newPresetName }).click();
    await expect(headerThumbs.locator('.pf-wys-thumb--on .pf-wys-thumb__name')).toHaveText(newPresetName);

    await page.getByRole('button', { name: /lab identity/i }).click();
    await taglineInput.fill(newTagline);

    await page.getByRole('button', { name: /style & table/i }).click();
    await setColorInput(page, 1, newAccent);

    await page.getByRole('button', { name: /^footer/i }).click();
    await footerTextInput.fill(newFooterText);
    await watermarkInput.fill(newWatermark);
    // Opacity slider only renders once watermarkText is non-empty.
    await expect(page.locator('input[type="range"][min="0.02"]')).toBeVisible();

    await saveTemplate(page);

    // ── Reload — confirm every field reflects the SAVED (server) state,
    //    not just the in-memory signal. ─────────────────────────────────
    await page.reload();
    await expect(page.getByRole('heading', { name: /report template/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /header & logo/i }).click();
    await expect(page.locator('.pf-wys-thumbs').first().locator('.pf-wys-thumb--on .pf-wys-thumb__name'))
      .toHaveText(newPresetName);

    await page.getByRole('button', { name: /lab identity/i }).click();
    await expect(page.getByPlaceholder('e.g. Accurate | Caring | Instant')).toHaveValue(newTagline);

    await page.getByRole('button', { name: /style & table/i }).click();
    expect((await colorInputValue(page, 1)).toLowerCase()).toBe(newAccent.toLowerCase());

    await page.getByRole('button', { name: /^footer/i }).click();
    await expect(
      page.locator('label:text-is("Footer text (legal / contact line)")').locator('xpath=following-sibling::input[1]')
    ).toHaveValue(newFooterText);
    await expect(page.getByPlaceholder('e.g. DRAFT, COPY')).toHaveValue(newWatermark);

    // ── Restore every field to its original value, save again, reload
    //    to confirm the restore itself persisted (the report E2E suite
    //    depends on defaults). ───────────────────────────────────────
    await page.getByRole('button', { name: /header & logo/i }).click();
    await page.locator('.pf-wys-thumbs').first().getByRole('button', { name: originalPreset.trim() }).click();

    await page.getByRole('button', { name: /lab identity/i }).click();
    await page.getByPlaceholder('e.g. Accurate | Caring | Instant').fill(originalTagline);

    await page.getByRole('button', { name: /style & table/i }).click();
    await setColorInput(page, 1, originalAccent);

    await page.getByRole('button', { name: /^footer/i }).click();
    await page.locator('label:text-is("Footer text (legal / contact line)")')
      .locator('xpath=following-sibling::input[1]').fill(originalFooterText);
    await page.getByPlaceholder('e.g. DRAFT, COPY').fill(originalWatermark);

    await saveTemplate(page);

    await page.reload();
    await expect(page.getByRole('heading', { name: /report template/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /header & logo/i }).click();
    await expect(page.locator('.pf-wys-thumbs').first().locator('.pf-wys-thumb--on .pf-wys-thumb__name'))
      .toHaveText(originalPreset.trim());
    await page.getByRole('button', { name: /lab identity/i }).click();
    await expect(page.getByPlaceholder('e.g. Accurate | Caring | Instant')).toHaveValue(originalTagline);
    await page.getByRole('button', { name: /style & table/i }).click();
    expect((await colorInputValue(page, 1)).toLowerCase()).toBe(originalAccent.toLowerCase());
    await page.getByRole('button', { name: /^footer/i }).click();
    await expect(
      page.locator('label:text-is("Footer text (legal / contact line)")').locator('xpath=following-sibling::input[1]')
    ).toHaveValue(originalFooterText);
    await expect(page.getByPlaceholder('e.g. DRAFT, COPY')).toHaveValue(originalWatermark);
  });
});

test.describe('Report Template — per-department columns + signatories (admin, real save + restore)', () => {
  test('rename + lock a report column: saved via /api/report-layout/department/:id, persists, restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoReportTemplate(page);

    await page.getByRole('button', { name: /report columns/i }).click();
    // First department auto-selects on tab entry (ReportColumnsEditorComponent.ngOnInit).
    await expect(page.locator('.pf-ce-strip .pf-ce-col').first()).toBeVisible({ timeout: 15_000 });

    // Column index 1 — index 0 is always the guaranteed "Investigation" (name)
    // column; index 1 is a real, editable column in every department's default set.
    const card = page.locator('.pf-ce-strip .pf-ce-col').nth(1);
    const originalLabel = (await card.locator('.pf-ce-col__label').innerText()).trim();
    await card.click();

    const labelInput = page.locator('label:text-is("Column heading")').locator('xpath=following-sibling::input[1]');
    await expect(labelInput).toHaveValue(originalLabel);
    const newLabel = originalLabel + ' (E2E)';
    await labelInput.fill(newLabel);

    // Capture the ORIGINAL lock state rather than assuming unlocked — this
    // dev tenant's data isn't guaranteed pristine between runs.
    const lockBtn = page.locator('.pf-ce-inspector button.pf-icon-btn').first();
    const originalLocked = (await lockBtn.getAttribute('class'))?.includes('pf-icon-btn--on') ?? false;
    const originalLockedValue = originalLocked
      ? await page.locator('.pf-ce-inspector input[placeholder="e.g. Blood - EDTA"]').inputValue()
      : '';

    await lockBtn.click(); // flip it
    if (originalLocked) {
      await expect(lockBtn).not.toHaveClass(/pf-icon-btn--on/);
    } else {
      await expect(lockBtn).toHaveClass(/pf-icon-btn--on/);
    }
    if (!originalLocked) {
      await page.locator('.pf-ce-inspector input[placeholder="e.g. Blood - EDTA"]').fill('E2E fixed value');
    }

    const saveResp = page.waitForResponse(
      r => /\/api\/report-layout\/department\/[^/]+$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await page.locator('.pf-ce-bar').getByRole('button', { name: /^save$/i }).click();
    const r = await saveResp;
    expect(r.ok(), 'POST /api/report-layout/department/:id should succeed').toBe(true);
    await expect(page.getByText(/column structure saved/i).last()).toBeVisible({ timeout: 10_000 });

    // Reload — re-enter the Columns tab fresh, confirm server-persisted state.
    await page.reload();
    await expect(page.getByRole('heading', { name: /report template/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /report columns/i }).click();
    await expect(page.locator('.pf-ce-strip .pf-ce-col').first()).toBeVisible({ timeout: 15_000 });
    const cardAfter = page.locator('.pf-ce-strip .pf-ce-col').nth(1);
    await expect(cardAfter.locator('.pf-ce-col__label')).toHaveText(newLabel);
    if (originalLocked) {
      await expect(cardAfter.locator('.pf-ce-col__lock')).toHaveCount(0);
    } else {
      await expect(cardAfter.locator('.pf-ce-col__lock')).toBeVisible();
    }

    // Restore — label back to original, lock flipped back to original state.
    await cardAfter.click();
    await page.locator('label:text-is("Column heading")').locator('xpath=following-sibling::input[1]').fill(originalLabel);
    const lockBtnAfter = page.locator('.pf-ce-inspector button.pf-icon-btn').first();
    const isLockedNow = (await lockBtnAfter.getAttribute('class'))?.includes('pf-icon-btn--on') ?? false;
    if (isLockedNow !== originalLocked) await lockBtnAfter.click();
    if (originalLocked) {
      await page.locator('.pf-ce-inspector input[placeholder="e.g. Blood - EDTA"]').fill(originalLockedValue);
    }

    const restoreResp = page.waitForResponse(
      r => /\/api\/report-layout\/department\/[^/]+$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await page.locator('.pf-ce-bar').getByRole('button', { name: /^save$/i }).click();
    const r2 = await restoreResp;
    expect(r2.ok()).toBe(true);
    await expect(page.getByText(/column structure saved/i).last()).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: /report template/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /report columns/i }).click();
    await expect(page.locator('.pf-ce-strip .pf-ce-col').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pf-ce-strip .pf-ce-col').nth(1).locator('.pf-ce-col__label')).toHaveText(originalLabel);
  });

  test('add + remove a department signatory: saved via .../signatories, persists, restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoReportTemplate(page);

    await page.getByRole('button', { name: /report columns/i }).click();
    await expect(page.locator('.pf-ce-strip .pf-ce-col').first()).toBeVisible({ timeout: 15_000 });

    // Don't assume this dev tenant's department starts with zero signatories
    // — capture whatever is already configured and only touch the ONE row
    // this test adds, leaving any pre-existing rows completely alone.
    const originalCount = await page.locator('.pf-sig-row').count();
    const originalDesignations = await page.locator('.pf-sig-desig').evaluateAll(els => els.map(e => (e as HTMLInputElement).value));

    await page.getByRole('button', { name: /\+ add signatory/i }).click();
    await expect(page.locator('.pf-sig-row')).toHaveCount(originalCount + 1);
    const designation = 'E2E QA Signatory ' + Date.now();
    // addSig() appends — the new row is always last.
    const newRowDesig = page.locator('.pf-sig-desig').last();
    await newRowDesig.fill(designation);

    const saveResp = page.waitForResponse(
      r => r.url().includes('/signatories') && r.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await page.getByRole('button', { name: /save signatories/i }).click();
    const r = await saveResp;
    expect(r.ok(), 'POST .../signatories should succeed').toBe(true);
    await expect(page.getByText(/signatories saved/i).last()).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: /report template/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /report columns/i }).click();
    await expect(page.locator('.pf-ce-strip .pf-ce-col').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pf-sig-row')).toHaveCount(originalCount + 1);
    await expect(page.locator('.pf-sig-desig').last()).toHaveValue(designation);
    // The pre-existing rows are untouched.
    expect(await page.locator('.pf-sig-desig').evaluateAll(els => els.map(e => (e as HTMLInputElement).value))).toEqual([...originalDesignations, designation]);

    // Restore — remove exactly the row this test added (still last).
    const restoreResp = page.waitForResponse(
      r => r.url().includes('/signatories') && r.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await page.locator('.pf-sig-row').last().locator('.pf-link-btn--danger').click();
    await expect(page.locator('.pf-sig-row')).toHaveCount(originalCount);
    await page.getByRole('button', { name: /save signatories/i }).click();
    const r2 = await restoreResp;
    expect(r2.ok()).toBe(true);
    await expect(page.getByText(/signatories saved/i).last()).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: /report template/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /report columns/i }).click();
    await expect(page.locator('.pf-ce-strip .pf-ce-col').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pf-sig-row')).toHaveCount(originalCount);
    expect(await page.locator('.pf-sig-desig').evaluateAll(els => els.map(e => (e as HTMLInputElement).value))).toEqual(originalDesignations);
  });
});

test.describe('Specimen label code (barcode / QR / data matrix) — admin, real save + restore', () => {
  test('toggling the org-wide label code persists via PATCH /api/tenants/branch-lab-config, restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/lab-settings');
    await expect(page.getByRole('heading', { name: /lab settings/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    const options: Array<{ key: 'barcode' | 'qr' | 'datamatrix'; btn: Locator }> = [
      { key: 'barcode',    btn: page.getByRole('button', { name: /^barcode \(1d\)/i }) },
      { key: 'qr',         btn: page.getByRole('button', { name: /^qr \(2d\)/i }) },
      { key: 'datamatrix', btn: page.getByRole('button', { name: /^data matrix \(2d\)/i }) },
    ];

    // Don't assume the tenant starts on the default (barcode) — find
    // whichever option is ACTUALLY active right now, so this test is safe to
    // run against a dev tenant that's already been toggled by someone else.
    let originalIdx = -1;
    for (let i = 0; i < options.length; i++) {
      if ((await options[i].btn.getAttribute('class'))?.includes('pf-ls__gate-opt--on')) { originalIdx = i; break; }
    }
    expect(originalIdx, 'exactly one label-code option should be active').toBeGreaterThanOrEqual(0);
    const newIdx = (originalIdx + 1) % options.length;

    // Toggle to a different option.
    const patch1 = page.waitForResponse(
      r => r.url().includes('/api/tenants/branch-lab-config') && r.request().method() === 'PATCH',
      { timeout: 15_000 }
    );
    await options[newIdx].btn.click();
    const r1 = await patch1;
    expect(r1.ok(), `PATCH branch-lab-config (labelCodeMode: ${options[newIdx].key}) should succeed`).toBe(true);
    await expect(page.getByText(/label code format updated/i).last()).toBeVisible({ timeout: 10_000 });
    await expect(options[newIdx].btn).toHaveClass(/pf-ls__gate-opt--on/, { timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: /lab settings/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(options[newIdx].btn).toHaveClass(/pf-ls__gate-opt--on/, { timeout: 10_000 });

    // Restore.
    const patch2 = page.waitForResponse(
      r => r.url().includes('/api/tenants/branch-lab-config') && r.request().method() === 'PATCH',
      { timeout: 15_000 }
    );
    await options[originalIdx].btn.click();
    const r2 = await patch2;
    expect(r2.ok()).toBe(true);
    await expect(page.getByText(/label code format updated/i).last()).toBeVisible({ timeout: 10_000 });
    await expect(options[originalIdx].btn).toHaveClass(/pf-ls__gate-opt--on/, { timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: /lab settings/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(options[originalIdx].btn).toHaveClass(/pf-ls__gate-opt--on/, { timeout: 10_000 });
  });
});

test.describe('Printing (per-station label size) — real localStorage persistence, restored', () => {
  test('label width/height persists across reload (no backend save API — see header finding)', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/printing');
    await expect(page.getByRole('heading', { name: /printing/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    const widthInput = page.getByLabel('Width (mm)');
    const heightInput = page.getByLabel('Height (mm)');
    const originalWidth = await widthInput.inputValue();
    const originalHeight = await heightInput.inputValue();

    await widthInput.fill('42');
    await widthInput.blur();
    await heightInput.fill('27');
    await heightInput.blur();
    await expect(page.locator('.pf-prev-wrap .pf-mono')).toHaveText('42 × 27 mm');

    // Confirm it's really in localStorage (PrintConfigService's persistence
    // layer), not just an in-memory Angular signal.
    const stored = await page.evaluate(() => localStorage.getItem('pf.printConfig'));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.labelWidthMm).toBe(42);
    expect(parsed.labelHeightMm).toBe(27);

    await page.reload();
    await expect(page.getByRole('heading', { name: /printing/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Width (mm)')).toHaveValue('42');
    await expect(page.getByLabel('Height (mm)')).toHaveValue('27');

    // Restore.
    await page.getByLabel('Width (mm)').fill(originalWidth);
    await page.getByLabel('Width (mm)').blur();
    await page.getByLabel('Height (mm)').fill(originalHeight);
    await page.getByLabel('Height (mm)').blur();
    await expect(page.locator('.pf-prev-wrap .pf-mono')).toHaveText(`${originalWidth} × ${originalHeight} mm`);

    await page.reload();
    await expect(page.getByRole('heading', { name: /printing/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Width (mm)')).toHaveValue(originalWidth);
    await expect(page.getByLabel('Height (mm)')).toHaveValue(originalHeight);
  });
});

test.describe('Report Template — permission gate', () => {
  for (const role of ['labTech', 'manager'] as const) {
    test(`${role}: blocked from /admin/reports (→ /403)`, async ({ page }) => {
      await loginAs(page, role);
      await expectBlocked(page, '/admin/reports');
    });
  }

  test('admin: reaches /admin/reports', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoReportTemplate(page);
  });
});
