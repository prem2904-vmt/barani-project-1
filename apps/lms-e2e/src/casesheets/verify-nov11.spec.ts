import { test, expect } from '@playwright/test';
import { STACK, api, openAs, settle, shot, expectNoVisibleAiText, type Theme } from './cs-stack';

/** Visual check 2026-11-11: Start menu, IPD departments, Prepare home, paper-sheet dialog. Screenshots only + light asserts. */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await api(STACK.plainLab.admin, 'POST', '/api/casesheets/departments', { name: 'Cardiology Ward' }).catch(() => undefined);
});

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`start menu desktop (${theme})`, async ({ browser }) => {
    const { ctx, page } = await openAs(browser, STACK.admin, '/frontdesk', { theme });
    await settle(page, 1500);
    await shot(page, 'sm-01-bar', { theme });
    await page.locator('[data-start-trigger]:visible').first().click();
    await expect(page.locator('[data-start-menu]')).toBeVisible();
    await shot(page, 'sm-02-menu', { theme });
    await page.locator('[data-start-menu] input').fill('val');
    await shot(page, 'sm-03-search', { theme });
    await page.locator('[data-start-menu] input').fill('');
    await page.locator('[data-start-menu] pf-toggle').first().click();
    await page.keyboard.press('Escape');
    await settle(page, 600);
    await shot(page, 'sm-04-icons-only', { theme });
    await expectNoVisibleAiText(page);
    await ctx.close();
  });

  test(`start menu phone (${theme})`, async ({ browser }) => {
    const { ctx, page } = await openAs(browser, STACK.admin, '/frontdesk', { theme, viewport: 'phone' });
    await settle(page, 1500);
    await shot(page, 'sm-05-phone-bar', { theme, viewport: 'phone' });
    await page.locator('[data-start-trigger]:visible').first().click();
    await expect(page.locator('[data-start-menu]')).toBeVisible();
    await shot(page, 'sm-06-phone-menu', { theme, viewport: 'phone' });
    await ctx.close();
  });

  test(`plain lab: Settings → IPD hub + departments page (${theme})`, async ({ browser }) => {
    const { ctx, page } = await openAs(browser, STACK.plainLab.admin, '/admin/ipd', { theme });
    await settle(page, 1500);
    await expect(page.locator('[data-prepare-switch]')).toBeVisible();
    await shot(page, 'dept-01-ipd-hub', { theme });
    await page.goto('/admin/ipd/departments');
    await settle(page, 1500);
    await expect(page.getByText('Cardiology Ward').first()).toBeVisible();
    await shot(page, 'dept-02-departments', { theme });
    await ctx.close();
  });

  for (const viewport of ['desktop', 'phone'] as const) {
    test(`prepare home ${viewport} (${theme})`, async ({ browser }) => {
      const { ctx, page } = await openAs(browser, STACK.admin, '/prepare', { theme, viewport });
      await settle(page, 1500);
      await shot(page, 'prep-01-home', { theme, viewport });
      await ctx.close();
      const p2 = await openAs(browser, STACK.plainLab.admin, '/prepare', { theme, viewport });
      await settle(p2.page, 1500);
      await shot(p2.page, 'prep-02-home-plain-lab', { theme, viewport });
      await p2.ctx.close();
    });
  }

  test(`paper case sheet dialog (${theme})`, async ({ browser }) => {
    const { ctx, page } = await openAs(browser, STACK.plainLab.admin, '/admin/ipd/myprefrontal', { theme });
    await page.evaluate(() => { localStorage.setItem('pf.cortexImport', '1'); });
    await page.reload();
    await settle(page, 1500);
    await page.locator('[data-act="cortex-import"]').click();
    await settle(page, 800);
    await shot(page, 'dept-03-paper-dialog', { theme });
    await ctx.close();
  });
}
