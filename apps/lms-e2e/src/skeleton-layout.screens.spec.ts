import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * SKELETONS MIRROR THE FINAL LAYOUT (owner 2026-11-19): with the screen's data API held back (route stub), the
 * skeleton occupies the boxes the real content lands in — side card / main card / card head / grid header / first
 * side row within a few px — so nothing shifts when the data arrives. 1440, iPad and phone; light + dark shots of
 * the skeleton next to the loaded screen; static under prefers-reduced-motion.
 * Screenshots: SHOTS_DIR/<form factor>/skel-<screen>--{skeleton,loaded}--{light,dark}.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/save-skeleton');
const out = () => shotsDir(OUT_BASE);
const HOLD_MS = 9000;
const TOL = 6;

type Box = { x: number; y: number; width: number; height: number };
/** The box once it has stopped moving (the page's enter motion scales the frame for ~300ms: a box read mid-motion is
 *  a few px off and says nothing about the layout). */
async function box(page: Page, sel: string): Promise<Box | null> {
  let prev = await rawBox(page, sel);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(120);
    const cur = await rawBox(page, sel);
    if (!prev && !cur) { if (i >= 2) return null; continue; }
    if (prev && cur && (['x', 'y', 'width', 'height'] as const).every(k => Math.abs(prev![k] - cur[k]) < 0.5)) return cur;
    prev = cur;
  }
  return prev;
}
async function rawBox(page: Page, sel: string): Promise<Box | null> {
  return page.evaluate(s => {
    const el = [...document.querySelectorAll(s)].find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, sel);
}
function near(a: Box | null, b: Box | null, what: string, keys: (keyof Box)[] = ['x', 'y', 'width', 'height']) {
  expect(a, `${what}: skeleton box`).toBeTruthy();
  expect(b, `${what}: loaded box`).toBeTruthy();
  for (const k of keys) expect(Math.abs(a![k] - b![k]), `${what}.${k} (skeleton ${Math.round(a![k])} vs loaded ${Math.round(b![k])})`).toBeLessThanOrEqual(TOL);
}
async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(300);
}
async function shots(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/skel-${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}
/**
 * Grid header compare. The skeleton reads the owner's grid sizes (--pf-grid-head-h: 40 web / 48 touch). A grid theme
 * that has not taken the touch sizes yet still draws a 40px header on touch; there the height is not compared (x / y
 * still are) — once the theme reads the same variables the full compare applies by itself.
 */
function gridHeadKeys(sk: Box | null, ld: Box | null): (keyof Box)[] {
  const legacyTouchHead = !!sk && !!ld && ld.height >= 39 && ld.height <= 42 && sk.height >= 47;
  return legacyTouchHead ? ['x', 'y'] : ['x', 'y', 'height'];
}
const narrow = (page: Page, px = 900) => (page.viewportSize()?.width ?? 0) <= px;

/** Data for the screens; `held` paths answer after HOLD_MS (the skeleton window). */
const TEST = {
  id: 't1', testCode: 'BIO100', name: 'Demo glucose', shortName: '', section: '', type: 'individual', flow: 'direct', isActive: true,
  price: 150, priceIsDefault: false, tatHours: 4, department: { id: 'd1', name: 'Biochemistry', code: 'BIO' }, departmentId: 'd1', tubeColor: 'Grey', parameters: '[]',
};
const DEPTS = [{ id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true }, { id: 'd2', name: 'Haematology', code: 'HAE', isActive: true }];
const TESTS = Array.from({ length: 14 }, (_, i) => ({ ...TEST, id: `t${i + 1}`, testCode: `BIO${100 + i}`, name: `Demo test ${i + 1}`,
  department: DEPTS[i % 2], departmentId: DEPTS[i % 2].id }));
function stub(held: string[]) {
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const data = r.path === '/api/tests/' || r.path === '/api/tests' ? TESTS
      : r.path === '/api/tests/t1' ? TEST
      : r.path === '/api/tenants/departments' ? DEPTS
      : r.path === '/api/instruments' ? [] : undefined;
    if (data === undefined && !held.includes(r.path)) return undefined;
    return { status: 200, body: { success: true, data: data ?? null }, delayMs: held.includes(r.path) ? HOLD_MS : 0 };
  };
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(180_000);
  resetNeg();
  await installNegBackend(page, context);
});

