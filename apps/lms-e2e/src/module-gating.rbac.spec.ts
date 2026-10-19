import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * HOSPITAL-MODULE GATING — Micro World is a LAB-ONLY tenant.
 *
 * All eight hospital modules (opd/ipd/pharmacy/payroll/insurance/radiology/
 * emergency/bloodbank) default to `enabled: false` in the module catalog
 * (core/modules/module-catalog.ts) and Micro World has no entitlement rows for
 * them, so:
 *   - Routed modules /opd /ipd /pharmacy /payroll carry `moduleGuard(key)`,
 *     which resolves the catalog default (false) and REDIRECTS to `/` — it does
 *     NOT fail open to true. (The doc-comment on module.guard.ts says
 *     "fail-open", but the real path through moduleOn() returns the catalog
 *     default, so hospital modules are effectively fail-CLOSED.)
 *   - Un-routed modules /radiology /blood-bank /emergency /insurance have NO
 *     top-level route at all, so they fall through the `**` wildcard to landing.
 * Either way the hospital module screen must never render for this tenant.
 *
 * The only deliberate carve-out: the /admin/<module> "coming soon" roadmap
 * stubs are gated by adminGuard ONLY (no moduleGuard), so a Lab Admin can open
 * those static placeholders even with the module off (app.routes.ts:100-135,
 * comment: "placeholder is visible regardless of entitlement"). That is
 * intentional and asserted below as a documented carve-out, not a leak.
 */

// Top-level module routes behind moduleGuard (default off → redirect to /).
const ROUTED_MODULES = ['/opd', '/ipd', '/pharmacy', '/payroll'];
// No top-level route at all → ** wildcard → landing.
const UNROUTED_MODULES = ['/radiology', '/blood-bank', '/emergency', '/insurance'];
// The admin roadmap stubs (adminGuard only, no moduleGuard) — reachable by admin.
const ADMIN_ROADMAP_STUBS = [
  '/admin/opd', '/admin/ipd', '/admin/pharmacy', '/admin/payroll',
  '/admin/insurance', '/admin/radiology', '/admin/emergency', '/admin/blood-bank',
];

const pathOf = (page: Page) => new URL(page.url()).pathname;

/** The hospital-module screen must not render: navigation is redirected away
 *  from the module path (to landing) by moduleGuard or the ** wildcard. */
async function expectModuleGatedOff(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
  // Redirect settles synchronously in the guard/router; give it a beat, then
  // assert we are NOT sitting on the hospital-module path.
  await expect.poll(() => pathOf(page), { timeout: 10_000 }).not.toBe(path);
  await page.waitForTimeout(400);
  expect(pathOf(page), `hospital module ${path} must not render for a lab-only tenant`).not.toBe(path);
}

test.describe('Hospital-module gating — lab-only tenant (Micro World)', () => {
  test('admin: every hospital module route is gated OFF (redirected away)', async ({ page }) => {
    // Even the most-privileged role cannot reach a hospital module when the
    // tenant lacks the entitlement — gating is tenant-level, not role-level.
    test.slow();
    await loginAs(page, 'admin');
    for (const p of [...ROUTED_MODULES, ...UNROUTED_MODULES]) {
      await expectModuleGatedOff(page, p);
    }
  });

  test('labTech: hospital module routes are gated OFF too', async ({ page }) => {
    test.slow();
    await loginAs(page, 'labTech');
    for (const p of [...ROUTED_MODULES, ...UNROUTED_MODULES]) {
      await expectModuleGatedOff(page, p);
    }
  });

  test('admin: /admin/<module> roadmap stubs ARE reachable (documented carve-out)', async ({ page }) => {
    test.slow();
    test.info().annotations.push({
      type: 'finding',
      description:
        'Deliberate carve-out (not a leak): the /admin/<module> "coming soon" roadmap stubs ' +
        '(admin/opd, admin/ipd, admin/pharmacy, admin/payroll, admin/insurance, admin/radiology, ' +
        'admin/emergency, admin/blood-bank) are gated by adminGuard ONLY — no moduleGuard — so a Lab ' +
        'Admin reaches these static placeholders even though every hospital module is entitlement-OFF ' +
        'for this lab-only tenant. Intentional per app.routes.ts:100-103. They are roadmap hubs, not ' +
        'the modules themselves; no functional hospital screen is reachable.',
    });
    await loginAs(page, 'admin');
    for (const p of ADMIN_ROADMAP_STUBS) {
      await page.goto(p);
      await expect(page, `admin roadmap stub ${p} should load (adminGuard only)`).toHaveURL(
        new RegExp(p.replace(/\//g, '\\/') + '$'),
      );
    }
  });
});
