import { test, expect } from '@playwright/test';

/**
 * Stage 1 of the clinical flow — patient registration. Runs against the real
 * mw backend + a live tenant workflow (patient_registration), so field
 * selectors are label-driven rather than hardcoded to a particular form
 * layout: the workflow is admin-configurable (apps/lms/src/app/features/
 * frontdesk/patient-register/patient-register.component.ts renders whatever
 * /api/workflows/patient_registration returns via pf-workflow-renderer /
 * pf-dynamic-input).
 *
 * Each run generates a unique name + phone (Date.now()-derived) so repeats
 * never collide with a previously-registered patient and never trip the
 * OPS-49 duplicate-confirmation dialog (same name + phone already
 * registered).
 */

/** Field rows are `<div class="flex flex-col gap-1.5"><label class="pf-label">…` —
 *  label and control are siblings with no `for`/`id` link, so getByLabel()
 *  doesn't apply. Scope by the row that contains the given label text. */
function fieldRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('div.flex.flex-col.gap-1\\.5').filter({
    has: page.locator('label.pf-label', { hasText: label }),
  });
}

test.describe('Patient registration', () => {
  test('registers a new patient and lands on their profile', async ({ page }) => {
    const suffix = Date.now().toString();
    const firstName = `E2EPatient${suffix.slice(-6)}`;
    const lastName = 'AutoTest';
    // India phone rule: /^[6-9]\d{9}$/ — 10 digits, must start 6-9.
    const phone = `9${suffix.slice(-9)}`;

    await page.goto('/frontdesk/patients/new');

    // The form is populated from a backend-fetched workflow config — wait for
    // it to actually render before interacting.
    await expect(fieldRow(page, 'First name').locator('input')).toBeVisible({ timeout: 15_000 });

    await fieldRow(page, 'First name').locator('input').fill(firstName);
    await fieldRow(page, 'Last name').locator('input').fill(lastName);
    await fieldRow(page, 'Date of birth').locator('input[type="date"]').fill('1990-05-15');

    // Sex is a custom pf-select (no native <select>): open it, then pick the
    // option from its portalled listbox panel.
    await fieldRow(page, 'Sex').locator('button.pf-dd__trigger').click();
    await page.getByRole('option', { name: 'Male', exact: true }).click();

    await fieldRow(page, 'Phone').locator('input[type="tel"]').fill(phone);

    await page.getByRole('button', { name: /^register patient$/i }).click();

    // Real outcome: POST succeeded and the app navigated off /patients/new
    // onto the newly-created patient's own profile route.
    await page.waitForURL(/\/frontdesk\/patients\/[0-9a-f-]{36}$/i, { timeout: 15_000 });

    // The profile header renders the server's canonical displayName for the
    // patient we just registered.
    await expect(page.locator('.pf-pp__tb-name')).toContainText(firstName, { timeout: 10_000 });
  });
});
