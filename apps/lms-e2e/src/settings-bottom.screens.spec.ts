import type { Page } from '@playwright/test';
import { test, expect } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * Owner rule (2026-11-17): NOTHING clickable at the bottom of a Settings / Test Master screen, next to the bottom nav —
 * no Save bars, footer buttons, sticky bottom actions, "load more" or bottom-pinned links. Save / Discard live in the
 * band's top-right corner; Add / Preview / filters in the card head; a panel's actions in the panel's head.
 *
 * The check: no visible button / link / input in the bottom 15% of the band body that is PINNED there — i.e. not
 * scrolled content (inside a scrolling card body) and not a grid's own rows / cells.
 */
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();

async function pinnedAtBottom(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const body = [...document.querySelectorAll<HTMLElement>('.pf-band-body')].filter(b => b.getBoundingClientRect().height > 0).pop();
    if (!body) return ['no band body'];
    const r = body.getBoundingClientRect();
    const limit = r.bottom - r.height * 0.15;
    const bad: string[] = [];
    const scrolls = (el: HTMLElement) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1; };
    for (const el of body.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"]')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0 || b.top < limit || b.top > r.bottom) continue;
      if (el.closest('.ag-row, .ag-header, .ag-cell, .ag-paging-panel, .ag-overlay, .pf-dialog, [role="dialog"]')) continue;
      let p: HTMLElement | null = el.parentElement; let inScroll = false; let pinned = false;
      while (p && p !== body) {
        const pos = getComputedStyle(p).position;
        if (pos === 'sticky' || pos === 'fixed') pinned = true;
        if (scrolls(p)) inScroll = true;
        p = p.parentElement;
      }
      if (pinned || !inScroll) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}"`);
    }
    return bad;
  });
}

const DEPTS = [
  { id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true },
  { id: 'd2', name: 'Haematology', code: 'HAE', isActive: true },
];
const TESTS = Array.from({ length: 10 }, (_, i) => ({
  id: `t${i + 1}`, testCode: `T${100 + i}`, name: `Demo test ${i + 1}`, shortName: '', section: '', type: 'individual', isActive: true,
  price: 100 + i, tatHours: 4, department: DEPTS[i % 2], departmentId: DEPTS[i % 2].id, tubeColor: 'Grey', parameters: '[]',
}));

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/tests/' || r.path === '/api/tests') return ok(TESTS);
    if (r.path === '/api/tenants/departments') return ok(DEPTS);
    if (r.path === '/api/option-groups' || r.path.startsWith('/api/microbiology/') || r.path === '/api/tests/prices/specimens') return ok([]);
    return undefined;
  };
  await installNegBackend(page, context);
});

const PAGES: [string, string][] = [
  ['overview', '/admin'],
  ['org profile', '/admin?section=profile'],
  ['numbers', '/admin?section=numbers'],
  ['billing', '/admin?section=billing'],
  ['channels', '/admin?section=channels'],
  ['people', '/admin?section=people'],
  ['branches', '/admin?section=branches'],
  ['lab collection', '/admin/lab/collection'],
  ['lab results', '/admin/lab/results'],
  ['lab front desk', '/admin/lab/front-desk'],
  ['lab alerts', '/admin/lab/alerts'],
  ['report design', '/admin/reports'],
  ['test master', '/admin/tests'],
  ['option groups', '/admin/tests?view=option-groups'],
  ['microbiology', '/admin/tests?view=microbiology'],
  ['pricing', '/admin/tests?view=pricing'],
];

test.describe('Nothing clickable at the bottom (Settings + Test Master)', () => {
  for (const [name, url] of PAGES) {
    test(`${name}: no pinned button / link / input in the bottom 15%`, async ({ page }) => {
      await go(page, url);
      await expect(vis(page, '.pf-band-body')).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(2500);
      expect(await pinnedAtBottom(page), `${name}: pinned at the bottom`).toEqual([]);
    });
  }
});
