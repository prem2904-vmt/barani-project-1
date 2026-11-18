import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, shotsDir } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * Test Master's band views in its two-panel frame (owner 2026-11-17): Option groups, Microbiology and Pricing —
 * side card LEFT + main card (pf-card__head) with a flush grid that fills to the bottom, no loose labels above.
 * Narrow widths: the side card is a sheet (Option groups) or a pick in the head. API mocked, demo data only.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/tm-views');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}
/** Side card and main card share one height (desktop / tablet). */
async function sameHeight(page: Page, side: string, main: string) {
  if (isPhone()) return;
  const [a, b] = await Promise.all([vis(page, side).boundingBox(), vis(page, main).boundingBox()]);
  expect(a && b, 'both cards render').toBeTruthy();
  expect(Math.abs(a!.height - b!.height), 'same height').toBeLessThan(3);
  expect(a!.x, 'side card is LEFT').toBeLessThan(b!.x);
}

const DEPTS = [
  { id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true },
  { id: 'd2', name: 'Haematology', code: 'HAE', isActive: true },
  { id: 'd3', name: 'Molecular', code: 'MOL', isActive: true },
];
const TESTS = Array.from({ length: 18 }, (_, i) => {
  const d = DEPTS[i % 3];
  return {
    id: `t${i + 1}`, testCode: `${d.code}${100 + i}`, name: `Demo test ${i + 1}`, shortName: '', section: '',
    type: i % 7 === 6 ? 'profile' : 'individual', isActive: true, price: 120 + i * 30, priceIsDefault: false, isOffered: i % 5 !== 4,
    tatHours: 4, department: { id: d.id, name: d.name, code: d.code }, departmentId: d.id, tubeColor: 'Grey', parameters: '[]',
  };
});
const OG = Array.from({ length: 9 }, (_, g) => ({
  code: `og${g}`, name: ['Detection status', 'Presence', 'Colour', 'Appearance', 'Reactivity', 'Blood group', 'Rh type', 'Growth', 'Grade'][g],
  values: [{ code: null, value: 'Detected', normal: false, active: true }, { code: null, value: 'Not detected', normal: true, active: true }],
  links: TESTS.slice(0, 3 + g).map(t => ({ testId: t.id, testCode: t.testCode, testName: t.name, paramName: 'p1', paramTitle: 'Result' })),
}));
const SPECIMENS = Array.from({ length: 12 }, (_, i) => ({ code: `SP${i}`, name: `Specimen ${i + 1}`, category: 'Fluid', site: 'Site', container: 'Sterile', transport: 'RT', suitableFor: 'Culture' }));

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/tests/' || r.path === '/api/tests') return ok(TESTS);
    if (r.path === '/api/tenants/departments') return ok(DEPTS);
    if (r.path === '/api/option-groups') return ok(OG);
    if (r.path === '/api/microbiology/specimens') return ok(SPECIMENS);
    if (r.path.startsWith('/api/microbiology/')) return ok([]);
    if (r.path === '/api/tests/prices/specimens') return ok([]);
    return undefined;
  };
  await installNegBackend(page, context);
});

