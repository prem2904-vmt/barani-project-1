import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Shared flow helpers for authed specs. Extracted from the stage-1
 * registration spec (register.authed.spec.ts) so stage-2+ specs (order
 * creation, billing, collection, …) can stand a fresh patient up without
 * re-implementing the dynamic-workflow-form dance.
 */

/** Field rows are `<div class="flex flex-col gap-1.5"><label class="pf-label">…` —
 *  label and control are siblings with no `for`/`id` link, so getByLabel()
 *  doesn't apply. Scope by the row that contains the given label text. */
export function fieldRow(page: Page, label: string) {
  return page.locator('div.flex.flex-col.gap-1\\.5').filter({
    has: page.locator('label.pf-label', { hasText: label }),
  });
}

export interface RegisteredPatient {
  firstName: string;
  lastName: string;
  phone: string;
  /** The patient's UUID, parsed off the post-registration profile URL. */
  patientId: string;
}

/**
 * Register a brand-new, uniquely-named/phoned patient (mirrors
 * register.authed.spec.ts step-for-step) and leave the browser sitting on
 * that patient's profile page. Returns identifying details so callers can
 * assert against them later.
 */
export async function registerPatient(page: Page): Promise<RegisteredPatient> {
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

  const url = page.url();
  const patientId = url.match(/\/frontdesk\/patients\/([0-9a-f-]{36})$/i)?.[1] ?? '';

  // The profile header renders the server's canonical displayName for the
  // patient we just registered.
  await expect(page.locator('.pf-pp__tb-name')).toContainText(firstName, { timeout: 10_000 });

  return { firstName, lastName, phone, patientId };
}
