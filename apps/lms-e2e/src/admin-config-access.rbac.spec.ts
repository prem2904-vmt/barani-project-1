import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * ADMIN-CONFIG ACCESS MATRIX — a cross-cutting RBAC audit of every
 * /admin/* tenant-configuration screen (plus the ungated /printing station
 * setup), asserted against all 5 working seeded roles at once.
 *
 * Ground truth is apps/lms/src/app/app.routes.ts (route `canActivate`
 * guards), cross-checked against prefrontal-mw's Prefrontal/Seed/RoleSeeder.cs
 * (the actual permission set each seeded role holds) and, for the write-block
 * tests, against Prefrontal/Controllers/ConfigController.cs +
 * TenantsController.cs (`[RequirePermission(...)]` on the mutating endpoints).
 * `permissionGuard(...)` (core/auth/permission.guard.ts) uses OR-semantics
 * and redirects a user holding none of the listed permissions to `/403`,
 * which renders the shared PlaceholderComponent titled "Forbidden" — the
 * block signature asserted throughout. `moduleGuard(...)` failure instead
 * redirects to `/` (landing) — not relevant to any assertion below because,
 * for every route/role pair here, `permissionGuard` alone already decides
 * the outcome (it runs first in the guard array and short-circuits on a
 * redirect before `moduleGuard('inventory')` ever runs).
 *
 * Route → guard (verified in app.routes.ts):
 *   /admin/billing        permissionGuard(['manage_tenant','manage_branches'])
 *   /admin/lab-settings   permissionGuard(['manage_lab_settings','manage_branches'])
 *   /admin/branches       permissionGuard('manage_branches')
 *   /admin/organization   permissionGuard(['manage_branches','manage_tenant'])
 *   /admin/modules        adminGuard = permissionGuard(['manage_tests','manage_users','manage_workflows','manage_branches'])
 *   /admin/notifications  permissionGuard(['manage_tenant','manage_branches'])
 *   /admin/reports        permissionGuard(['manage_tenant','manage_tests'])
 *   /admin/inventory      permissionGuard('manage_inventory') + moduleGuard('inventory')
 *   /printing             NONE — no canActivate at all (open to any signed-in user)
 *
 * Role → permission (RoleSeeder.cs):
 *   admin (Lab Admin)       holds every manage_* permission → reaches all 8 screens.
 *   manager (Branch Manager) holds manage_branch/manage_branches, view_*,
 *                             view_audit_log, manage_home_collection — but
 *                             NOT manage_tenant/manage_tests/manage_lab_settings/
 *                             manage_users/manage_workflows/manage_inventory/
 *                             manage_report_template/manage_notifications.
 *   labTech / sampleCollector / pathologist hold NO manage_* permission at all.
 *
 * ⚠ FINDING — Branch Manager admin-config over-exposure. `manage_branches`
 * is a read-tier "browse the tenant branch list" permission (see RoleSeeder.cs's
 * own comment on the Branch Manager entry), but it is OR'd into the route
 * guard for billing / lab-settings / organization / modules / notifications
 * (and, by extension, `manage_branches` is one of the 4 `adminGuard` perms
 * that also gates plain `/admin`). So a Branch Manager's direct navigation to
 * any of those 5 URLs (6 counting /admin/branches, which is INTENTIONALLY
 * manage_branches-gated) loads the real screen, not /403 — even though the
 * corresponding nav links stay hidden (nav-items.ts gates on the narrower,
 * settings-specific permission). This is proven live in the "Branch Manager
 * over-exposure" describe block below, and BOUNDED by the 3 write-block tests
 * at the bottom of this file: every mutation endpoint behind those screens
 * (`POST /api/config/billing`, `PATCH /api/tenants/current` — used by both
 * Lab Settings' scan-mode toggle and Organization's rename) requires
 * `manage_tenant` specifically, which Branch Manager does NOT hold, so the
 * screen is viewable but not actionable. UI/affordance over-exposure, not a
 * data-mutation leak.
 *
 * ⚠ FINDING — /printing (label/QR/barcode printer setup) has no route guard
 * whatsoever; ANY authenticated user — including sampleCollector/labTech,
 * which hold zero manage_* permissions — can open it directly. Documented,
 * not "fixed": per the route's own comment this is deliberate (the printer +
 * label roll are physical to the station, not a tenant-config secret), but it
 * is still worth a live regression tracker since a future refactor could
 * silently start gating it and this spec would catch that drift too.
 *
 * NOTE — nav-vs-route mismatch (observed, not separately asserted here to
 * avoid flakiness/duplication): several of these routes' guards accept
 * `manage_branches`/`manage_tenant` while their nav-items.ts entries gate on
 * a narrower, settings-specific permission (e.g. `manage_billing_config`,
 * `manage_notifications`). notifications-config.rbac.spec.ts and
 * report-template.rbac.spec.ts already document this drift in detail for
 * those two screens specifically; it is the same root cause as the
 * over-exposure finding above, just from the nav side rather than the route
 * side, so it is not re-asserted here.
 */

