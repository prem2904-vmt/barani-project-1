import { test, expect } from '@playwright/test';
import { STACK, LAB_URL, openAs, settle, shot, expectNoVisibleAiText, expectNoNativeControls, expectNothingBlocked } from './cs-stack';

/**
 * ADMIN → IPD → MyPrefrontal (Studio, desktop-first): the hub tile, the forms grouped by master department with the
 * Master tag, "Edit" on a master = the lab's own copy (fork) opening in the editor, and the version history.
 */
test.describe.configure({ mode: 'serial' });

test('IPD hub → MyPrefrontal home: departments, Master tags', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.admin, `${LAB_URL}/admin/ipd`);
  const tile = page.getByText('MyPrefrontal', { exact: true }).first();
  await expect(tile).toBeVisible();
  await shot(page, 'studio-01-ipd-hub');
  await tile.click();
  await expect(page).toHaveURL(/\/admin\/ipd\/myprefrontal$/);
  await expect(page.locator('#studio-h')).toBeVisible();
  await expect(page.locator('.st-dept[data-dept="general-medicine"]')).toBeVisible();
  await expect(page.locator('.st-dept[data-dept="ent"]')).toBeVisible();
  await expect(page.locator('[data-tag="master"]').first()).toBeVisible();
  await shot(page, 'studio-02-home-departments');
  await expectNoNativeControls(page);
  await expectNoVisibleAiText(page);
  await ctx.close();
});

test('Edit a master → confirm → the lab copy opens in the editor; history', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.admin, `${LAB_URL}/admin/ipd/myprefrontal`);
  await settle(page);
  const edit = page.locator('.st-dept[data-dept="ent"] [data-act="fork"]').first();
  if (await edit.count()) {
    await edit.click();
    const dlg = page.getByRole('dialog').filter({ hasText: /lab's copy/ });
    await expect(dlg).toBeVisible();
    await shot(page, 'studio-03-fork-confirm');
    await dlg.getByRole('button', { name: 'Make my copy' }).click();
  } else {
    // already forked on an earlier run: open the lab's copy
    await page.locator('.st-dept[data-dept="ent"] [data-tag="copy"]').first().click();
  }
  await expect(page).toHaveURL(/\/admin\/ipd\/myprefrontal\/forms\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const formId = page.url().split('/forms/')[1];
  await settle(page, 1500);
  await shot(page, 'studio-04-editor');
  await expectNoNativeControls(page);
  await expectNoVisibleAiText(page);

  await page.goto(`${LAB_URL}/admin/ipd/myprefrontal/forms/${formId}/history`);
  await settle(page, 1200);
  await shot(page, 'studio-05-history');

  await page.goto(`${LAB_URL}/admin/ipd/myprefrontal`);
  await settle(page);
  await expect(page.locator('.st-dept[data-dept="ent"] [data-tag="copy"]').first()).toBeVisible();
  await shot(page, 'studio-06-home-after-fork');
  await ctx.close();
});

test.afterAll(() => expectNothingBlocked());
