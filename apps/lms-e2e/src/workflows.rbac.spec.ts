import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * WORKFLOWS / PROCESS-BUILDER — the admin workflow/form editor.
 *
 * Two builders live under /admin, both gated by the SAME single permission
 * (apps/lms/src/app/app.routes.ts → permissionGuard('manage_workflows')):
 *   - /admin/workflows[/:screen[/steps/:stepId/fields/...]] — the FORM builder
 *     (features/admin/workflow-builder/*) that shapes a screen's step/field
 *     config, backed by prefrontal-mw's WorkflowsController
 *     (GET/POST /api/workflows/{screen}, /publish, /history, /restore).
 *   - /admin/process — the PROCESS builder (features/admin/process-builder/*)
 *     that arranges actions into work-area lanes, backed by
 *     ProcessWorkflowController (GET/POST/PUT /api/process-workflows).
 *
 * Per RoleSeeder.cs only "Lab Admin" holds manage_workflows — Lab Technician
 * and Branch Manager hold neither (confirmed in admin-settings.rbac.spec.ts
 * for /admin/workflows; /admin/process uses the identical single-permission
 * guard so the same two roles are asserted blocked there too).
 *
 * The functional half runs as admin against the REAL seeded "Micro World"
 * tenant data:
 *   - Form builder: edits the `patient_registration` workflow (the same
 *     screen register.authed.spec.ts drives), renaming one field's label
 *     (the custom "Occupation" field in the optional/skippable
 *     "Additional Info" step — never touched by register.authed.spec.ts,
 *     which only fills Basic Info fields). Saved via the real "Save draft"
 *     action (POST /api/workflows/patient_registration), verified surviving
 *     a full page reload, then the label AND the publish status are both
 *     restored (status was "published" before this spec touched it — saving
 *     a draft flips it to "draft", so the restore re-publishes too) so the
 *     workflow is left exactly as this spec found it.
 *   - Process builder: toggles the "Home Visits" action (home_visits — a
 *     free-standing action per ACTION_POLICY: not locked, not mandatory, no
 *     couplings/prerequisites, so flipping it has no cascading side effects)
 *     inside the tenant's currently ACTIVE, tenant-owned workflow ("Without
 *     Collection Center" — confirmed isSystemDefault:false via a live probe,
 *     so saving PUTs the existing row directly instead of forking a new one
 *     the way editing the shipped "Standard flow" system default would).
 *     Verified via the real "Save" action (PUT /api/process-workflows/{id})
 *     surviving a full page reload, then restored to its original disabled
 *     state.
 */

const FORBIDDEN_HEADING = /forbidden/i;

async function expectBlocked(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/403$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
  await expect(page.getByText(/you do not have permission/i)).toBeVisible();
}

/** Field rows in the builder list live storageKey text (stable — unlike the
 *  title, which this spec temporarily edits) in a small font-mono <p> under
 *  the title. Scope by that to find a field regardless of its current label. */
function fieldItemByStorageKey(page: Page, storageKey: string) {
  return page.locator('.pf-field-item', { hasText: storageKey });
}

test.describe.configure({ mode: 'serial' });

test.describe('Workflow Builder (form editor) — admin functional', () => {
  test('admin: list renders, opening patient_registration shows its steps/fields', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/workflows');
    await expect(page.getByRole('heading', { name: /workflow builder/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    const row = page.locator('.pf-wf-row', { hasText: 'Patient Registration' });
    await expect(row).toBeVisible({ timeout: 15_000 });

    const getResponse = page.waitForResponse(
      r => r.url().includes('/api/workflows/patient_registration') && r.request().method() === 'GET',
      { timeout: 15_000 }
    );
    await row.click();
    const getResp = await getResponse;
    expect(getResp.ok()).toBe(true);

    await expect(page.getByRole('heading', { name: 'Patient Registration', level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pf-step-item')).toHaveCount(2); // basic_info + additional_info
  });

  test('admin: renaming a field label persists (save API + reload), then is restored ' +
       '(including re-publishing, since a draft save flips status away from published)', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/workflows/patient_registration');
    await expect(page.getByRole('heading', { name: 'Patient Registration', level: 1 })).toBeVisible({ timeout: 15_000 });

    // Select the "Additional Info" step — the optional/skippable second step
    // register.authed.spec.ts never interacts with.
    await page.locator('.pf-step-item', { hasText: 'Additional Info' }).click();

    const occupationRow = fieldItemByStorageKey(page, 'metadata.occupation');
    await expect(occupationRow).toBeVisible({ timeout: 10_000 });

    let originalLabel = '';

    async function editLabel(newLabel: string) {
      await occupationRow.getByRole('button', { name: 'Edit field' }).click();
      await expect(page.getByRole('heading', { name: 'Edit field', level: 1 })).toBeVisible({ timeout: 10_000 });
      const labelInput = page.locator('.field-editor-page input.pf-input').first();
      if (!originalLabel) originalLabel = await labelInput.inputValue();
      await labelInput.fill(newLabel);
      await page.getByRole('button', { name: /save changes/i }).click();
      await expect(page.getByRole('heading', { name: 'Patient Registration', level: 1 })).toBeVisible({ timeout: 10_000 });
      // Re-select the step (fresh component instance after the route change).
      await page.locator('.pf-step-item', { hasText: 'Additional Info' }).click();
    }

    async function saveDraftAndAssert() {
      const saveResponse = page.waitForResponse(
        r => r.url().includes('/api/workflows/patient_registration') && r.request().method() === 'POST' && !r.url().includes('/publish'),
        { timeout: 15_000 }
      );
      await page.getByRole('button', { name: /save draft/i }).click();
      const resp = await saveResponse;
      expect(resp.ok(), 'Save draft must persist the field edit').toBe(true);
    }

    try {
      // ── Edit + save + verify it survives a reload ──────────────────────
      const editedLabel = 'Occupation (e2e-edit)';
      await editLabel(editedLabel);
      await expect(fieldItemByStorageKey(page, 'metadata.occupation')).toContainText(editedLabel);
      await saveDraftAndAssert();

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Patient Registration', level: 1 })).toBeVisible({ timeout: 15_000 });
      await page.locator('.pf-step-item', { hasText: 'Additional Info' }).click();
      await expect(fieldItemByStorageKey(page, 'metadata.occupation'))
        .toContainText(editedLabel, { timeout: 10_000 });
    } finally {
      // ── Restore: label back to what it was, re-saved, re-published ─────
      if (originalLabel) {
        await editLabel(originalLabel);
        await expect(fieldItemByStorageKey(page, 'metadata.occupation')).toContainText(originalLabel);
        await saveDraftAndAssert();

        // Saving a draft flips status away from "published" (WorkflowRepository.
        // UpsertAsync always sets Status="draft") — publish again so the record
        // is left exactly as found (status published), not just content-equal.
        const publishResponse = page.waitForResponse(
          r => r.url().includes('/api/workflows/patient_registration/publish') && r.request().method() === 'POST',
          { timeout: 15_000 }
        );
        await page.getByRole('button', { name: /^publish$/i }).click();
        const publishResp = await publishResponse;
        expect(publishResp.ok(), 'Re-publish must succeed to fully restore original status').toBe(true);

        await page.reload();
        await expect(page.getByRole('heading', { name: 'Patient Registration', level: 1 })).toBeVisible({ timeout: 15_000 });
        await page.locator('.pf-step-item', { hasText: 'Additional Info' }).click();
        await expect(fieldItemByStorageKey(page, 'metadata.occupation'))
          .toContainText(originalLabel, { timeout: 10_000 });
        await expect(fieldItemByStorageKey(page, 'metadata.occupation')).not.toContainText('e2e-edit');
      }
    }
  });
});

test.describe('Process Builder (work-area/action editor) — admin functional', () => {
  test('admin: toggling the Home Visits action persists (save API + reload), then is restored', async ({ page }) => {
    await loginAs(page, 'admin');
    // Work steps (workflow redesign 2026-11-19): work areas LEFT, the selected area's actions RIGHT.
    const openHomeVisits = async () => {
      await page.goto('/admin/process');
      await expect(page.locator('[data-testid="wf-main"]')).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-testid="wf-area-homecoll"]').locator('visible=true').first().click();
      const sw = page.locator('[data-testid="wf-switch-home_visits"]');
      await expect(sw).toBeVisible({ timeout: 15_000 });
      return sw;
    };
    const isOn = async (sw: import('@playwright/test').Locator) => (await sw.getAttribute('aria-checked')) === 'true';
    async function saveAndAssert() {
      const saveResponse = page.waitForResponse(
        r => r.url().includes('/api/process-workflows/') && r.request().method() === 'PUT',
        { timeout: 15_000 }
      );
      await page.locator('pf-hero-band [data-testid="band-save"] .pf-ssv__save').click();
      const resp = await saveResponse;
      expect(resp.ok(), 'Save must persist the process-workflow toggle').toBe(true);
    }

    let toggle = await openHomeVisits();
    const wasOn = await isOn(toggle);
    try {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', String(!wasOn));
      await saveAndAssert();
      toggle = await openHomeVisits();
      await expect(toggle).toHaveAttribute('aria-checked', String(!wasOn));
    } finally {
      toggle = await openHomeVisits();
      if ((await isOn(toggle)) !== wasOn) { await toggle.click(); await saveAndAssert(); }
      toggle = await openHomeVisits();
      expect(await isOn(toggle), 'Home Visits toggle must be restored to its original state').toBe(wasOn);
    }
  });
});

test.describe('Workflows / Process Builder RBAC gate — only manage_workflows (Lab Admin) reaches it', () => {
  test('admin (Lab Admin): reaches both builders', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/workflows');
    await expect(page.getByRole('heading', { name: /workflow builder/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.goto('/admin/process');
    await expect(page.locator('[data-testid="wf-main"]')).toBeVisible({ timeout: 15_000 });
  });

  for (const role of ['labTech', 'manager'] as const) {
    test(`${role}: blocked from /admin/workflows and /admin/process (→ /403)`, async ({ page }) => {
      await loginAs(page, role);
      await expectBlocked(page, '/admin/workflows');
      await expectBlocked(page, '/admin/process');
      // Also confirm the field-editor sub-route (not just the list) is gated.
      await expectBlocked(page, '/admin/workflows/patient_registration');
    });
  }
});