const FORBIDDEN_HEADING = /forbidden/i;

async function expectBlocked(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/403$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
  await expect(page.getByText(/you do not have permission/i)).toBeVisible();
}

async function expectAllowed(page: Page, path: string, headingName: RegExp) {
  await page.goto(path);
  // Give the guard + lazy chunk a moment, then confirm we were NOT bounced
  // (neither to /403 by permissionGuard, nor to / by moduleGuard).
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));
  await expect(page.getByRole('heading', { name: headingName, level: 1 })).toBeVisible({ timeout: 15_000 });
}

interface ConfigScreen {
  key: string;
  path: string;
  heading: RegExp;
}

const SCREENS: ConfigScreen[] = [
  { key: 'billing', path: '/admin/billing', heading: /billing config/i },
  { key: 'labSettings', path: '/admin/lab-settings', heading: /lab settings/i },
  { key: 'branches', path: '/admin/branches', heading: /branches\s*&\s*departments/i },
  { key: 'organization', path: '/admin/organization', heading: /organization\s*&\s*identity/i },
  { key: 'modules', path: '/admin/modules', heading: /^modules$/i },
  { key: 'notifications', path: '/admin/notifications', heading: /^notifications$/i },
  { key: 'reports', path: '/admin/reports', heading: /report template/i },
  { key: 'inventory', path: '/admin/inventory', heading: /^inventory$/i },
];

/** The 6 screens whose route guard OR's in `manage_branches` — the finding
 *  above. Everything else in SCREENS is correctly blocked for a manager. */
const MANAGER_REACHABLE = new Set(['billing', 'labSettings', 'branches', 'organization', 'modules', 'notifications']);

test.describe('Admin-config access matrix — admin (Lab Admin) reaches every screen', () => {
  test('admin: reaches all 8 tenant-config screens + /printing', async ({ page }) => {
    await loginAs(page, 'admin');
    for (const s of SCREENS) {
      await expectAllowed(page, s.path, s.heading);
    }
    await expectAllowed(page, '/printing', /^printing$/i);
  });
});

test.describe('Admin-config access matrix — labTech / sampleCollector / pathologist: blocked everywhere', () => {
  for (const role of ['labTech', 'sampleCollector', 'pathologist'] as const) {
    test(`${role}: blocked from every /admin/* config screen`, async ({ page }) => {
      await loginAs(page, role);
      for (const s of SCREENS) {
        await expectBlocked(page, s.path);
      }
    });
  }
});

test.describe('Admin-config access matrix — Branch Manager over-exposure (documented finding)', () => {
  test('manager: reaches billing/lab-settings/branches/organization/modules/notifications via manage_branches; blocked from reports/inventory', async ({ page }) => {
    test.info().annotations.push({
      type: 'finding',
      description:
        "Branch Manager holds manage_branches (RoleSeeder.cs: a read-tier 'browse the tenant branch list' permission), " +
        'which app.routes.ts OR-includes in the route guard for /admin/billing, /admin/lab-settings, /admin/organization, ' +
        '/admin/modules and /admin/notifications (plus /admin/branches, intentionally). So Branch Manager can directly ' +
        'open all 6 real screens, though the nav links to them stay hidden. Bounded by the write-block tests below: the ' +
        'mutation endpoints require manage_tenant specifically, which Branch Manager lacks.',
    });

    await loginAs(page, 'manager');
    for (const s of SCREENS) {
      if (MANAGER_REACHABLE.has(s.key)) {
        await expectAllowed(page, s.path, s.heading);
      } else {
        await expectBlocked(page, s.path);
      }
    }
  });
});

