import { test, expect, type Page } from '@playwright/test';
import { STACK, blocked, expectNoVisibleAiText, openAs, shot as rawShot } from '../support/local-stack';

/**
 * Report designer, phase 6 - the Footer tab's Signatures card on the local
 * full stack (never a real host): placement, what prints, the live readout
 * and the sample the footer preview prints. Screenshots go to PF_SHOTS.
 */
const ADMIN = STACK.admin;
const shot = async (page: Page, name: string) => { await page.waitForTimeout(2500); await rawShot(page, name); };
const card = (page: Page) => page.locator('pf-report-signature-card');
const pick = (page: Page, name: RegExp | string) => card(page).getByRole('radio', { name }).first().click();

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

test('designer: Signatures card - placement, what prints, readout, light and dark', async ({ browser }) => {
  for (const theme of ['light', 'dark'] as const) {
    const { page } = await openAs(browser, ADMIN, '/admin/reports', { theme });
    await page.getByRole('radio', { name: 'Footer' }).click();
    await expect(card(page)).toBeVisible({ timeout: 60_000 });
    await card(page).scrollIntoViewIfNeeded();
    await expect(card(page)).toContainText(/2 signatories · 1 row · \d+ mm · at the end of each department/);
    await shot(page, `p6-editor-department-${theme}`);

    await pick(page, /Once, at the end/);
    await expect(card(page)).toContainText(/once, after End of Report/);
    await pick(page, 'Try with 7 signatories');
    await expect(card(page)).toContainText(/7 signatories · 2 rows/);
    await shot(page, `p6-editor-end-7-${theme}`);

    await pick(page, /Every page/);
    await expect(card(page)).toContainText(/at the foot of every page/);
    await expect(card(page)).toContainText(/on every page/);
    await shot(page, `p6-editor-every-page-${theme}`);

    await pick(page, /Verified line/);
    await pick(page, 'Try with 2 signatories');
    await expect(card(page)).toContainText(/2 signatories · 2 lines/);
    await shot(page, `p6-editor-verified-${theme}`);

    await pick(page, /Name only/);
    await pick(page, /Each department/);
    await shot(page, `p6-editor-nameonly-${theme}`);
    await expectNoVisibleAiText(page);
  }
});
