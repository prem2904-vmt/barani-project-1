import { test, expect } from '@playwright/test';
import { fieldRow, fillRegistration } from './support/flows';

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
    await expect(fieldRow(page, 'First name').locator('input').first()).toBeVisible({ timeout: 15_000 });

    // Design-agnostic: classic is one page; the new design opens each
    // field's section tab first (Sex is a segment there, a pf-select classic).
    await fillRegistration(page, { firstName, lastName, phone, dob: '1990-05-15' });

    await page.getByRole('button', { name: /^register patient$/i }).click();

    // Real outcome: POST succeeded and the app navigated off /patients/new
    // onto the newly-created patient's own profile route.
    await page.waitForURL(/\/frontdesk\/patients\/[0-9a-f-]{36}$/i, { timeout: 15_000 });

    // The profile header renders the server's canonical displayName for the
    // patient we just registered.
    await expect(page.locator('.pf-pp__tb-name')).toContainText(firstName, { timeout: 10_000 });
  });
});
