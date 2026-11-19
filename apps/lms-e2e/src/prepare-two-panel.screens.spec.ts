import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, shotsDir } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * PREPARE (case-sheet picker) is OUR two-panel (owner 2026-11-19): the Departments side card on the LEFT at --pf-side-w,
 * the department's case sheets in the main card on the RIGHT, same height, no button in the band's corner ("My case
 * sheets" is in the side card's head), "Continue" drafts as a second group. Phone: the list is the first screen.
 * API mocked, fake data only. Screenshots: SHOTS_DIR/<form factor>/prepare-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/prepare-2p');
const out = () => shotsDir(OUT_BASE);
const DEPTS = ['ENT', 'General Medicine', 'Orthopaedics', 'Paediatrics', 'Dermatology'].map((name, i) => ({ key: name.toLowerCase().replace(/\W+/g, '-'), name, sortOrder: i + 1, isActive: true }));
const FORMS = [
  ['Nose history', 'ENT', true], ['Ear examination', 'ENT', false], ['Throat review', 'ENT', false],
  ['General consultation', 'General Medicine', false], ['Wound review', 'General Medicine', false],
  ['Knee pain', 'Orthopaedics', false],
].map(([title, dept, pinned], i) => ({
  id: `f${i}`, key: `k${i}`, title, departmentKey: DEPTS.find(d => d.name === dept)!.key, departmentName: dept, pinned,
  published: { id: `v${i}`, versionNo: 1, publishedAt: '2026-11-01T10:00:00Z' },
}));
const DRAFTS = [{ id: 'c1', state: 'draft', formId: 'f0', formTitle: 'Nose history', patientName: 'Meenakshi Demo', updatedAt: new Date(Date.now() - 3600_000).toISOString(), rowVersion: 1 }];

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/casesheets/departments') return { status: 200, body: DEPTS };
    if (r.path === '/api/casesheets/forms') return { status: 200, body: { items: FORMS, total: FORMS.length, page: 1, pageSize: 100 } };
    if (r.path === '/api/casesheets/sheets') return { status: 200, body: { items: DRAFTS, total: DRAFTS.length, page: 1, pageSize: 4 } };
    if (r.path.startsWith('/api/casesheets/')) return ok([]);
    return undefined;
  };
  await page.addInitScript(() => { try { localStorage.setItem('pf.casesheets', '1'); } catch { /* blocked */ } });
  await installNegBackend(page, context);
});

const side = (page: Page) => page.locator('[data-testid="tp-nav"]').locator('visible=true').first();
const main = (page: Page) => page.locator('[data-testid="tp-panel"]').locator('visible=true').first();

test.describe('Prepare two-panel', () => {
  test('wide: side card LEFT at the shared width, main card RIGHT, same height, no band-corner button, one scroll level', async ({ page }) => {
    test.skip(isPhone());
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/prepare');
    await expect(side(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="tp-item-ENT"]')).toBeVisible();
    await expect(main(page).locator('.dp__tile')).toHaveCount(3);
    const m = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const w = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pf-side-w')) || 340;
      return { side: r('[data-testid="tp-nav"]'), panel: r('[data-testid="tp-panel"]'), w, rowH: r('[data-testid="tp-item-ENT"]').height,
        pageScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        bandBtn: !!document.querySelector('pf-hero-band [data-my-sheets], pf-hero-band .pf-hb__actions a') };
    });
    expect(Math.round(m.side.width), 'side card width').toBe(Math.round(m.w));
    expect(m.side.left, 'side card on the left').toBeLessThan(m.panel.left);
    expect(Math.round(m.side.top), 'top aligned').toBe(Math.round(m.panel.top));
    expect(Math.round(m.side.height), 'same height').toBe(Math.round(m.panel.height));
    expect(m.rowH, 'shared 44px row').toBe(44);
    expect(m.pageScroll, 'no page scroll').toBeLessThanOrEqual(1);
    expect(m.bandBtn, 'no button in the band corner').toBe(false);
    // the side card's head: icon + DEPARTMENTS + count; "My case sheets" is in the main card's head
    await expect(side(page).locator('[data-testid="tp-nav-title"]')).toHaveText('Departments');
    await expect(side(page).locator('[data-dept-count]')).toHaveText('5');
    await expect(main(page).locator('.pf-tp__head [data-my-sheets]')).toBeVisible();
    // the count sits on the right of each row; the drafts group is "Continue"
    await expect(page.locator('[data-testid="tp-item-ENT"] .pf-tp__note')).toHaveText('3');
    // owner 2026-11-19: drafts are NOT in the side card; the main card's pill switches Case sheets | Continue
    await expect(page.locator('[data-testid="tp-group-continue"]')).toHaveCount(0);
    await expect(side(page).locator('[data-case]')).toHaveCount(0);
    await expect(main(page).locator('.pf-tp__head pf-segmented')).toBeVisible();
    // main card head: the department + "n case sheets"
    await expect(main(page).locator('.pf-tp__title')).toHaveText('ENT');
    await expect(main(page).locator('.pf-tp__desc')).toContainText('3 case sheets');
    // favourite toggle keeps working
    const star = main(page).locator('[data-pin="k0"]');
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    // picking another department swaps the right card
    await page.locator('[data-testid="tp-item-General Medicine"]').click();
    await expect(main(page).locator('.pf-tp__title')).toHaveText('General Medicine');
    await expect(main(page).locator('.dp__tile')).toHaveCount(2);
    await shot(page, 'prepare-wide');
    // Continue: the saved drafts as rows, with search + "This department only"
    await main(page).locator('.pf-tp__head [data-tab="continue"]').click();
    await expect(main(page).locator('[data-drafts] [data-case="c1"]')).toContainText('Meenakshi Demo');
    await expect(main(page).locator('[data-drafts] [data-case="c1"]')).toContainText('Nose history');
    await expect(main(page).locator('[data-draft-search]')).toBeVisible();
    await expect(main(page).locator('[data-only-dept]')).toBeVisible();
    await shot(page, 'prepare-continue');
    await main(page).locator('[data-draft-search]').fill('zzz');
    await expect(main(page).locator('[data-empty="drafts"]')).toContainText('No drafts to continue');
    expect(errors).toEqual([]);
  });

  test('phone: the Departments list is the first screen; picking one opens its case sheets', async ({ page }) => {
    test.skip(!isPhone());
    await go(page, '/prepare');
    await expect(side(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="tp-panel"]').locator('visible=true')).toHaveCount(0);
    await expect(side(page).locator('.pf-tp__navhead [data-my-sheets]')).toBeVisible();
    const head = await side(page).locator('.pf-tp__navhead').evaluate(h => ({ over: h.scrollWidth - h.clientWidth }));
    expect(head.over, 'the head fits').toBeLessThanOrEqual(0);
    await shot(page, 'prepare-phone-list');
    await page.locator('[data-testid="tp-item-ENT"]').click();
    await expect(main(page).locator('.dp__tile')).toHaveCount(3);
    await expect(side(page)).toHaveCount(0);
    await shot(page, 'prepare-phone-dept');
    await main(page).locator('.pf-tp__head [data-tab="continue"]').click();
    await expect(main(page).locator('[data-drafts] [data-case="c1"]')).toContainText('Meenakshi Demo');
    await shot(page, 'prepare-phone-continue');
  });
});
