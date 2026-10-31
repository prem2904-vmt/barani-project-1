import { test, expect } from '@playwright/test';
import { registerPatient } from './support/flows';

/**
 * Billing / payment flow — place an order and take a REAL payment on it
 * (as opposed to order.authed.spec.ts / support/flows.ts::createOrder,
 * which deliberately choose "Pay later" to sidestep the cash num-pad).
 *
 * Test picked: BIO010 "Fasting Blood Sugar" — a real, active, uniquely-named
 * individual test in the Micro World demo catalogue with a NON-ZERO price
 * (₹30 — confirmed via GET /api/tests/?activeOnly=true). This matters: most
 * of the seeded catalogue (incl. BIO108, used by the rest of the clinical-
 * flow specs) has price 0 because Micro World's Test Master catalogue is
 * cloned from the default template with prices reset to 0 — a ₹0 cart makes
 * the inline payment panel's cash path unusable (canConfirm() requires
 * amount() > 0), so a priced test is required to exercise real payment.
 *
 * The order screen (apps/lms/src/app/features/frontdesk/order-create/) is a
 * combined test-picker + inline-payment screen for Micro World's
 * 'front_desk' billing mode: OrderCreateComponent.confirmPayment() creates
 * the order (POST /api/orders/), creates the bill (POST /api/billing/), then
 * — for any mode other than "later" — records the payment for the FULL
 * amount (POST /api/billing/{id}/payment) in one submit driven by
 * pf-inline-payment-panel's (confirm) output. We select the Cash tile and
 * hit "Exact" (InlinePaymentPanelComponent.setExactCash() sets cash tendered
 * = amount(), the deterministic way to satisfy the exact-tender gate
 * without knowing the price ahead of time in the UI itself) before
 * confirming.
 */

test.describe('Billing — payment on order', () => {
  test('places an order with a real cash payment and the bill balance clears to zero', async ({ page }) => {
    const patient = await registerPatient(page);

    // From the patient's profile, "New Lab Order" is the canonical entry
    // point into order-create (patient-profile.component.ts::startOrder).
    await page.getByRole('button', { name: /^(New order|New Lab Order)$/ }).first().click();
    await page.waitForURL(new RegExp(`/frontdesk/order\\?patientId=${patient.patientId}`), { timeout: 30_000 });

    // New design: the unified search pill → pick the match from its drop.
    const search = page.locator('input.pf-us__input');
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill('BIO010');
    const match = page.locator('#pf-us-drop [role="option"]', { hasText: 'Fasting Blood Sugar' });
    await expect(match).toHaveCount(1, { timeout: 20_000 });
    await match.click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pf-crt', { hasText: 'Fasting Blood Sugar' })).toBeVisible();

    // Continue to payment → Pay now · Cash · Exact (price-agnostic: the
    // tenant's catalogue price is whatever the bill says).
    await page.getByRole('button', { name: /continue to payment/i }).click();
    const ipp = page.locator('.pf-ipp');
    await expect(ipp).toBeVisible({ timeout: 20_000 });
    await ipp.getByText('Cash', { exact: true }).click();
    await ipp.getByText('Exact', { exact: true }).click();

    const confirmBtn = page.getByRole('button', { name: /^confirm .* received$/i });
    await expect(confirmBtn).toBeEnabled();

    const [orderResponse, billResponse, paymentResponse] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/orders/') && r.request().method() === 'POST'),
      page.waitForResponse(r => r.url().endsWith('/api/billing/') && r.request().method() === 'POST'),
      page.waitForResponse(
        r => /\/api\/billing\/[0-9a-f-]{36}\/payment$/i.test(r.url()) && r.request().method() === 'POST',
      ),
      confirmBtn.click(),
    ]);

    expect(orderResponse.ok()).toBe(true);
    const orderBody = await orderResponse.json();
    const order = orderBody?.data ?? orderBody;
    expect(order?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(order?.patientId).toBe(patient.patientId);

    expect(billResponse.ok()).toBe(true);
    const billBody = await billResponse.json();
    const bill = billBody?.data ?? billBody;
    expect(bill?.orderId).toBe(order.id);
    expect(bill?.totalPayable).toBeGreaterThan(0);
    const price = bill.totalPayable as number;
    // Fresh bill, payment not yet recorded.
    expect(bill?.totalPaid).toBe(0);

    // The load-bearing assertion: the payment POST succeeded and the bill it
    // returns is fully settled — mode 'cash', amount === totalPayable, and
    // balance driven to zero. Also assert a real invoice number got issued.
    expect(paymentResponse.ok()).toBe(true);
    const paymentBody = await paymentResponse.json();
    const paidBill = paymentBody?.data ?? paymentBody;
    expect(paidBill?.id).toBe(bill.id);
    expect(paidBill?.orderId).toBe(order.id);
    expect(paidBill?.totalPayable).toBe(price);
    expect(paidBill?.totalPaid).toBe(price);
    expect(paidBill?.balance).toBe(0);
    expect(paidBill?.status).toBe('paid');
    expect(paidBill?.payments?.length).toBeGreaterThan(0);
    const lastPayment = paidBill.payments[paidBill.payments.length - 1];
    expect(lastPayment.mode).toBe('cash');
    expect(lastPayment.amount).toBe(price);
    // Server-allocated invoice number (prefix + running counter) — the
    // concrete "invoice issued" proof the task calls out.
    expect(paidBill?.invoiceNumber).toBeTruthy();
    expect(String(paidBill.invoiceNumber).length).toBeGreaterThan(0);

    // Real state change #2: the screen locks into its post-payment summary —
    // the catalogue swaps for a read-only "Tests in this Order" recap
    // (orderLocked() via paidOrderId()) showing the exact test we bought.
    // The screen locks into its post-order summary: the test, nothing due.
    await expect(page.locator('.pf-payment-due-tests')).toContainText(/Tests in this Order \(1\)/i);
    await expect(page.locator('.pf-payment-due-tests')).toContainText('Fasting Blood Sugar');
    await expect(page.locator('.pf-oc-bill')).toContainText('Payment recorded');
    await expect(page.locator('.pf-oc-bill')).toContainText('Payment completed');
    await expect(page.getByRole('button', { name: 'Print invoice' })).toBeVisible();
  });
});
