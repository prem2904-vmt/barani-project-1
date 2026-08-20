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

export interface PlacedOrder {
  orderId: string;
  patientId: string;
}

/**
 * Place an order for an already-registered patient (mirrors
 * order.authed.spec.ts step-for-step) — picks a single real, uniquely-coded
 * test from the Micro World demo catalogue and pays later, so it doesn't
 * need to fight the cash num-pad's exact-tender requirement. Leaves the
 * browser sitting on order-create's post-order summary. Returns the
 * server-assigned order id so callers (e.g. stage-3 collection) can act on
 * it directly.
 */
export async function createOrder(
  page: Page,
  patient: RegisteredPatient,
  testCode = 'BIO108',
  testName = 'Alkaline Phosphatase',
): Promise<PlacedOrder> {
  // From the patient's profile, "New Lab Order" is the canonical entry
  // point into order-create (patient-profile.component.ts::startOrder).
  await page.getByRole('button', { name: 'New Lab Order' }).click();
  await page.waitForURL(new RegExp(`/frontdesk/order\\?patientId=${patient.patientId}`), { timeout: 15_000 });

  // The catalogue is fetched async (GET /api/tests/?activeOnly=true) —
  // wait for the search box before typing into it.
  const search = page.getByPlaceholder(/search tests or packages/i);
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(testCode);

  // Exactly one test card should match this code — click it to add to cart.
  const testCard = page.locator('.pf-rail-card', { hasText: testName });
  await expect(testCard).toHaveCount(1, { timeout: 10_000 });
  await testCard.click();

  // Real state change #1: the cart reflects the added test.
  await expect(page.locator('.pf-cart-name', { hasText: testName })).toBeVisible();

  // Inline payment pane appears once a patient + ≥1 test are attached
  // (showInlinePay() — front_desk billing mode, not editing an order).
  await expect(page.locator('.pf-ipp')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Pay later', exact: true }).click();

  const confirmBtn = page.getByRole('button', { name: /place order \(pay later\)/i });
  await expect(confirmBtn).toBeEnabled();

  // Capture the real backend response for the order-creation POST — the
  // load-bearing proof that an order actually got created server-side, not
  // just that the UI stopped complaining.
  const [orderResponse] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/orders/') && r.request().method() === 'POST'),
    confirmBtn.click(),
  ]);
  expect(orderResponse.ok()).toBe(true);
  const orderBody = await orderResponse.json();
  const order = orderBody?.data ?? orderBody;
  expect(order?.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(order?.patientId).toBe(patient.patientId);

  // Real state change #2: the screen locks into its post-order summary.
  await expect(page.locator('.pf-payment-due-tests')).toContainText('Tests in this Order (1)');

  return { orderId: order.id, patientId: patient.patientId };
}

export interface CollectedSample {
  sampleId: string;
  barcode: string;
  orderId: string;
}

/**
 * Collect the (single) sample on a just-placed order (extracted from
 * collect.authed.spec.ts — see that spec for the deep-link-mode rationale).
 * Deep-links straight into the order's collect drawer — the same
 * navigation the app's own front-desk "Collect Sample" button performs
 * (order-create.component.ts::collectPaidSample() → router.navigate(['/lab/
 * collect'], { queryParams: { orderId, from } })) — which sidesteps the
 * queue screen's camera-scanner requirement entirely (SampleCollection
 * Component's deepLinkMode). Taps the pending vial, capturing the real
 * `PATCH /api/samples/{id}/collect` response so callers get the
 * server-assigned sample id + barcode (needed downstream for dispatch /
 * receive / result-entry — stage 4). Leaves the browser sitting in the
 * still-open collect drawer.
 */
export async function collectSample(page: Page, orderId: string): Promise<CollectedSample> {
  await page.goto(`/lab/collect?orderId=${orderId}&from=/frontdesk`);

  const drawer = page.locator('.pf-drawer__panel');
  await expect(drawer).toBeVisible({ timeout: 15_000 });

  // Exactly one tube (the single BIO108 test ordered), starting pending.
  const tube = page.locator('.pf-tube');
  await expect(tube).toHaveCount(1, { timeout: 10_000 });
  await expect(tube).not.toHaveClass(/pf-tube--done/);

  // Tap the vial — real state change: PATCH /api/samples/{id}/collect
  // fires and must succeed server-side, not just flip the UI optimistically.
  const [collectResponse] = await Promise.all([
    page.waitForResponse(
      r => /\/api\/samples\/[0-9a-f-]{36}\/collect$/i.test(r.url()) && r.request().method() === 'PATCH',
    ),
    tube.click(),
  ]);
  expect(collectResponse.ok()).toBe(true);
  const sampleBody = await collectResponse.json();
  const sample = sampleBody?.data ?? sampleBody;

  // Real state change: the tube card flips to its collected look and the
  // drawer's progress counter advances.
  await expect(tube).toHaveClass(/pf-tube--done/);
  await expect(page.locator('.pf-drawer__progress-num')).toHaveText('1/1');

  return { sampleId: sample.id, barcode: sample.barcode ?? '', orderId };
}
