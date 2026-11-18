import type { Page } from '@playwright/test';
import { test, expect, isPhone } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * ONE side card everywhere (owner 2026-11-17): the same width (--pf-side-w) and the same first nav row box (height,
 * left inset, width) on every two-panel screen — Settings overview, Branches, Connected apps, Report design and the
 * Test Master views. Measured at 1440 and 1720.
 */
const DEPTS = [{ id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true }];
const SCREENS: { name: string; url: string; side: string; item: string | null }[] = [
  { name: 'Settings overview', url: '/admin', side: '[data-testid="tp-nav"]', item: '[data-testid="tp-nav"] .pf-tp__item' },
  { name: 'Branches', url: '/admin?section=branches', side: '[data-testid="tp-nav"]', item: '[data-testid="tp-nav"] .pf-tp__item' },
  { name: 'Connected apps', url: '/admin?section=connected', side: '[data-testid="tp-nav"]', item: '[data-testid="tp-nav"] .pf-tp__item' },
  { name: 'Report design', url: '/admin/reports', side: '[data-testid="rt-nav"]', item: '[data-testid="rt-nav"] .pf-side-item' },
  { name: 'Microbiology', url: '/admin/tests?view=microbiology', side: '[data-testid="mm-side"]', item: '[data-testid="mm-side"] .pf-side-item' },
  { name: 'Option groups', url: '/admin/tests?view=option-groups', side: '[data-testid="og-side"]', item: null },
  { name: 'Pricing', url: '/admin/tests?view=pricing', side: '[data-testid="pr-side"]', item: '[data-testid="pr-side"] .pf-side-item' },
];

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/tenants/departments') return ok(DEPTS);
    if (r.path === '/api/option-groups') return ok([{ code: 'og1', name: 'Detection status', values: [{ code: null, value: 'Detected', normal: false, active: true }], links: [] }]);
    if (r.path.startsWith('/api/microbiology/') || r.path === '/api/tests/prices/specimens') return ok([]);
    if (r.path === '/api/beta-features') return ok({ mcp: true });
    return undefined;
  };
  await page.addInitScript(() => { try { localStorage.setItem('pf.beta.mcp', '1'); } catch { /* blocked */ } });
  await installNegBackend(page, context);
});

async function measure(page: Page, side: string, item: string | null) {
  return page.evaluate(([s, i]) => {
    const vis = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].find(e => e.getBoundingClientRect().width > 0) ?? null;
    const a = vis(s!);
    const b = i ? vis(i) : null;
    const ar = a?.getBoundingClientRect(), br = b?.getBoundingClientRect();
    return { w: ar ? Math.round(ar.width) : -1, ih: br ? Math.round(br.height) : null, iw: br ? Math.round(br.width) : null,
             inset: br && ar ? Math.round(br.left - ar.left) : null };
  }, [side, item] as const);
}

for (const w of [1440, 1720]) {
  test(`at ${w}px every two-panel screen has the same side card and the same first row`, async ({ page }) => {
    test.skip(isPhone());
    await page.setViewportSize({ width: w, height: 1000 });
    const rows: Record<string, Awaited<ReturnType<typeof measure>>> = {};
    for (const sc of SCREENS) {
      await go(page, sc.url);
      await expect(page.locator(sc.side).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
      if (sc.item) await expect(page.locator(sc.item).locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(500);
      rows[sc.name] = await measure(page, sc.side, sc.item);
    }
    const ref = rows['Settings overview'];
    for (const [name, m] of Object.entries(rows)) {
      expect(m.w, `${name}: side card width`).toBe(ref.w);
      if (m.ih !== null) {
        expect(m.ih, `${name}: first row height`).toBe(ref.ih);
        expect(m.inset, `${name}: first row left inset`).toBe(ref.inset);
        expect(m.iw, `${name}: first row width`).toBe(ref.iw);
      }
    }
  });
}
