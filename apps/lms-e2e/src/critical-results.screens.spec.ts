import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, isTouch, isPhone, projectName } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * Lab > Critical results layout (owner 2026-11-19): the status filter is vertical side-list rows (never a wrapped
 * segmented control over the next label), the Detected cell fits its row, the actions column has no extra border or
 * stray header dividers, and the action buttons are touch-sized. Light + dark. API mocked, demo data only.
 * Screenshots: SHOTS_DIR/<project>/critical-<theme>.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/critical-fix');
const iso = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();
const ev = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, status, source: 'live', orderTestId: `ot-${id}`, orderId: `o-${id}`, orderNumber: `LAB-2611-0000${id}`, resultVersion: 1,
  patientId: `p-${id}`, patientName: 'Meena Iyer', patientMrn: '26000012', testId: 't1', testName: 'Potassium', summary: 'K 7.1 mmol/L CH',
  values: [], branchId: 'b1', branchName: 'Main', detectedAt: iso(30), detectedByName: 'Admin User', alertedAt: iso(29), alertedCount: 9,
  acknowledgements: [], ...over,
});
const ITEMS = [
  ev('1', 'open'),
  ev('2', 'acknowledged', { patientName: 'Noor Khan', testName: 'Haemoglobin', summary: 'Hb 3.2 g/dL CL', acknowledgedByName: 'Kavya Desk', acknowledgedAt: iso(20), acknowledgedVia: 'register', acknowledgements: [{ userId: 'app-1', name: 'Kavya Desk', at: iso(20), via: 'register' }] }),
  ev('3', 'communicated', { patientName: 'Anitha Raj', testName: 'Glucose', summary: 'Glu 31 mg/dL CL', acknowledgedByName: 'Kavya Desk', acknowledgedAt: iso(50), acknowledgedVia: 'register', acknowledgements: [{ userId: 'app-1', name: 'Kavya Desk', at: iso(50), via: 'register' }],
    communicationMethod: 'phone', communicatedToName: 'Dr. Ravi Kumar', communicatedToRole: 'referring_doctor', communicatedAt: iso(40), communicatedByName: 'Kavya Desk' }),
];

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  resetNeg();
  neg.hook = r => {
    if (r.method === 'GET' && r.path === '/api/critical-results') {
      return { status: 200, body: { success: true, data: { items: ITEMS, total: ITEMS.length, page: 1, pageSize: 200, openCount: 1 } } };
    }
    return undefined;
  };
  await installNegBackend(page, context);
});

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
}

