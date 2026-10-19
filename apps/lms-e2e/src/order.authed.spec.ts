import { test, expect } from '@playwright/test';
import { registerPatient } from './support/flows';

/**
 * Stage 2 of the clinical flow — create an order for a patient.
 *
 * Each run registers a brand-new patient (stage 1, via
 * support/flows.ts::registerPatient — the same steps as
 * register.authed.spec.ts) so the order is created against a patient that
 * definitely has no prior orders/drafts to interfere with test selection.
 *
 * The order screen (apps/lms/src/app/features/frontdesk/order-create/) is a
 * combined test-picker + inline-payment screen: for the 'front_desk' billing
 * mode (Micro World's default — see BranchLabConfigService.billingMode),
 * placing an order and collecting/deferring payment happen in one submit via
 * pf-inline-payment-panel's (confirm) → OrderCreateComponent.confirmPayment(),
 * which POSTs /api/orders/ then /api/billing/. We pick "Pay later" so the
 * flow doesn't need to fight the cash num-pad's exact-tender requirement.
 *
 * Test picked: BIO108 "Alkaline Phosphatase" — a real, active, uniquely-coded
 * Biochemistry test in the Micro World demo catalogue (confirmed via
 * GET /api/tests/?activeOnly=true). Searching by its test code is exact —
 * unlike some test *names* in this catalogue (e.g. "24-Hour Urine Albumin"),
 * which appear twice under different codes.
 */

test.describe('Create order', () => {
  test('creates an order for a freshly-registered patient and places it', async ({ page }) => {
    const patient = await registerPatient(page);

    // From the patient's profile, "New Lab Order" is the canonical entry
    // point into order-create (patient-profile.component.ts::startOrder).
    await page.getByRole('button', { name: 'New Lab Order' }).click();
    await page.waitForURL(new RegExp(`/frontdesk/order\\?patientId=${patient.patientId}`), { timeout: 15_000 });

    // The catalogue is fetched async (GET /api/tests/?activeOnly=true) —
    // wait for the search box before typing into it.
    const search = page.getByPlaceholder(/search tests or packages/i);
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill('BIO108');

    // Exactly one test card should match this code — click it to add to cart.
    const testCard = page.locator('.pf-rail-card', { hasText: 'Alkaline Phosphatase' });
    await expect(testCard).toHaveCount(1, { timeout: 10_000 });
    await testCard.click();

    // Real state change #1: the cart reflects the added test.
    await expect(page.locator('.pf-cart-name', { hasText: 'Alkaline Phosphatase' })).toBeVisible();

    // Inline payment pane appears once a patient + ≥1 test are attached
    // (showInlinePay() — front_desk billing mode, not editing an order).
    await expect(page.locator('.pf-ipp')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Pay later', exact: true }).click();

    const confirmBtn = page.getByRole('button', { name: /place order \(pay later\)/i });
    await expect(confirmBtn).toBeEnabled();

    // Capture the real backend response for the order-creation POST — the
    // load-bearing assertion that an order actually got created server-side,
    // not just that the UI stopped complaining.
    const [orderResponse] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/orders/') && r.request().method() === 'POST'),
      confirmBtn.click(),
    ]);
    expect(orderResponse.ok()).toBe(true);
    const orderBody = await orderResponse.json();
    const order = orderBody?.data ?? orderBody;
    expect(order?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(order?.patientId).toBe(patient.patientId);

    // Real state change #2: the screen locks into its post-order summary —
    // the catalogue swaps for a read-only "Tests in this Order" recap
    // (orderLocked() via paidOrderId()) showing the exact test we added.
    await expect(page.locator('.pf-payment-due-tests')).toContainText('Tests in this Order (1)');
    await expect(page.locator('.pf-readonly-test-card', { hasText: 'Alkaline Phosphatase' })).toBeVisible();

    // Real state change #3: the payment pane confirms the order was placed
    // (pay-later → balance > 0 → "Advance recorded" per the component's
    // paymentSummaryBill-driven message) and offers to print the invoice.
    await expect(page.locator('.pf-paid__msg')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print invoice' })).toBeVisible();
  });
});