test.describe('Admin-config access matrix — /printing is ungated (documented finding)', () => {
  for (const role of ['sampleCollector', 'labTech', 'pathologist', 'manager', 'admin'] as const) {
    test(`${role}: reaches /printing (no route guard in app.routes.ts)`, async ({ page }) => {
      if (role === 'sampleCollector' || role === 'labTech') {
        test.info().annotations.push({
          type: 'finding',
          description:
            `/printing (label/QR/barcode printer setup) has NO canActivate guard — ${role} holds zero manage_* ` +
            'permissions and still loads the real screen directly. Deliberate per the route comment (station-local ' +
            'printer/label config, not tenant-config), but tracked live so a future accidental gate change is caught.',
        });
      }
      await loginAs(page, role);
      await expectAllowed(page, '/printing', /^printing$/i);
    });
  }
});

test.describe('Admin-config access matrix — Branch Manager write is bounded (the finding\'s bound)', () => {
  // Each test attempts a REAL save as manager and asserts the mutation API
  // 403s — a 403 means nothing was ever written, so the tenant's actual
  // billing/lab-settings/organization config is left untouched regardless of
  // what value was typed/clicked.

  test('manager: Billing Config save is blocked — POST /api/config/billing returns 403', async ({ page }) => {
    await loginAs(page, 'manager');
    await page.goto('/admin/billing');
    await expect(page.getByRole('heading', { name: /billing config/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    // Scope to the screen-header action button so we don't collide with the
    // per-branch "Save" (GSTIN) button that lives on a different tab.
    const saveBtn = page.locator('pf-screen-header').getByRole('button', { name: 'Save', exact: true });
    const postResponse = page.waitForResponse(
      (r) => r.url().includes('/api/config/billing') && r.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await saveBtn.click();
    const resp = await postResponse;
    expect(resp.ok(), 'Branch Manager must NOT be able to write billing config — backend requires manage_tenant').toBe(false);
  });

  test('manager: Lab Settings save is blocked — PATCH /api/tenants/current returns 403', async ({ page }) => {
    await loginAs(page, 'manager');
    await page.goto('/admin/lab-settings');
    await expect(page.getByRole('heading', { name: /lab settings/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    const scanBtn = page.getByRole('button', { name: /^scan \(qr \/ barcode\)/i });
    const manualBtn = page.getByRole('button', { name: /manual entry/i });
    // setScanMode() no-ops if clicked value === current value, so click
    // whichever option is currently OFF — guarantees the PATCH actually
    // fires regardless of what state a prior test run left the tenant in.
    const scanIsOn = (await scanBtn.getAttribute('class'))?.includes('pf-ls__gate-opt--on') ?? false;
    const targetBtn = scanIsOn ? manualBtn : scanBtn;

    const patchResponse = page.waitForResponse(
      (r) => r.url().includes('/api/tenants/current') && r.request().method() === 'PATCH',
      { timeout: 15_000 }
    );
    await targetBtn.click();
    const resp = await patchResponse;
    expect(resp.ok(), 'Branch Manager must NOT be able to write tenant config — backend requires manage_tenant').toBe(false);
  });

  test('manager: Organization name save is blocked — PATCH /api/tenants/current returns 403', async ({ page }) => {
    await loginAs(page, 'manager');
    await page.goto('/admin/organization');
    await expect(page.getByRole('heading', { name: /organization\s*&\s*identity/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    const nameInput = page.getByPlaceholder('e.g. Arun Labs');
    const saveBtn = page.getByRole('button', { name: 'Save name' });
    const current = await nameInput.inputValue();
    await nameInput.fill(`${current} QA-probe`);
    await expect(saveBtn).toBeEnabled();

    const patchResponse = page.waitForResponse(
      (r) => r.url().includes('/api/tenants/current') && r.request().method() === 'PATCH',
      { timeout: 15_000 }
    );
    await saveBtn.click();
    const resp = await patchResponse;
    expect(resp.ok(), 'Branch Manager must NOT be able to rename the org — backend requires manage_tenant').toBe(false);
  });
});
