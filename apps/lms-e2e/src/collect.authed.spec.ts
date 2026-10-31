import { test, expect } from '@playwright/test';
import { registerPatient, createOrder } from './support/flows';

/**
 * Stage 3 of the clinical flow — collect the sample for a just-placed order.
 *
 * Each run registers a brand-new patient and places a fresh order (stages 1
 * + 2, via support/flows.ts) so the sample-collection screen (apps/lms/src/
 * app/features/lab/sample-collection/) has exactly one clean pending tube to
 * work with — no leftover state from other test runs to accidentally match.
 *
 * Sample-ID mode: Micro World's tenant record (GET /api/tenants/current)
 * reports `"scanMode": "scan"` — ScanService.manualEntry() is false here, so
 * the *queue* screen (/lab/collect with no ?orderId) would normally show a
 * camera-scanner button, which doesn't exist in headless Chrome. We sidestep
 * that entirely by using the same **deep-link entry point** the app's own
 * front-desk "Collect Sample" button uses (order-create.component.ts::
 * collectPaidSample() → router.navigate(['/lab/collect'], { queryParams:
 * { orderId, from } })): SampleCollectionComponent's deepLinkMode (set
 * whenever ?orderId=… is present) hides the queue list AND the scan/camera
 * row entirely and opens that order's collect drawer directly
 * (sample-collection.component.html:12,30). This is a real, first-class app
 * flow — not a test-only bypass — and it holds regardless of tenant scan
 * mode, so the spec doesn't need to fight a camera in either mode.
 *
 * Inside the drawer, tapping a pending vial (.pf-tube) calls
 * onVialClick → toggleCollected → markCollected(), which optimistically
 * flips the tube to 'collected' and PATCHes /api/samples/{id}/collect.
 */

test.describe('Collect sample', () => {
  test('collects the single tube on a freshly-placed order', async ({ page }) => {
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient);

    // Deep-link straight into that order's collect drawer — the same
    // navigation the app's own "Collect Sample" button performs.
    await page.goto(`/lab/collect?orderId=${order.orderId}&from=/frontdesk`);

    // Deep-link mode: the drawer takes over the page once the order loads
    // (sample-collection.component.html's loading-logo branch resolves).
    const drawer = page.locator('.pf-drawer__panel');
    await expect(drawer).toBeVisible({ timeout: 15_000 });

    // Exactly one tube (the single BIO108 test we ordered), starting pending.
    const tube = page.locator('.pf-tube');
    await expect(tube).toHaveCount(1, { timeout: 10_000 });
    await expect(tube).not.toHaveClass(/pf-tube--done/);
    await expect(drawer).toContainText('0/1');
    await expect(tube.locator('.pf-tube__stamp')).toHaveText(/tap when drawn/i);

    // Tap the vial — real state change: PATCH /api/samples/{id}/collect
    // fires and must succeed server-side, not just flip the UI optimistically.
    const [collectResponse] = await Promise.all([
      page.waitForResponse(
        r => /\/api\/samples\/[0-9a-f-]{36}\/collect$/i.test(r.url()) && r.request().method() === 'PATCH',
      ),
      tube.click(),
    ]);
    expect(collectResponse.ok()).toBe(true);

    // Real state change #1: the tube card flips to its collected look —
    // the "done" class, the green tick badge's timestamp stamp instead of
    // "Tap when drawn".
    await expect(tube).toHaveClass(/pf-tube--done/);
    await expect(tube.locator('.pf-tube__stamp')).not.toHaveText(/tap when drawn/i);

    // Real state change #2: the drawer's own progress counter advances.
    await expect(drawer).toContainText('1/1');

    // Real state change #3: with every vial drawn, the footer swaps its
    // "N remaining" note for the "All vials collected" stamp, and the
    // Done button (disabled while any vial is still pending — doneDisabled())
    // becomes clickable.
    const doneBtn = page.getByRole('button', { name: /^done$/i });
    await expect(doneBtn).toBeEnabled();
  });
});
