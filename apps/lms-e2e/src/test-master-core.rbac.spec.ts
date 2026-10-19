import { test, expect, type Page, type Locator } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * TEST MASTER CORE — /admin/tests (the catalogue: individual tests, profiles,
 * packages) — functionality AND its permission gate.
 *
 * Ground truth for the gate: apps/lms/src/app/app.routes.ts guards
 * '/admin/tests', '/admin/tests/new' and '/admin/tests/:id/edit' with
 * permissionGuard('manage_tests') only — a single-permission guard (unlike
 * lab-settings/billing, which OR in manage_branches — see
 * admin-settings.rbac.spec.ts for that finding). Per prefrontal-mw's
 * RoleSeeder.cs only "Lab Admin" holds manage_tests; Lab Technician and
 * Branch Manager hold neither, so both are blocked here, full stop.
 *
 * UI ground truth: apps/lms/src/app/features/admin/tests/tests/tests.component.ts
 * (the grid) and .../test-editor/test-editor.component.ts (the create/edit
 * form). Backend: prefrontal-mw's TestsController.cs — Create/Update both
 * enforce a case-insensitive unique TestCode per tenant (409 "duplicate_code"),
 * a "profile" MUST carry a TestCode, a "package" MUST NOT.
 *
 * Uniqueness: every created name/code is suffixed with a Date.now()-based id
 * so repeat runs never collide with leftover data from a previous run.
 */

function uid(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

// ── Editor-page helpers ─────────────────────────────────────────────────
// The identity "Name" input, sibling to a <label class="pf-label">Name</label>.
function nameInput(page: Page): Locator {
  return page.locator('xpath=//label[normalize-space(text())="Name"]/following-sibling::input');
}

// Test code / Profile code share one input (label text differs by type).
function codeInput(page: Page): Locator {
  return page.locator('input[placeholder="e.g. CBC001"], input[placeholder="e.g. LIPID01"]');
}

function unitInput(page: Page): Locator {
  return page.locator('input[placeholder="e.g. mg/dL"]');
}

/** pf-select is a custom combobox (no native <select>) whose panel is
 *  portalled to a body-level overlay host. Open the trigger that sits next
 *  to `labelText`, then click the option matching `optionText`. */
async function pickSelect(page: Page, labelText: string, optionText: string | RegExp): Promise<void> {
  const trigger = page.locator(
    `xpath=//label[normalize-space(text())="${labelText}"]/following-sibling::pf-select//button[@aria-haspopup="listbox"]`
  );
  await trigger.click();
  const panel = page.locator('[role="listbox"]');
  await expect(panel).toBeVisible();
  const option = typeof optionText === 'string'
    ? panel.getByRole('option', { name: optionText, exact: true })
    : panel.getByRole('option', { name: optionText });
  await option.first().click();
}

/** Opens the Department pf-select and picks the first REAL department
 *  (index 0 is the "— None —" placeholder). Returns its label text. */
async function pickFirstDepartment(page: Page): Promise<string> {
  const trigger = page.locator(
    'xpath=//label[normalize-space(text())="Department"]/following-sibling::pf-select//button[@aria-haspopup="listbox"]'
  );
  await trigger.click();
  const panel = page.locator('[role="listbox"]');
  await expect(panel).toBeVisible();
  const options = panel.getByRole('option');
  await expect(options.nth(1)).toBeVisible();
  const label = (await options.nth(1).innerText()).trim();
  await options.nth(1).click();
  return label;
}

/** Reference-range block: numeric "Normal min"/"Normal max" pf-number-input,
 *  each nested in a <label> whose <span class="pf-mini-lbl"> names it. */
function normalRangeInput(page: Page, which: 'Normal min' | 'Normal max'): Locator {
  return page.locator(
    `xpath=//label[.//span[normalize-space(text())="${which}"]]//input`
  );
}

async function fillNumberInput(locator: Locator, value: string): Promise<void> {
  await locator.click();
  await locator.fill(value);
  await locator.press('Tab');
}

/** Picks the first `count` NOT-YET-selected package/profile members from the
 *  picker grid, one at a time (selecting one re-renders a duplicate "Selected"
 *  entry at the top, so re-querying `:not(.pf-pkg-pick--on)` after each click
 *  keeps indices honest). Returns the picked names. */
async function pickFirstUnselectedMembers(page: Page, count: number): Promise<string[]> {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = page.locator('.pf-pkg-pick:not(.pf-pkg-pick--on)').first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const name = (await row.locator('.pf-pkg-pick__name').innerText()).trim();
    names.push(name);
    await row.locator('input[type="checkbox"]').click();
  }
  return names;
}

