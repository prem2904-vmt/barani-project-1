import { test, expect, type Page } from '@playwright/test';
import { LAB_URL, STACK, openAs, settle, shot, expectNoNativeControls, expectNoVisibleAiText, type Theme, type ViewportName } from './cs-stack';

/**
 * CASE-SHEET BUILDER (owner 2026-11-11) on the real stack with the scripted model (CaseSheets:Builder:Fake=true):
 * Studio → Cortex chat edits the DRAFT through the builder tools (page, choice, sentence, follow-up) → the editor reloads →
 * Checks (auto + Cortex) are run by the server engine; failing checks only warn. Console flag pf.cortexBuilder on.
 */
test.describe.configure({ mode: 'serial' });
let formId = '';

async function withFlag(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem('pf.cortexBuilder', '1'); localStorage.setItem('pf.beta.mcp', '1'); } catch { /* */ } });
}

test('lab copy of General Medicine opens in the editor with Cortex and Checks', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.admin, `${LAB_URL}/admin/ipd/myprefrontal`);
  await withFlag(page);
  await page.reload();
  await settle(page, 1200);
  const fork = page.locator('[data-act="fork"]').first();
  if (await fork.count()) {
    await fork.click();
    const dlg = page.getByRole('dialog').filter({ hasText: /lab's copy/ });
    await dlg.getByRole('button', { name: 'Make my copy' }).click();
  } else {
    await page.locator('[data-tag="copy"]').first().click();   // already copied on an earlier run
  }
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  formId = page.url().split('/forms/')[1];
  await settle(page, 1500);
  await expect(page.locator('[data-act="cortex"]')).toBeVisible();
  await expect(page.locator('[data-act="checks"]')).toBeVisible();
  await shot(page, 'builder-01-editor');
  await ctx.close();
});

for (const [theme, vp] of [['light', 'desktop'], ['dark', 'desktop'], ['light', 'phone']] as [Theme, ViewportName][]) {
  test(`Cortex builds into the draft, Checks run (${theme}, ${vp})`, async ({ browser }) => {
    const { ctx, page } = await openAs(browser, STACK.admin, `${LAB_URL}/admin/ipd/myprefrontal/forms/${formId}`, { theme, viewport: vp });
    await withFlag(page);
    await page.reload();
    await settle(page, 1500);
    await page.locator('[data-act="cortex"]').click();
    const drawer = page.locator('[data-builder-drawer]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Cortex only edits the draft');
    await shot(page, 'builder-02-cortex-open', { theme, viewport: vp });
    await drawer.locator('textarea').fill('Add a presenting complaint page with type of pain, and how long for sharp pain.');
    await drawer.locator('[data-act="send"]').click();
    await expect(drawer).toContainText(/Presenting complaint|Type of pain/i, { timeout: 60_000 });
    await settle(page, 1500);
    await shot(page, 'builder-03-cortex-done', { theme, viewport: vp });

    await drawer.getByText('Checks', { exact: true }).first().click();
    const checks = page.locator('[data-checks]');
    await expect(checks).toBeVisible();
    await expect(page.locator('[data-act="run-all"]')).toBeEnabled({ timeout: 30_000 });
    await page.locator('[data-act="run-all"]').click();
    await expect(page.locator('[data-act="publish"], button:has-text("Publish")').first()).toBeVisible();
    await expect(page.locator('[data-builder-drawer]')).toContainText(/checks? ·/, { timeout: 30_000 });
    await settle(page, 800);
    await shot(page, 'builder-04-checks', { theme, viewport: vp });
    if (theme === 'light' && vp === 'desktop') {
      await expect(page.locator('[data-act="suggest"]')).toBeEnabled({ timeout: 30_000 });
      await page.locator('[data-act="suggest"]').click();
      await settle(page, 2500);
      await shot(page, 'builder-05-checks-suggested', { theme, viewport: vp });
      await page.locator('[data-act="close-builder"]').click();
      await settle(page, 800);
      await shot(page, 'builder-06-editor-after', { theme, viewport: vp, fullPage: false });
    }
    await expectNoNativeControls(page);
    await expectNoVisibleAiText(page);
    await ctx.close();
  });
}

test('history says the change came from Cortex', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.admin, `${LAB_URL}/admin/ipd/myprefrontal/forms/${formId}/history`);
  await settle(page, 1500);
  await shot(page, 'builder-07-history');
  await ctx.close();
});

test('Settings → AI connector: the case-sheet switch', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.admin, `${LAB_URL}/admin`);
  await withFlag(page);
  await page.goto(`${LAB_URL}/admin/ai-connectors`);
  await settle(page, 1500);
  await expect(page).toHaveURL(/ai-connectors/);
  await page.getByText('Let connected apps build case sheets').first().scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(page, 'builder-08-connector-settings');
  await ctx.close();
});
