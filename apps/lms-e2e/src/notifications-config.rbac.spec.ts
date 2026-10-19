import { test, expect, type Page, type Response } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * NOTIFICATIONS CONFIG (/admin/notifications) — the in-app notification
 * catalog: enable/disable per event, overdue-alert thresholds, who each
 * event notifies — AND the permission gate around the screen.
 *
 * Ground truth:
 *  - UI: apps/lms/src/app/features/admin/notifications-config/notifications-config.component.ts
 *    Loads GET /api/config/notifications/catalog (one row per catalog event,
 *    merged with the tenant's override), renders it grouped by module with
 *    filter chips, and autosaves each toggle/threshold edit with a single
 *    POST /api/config/notifications carrying the row's full state
 *    ({ eventType, inAppEnabled, thresholdMinutes }) — a toggle never wipes a
 *    saved threshold because both are always sent together.
 *  - Catalog source of truth: prefrontal-mw Prefrontal/Services/NotificationCatalog.cs
 *    — every dropdown/label/threshold default here must trace back to that
 *    file's `Events` list (per project memory: "NotificationCatalog.cs is the
 *    single source of truth").
 *  - Route guard: apps/lms/src/app/app.routes.ts →
 *      path: 'admin/notifications',
 *      canActivate: [permissionGuard(['manage_tenant', 'manage_branches'])]
 *    ⚠ FINDING — the route guard does NOT list `manage_notifications`, even
 *    though that's the permission the memory/task describes as the gate and
 *    even though the backend GETs accept it
 *    (ConfigController.cs: [RequirePermission("manage_tenant",
 *    "manage_branches", "manage_notifications")] on both
 *    /notifications and /notifications/catalog). In practice this is moot for
 *    our seeded roles because only "Lab Admin" holds manage_notifications
 *    and Lab Admin also holds manage_tenant — but a role granted
 *    manage_notifications alone (without manage_tenant/manage_branches)
 *    would be able to fetch the catalog from the API yet get bounced to
 *    /403 by the frontend guard. Same class of bug as documented in
 *    admin-settings.rbac.spec.ts for /admin/lab-settings and /admin/billing.
 *
 *    Separately, and more visibly: because the guard OR's in
 *    `manage_branches`, and RoleSeeder.cs grants Branch Manager
 *    `manage_branches` (read-only browsing, per that role's own comment),
 *    a Branch Manager's direct navigation to /admin/notifications is NOT
 *    blocked — the real screen loads, same as the lab-settings/billing
 *    finding. The backend write endpoint
 *    (POST /api/config/notifications) is gated to `manage_tenant` ONLY, so a
 *    Branch Manager cannot actually persist a change — confirmed below.
 *
 *  - Per RoleSeeder.cs, "Lab Technician" holds none of manage_tenant /
 *    manage_branches / manage_notifications, so it is cleanly blocked.
 *
 * Event catalog picked for the functional assertions (both currently unused
 * by any other e2e spec, so toggling them here can't cross-contaminate other
 * specs' expectations):
 *   - "user_created" (team module, kind: instant, default ON, no threshold)
 *     — used for the enable/disable assertion.
 *   - "validation_overdue" (results module, kind: overdue, default ON,
 *     default threshold 120 min, thresholdConfigurable: true) — used for the
 *     threshold-edit assertion.
 * Both are restored to their catalog defaults in a `finally` block.
 */

const CATALOG_URL = '**/api/config/notifications/catalog';
const SAVE_URL = '**/api/config/notifications';
const FORBIDDEN_HEADING = /forbidden/i;

async function gotoNotifications(page: Page) {
  const catalogResp = page.waitForResponse(
    r => r.url().includes('/api/config/notifications/catalog') && r.request().method() === 'GET'
  );
  await page.goto('/admin/notifications');
  return catalogResp;
}

/** Reload while on /admin/notifications and wait for the fresh catalog GET —
 *  a single navigation (unlike calling gotoNotifications + page.reload(),
 *  which races two navigations and aborts one with ERR_ABORTED). */
async function reloadNotifications(page: Page) {
  const catalogResp = page.waitForResponse(
    r => r.url().includes('/api/config/notifications/catalog') && r.request().method() === 'GET'
  );
  await page.reload();
  await catalogResp;
}

function tileFor(page: Page, label: string | RegExp) {
  // pf-tile rows render the event label as a <p>; walk up to the tile that
  // contains it so we can scope the toggle/number-input queries.
  return page.locator('pf-tile').filter({ has: page.getByText(label, { exact: true }) });
}

async function saveResponseFor(page: Page, eventType: string, action: () => Promise<void>): Promise<Response> {
  const resp = page.waitForResponse(
    r => r.url().includes('/api/config/notifications') && !r.url().includes('/catalog')
      && r.request().method() === 'POST'
      && (r.request().postDataJSON()?.eventType === eventType),
    { timeout: 15_000 }
  );
  await action();
  return resp;
}

test.describe('Notifications config — functional (as admin)', () => {
  test('catalog renders known events grouped by module, with recipients shown per event', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoNotifications(page);
    await expect(page.getByRole('heading', { name: /^notifications$/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    // Module filter chips — "All" plus at least the modules we know the
    // catalog declares (NotificationCatalog.Modules).
    await expect(page.getByRole('button', { name: /^all\b/i })).toBeVisible();
    for (const chip of [/front desk & orders/i, /billing & payments/i, /lab bench/i, /results & validation/i,
                         /reports/i, /inventory/i, /appointments & home collection/i, /team & platform/i]) {
      await expect(page.getByRole('button', { name: chip })).toBeVisible();
    }

    // A representative event from each of a few modules — proves the
    // catalog rows actually came from NotificationCatalog.cs, not a stub.
    await expect(page.getByText('New sample to collect', { exact: true })).toBeVisible();
    await expect(page.getByText('Report ready', { exact: true })).toBeVisible();
    await expect(page.getByText('Critical result entered', { exact: true })).toBeVisible();
    await expect(page.getByText('Item below reorder level', { exact: true })).toBeVisible();

    // "Who receives" mapping — recipients text renders per event.
    const sampleReadyTile = tileFor(page, 'New sample to collect');
    await expect(sampleReadyTile.getByText(/notifies:\s*sample collectors of the branch/i)).toBeVisible();

    const criticalTile = tileFor(page, 'Critical result entered');
    await expect(criticalTile.getByText(/notifies:\s*the entering technician and validators of the branch/i)).toBeVisible();

    // Overdue events carry the "overdue watch" badge + a clock icon variant.
    const tatBreachTile = tileFor(page, 'Test past TAT');
    await expect(tatBreachTile.getByText(/overdue watch/i)).toBeVisible();
  });

  test('enable/disable an event → saves → persists across reload → restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoNotifications(page);
    await expect(page.getByRole('heading', { name: /^notifications$/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    // Isolate to the Team & platform module so the toggle we click is
    // unambiguous.
    await page.getByRole('button', { name: /team & platform/i }).click();
    const row = tileFor(page, 'New staff account created');
    await expect(row).toBeVisible();
    const toggle = row.getByRole('switch');
    const originallyOn = (await toggle.getAttribute('aria-checked')) === 'true';
    expect(originallyOn, 'expected "New staff account created" to start enabled (catalog default)').toBe(true);

    try {
      // Turn it OFF.
      const offResp = await saveResponseFor(page, 'user_created', () => toggle.click());
      expect(offResp.ok(), 'save (disable) should succeed for admin').toBe(true);
      expect(offResp.request().postDataJSON()).toMatchObject({ eventType: 'user_created', inAppEnabled: false });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByText(/new staff account created off/i)).toBeVisible({ timeout: 10_000 });

      // Reload — confirm the OFF state is server-persisted, not just local signal state.
      await reloadNotifications(page);
      await page.getByRole('button', { name: /team & platform/i }).click();
      const rowAfterReload = tileFor(page, 'New staff account created');
      await expect(rowAfterReload.getByRole('switch')).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 });
    } finally {
      // Restore to ON regardless of assertion outcome above.
      await page.getByRole('button', { name: /team & platform/i }).click().catch(() => {});
      const restoreRow = tileFor(page, 'New staff account created');
      const restoreToggle = restoreRow.getByRole('switch');
      if ((await restoreToggle.getAttribute('aria-checked')) !== 'true') {
        const onResp = await saveResponseFor(page, 'user_created', () => restoreToggle.click());
        expect(onResp.ok(), 'restore (enable) POST should succeed').toBe(true);
      }
      await expect(restoreToggle).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });

      // Confirm restore persisted too.
      await reloadNotifications(page);
      await page.getByRole('button', { name: /team & platform/i }).click();
      await expect(tileFor(page, 'New staff account created').getByRole('switch'))
        .toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    }
  });

  test('overdue threshold edit → saves → persists across reload → restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoNotifications(page);
    await expect(page.getByRole('heading', { name: /^notifications$/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /results & validation/i }).click();
    const row = tileFor(page, 'Validation overdue');
    await expect(row).toBeVisible();
    await expect(row.getByText(/overdue watch/i)).toBeVisible();

    const input = row.locator('pf-number-input input.field');
    await expect(input).toBeVisible();
    const original = await input.inputValue();
    expect(original, 'catalog default threshold for validation_overdue is 120 min').toBe('120');

    const NEW_VALUE = '135';
    try {
      const editResp = await saveResponseFor(page, 'validation_overdue', async () => {
        await input.fill(NEW_VALUE);
        await input.blur();
      });
      expect(editResp.ok(), 'threshold save should succeed for admin').toBe(true);
      expect(editResp.request().postDataJSON()).toMatchObject({ eventType: 'validation_overdue', thresholdMinutes: 135 });
      await expect(page.getByText(/validation overdue: after 135 min/i)).toBeVisible({ timeout: 10_000 });

      // Reload — confirm the new threshold is server-persisted.
      await reloadNotifications(page);
      await page.getByRole('button', { name: /results & validation/i }).click();
      const inputAfterReload = tileFor(page, 'Validation overdue').locator('pf-number-input input.field');
      await expect(inputAfterReload).toHaveValue('135', { timeout: 15_000 });
    } finally {
      await page.getByRole('button', { name: /results & validation/i }).click().catch(() => {});
      const restoreRow = tileFor(page, 'Validation overdue');
      const restoreInput = restoreRow.locator('pf-number-input input.field');
      const current = await restoreInput.inputValue().catch(() => null);
      if (current !== original) {
        const restoreResp = await saveResponseFor(page, 'validation_overdue', async () => {
          await restoreInput.fill(original);
          await restoreInput.blur();
        });
        expect(restoreResp.ok(), 'restore threshold POST should succeed').toBe(true);
      }

      await reloadNotifications(page);
      await page.getByRole('button', { name: /results & validation/i }).click();
      await expect(tileFor(page, 'Validation overdue').locator('pf-number-input input.field'))
        .toHaveValue(original, { timeout: 15_000 });
    }
  });
});

test.describe('Notifications config — permission gate', () => {
  test('labTech (Lab Technician): blocked from /admin/notifications → /403', async ({ page }) => {
    await loginAs(page, 'labTech');
    await page.goto('/admin/notifications');
    await page.waitForURL(/\/403$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
    await expect(page.getByText(/you do not have permission/i)).toBeVisible();
  });

  test('manager (Branch Manager): NOT blocked from the screen (finding: manage_branches ' +
       'fallback) but cannot persist a change (backend POST requires manage_tenant only)', async ({ page }) => {
    await loginAs(page, 'manager');

    // ⚠ Reaches the real screen — same root cause as the lab-settings/billing
    // finding in admin-settings.rbac.spec.ts: the route guard OR's in
    // manage_branches, which Branch Manager holds.
    await gotoNotifications(page);
    await expect(page).toHaveURL(/\/admin\/notifications$/);
    await expect(page.getByRole('heading', { name: /^notifications$/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    // Attempt a write — must be rejected server-side even though the UI let
    // the click through.
    await page.getByRole('button', { name: /team & platform/i }).click();
    const row = tileFor(page, 'New staff account created');
    await expect(row).toBeVisible();
    const toggle = row.getByRole('switch');
    const before = await toggle.getAttribute('aria-checked');

    const resp = page.waitForResponse(
      r => r.url().includes('/api/config/notifications') && !r.url().includes('/catalog') && r.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await toggle.click();
    const postResp = await resp;
    expect(postResp.ok(), 'Branch Manager must NOT be able to write notification config — backend should 401/403 this POST').toBe(false);

    // No cleanup needed: the write was rejected, so nothing changed server-side.
    // (Local optimistic UI state may have flipped the toggle, but that's
    // discarded on navigation/reload — never persisted.)
    void before;
  });
});