async function gotoNewTest(page: Page): Promise<void> {
  await page.goto('/admin/tests/new');
  await expect(page.getByRole('heading', { level: 1, name: /^create test$/i })).toBeVisible({ timeout: 15_000 });
}

async function searchGrid(page: Page, query: string): Promise<void> {
  const box = page.locator('.pf-tm-search__input');
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.fill(query);
}

test.describe('Test Master core — admin functional flow', () => {
  test.describe.configure({ mode: 'serial' });

  // Shared across the "duplicate-guard" test, set by the first test.
  let existingIndividualCode = '';
  // Shared with the "package" test, set by the "profile" test, to prove the
  // Packages tab specifically excludes THIS profile.
  let createdProfileName = '';

  test('admin: create an individual test (name, code, department, numeric parameter + unit + reference range) — persists and appears in the grid', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAs(page, 'admin');
    await gotoNewTest(page);

    const suffix = uid();
    const name = `E2E Individual ${suffix}`;
    const code = `E2E${suffix}`.toUpperCase();
    existingIndividualCode = code;

    await nameInput(page).fill(name);
    await codeInput(page).fill(code);
    const deptLabel = await pickFirstDepartment(page);
    expect(deptLabel.length).toBeGreaterThan(0);

    // Results section: set the unit, then add a reference range (creates the
    // test's single numeric parameter, seeded with that unit). The nav
    // button's accessible name is "Results" + its description span, so match
    // on the leading word only.
    await page.getByRole('button', { name: /^Results/ }).click();
    await unitInput(page).fill('mg/dL');
    await page.getByRole('button', { name: /add a reference range/i }).click();
    await fillNumberInput(normalRangeInput(page, 'Normal min'), '10');
    await fillNumberInput(normalRangeInput(page, 'Normal max'), '50');

    const createResp = page.waitForResponse(r =>
      r.url().includes('/api/tests/') && r.request().method() === 'POST', { timeout: 15_000 });
    await page.getByRole('button', { name: /^save$/i }).click();
    const resp = await createResp;
    expect(resp.ok(), 'POST /api/tests/ must succeed for a well-formed individual test').toBe(true);

    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe(name);
    expect(body.data.testCode).toBe(code);
    expect(body.data.unit).toBe('mg/dL');
    // The single numeric parameter carries the reference-range band we typed.
    const parsedParams = JSON.parse(body.data.parameters);
    const param = parsedParams.parameters[0];
    expect(param.referenceRanges[0].min).toBe(10);
    expect(param.referenceRanges[0].max).toBe(50);

    // Back on the grid (individual tab) — find it via search.
    await expect(page).toHaveURL(/\/admin\/tests(\?.*type=individual.*)?$/, { timeout: 15_000 });
    await searchGrid(page, code);
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(code, { exact: true })).toBeVisible();
  });

  test('admin: create a profile bundling two existing tests — persists and its members expand in the grid tree', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAs(page, 'admin');
    await gotoNewTest(page);

    await pickSelect(page, 'Type', 'Profile');
    await expect(page.getByRole('heading', { level: 1, name: /^create profile$/i })).toBeVisible({ timeout: 10_000 });

    const suffix = uid();
    const name = `E2E Profile ${suffix}`;
    const code = `E2EPRO${suffix}`.toUpperCase();
    createdProfileName = name;

    await nameInput(page).fill(name);
    await codeInput(page).fill(code);

    // Member picker renders directly under Identity for non-individual types.
    await expect(page.getByRole('heading', { name: /profile members/i })).toBeVisible({ timeout: 10_000 });
    // Two DISTINCT member rows are ticked (verified below via the saved
    // items[] length); the seeded catalogue can have same-named tests in
    // different departments, so member *display names* are not asserted
    // unique here — only that two rows were picked.
    const members = await pickFirstUnselectedMembers(page, 2);
    expect(members.length).toBe(2);

    const createResp = page.waitForResponse(r =>
      r.url().includes('/api/tests/') && r.request().method() === 'POST', { timeout: 15_000 });
    await page.getByRole('button', { name: /^save$/i }).click();
    const resp = await createResp;
    expect(resp.ok(), 'POST /api/tests/ must succeed for a profile with >=2 members').toBe(true);

    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.data.type).toBe('profile');
    expect(body.data.testCode).toBe(code);
    const items = JSON.parse(body.data.parameters).items;
    expect(items.length).toBe(2);

    // Grid tree: root row, expand, both member names appear as children.
    // (`.first()` on each name — the seeded catalogue can have same-named
    // tests in different departments, so a member's name is not guaranteed
    // globally unique; the real uniqueness check is items.length===2 above.)
    await expect(page).toHaveURL(/\/admin\/tests(\?.*type=profile.*)?$/, { timeout: 15_000 });
    await searchGrid(page, code);
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Expand' }).click();
    for (const m of members) {
      await expect(page.getByText(m, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('admin: create a package — persists, and the Packages tab does NOT list profiles', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAs(page, 'admin');
    await gotoNewTest(page);

    await pickSelect(page, 'Type', 'Package');
    await expect(page.getByRole('heading', { level: 1, name: /^create package$/i })).toBeVisible({ timeout: 10_000 });

    const suffix = uid();
    const name = `E2E Package ${suffix}`;
    // Packages carry no test code (NormalizeBundleTestCode nulls it server-side).
    await nameInput(page).fill(name);

    await expect(page.getByRole('heading', { name: /package members/i })).toBeVisible({ timeout: 10_000 });
    const members = await pickFirstUnselectedMembers(page, 1);
    expect(members.length).toBe(1);

    const createResp = page.waitForResponse(r =>
      r.url().includes('/api/tests/') && r.request().method() === 'POST', { timeout: 15_000 });
    await page.getByRole('button', { name: /^save$/i }).click();
    const resp = await createResp;
    expect(resp.ok(), 'POST /api/tests/ must succeed for a package').toBe(true);

    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.data.type).toBe('package');
    expect(body.data.testCode ?? null).toBeNull();
    expect(body.data.name).toBe(name);

    // It shows up on the Packages tab...
    await expect(page).toHaveURL(/\/admin\/tests(\?.*type=package.*)?$/, { timeout: 15_000 });
    await searchGrid(page, name);
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });

    // ...but the profile created in the previous test must NOT be reachable
    // from the Packages tab — per memory (Packages tab must not list
    // profiles). tests.component.ts filters the tab's rowData strictly by
    // `t.type === this._type()`, so a profile's name should never surface
    // here even when searched for directly.
    expect(createdProfileName, 'depends on the profile test having run first').not.toBe('');
    await searchGrid(page, createdProfileName);
    await expect(page.getByText(createdProfileName, { exact: true })).toHaveCount(0);
    await expect(page.locator('.pf-tm-count-badge')).toHaveText(/0\s*packages/i, { timeout: 10_000 });
  });

  test('admin: duplicate test code is rejected on create', async ({ page }) => {
    expect(existingIndividualCode, 'depends on the first test in this file having run').not.toBe('');

    await loginAs(page, 'admin');
    await gotoNewTest(page);

    const suffix = uid();
    await nameInput(page).fill(`E2E Duplicate Attempt ${suffix}`);
    await codeInput(page).fill(existingIndividualCode); // reuse an already-saved code

    const createResp = page.waitForResponse(r =>
      r.url().includes('/api/tests/') && r.request().method() === 'POST', { timeout: 15_000 });
    await page.getByRole('button', { name: /^save$/i }).click();
    const resp = await createResp;

    expect(resp.ok(), 'a duplicate test code must be rejected, not saved').toBe(false);
    expect(resp.status()).toBe(409);
    const body = await resp.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('duplicate_code');

    // The form does not navigate away on failure, and surfaces the error.
    await expect(page).toHaveURL(/\/admin\/tests\/new/);
    await expect(page.locator('.toast-msg', { hasText: /already in use/i })).toBeVisible({ timeout: 10_000 });
  });

  test('admin: department enable/disable toggle persists', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/tests');
    await expect(page.getByRole('heading', { level: 1, name: /test master/i })).toBeVisible({ timeout: 15_000 });

    // Side panel starts collapsed — expand it.
    const expandBtn = page.getByRole('button', { name: /show department panel/i });
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
    }

    // Departments are always rendered alphabetically by name (departments()
    // computed sorts on `a.name.localeCompare(b.name)`, independent of
    // isActive), so a fixed position — NOT the aria-label text, which
    // mutates the instant the toggle flips — is the stable handle across
    // the whole flow.
    const deptSwitch = page.locator('.pf-tm-dept-switch').first();
    await expect(deptSwitch).toBeVisible({ timeout: 10_000 });
    const label = (await deptSwitch.getAttribute('aria-label')) ?? '';
    const deptName = label.replace(/^(Disable|Enable)\s+/, '');
    const initiallyOn = (await deptSwitch.getAttribute('aria-pressed')) === 'true';

    // Flip it.
    const patch1 = page.waitForResponse(r =>
      /\/api\/tenants\/departments\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 15_000 });
    await deptSwitch.click();
    const resp1 = await patch1;
    expect(resp1.ok(), 'department toggle PATCH must succeed').toBe(true);
    await expect(page.locator('.toast-msg', { hasText: initiallyOn ? /disabled/i : /enabled/i })).toBeVisible({ timeout: 10_000 });
    await expect(deptSwitch).toHaveAttribute('aria-pressed', String(!initiallyOn));
    await expect(deptSwitch).toHaveAttribute('aria-label', (initiallyOn ? 'Enable ' : 'Disable ') + deptName);

    // Reload — the flip must have persisted server-side, not just optimistically.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /test master/i })).toBeVisible({ timeout: 15_000 });
    const expandBtn2 = page.getByRole('button', { name: /show department panel/i });
    if (await expandBtn2.isVisible().catch(() => false)) {
      await expandBtn2.click();
    }
    const deptSwitchAfterReload = page.locator('.pf-tm-dept-switch').first();
    await expect(deptSwitchAfterReload).toHaveAttribute('aria-label', (initiallyOn ? 'Enable ' : 'Disable ') + deptName, { timeout: 10_000 });
    await expect(deptSwitchAfterReload).toHaveAttribute('aria-pressed', String(!initiallyOn));

    // Restore original state so the tenant catalogue is left exactly as found.
    const patch2 = page.waitForResponse(r =>
      /\/api\/tenants\/departments\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 15_000 });
    await deptSwitchAfterReload.click();
    const resp2 = await patch2;
    expect(resp2.ok()).toBe(true);
    await expect(deptSwitchAfterReload).toHaveAttribute('aria-pressed', String(initiallyOn));
    await expect(deptSwitchAfterReload).toHaveAttribute('aria-label', (initiallyOn ? 'Disable ' : 'Enable ') + deptName);
  });
});

