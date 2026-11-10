import { test, expect } from '@playwright/test';
import { LAB_URL, STACK, expectNothingBlocked, openAs, shot, type Theme } from './cs-stack';

/**
 * Fix from the case-sheets review that only a real browser can show: the search box carries OUR clear button (the browser's
 * blue native "x" is hidden).
 */
const PATIENT = STACK.patients[0];

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`Departments search: our own clear button, no native one (${theme})`, async ({ browser }) => {
    const { ctx, page } = await openAs(browser, STACK.admin, `${LAB_URL}/casesheets/new?patientId=${PATIENT.id}`, { theme });
    const search = page.locator('[data-dp-search]');
    await expect(search).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.dp__clear')).toHaveCount(0);
    await search.fill('nose');
    await expect(page.locator('.dp__clear')).toBeVisible();
    // (the browser's own cancel button is hidden by the page's CSS — checked on the screenshot and by the style spec; a pseudo-element's computed style is not reliable)
    await shot(page, 'review-search-clear', { theme });
    await page.locator('.dp__clear').click();
    await expect(search).toHaveValue('');
    await expect(page.locator('.dp__clear')).toHaveCount(0);
    await ctx.close();
  });
}

test.afterAll(() => expectNothingBlocked());
