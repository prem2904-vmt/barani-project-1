import { test, expect } from '@playwright/test';
import { STACK, api, blocked, expectNoVisibleAiText, openAs, platform, shot } from '../support/local-stack';

/**
 * Integration 2026-11-01b — quick end-to-end checks of what the combined
 * branches changed, on the local full stack (never a real host):
 *  - settings search: "sample id" ranks the Sample ID setting first
 *  - back from a settings screen (Instruments) lands on the Lab hub
 *  - the instruments assistant panel says Cortex, never "PF Sense" / "AI"
 *  - the profile Custom layout designer draws a smart guide while a box is dragged
 * Read-only: nothing is saved.
 */
const ADMIN = STACK.admin;
const THEMES = ['light', 'dark'] as const;

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

test('settings search: "sample id" puts Sample ID first', async ({ browser }) => {
  for (const theme of THEMES) {
    const { ctx, page } = await openAs(browser, ADMIN, '/admin/manage', { theme });
    const box = page.locator('input[placeholder*="Search settings"]').first();
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.fill('sample id');
    const first = page.getByTestId('settings-hit').first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(first).toContainText(/Sample ID/i);
    await shot(page, `settings-search-sample-id-${theme}`);
    await ctx.close();
  }
});

test('back from Instruments lands on the Lab hub', async ({ browser }) => {
  for (const theme of THEMES) {
    const { ctx, page } = await openAs(browser, ADMIN, '/lab/settings', { theme });
    await expect(page.getByText('Instruments').first()).toBeVisible({ timeout: 30_000 });
    await shot(page, `lab-hub-${theme}`);
    await page.locator('a[href="/admin/instruments"]').first().click();
    await expect(page).toHaveURL(/\/admin\/instruments$/);
    await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible({ timeout: 20_000 });
    await shot(page, `instruments-${theme}`);
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page).toHaveURL(/\/lab\/settings$/, { timeout: 15_000 });
    await shot(page, `back-on-lab-hub-${theme}`);
    await ctx.close();
  }
});

test('instruments assistant: the button, the panel and the limit notice all say Cortex (no "PF Sense", no "AI")', async ({ browser }) => {
  // Cap below what the seeded usage row already used: the panel shows its limit notice.
  await platform('PUT', `/tenants/${STACK.tenantId}/pf-sense`, { features: { instruments_assistant: true }, capTokens: 100 });
  try {
    for (const theme of THEMES) {
      const { ctx, page } = await openAs(browser, ADMIN, '/admin/instruments', { theme, beta: ['assistant'] });
      const btn = page.getByRole('button', { name: /Ask Cortex/ }).first();
      await expect(btn).toBeVisible({ timeout: 30_000 });
      await btn.click();
      await expect(page.getByText('Cortex is resting')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Cortex limit reached for this month/)).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(/PF Sense/i);
      await expectNoVisibleAiText(page);
      await shot(page, `instruments-assistant-panel-${theme}`);
      await ctx.close();
    }
  } finally {
    await platform('PUT', `/tenants/${STACK.tenantId}/pf-sense`, { capTokens: null });
  }
});

test('profile Custom layout designer: dragging a box near another draws a smart guide', async ({ browser }) => {
  const tests = await api<Array<{ id: string; name: string; type: string }>>(ADMIN, 'GET', '/api/tests/');
  const profile = tests.find(t => t.type === 'profile' && /Renal Profile/.test(t.name)) ?? tests.find(t => t.type === 'profile')!;
  for (const theme of THEMES) {
    const { ctx, page } = await openAs(browser, ADMIN, `/admin/tests/${profile.id}/edit?type=profile`, { theme });
    await page.getByText('Printed report').first().click();
    const boxes = page.locator('.pld-box');
    await expect(boxes.first()).toBeVisible({ timeout: 40_000 });
    expect(await boxes.count()).toBeGreaterThanOrEqual(2);
    await boxes.first().scrollIntoViewIfNeeded();
    // Drag the LAST box a little at a time: it passes the other box's edges, so a guide appears.
    const last = boxes.last();
    const bb = (await last.boundingBox())!;
    const other = (await boxes.first().boundingBox())!;
    const sx = bb.x + bb.width / 2, sy = bb.y + 6;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    let seen = 0;
    const targetX = sx + (other.x - bb.x);   // line the left edges up
    for (let i = 1; i <= 24 && !seen; i++) {
      await page.mouse.move(sx + ((targetX - sx) * i) / 24 + 1, sy - i * 2, { steps: 2 });
      seen = await page.locator('pf-snap-guides .sg-line, pf-snap-guides .sg-mark').count();
    }
    expect(seen, 'a guide or distance mark shows while dragging').toBeGreaterThan(0);
    await shot(page, `profile-layout-guide-${theme}`);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await ctx.close();
  }
});

test('no visible "AI" wording on the settings hub', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, ADMIN, '/lab/settings');
  await expect(page.getByText('Instruments').first()).toBeVisible({ timeout: 30_000 });
  await expectNoVisibleAiText(page);
  await ctx.close();
});