async function openRegister(page: Page) {
  await go(page, '/lab/critical-results');
  await expect(page.locator('.ag-cell[col-id="detectedAt"]').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
  // Show every column (the widest register) before measuring.
  if (!isPhone() && (await page.locator('.pf-cr__side [role="radio"]').locator('visible=true').count())) {
    await page.locator('.pf-cr__side [role="radio"]', { hasText: /^\s*All\s*$/ }).locator('visible=true').first().click();
    await expect(page.locator('.ag-row').locator('visible=true')).toHaveCount(3, { timeout: 20_000 });
  }
  await page.waitForTimeout(600);
}

async function openFiltersIfSheet(page: Page) {
  const btn = page.getByRole('button', { name: 'Filters' }).locator('visible=true').first();
  if (await btn.count()) await btn.click();
  await expect(page.locator('[data-testid="cr-status"]').locator('visible=true').first()).toBeVisible();
}

for (const dark of [false, true]) {
  test(`critical results layout (${dark ? 'dark' : 'light'})`, async ({ page }) => {
    await openRegister(page);
    await theme(page, dark);
    await page.waitForTimeout(300);
    const dir = path.join(OUT_BASE, projectName());
    fs.mkdirSync(dir, { recursive: true });
    const tag = dark ? 'dark' : 'light';

    // 0 — no page scroll sideways
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(0);

    // 1 — grid: Detected fits its row, no extra border before the actions
    await page.screenshot({ path: `${dir}/critical-${tag}.png` });
    const g = await page.evaluate(() => {
      const vis = (e: Element) => (e as HTMLElement).getBoundingClientRect().width > 0;
      const rows = [...document.querySelectorAll('.pf-cr__main .ag-cell[col-id="detectedAt"]')].filter(vis).map(c => c.closest('.ag-row') as Element);
      const detected = rows.map(row => {
        const rr = row.getBoundingClientRect();
        const cell = row.querySelector('.ag-cell[col-id="detectedAt"]') as HTMLElement;
        const box = cell.querySelector('.pf-cr-cell') as HTMLElement;
        const kids = [...box.querySelectorAll('span')].map(k => k.getBoundingClientRect());
        const cr = cell.getBoundingClientRect();
        return {
          rowTop: rr.top, rowBottom: rr.bottom,
          kidsTop: Math.min(...kids.map(k => k.top)), kidsBottom: Math.max(...kids.map(k => k.bottom)),
          cellFit: cell.scrollHeight <= cell.clientHeight + 1, cellH: cr.height, kidsRight: Math.max(...kids.map(k => k.right)), cellRight: cr.right,
          lines: box.querySelectorAll(':scope > span').length,
        };
      });
      const actCells = [...document.querySelectorAll('.pf-cr__main .ag-cell[col-id="actions"]')].filter(vis);
      const pinned = document.querySelector('.pf-cr__main .ag-pinned-right-cols-container') as HTMLElement | null;
      const pinnedHead = document.querySelector('.pf-cr__main .ag-pinned-right-header') as HTMLElement | null;
      const head = document.querySelector('.pf-cr__main .ag-header-cell[col-id="actions"]') as HTMLElement | null;
      const resize = head?.querySelector('.ag-header-cell-resize') as HTMLElement | null;
      const btns = [...document.querySelectorAll('.pf-cr__main .pf-cr-acts button')].filter(vis).map(b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height }; });
      const stripe = rows.map(r => ({
        first: getComputedStyle(r.querySelector('.ag-cell[col-id="detectedAt"]') as Element).boxShadow,
        act: r.querySelector('.ag-cell[col-id="actions"]') ? getComputedStyle(r.querySelector('.ag-cell[col-id="actions"]') as Element).boxShadow : 'none',
      }));
      return {
        detected, hasActs: actCells.length, btns, stripe,
        pinnedBorder: pinned ? getComputedStyle(pinned).borderLeftWidth : '0px', pinnedHeadBorder: pinnedHead ? getComputedStyle(pinnedHead).borderLeftWidth : '0px',
        headText: head?.textContent?.trim() ?? null, resizeShown: resize ? getComputedStyle(resize).display !== 'none' : false,
        rowCount: rows.length,
      };
    });
    expect(g.rowCount).toBeGreaterThan(0);
    for (const d of g.detected) {
      expect(d.kidsTop, 'Detected text starts inside the row').toBeGreaterThanOrEqual(d.rowTop - 0.5);
      expect(d.kidsBottom, 'Detected text ends inside the row (not clipped)').toBeLessThanOrEqual(d.rowBottom + 0.5);
      expect(d.cellFit, 'Detected cell does not clip its content').toBe(true);
      expect(d.kidsRight, 'Detected text stays inside its column').toBeLessThanOrEqual(d.cellRight + 0.5);
      expect(d.lines, 'Detected is two lines: time, then who + alerted').toBeLessThanOrEqual(2);
    }
    expect(g.hasActs).toBeGreaterThan(0);
    expect(g.pinnedBorder, 'no border before the actions').toBe('0px');
    expect(g.pinnedHeadBorder, 'no border before the actions header').toBe('0px');
    for (const s of g.stripe) expect(s.act, 'the critical stripe is never on the actions cell').toBe('none');
    expect(g.stripe.filter(s => s.first !== 'none').length, 'one stripe, on the open row only').toBe(1);
    expect(g.headText, 'the actions column has a header').toBe('Actions');
    expect(g.resizeShown, 'no stray resize divider on the actions header').toBe(false);
    if (isTouch()) for (const b of g.btns) { expect(b.h, 'action button height on touch').toBeGreaterThanOrEqual(44); expect(b.w, 'action button width on touch').toBeGreaterThanOrEqual(44); }

    // 1b — everything fits: no sideways scroll in the grid (All shows every record), no ellipsis in a header,
    //      the status pill is ONE line, the second step lives in the ⋯ menu
    const fit = await page.evaluate(() => {
      const vis = (e: Element) => (e as HTMLElement).getBoundingClientRect().width > 0;
      const vp = (document.querySelector('.pf-cr__main .ag-body-horizontal-scroll-viewport') ?? document.querySelector('.pf-cr__main .ag-center-cols-viewport') ?? document.querySelector('.pf-cr__main .ag-body-viewport')) as HTMLElement;
      const heads = [...document.querySelectorAll('.pf-cr__main .ag-header-cell-text')].filter(vis).map(h => ({ t: h.textContent, clipped: (h as HTMLElement).scrollWidth > (h as HTMLElement).clientWidth + 1 }));
      const pills = [...document.querySelectorAll('.pf-cr__main .pf-cr-status, .pf-cr__main .pf-cr-word')].filter(vis).map(x => { const r = x.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(x).lineHeight) || 16; return { h: r.height, lh, w: r.width, cellW: (x.closest('.ag-cell') as HTMLElement).clientWidth }; });
      const clippedCells = [...document.querySelectorAll('.pf-cr__main .ag-cell')].filter(vis).filter(c => (c as HTMLElement).scrollWidth > (c as HTMLElement).clientWidth + 1).length;
      return { scroll: vp.scrollWidth - vp.clientWidth, heads, pills, clippedCells, text: [...document.querySelectorAll('.pf-cr__main .ag-cell')].map(c => (c as HTMLElement).innerText).join(' | ') };
    });
    expect(fit.scroll, 'no horizontal scroll in the register').toBeLessThanOrEqual(1);
    expect(fit.clippedCells, 'no cell is wider than its column').toBe(0);
    for (const h of fit.heads) expect(h.clipped, `header "${h.t}" shows no ellipsis`).toBe(false);
    for (const x of fit.pills) { expect(x.h, 'status pill is a single line').toBeLessThan(x.lh + 10); expect(x.w, 'status pill fits its column').toBeLessThanOrEqual(x.cellW); }
    if (!isPhone()) {
      expect(fit.text).toContain('Kavya Desk');
      expect(fit.text).toContain('Told Dr. Ravi Kumar');
      const more = page.getByRole('button', { name: /More actions/ }).locator('visible=true').first();
      await expect(more).toBeVisible();
      const mb = await more.boundingBox();
      if (isTouch()) { expect(mb!.height).toBeGreaterThanOrEqual(44); expect(mb!.width).toBeGreaterThanOrEqual(44); }
      await more.click();
      await expect(page.getByRole('menuitem', { name: /Communicate|Record communication/ }).locator('visible=true').first()).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      // Status words, not pills (owner design D, 2026-11-21): the phone Record cell's status is a `.pf-cr-word`.
      await expect(page.locator('.pf-cr__main .pf-cr-word, .pf-cr__main .pf-cr-status').filter({ hasText: "Not ack'd" }).locator('visible=true').first()).toBeVisible();
    }

    // 2 — the status filter: vertical rows, none over the next label
    await openFiltersIfSheet(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/critical-filters-${tag}.png` });
    const f = await page.evaluate(() => {
      const vis = (e: Element) => (e as HTMLElement).getBoundingClientRect().width > 0;
      const items = [...document.querySelectorAll('[data-testid="cr-status"] .pf-side-item')].filter(vis).map(e => e.getBoundingClientRect());
      const lbl = [...document.querySelectorAll('.pf-field__lbl')].filter(vis).find(e => /Detected/.test(e.textContent ?? ''))!.getBoundingClientRect();
      const card = (document.querySelector('[data-testid="cr-status"]')!.closest('.pf-card') as HTMLElement).getBoundingClientRect();
      return { items: items.map(r => ({ t: r.top, b: r.bottom, l: r.left, r: r.right })), lbl: { t: lbl.top }, card: { l: card.left, r: card.right } };
    });
    expect(f.items.length).toBe(4);
    for (let i = 1; i < f.items.length; i++) expect(f.items[i].t, 'status rows do not overlap').toBeGreaterThanOrEqual(f.items[i - 1].b - 0.5);
    expect(f.lbl.t - f.items[3].b, 'the next label sits clear below the status rows').toBeGreaterThanOrEqual(8);
    for (const i of f.items) { expect(i.l).toBeGreaterThanOrEqual(f.card.l); expect(i.r).toBeLessThanOrEqual(f.card.r); }
  });
}