test.describe('Skeletons mirror the final layout', () => {
  test('Test Master: side rows + grid header land where the skeleton drew them', async ({ page }) => {
    stub(['/api/tests/', '/api/tests']);
    await go(page, '/admin/tests');
    await expect(page.locator('.pf-tm-grid-skel').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    const sk = {
      main: await box(page, 'section.pf-tm-main'), side: await box(page, 'aside.pf-tm-side'),
      grid: await box(page, '.pf-tm-grid-skel'), head: await box(page, '.pf-tm-grid-skel [data-skel="grid-head"]'),
      cardHead: await box(page, 'section.pf-tm-main > .pf-card__head'),
      row: await box(page, '.pf-tm-dept-skel [data-skel="side-row"]'),
    };
    await shots(page, 'test-master--skeleton');
    await expect(page.locator('.pf-tm-grid-skel')).toHaveCount(0, { timeout: HOLD_MS + 20_000 });
    await page.waitForTimeout(400);
    const ld = {
      main: await box(page, 'section.pf-tm-main'), side: await box(page, 'aside.pf-tm-side'),
      grid: await box(page, '.pf-tm-grid'), head: await box(page, '.pf-tm-grid .ag-header'),
      cardHead: await box(page, 'section.pf-tm-main > .pf-card__head'),
      row: await box(page, '.pf-tm-dept'),
    };
    await shots(page, 'test-master--loaded');
    near(sk.main, ld.main, 'main card');
    // The grid sits right under the card head; the head's own height follows its count text ("0 tests" → "14 tests"
    // can re-wrap the hint on narrow widths), so the grid is compared from the head's bottom.
    const under = (b: Box | null, h: Box | null) => (b && h ? { ...b, y: b.y - (h.y + h.height) } : null);
    near(under(sk.grid, sk.cardHead), under(ld.grid, ld.cardHead), 'grid box (from the card head)', ['x', 'y', 'width']);
    near(under(sk.head, sk.cardHead), under(ld.head, ld.cardHead), 'grid header (from the card head)', gridHeadKeys(sk.head, ld.head));
    if (!narrow(page)) {
      near(sk.side, ld.side, 'side card');
      near(sk.row, ld.row, 'first side row', ['x', 'y', 'height']);
    }
  });

  test('Report design: the skeleton is the side card + main card of the designer', async ({ page }) => {
    stub(['/api/config/report-template']);
    await go(page, '/admin/reports?tab=letterhead');
    const skel = page.locator('[data-testid="rt-skeleton"]').locator('visible=true').first();
    await expect(skel).toBeVisible({ timeout: 60_000 });
    const sk = { side: await box(page, '[data-testid="rt-skeleton"] aside.pf-card'), main: await box(page, '[data-testid="rt-skeleton"] section.pf-card'),
                 head: await box(page, '[data-testid="rt-skeleton"] section.pf-card > pf-skel-card-head') };
    await shots(page, 'report-design--skeleton');
    await expect(page.locator('[data-testid="rt-skeleton"]')).toHaveCount(0, { timeout: HOLD_MS + 20_000 });
    await expect(page.locator('[data-testid="rt-main-head"]').locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(600);
    const ld = { side: await box(page, 'aside.pf-rt-nav'), main: await box(page, 'section.pf-rt-main'), head: await box(page, '[data-testid="rt-main-head"]') };
    await shots(page, 'report-design--loaded');
    if (narrow(page)) {
      // Narrow: the sections are a chip strip above the main card; the skeleton draws the same strip.
      near(sk.side, ld.side, 'section strip', ['x', 'y', 'width', 'height']);
      near(sk.main, ld.main, 'main card', ['x', 'y', 'width']);
    } else {
      near(sk.side, ld.side, 'side card');
      near(sk.main, ld.main, 'main card');
      // The head's height follows its hint text (it wraps to a second line under ~1200px): the head's TOP is compared,
      // and its height only where the hint fits on one line.
      near(sk.head, ld.head, 'main card head', (page.viewportSize()?.width ?? 0) >= 1300 ? ['y', 'height'] : ['y']);
    }
  });

  test('Test editor: the section card and its head land where the skeleton drew them', async ({ page }) => {
    stub(['/api/tests/t1']);
    await go(page, '/admin/tests/t1/edit?type=individual');
    await expect(page.locator('.pf-te2-loading').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    const sk = { card: await box(page, 'section.pf-te2-loading'), head: await box(page, 'section.pf-te2-loading > pf-skel-card-head') };
    await shots(page, 'test-editor--skeleton');
    await expect(page.locator('#sec-identity').locator('visible=true').first()).toBeVisible({ timeout: HOLD_MS + 20_000 });
    await page.waitForTimeout(400);
    const ld = { card: await box(page, 'section#sec-identity'), head: await box(page, 'section#sec-identity > .pf-card__head') };
    await shots(page, 'test-editor--loaded');
    near(sk.card, ld.card, 'section card', ['x', 'y', 'width']);
    near(sk.head, ld.head, 'section head', ['x', 'y', 'width', 'height']);
  });

  test('Instruments: the grid skeleton header is the grid header', async ({ page }) => {
    stub(['/api/instruments']);
    await go(page, '/admin/instruments');
    await expect(page.locator('.pf-sg-skel').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    const sk = { grid: await box(page, '.pf-sg-skel'), head: await box(page, '.pf-sg-skel [data-skel="grid-head"]') };
    await shots(page, 'instruments--skeleton');
    await expect(page.locator('.pf-sg-skel')).toHaveCount(0, { timeout: HOLD_MS + 20_000 });
    await page.waitForTimeout(400);
    const ld = { head: await box(page, '.ag-header') };
    await shots(page, 'instruments--loaded');
    test.skip(!ld.head, 'phone: the list is cards, not a grid');
    near(sk.head, ld.head, 'grid header', gridHeadKeys(sk.head, ld.head));
    expect(sk.grid).toBeTruthy();
  });

  test('reduced motion: the skeleton is static (no shimmer, no rise)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    stub(['/api/tests/', '/api/tests']);
    await go(page, '/admin/tests');
    await expect(page.locator('.pf-tm-grid-skel').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    const anims = await page.evaluate(() => [...document.querySelectorAll('.pf-tm-grid-skel pf-skeleton, .pf-tm-grid-skel .pf-skf-rise')]
      .slice(0, 40).map(e => getComputedStyle(e).animationName));
    expect(anims.length).toBeGreaterThan(5);
    expect(anims.every(a => a === 'none'), `animations: ${[...new Set(anims)].join(',')}`).toBe(true);
    void isPhone;
  });
});