// ── Permission gate ───────────────────────────────────────────────────────

test.describe('Test Master — permission gate (manage_tests only)', () => {
  test('admin (Lab Admin, holds manage_tests): reaches /admin/tests and /admin/tests/new', async ({ page }) => {
    await loginAs(page, 'admin');

    await page.goto('/admin/tests');
    await expect(page).toHaveURL(/\/admin\/tests$/);
    await expect(page.getByRole('heading', { level: 1, name: /test master/i })).toBeVisible({ timeout: 15_000 });

    await page.goto('/admin/tests/new');
    await expect(page).toHaveURL(/\/admin\/tests\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: /^create test$/i })).toBeVisible({ timeout: 15_000 });
  });

  for (const role of ['labTech', 'manager'] as const) {
    test(`${role}: blocked from /admin/tests and /admin/tests/new (→ /403)`, async ({ page }) => {
      await loginAs(page, role);

      await page.goto('/admin/tests');
      await page.waitForURL(/\/403$/, { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: /forbidden/i })).toBeVisible();
      await expect(page.getByText(/you do not have permission/i)).toBeVisible();

      await page.goto('/admin/tests/new');
      await page.waitForURL(/\/403$/, { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: /forbidden/i })).toBeVisible();
      await expect(page.getByText(/you do not have permission/i)).toBeVisible();
    });
  }

  // labTech holds NONE of the manage_* permissions (RoleSeeder.cs), so the
  // Admin nav icon (ADMIN_NAV.permissions, layout/nav-items.ts) is absent for
  // it too. Branch Manager is intentionally excluded from this check: per the
  // finding already documented in admin-settings.rbac.spec.ts, RoleSeeder
  // grants Branch Manager `manage_branches`, and ADMIN_NAV.permissions ORs
  // that in — so a[href="/admin"] IS present for a Manager even though
  // /admin/tests itself stays correctly blocked (single-permission guard,
  // asserted above). That's a pre-existing nav-visibility finding, not
  // something this Test-Master-scoped spec re-litigates.
  test('labTech: no admin nav entry point anywhere in the chrome', async ({ page }) => {
    await loginAs(page, 'labTech');
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  });

  test('manager: /admin nav icon IS present (manage_branches finding) but /admin/tests stays blocked', async ({ page }) => {
    await loginAs(page, 'manager');
    await expect(page.locator('a[href="/admin"]').first()).toBeAttached();
    await page.goto('/admin/tests');
    await page.waitForURL(/\/403$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /forbidden/i })).toBeVisible();
  });
});
