import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { STACK, api, blocked, expectNoVisibleAiText, openAs, shot } from '../support/local-stack';

/**
 * Test Master → "Read a rate card" (Cortex, beta `assistant`) on the LOCAL full stack with a SCRIPTED model.
 * Needs the mw host started with PF_LAB_E2E_FAKE_MODEL=1 and PF_LAB_E2E_FAKE_LINES=<file> (LabFlowE2EHost): the
 * "model" answers the lines written to that file; no network, no key. A sample rate-card JPEG is drawn in the browser,
 * attached in the panel, read, and the suggestions must appear in Pending (and ONLY there: no price changed).
 */
const ADMIN = STACK.admin;
const LINES = process.env['PF_LAB_E2E_FAKE_LINES'] ?? '';

type T = { id: string; testCode: string; name: string; type: string; department?: { name: string } };

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

async function drawCard(page: import('@playwright/test').Page, lines: string[]): Promise<Buffer> {
  const data = await page.evaluate((ls) => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
    const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 1200);
    x.fillStyle = '#111'; x.font = '28px sans-serif'; x.fillText('Sample Lab - Rate card', 40, 60);
    ls.forEach((l, i) => x.fillText(l, 40, 130 + i * 48));
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, lines);
  return Buffer.from(data, 'base64');
}

for (const theme of ['light', 'dark'] as const) {
  test(`read a rate card → suggestions in Pending, nothing applied (${theme}, desktop + phone)`, async ({ browser }) => {
    expect(LINES, 'PF_LAB_E2E_FAKE_LINES').not.toBe('');
    const tests = await api<T[]>(ADMIN, 'GET', '/api/tests?status=all');
    const byName = new Map<string, T[]>();
    for (const t of tests) if (t.type === 'individual') byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
    const uniq = [...byName.values()].filter(v => v.length === 1).map(v => v[0]).filter(t => t.department?.name === 'Haematology');
    expect(uniq.length).toBeGreaterThanOrEqual(12);
    const priceBefore = new Map<string, string>();
    const dept = 'Haematology';
    for (const phone of [false, true]) {
      const k = (theme === 'light' ? 0 : 6) + (phone ? 3 : 0);   // fresh tests for every pass (a second pending row for one test is refused)
      const [a, b, c] = uniq.slice(k, k + 3);
      priceBefore.set(a.id, JSON.stringify(await api<unknown>(ADMIN, 'GET', `/api/tests/${a.id}`)));
      const newName = `Vitamin B12 RC ${theme} ${phone ? 'phone' : 'desktop'}`;
      const lines = [
        { text: a.name, price: 411, section: dept }, { text: b.testCode, price: 522 }, { text: c.name.toUpperCase(), price: 633 },
        { text: newName, price: 880, section: dept }, { text: 'Mystery Heading Thing' },
      ];
      writeFileSync(LINES, JSON.stringify({ lines }));
      const { ctx, page } = await openAs(browser, ADMIN, '/admin/tests', { theme, beta: ['assistant'], viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      const btn = page.getByRole('button', { name: /Read a rate card/i }).first();
      await expect(btn).toBeVisible({ timeout: 60_000 });
      await btn.click();
      await expect(page.locator('.pf-asst')).toBeVisible();
      await expect(page.locator('[data-asst-attach]')).toBeVisible();
      await expectNoVisibleAiText(page);
      await shot(page, `tm-ratecard-panel-${theme}-${phone ? 'phone' : 'desktop'}`);
      const png = await drawCard(page, lines.map(l => `${l.text}   ${l.price ?? ''}`));
      await page.locator('input.pf-asst__file:not([capture])').setInputFiles({ name: 'rate-card.jpg', mimeType: 'image/jpeg', buffer: png });
      const card = page.locator('[data-asst-card]');
      await expect(card).toHaveAttribute('data-phase', 'done', { timeout: 90_000 });
      await expect(card).toContainText('suggestions added to Pending');
      await expectNoVisibleAiText(page);
      await shot(page, `tm-ratecard-result-${theme}-${phone ? 'phone' : 'desktop'}`);
      // the batch is the open upload; only this read's rows
      await page.locator('[data-asst-review]').click();
      await expect(page.locator('[data-tmp-batch]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.pf-tmp__grid .ag-row').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.pf-tmp__grid .ag-row').filter({ hasText: a.name }).first()).toBeVisible();
      await expect(page.locator(".pf-tmp__grid .ag-row").filter({ hasText: newName }).first()).toBeVisible();
      await shot(page, `tm-ratecard-pending-${theme}-${phone ? 'phone' : 'desktop'}`);
      await ctx.close();
      const now = JSON.stringify(await api<unknown>(ADMIN, 'GET', `/api/tests/${a.id}`));
      expect(now, 'nothing was applied').toEqual(priceBefore.get(a.id));
      await new Promise(r => setTimeout(r, 62_000));   // one read a minute per person
    }
  });
}
