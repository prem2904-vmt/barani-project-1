import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, isDesktop, expectLayout, shotsDir } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * SETTINGS in Test Master's frame (owner 2026-11-17, DESIGN-V2): Test Master itself, the overview and the card-style
 * settings (rows), on every form factor, light + dark. API mocked, demo data only. Screenshots: SHOTS_DIR/<form factor>/.
 *
 * SV2_ONLY_TM=1 shoots only Test Master (used against the pre-re-home build for the before/after comparison).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/settings-v2');
const out = () => shotsDir(OUT_BASE);
const ONLY_TM = process.env['SV2_ONLY_TM'] === '1';
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
/** Desktop / tablet: the document never scrolls — only the card bodies do. */
async function expectNoPageScroll(page: Page, tag: string) {
  if (isPhone()) return;
  const over = await page.evaluate(() => {
    const els = [document.scrollingElement, document.querySelector('.shell-main')].filter(Boolean) as Element[];
    return els.map(e => e.scrollHeight - e.clientHeight).filter(d => d > 2);
  });
  expect(over, `${tag}: no page scroll`).toEqual([]);
}

const DEPTS = [
  { id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true },
  { id: 'd2', name: 'Haematology', code: 'HAE', isActive: true },
  { id: 'd3', name: 'Microbiology', code: 'MIC', isActive: true },
];
const TESTS = Array.from({ length: 14 }, (_, i) => {
  const d = DEPTS[i % 3];
  return {
    id: `t${i + 1}`, testCode: `T${String(100 + i)}`, name: ['Glucose fasting', 'HbA1c', 'Complete blood count', 'Urine culture', 'Creatinine', 'ESR', 'Blood culture',
      'Lipid profile', 'Platelet count', 'Sputum culture', 'Urea', 'Haemoglobin', 'Stool culture', 'Bilirubin total'][i],
    shortName: '', section: '', type: 'individual', isActive: true, price: 120 + i * 30, tatHours: 4,
    department: { id: d.id, name: d.name, code: d.code }, departmentId: d.id, tubeColor: 'Grey', parameters: '[]',
  };
});

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    if (r.path === '/api/tests/' || r.path === '/api/tests') return { status: 200, body: { success: true, data: TESTS } };
    if (r.path === '/api/tenants/departments') return { status: 200, body: { success: true, data: DEPTS } };
    return undefined;
  };
  await installNegBackend(page, context);
});

test.describe('settings v2 (Test Master frame)', () => {
  test('Test Master: its own band, view switch, departments side card, grid', async ({ page }) => {
    await go(page, '/admin/tests');
    await expect(vis(page, '.pf-tm-main')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Glucose fasting').locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
    // The view switch rides in the band (not hidden by a host).
    await expect(vis(page, '.pf-tm-bandseg')).toBeVisible();
    await expect(page.locator('[data-testid="settings-shell"]')).toHaveCount(0);
    await page.waitForTimeout(600);
    await shot(page, 'tm');
    if (!ONLY_TM) {
      await expectLayout(page, 'test master');
      await expectNoPageScroll(page, 'test master');
    }
  });

  test('overview: band search pill, Settings side card, section tiles in the main card', async ({ page }) => {
    test.skip(ONLY_TM);
    await go(page, '/admin');
    await expect(vis(page, '[data-testid="tp-item-lab"]')).toBeVisible({ timeout: 60_000 });
    // No separate search box: the search is the band pill.
    await expect(page.locator('.pf-ov__search').locator('visible=true')).toHaveCount(0);
    if (isPhone()) {
      await shot(page, 'overview-phone-list');
      await vis(page, '[data-testid="tp-item-lab"]').click();
      await expect(vis(page, '[data-testid="ov-tile-admin-lab-sample-numbers"]')).toBeVisible();
      await shot(page, 'overview-phone-lab');
    } else {
      await expect(vis(page, '[data-testid="ov-tile-admin-tests"]')).toBeVisible();
      await expectLayout(page, 'overview');
      await expectNoPageScroll(page, 'overview');
      await shot(page, 'overview');
    }
  });

  const CARD_PAGES: { name: string; url: string; wait: string }[] = [
    { name: 'sample-numbers-format', url: '/admin/lab/sample-numbers?tab=format', wait: '[data-testid="sid-format-row"]' },
    { name: 'sample-numbers-barcode', url: '/admin/lab/sample-numbers?tab=barcode', wait: '[data-testid="row-barcode"]' },
    { name: 'org-profile', url: '/admin/org/profile', wait: '[data-testid="org-profile"]' },
    { name: 'billing-payments', url: '/admin/billing?tab=payments', wait: '[data-testid="row-payment-gate"]' },
    { name: 'lab-alerts', url: '/admin/lab/alerts', wait: '[data-testid="alert-row"]' },
    { name: 'org-numbers', url: '/admin/org/numbers?tab=patient', wait: '[data-testid="fmt-row"]' },
    { name: 'collection', url: '/admin/lab/collection?tab=queue', wait: '[data-testid="settings-main"]' },
  ];
  for (const p of CARD_PAGES) {
    test(`card setting in the frame: ${p.name}`, async ({ page }) => {
      test.skip(ONLY_TM);
      await go(page, p.url);
      await expect(vis(page, '[data-testid="settings-shell"]')).toBeVisible({ timeout: 60_000 });
      await expect(vis(page, p.wait)).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(500);
      if (isDesktop()) await expectNoPageScroll(page, p.name);
      await expectLayout(page, p.name);
      await shot(page, `set-${p.name}`);
    });
  }

  test('full-screen pages open on their own with the back chevron to their Settings section', async ({ page }) => {
    test.skip(ONLY_TM);
    await go(page, '/admin?section=lab');
    await expect(vis(page, '[data-testid="ov-tile-admin-lab-analyzers"]')).toBeVisible({ timeout: 60_000 });
    await vis(page, '[data-testid="ov-tile-admin-lab-analyzers"]').click();
    await expect(page).toHaveURL(/\/admin\/instruments/);
    await expect(page.locator('[data-testid="settings-shell"]')).toHaveCount(0);
    await expect(vis(page, '[data-testid="settings-siblings"]')).toBeVisible({ timeout: 30_000 });
    await shot(page, 'full-analyzers');
    await vis(page, '.pf-hb__back').click();
    await expect(page).toHaveURL(/\/admin\?section=lab/);
  });
});