test.describe('Test Master views: two-panel', () => {
  test('Option groups: detail side card LEFT, groups grid in the main card; narrow = sheet on row click', async ({ page }) => {
    await go(page, '/admin/tests?view=option-groups');
    await expect(vis(page, '[data-testid="og-main"] .pf-card__head')).toContainText('Option groups', { timeout: 60_000 });
    await expect(vis(page, '[data-testid="og-main"]')).toContainText('9 groups');
    await expect(page.getByText('Demo test 1').locator('visible=true').first()).toBeAttached({ timeout: 20_000 }).catch(() => undefined);
    if (isPhone() || (page.viewportSize()?.width ?? 0) <= 900) {
      await expect(page.locator('[data-testid="og-side"]')).toHaveCount(0);
      await page.waitForTimeout(500);
      await shot(page, 'og');
      await vis(page, '[data-testid="og-main"] .ag-row').click();
      await expect(vis(page, '[data-testid="og-side"]')).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, 'og-sheet');
    } else {
      await expect(vis(page, '[data-testid="og-side"]')).toContainText('Linked tests');
      await sameHeight(page, '[data-testid="og-side"]', '[data-testid="og-main"]');
      // No native title on the linked-test rows (it rendered at the page's top-left).
      await expect(page.locator('[data-testid="og-side"] .pf-og__test[title]')).toHaveCount(0);
      await page.waitForTimeout(500);
      await shot(page, 'og');
    }
  });

  test('Microbiology: Masters side card LEFT full height, main card head with the master + count', async ({ page }) => {
    await go(page, '/admin/tests?view=microbiology');
    await expect(vis(page, '[data-testid="mm-main"] .pf-card__head')).toContainText('12 specimens', { timeout: 60_000 });
    if (!isPhone() && (page.viewportSize()?.width ?? 0) > 900) {
      await expect(vis(page, '[data-testid="mm-side"]')).toContainText('Masters');
      await sameHeight(page, '[data-testid="mm-side"]', '[data-testid="mm-main"]');
    }
    await page.waitForTimeout(500);
    await shot(page, 'micro');
  });

  test('Pricing: Departments side card LEFT, prices grid in the main card', async ({ page }) => {
    await go(page, '/admin/tests?view=pricing');
    await expect(vis(page, '[data-testid="pr-main"] .pf-card__head')).toContainText('18 tests', { timeout: 60_000 });
    await expect(vis(page, '[data-testid="pr-main"] .ag-header')).toContainText('Price');
    await expect(page.locator('.pf-pricing__row')).toHaveCount(0);      // no card-per-row list
    if (!isPhone() && (page.viewportSize()?.width ?? 0) > 900) {
      await expect(vis(page, '[data-testid="pr-side"]')).toContainText('All');
      await sameHeight(page, '[data-testid="pr-side"]', '[data-testid="pr-main"]');
    }
    await page.waitForTimeout(500);
    await shot(page, 'pricing');
  });

  test('Option groups side card: wrapped value chips never slide under "Linked tests" (no shrink in the side card)', async ({ page }) => {
    test.skip(isPhone());
    await page.setViewportSize({ width: 1440, height: 900 });
    const long = ['Detected — strongly positive', 'Not detected — negative', 'Indeterminate, repeat the test', 'Weakly positive, borderline', 'Invalid sample, recollect'];
    const prev = neg.hook;
    neg.hook = r => (r.method === 'GET' && r.path === '/api/option-groups')
      ? { status: 200, body: { success: true, data: [{ code: 'ogL', name: 'Long values', values: long.map((v, i) => ({ code: null, value: v, normal: i === 1, active: true })),
          links: TESTS.slice(0, 12).map(t => ({ testId: t.id, testCode: t.testCode, testName: t.name, paramName: 'p1', paramTitle: 'Result' })) }] } }
      : prev?.(r);
    await go(page, '/admin/tests?view=option-groups');
    await expect(vis(page, '[data-testid="og-side"] .pf-og__chips')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => {
      const chips = document.querySelector('[data-testid="og-side"] .pf-og__chips')!;
      const label = [...document.querySelectorAll('[data-testid="og-side"] .pf-og__slabel')].find(l => /Linked tests/.test(l.textContent ?? ''))!;
      const rows = new Set([...chips.children].map(c => Math.round(c.getBoundingClientRect().top))).size;
      return { chipsBottom: chips.getBoundingClientRect().bottom, labelTop: label.getBoundingClientRect().top, rows,
               lastChipBottom: Math.max(...[...chips.children].map(c => c.getBoundingClientRect().bottom)) };
    });
    expect(g.rows, 'the chips wrap').toBeGreaterThan(1);
    expect(g.labelTop, 'label below the chips box').toBeGreaterThanOrEqual(g.chipsBottom - 0.5);
    expect(g.labelTop, 'label below the last chip').toBeGreaterThanOrEqual(g.lastChipBottom - 0.5);
  });
});
