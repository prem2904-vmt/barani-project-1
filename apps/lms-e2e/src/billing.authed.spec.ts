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
    await page.getByRole('button', { name: 'New Lab Order' }).click();
    await page.waitForURL(new RegExp(`/frontdesk/order\\?patientId=${patient.patientId}`), { timeout: 30_000 });

    // The catalogue is fetched async (GET /api/tests/?activeOnly=true) —
    // wait for the search box before typing into it.
    const search = page.getByPlaceholder(/search tests or packages/i);
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill('BIO010');

    // Exactly one test card should match this code — click it to add to cart.
    const testCard = page.locator('.pf-rail-card', { hasText: 'Fasting Blood Sugar' });
    await expect(testCard).toHaveCount(1, { timeout: 20_000 });
    await testCard.click();

    // Real state change #1: the cart reflects the added test, priced at ₹30.
    await expect(page.locator('.pf-cart-name', { hasText: 'Fasting Blood Sugar' })).toBeVisible();
    await expect(page.locator('.pf-cart-line--total')).toContainText('₹30.00');

    // Inline payment pane appears once a patient + ≥1 test are attached
    // (showInlinePay() — front_desk billing mode, not editing an order).
    const ipp = page.locator('.pf-ipp');
    await expect(ipp).toBeVisible({ timeout: 20_000 });

    // Select the Cash tile (it's the panel's default, but click it explicitly
    // — this is the real action a front-desk user takes).
    await ipp.locator('.pf-ipp__modes').getByRole('button', { name: 'Cash', exact: true }).click();

    // Cash num-pad + exact-tender gate: InlinePaymentPanelComponent.canConfirm()
    // for cash mode requires cashNum() >= amount() && amount() > 0. "Exact"
    // (setExactCash()) fills the tendered amount to exactly the cart total —
    // the deterministic way to clear that gate without hard-coding the price.
    await page.getByRole('button', { name: 'Exact', exact: true }).click();
    await expect(page.locator('.pf-cash__amt')).toHaveText('₹30.00');
    await expect(page.locator('.pf-cash__change')).toContainText('Exact — no change due');

    const confirmBtn = page.getByRole('button', { name: /confirm payment/i });
    await expect(confirmBtn).toBeEnabled();

    // Capture the real backend responses for the three sequential calls
    // confirmPayment() makes: create order, create bill, record payment.
    // These are the load-bearing proof that a payment actually landed
    // server-side, not just that the UI stopped complaining.
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
    expect(bill?.totalPayable).toBe(30);
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
    expect(paidBill?.totalPayable).toBe(30);
    expect(paidBill?.totalPaid).toBe(30);
    expect(paidBill?.balance).toBe(0);
    expect(paidBill?.status).toBe('paid');
    expect(paidBill?.payments?.length).toBeGreaterThan(0);
    const lastPayment = paidBill.payments[paidBill.payments.length - 1];
    expect(lastPayment.mode).toBe('cash');
    expect(lastPayment.amount).toBe(30);
    // Server-allocated invoice number (prefix + running counter) — the
    // concrete "invoice issued" proof the task calls out.
    expect(paidBill?.invoiceNumber).toBeTruthy();
    expect(String(paidBill.invoiceNumber).length).toBeGreaterThan(0);

    // Real state change #2: the screen locks into its post-payment summary —
    // the catalogue swaps for a read-only "Tests in this Order" recap
    // (orderLocked() via paidOrderId()) showing the exact test we bought.
    await expect(page.locator('.pf-payment-due-tests')).toContainText('Tests in this Order (1)');
    await expect(page.locator('.pf-readonly-test-card', { hasText: 'Fasting Blood Sugar' })).toBeVisible();

    // Real state change #3: "Payment recorded" (not "Advance recorded" —
    // that only shows when balance > 0, i.e. a partial/advance payment).
    const paidPanel = page.locator('.pf-paid');
    await expect(paidPanel).toBeVisible({ timeout: 10_000 });
    await expect(paidPanel.locator('.pf-paid__msg')).toHaveText(/payment recorded/i);

    // The Total / Paid / Balance due summary reflects the fully-settled bill.
    const summary = paidPanel.locator('.pf-paid__summary');
    await expect(summary).toBeVisible();
    await expect(summary.locator('.pf-paid__sumline').nth(0)).toContainText('₹30.00'); // Total
    await expect(summary.locator('.pf-paid__sumline').nth(1)).toContainText('₹30.00'); // Paid
    await expect(summary.locator('.pf-paid__sumline--due')).toContainText('₹0.00'); // Balance due

    // Invoice is reachable from the UI too.
    await expect(paidPanel.getByRole('button', { name: 'Print invoice' })).toBeVisible();
  });
});
