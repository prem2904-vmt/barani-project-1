import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { STACK, api, blocked, expectNoVisibleAiText, openAs, shot } from '../support/local-stack';

/**
 * Test Master tools, Phase 5 hardening, on the LOCAL full stack (host started with PF_LAB_E2E_TM=1,
 * PF_LAB_E2E_FAKE_MODEL=1 and PF_LAB_E2E_FAKE_LINES=<file>):
 *  - the rate-card result lists EVERY line that was not added, with its line number and reason (no count behind a click);
 *  - a test edit suggested for another branch shows "Switch to <branch>" and Approve there asks before anything is sent.
 * The second branch and the branch stamp are written straight into the local test database (PF_TM_DB).
 */
const ADMIN = STACK.admin;
const LINES = process.env['PF_LAB_E2E_FAKE_LINES'] ?? '';
const DB = process.env['PF_TM_DB'] ?? '';
const STACK_PATH = process.env['PF_STACK'] ?? '';

type T = { id: string; testCode: string; name: string; type: string; department?: { name: string } };

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

const sql = (q: string) => execFileSync('psql', ['-d', DB, '-At', '-c', q], { encoding: 'utf8' }).trim();

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
  test(`rate card: every line not added is listed with its reason (${theme}, desktop + phone)`, async ({ browser }) => {
    test.setTimeout(360_000);
    expect(LINES, 'PF_LAB_E2E_FAKE_LINES').not.toBe('');
    const tests = await api<T[]>(ADMIN, 'GET', '/api/tests?status=all');
    const byName = new Map<string, T[]>();
    for (const t of tests) if (t.type === 'individual') byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
    const uniq = [...byName.values()].filter(v => v.length === 1).map(v => v[0]).filter(t => t.department?.name === 'Haematology');
    for (const phone of [false, true]) {
      const k = 20 + (theme === 'light' ? 0 : 6) + (phone ? 3 : 0);
      const [a, b] = uniq.slice(k, k + 2);
      const lines = [
        { text: a.name, price: 411 }, { text: b.testCode, price: 522 },
        { text: 'Mystery Heading Thing' }, { text: 'Home visit charge', price: 150 },
        { text: 'Courier and handling', price: 90 }, { text: 'Cardiac Panel Plus' },
      ];
      writeFileSync(LINES, JSON.stringify({ lines }));
      const { ctx, page } = await openAs(browser, ADMIN, '/admin/tests', { theme, beta: ['assistant'], viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      const btn = page.getByRole('button', { name: /Read a rate card/i }).first();
      await expect(btn).toBeVisible({ timeout: 60_000 });
      await btn.click();
      const png = await drawCard(page, lines.map(l => `${l.text}   ${l.price ?? ''}`));
      await page.locator('input.pf-asst__file:not([capture])').setInputFiles({ name: 'rate-card.jpg', mimeType: 'image/jpeg', buffer: png });
      const card = page.locator('[data-asst-card]');
      await expect(card).toHaveAttribute('data-phase', 'done', { timeout: 90_000 });
      const rows = card.locator('[data-asst-unmatched-row]');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeGreaterThanOrEqual(2);
      await expect(card.locator('[data-asst-unmatched]')).toContainText('Mystery Heading Thing');
      await expect(card.locator('[data-asst-unmatched]')).toContainText(/Line \d/);
      await expectNoVisibleAiText(page);
      await shot(page, `tm-hardening-unmatched-${theme}-${phone ? 'phone' : 'desktop'}`);
      await ctx.close();
      await new Promise(r => setTimeout(r, 62_000));   // one read a minute per person
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`pending: a test edit for another branch offers the switch (${theme}, desktop + phone)`, async ({ browser }) => {
    const seed = JSON.parse(readFileSync(`${STACK_PATH}.tm.json`, 'utf8')) as { clinical: string; clinicalLabel: string };
    const branch2 = sql(`select "Id" from branches where "TenantId"='${STACK.tenantId}' and "Name"='Salem'`)
      || sql(`insert into branches ("Id","TenantId","Name","Code","Type","HasPfBox","Timezone","IsActive","LabStructure","CreatedAt") values (gen_random_uuid(),'${STACK.tenantId}','Salem','SLM','lab',false,'Asia/Kolkata',true,'auto',now()) returning "Id"`).split('\n')[0];
    sql(`update tm_change_proposals set "BranchId"='${branch2}' where "Id"='${seed.clinical}'`);
    for (const phone of [false, true]) {
      const { ctx, page } = await openAs(browser, ADMIN, '/admin/tests?view=pending', { theme, beta: ['assistant'], viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      await expect(page.locator('.pf-tmp__grid .ag-row').first()).toBeVisible({ timeout: 60_000 });
      await page.getByPlaceholder(/Search pending changes/i).first().fill(seed.clinicalLabel.replace(/ \(.*$/, ''));
      const row = page.locator('.pf-tmp__grid .ag-row').filter({ hasText: seed.clinicalLabel }).first();
      await expect(row).toBeVisible({ timeout: 60_000 });
      await row.click();
      await expect(page.locator('[data-tmp-branch]')).toContainText('Suggested for Salem', { timeout: 15_000 });
      await expect(page.locator('[data-tmp-switch]')).toContainText('Switch to Salem');
      await expectNoVisibleAiText(page);
      await shot(page, `tm-hardening-branch-banner-${theme}-${phone ? 'phone' : 'desktop'}`);
      let approveCalls = 0;
      page.on('request', r => { if (/\/api\/tm-proposals\/.+\/approve/.test(r.url())) approveCalls++; });
      await page.locator('[data-tmp-approve]').click();
      const dlg = page.getByRole('dialog');
      await expect(dlg).toContainText('Switch to Salem');
      await shot(page, `tm-hardening-branch-dialog-${theme}-${phone ? 'phone' : 'desktop'}`);
      expect(approveCalls).toBe(0);
      await dlg.getByRole('button', { name: /Stay here/i }).click();
      await ctx.close();
    }
  });
}
