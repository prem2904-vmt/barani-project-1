import { test, expect } from '@playwright/test';
import { registerPatient, createOrder } from './support/flows';

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
    // flows.createOrder drives the new-design order screen (unified search →
    // cart → Continue to payment → Pay later → Place order) and asserts the
    // real POST /api/orders response + the post-order summary.
    const order = await createOrder(page, patient);
    expect(order.patientId).toBe(patient.patientId);
    await expect(page.locator('.pf-payment-due-tests')).toContainText('Alkaline Phosphatase');
    await expect(page.getByText('Order placed — payment pending')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print invoice' })).toBeVisible();
  });
});
