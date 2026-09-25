import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Culture case — REAL layout (jsdom can't lay out). Signs in as the seeded
 * Micro World Lab Admin (support/auth ROLE_CREDS), opens the first culture
 * case from My Work's Culture tab, and checks the nd pattern at 1440 and
 * 375: the context bar, ONE band primary ("Submit all results"), every stage
 * stacked (no tabs), Inoculate in the nav row, option controls FILLING the
 * control column with equal segments, stacked phone rows. Read-only: it never taps
 * an option, so no stage is picked. Screenshots into $SHOTS_DIR when set.
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

async function openCase(page: Page): Promise<boolean> {
  const direct = process.env['CULTURE_ORDER_TEST_ID'];
  if (direct) { await page.goto(`/lab/culture/${direct}`); return true; }
  await page.goto('/lab/my-work');
  await page.waitForLoadState('networkidle').catch(() => {});
  const tab = page.locator('pf-segmented button[aria-label="Culture"], .pf-mtab[aria-label="Culture bench"]').first();
  if (!(await tab.count())) return false;
  await tab.click();
  const card = page.locator('li.pf-cc .pf-cc__hdr').first();
  try { await card.waitFor({ timeout: 15_000 }); } catch { return false; }
  await card.click();
  try { await page.waitForURL(/\/lab\/culture\//, { timeout: 15_000 }); return true; } catch { return false; }
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.toggle('dark', t === 'dark');
    r.classList.toggle('light', t === 'light');
    r.setAttribute('data-theme', t);
  }, theme);
}

async function shoot(page: Page, w: number) {
  if (!SHOTS) return;
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${w}-${theme}.png`, fullPage: false });
  }
}

// A fake camera so the Measure modal's live reticle renders headless.
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

test.describe('Culture case — real layout', () => {
  test('1440 + 375: context bar, one primary, stacked stages, filling options, stacked phone rows', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    const opened = await openCase(page);
    test.skip(!opened, 'No culture case to open (set CULTURE_ORDER_TEST_ID).');

    await expect(page.locator('.pf-cse-ctx .pf-cse-chip--id')).toBeVisible({ timeout: 20_000 });
    const primary = page.locator('pf-hero-band .pf-hb-btn--primary');
    await expect(primary).toHaveCount(1);
    await expect(primary).toContainText('Submit all results');
    await expect(page.locator('[role="tablist"].pf-cse-tabs')).toHaveCount(0);
    expect(await page.locator('section.pf-stg').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.pf-cse-nav .pf-cse-incubbtn.nd-btn--secondary')).toBeVisible();

    // Options FILL the control column, segments equal width.
    const row = page.locator('.pf-cse-row').filter({ has: page.locator('.pf-cse-opts--fill:not(.pf-cse-opts--many)') }).first();
    if (await row.count()) {
      const cw = (await row.locator('.pf-cse-row__ctl').boundingBox())!.width;
      const ow = (await row.locator('.pf-cse-opts').boundingBox())!.width;
      expect(ow).toBeGreaterThanOrEqual(cw - 2);
      const widths = await row.locator('.pf-cse-opt').evaluateAll(els => els.map(e => e.getBoundingClientRect().width));
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
      const h = (await row.locator('.pf-cse-opt').first().boundingBox())!.height;
      expect(h).toBeGreaterThanOrEqual(36);
    }
    await shoot(page, 1440);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);
    if (await row.count()) {
      const name = (await row.locator('.pf-cse-row__name').boundingBox())!;
      const ctl = (await row.locator('.pf-cse-row__ctl').boundingBox())!;
      expect(ctl.y).toBeGreaterThan(name.y + name.height - 1);   // stacked below the name
    }
    const act = page.locator('pf-hero-band .pf-cse-act').first();
    const aBox = (await act.boundingBox())!;
    expect(Math.round(aBox.width)).toBeGreaterThanOrEqual(44);
    await shoot(page, 375);
  });

  test('AST table (light + dark) and the Measure zones modal (1440 + 375)', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    // READ-ONLY: the case response is rewritten in the browser so the AST
    // stage is open with an identified organism, and the first-touch pick
    // is answered locally — nothing is claimed or written on the server.
    let lastCase: any = null;
    await page.route(/\/api\/microbiology\/culture\/[^/?]+(\?.*)?$/, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      const openIt = (c: any) => {
        for (const st of c?.stages ?? []) {
          if (st.key === 'identification') {
            st.state = 'done';
            st.valuesJson = JSON.stringify({ fields: [{ name: 'organism', title: 'Organism', value: 'Staphylococcus aureus' }] });
          }
          if (st.key === 'ast') { st.state = 'open'; st.holderUserId = null; st.holderName = null; st.valuesJson = null; }
        }
      };
      const c = body?.data ?? body;   // ApiService envelope
      openIt(c);
      for (const sub of c?.subCultures ?? []) openIt(sub);
      lastCase = body;
      await route.fulfill({ response: res, json: body });
    });
    await page.route(/\/api\/microbiology\/culture\/.*\/stage\/ast\/pick/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lastCase) }));
    const opened = await openCase(page);
    test.skip(!opened, 'No culture case to open (set CULTURE_ORDER_TEST_ID).');
    const ast = page.locator('section.pf-stg').filter({ hasText: /sensitivity/i }).first();
    await expect(ast).toBeVisible({ timeout: 20_000 });
    const openBtn = ast.locator('.pf-cse__astbtn');
    test.skip(!(await openBtn.count()), 'AST stage not editable.');
    await openBtn.click();
    const table = page.locator('.ce-abx').first();
    const hasTable = await table.waitFor({ timeout: 8_000 }).then(() => true).catch(() => false);
    if (hasTable) {
      // Give one row a picked result (local only) so the subtle tint shows.
      const zone = page.locator('.ce-abx__row').first().locator('.ce-sirseg [data-v="R"]');
      if (await zone.count()) await zone.click();
      // BOTH themes: breakpoints / headers / MIC line neutral; the picked
      // result a subtle tint; every row its own shaded card.
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await page.waitForTimeout(200);
        const picked = page.locator('.ce-sir-picked').first();
        if (await picked.count()) {
          const bg = await picked.evaluate(e => getComputedStyle(e).backgroundColor);
          expect(bg).toMatch(/rgba\(239, 68, 68, 0\.(12|2)\)/);   // soft red tint, not a solid fill
        }
        const colours = await page.evaluate(() => [...document.querySelectorAll(
          '.ce-abx__head span, .ce-abx__bpbox, .ce-abx__mic, .ce-abx__mic em')]
          .flatMap(e => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]));
        for (const c of colours) expect(c).not.toMatch(/rgba?\((16, 185, 129|52, 211, 153|245, 158, 11|251, 191, 36|239, 68, 68|248, 113, 113)/);
        const rowBg = await page.locator('.ce-abx__row').first().evaluate(e => getComputedStyle(e).backgroundColor);
        expect(rowBg).not.toBe('rgba(0, 0, 0, 0)');
      }
      if (SHOTS) {
        for (const theme of ['light', 'dark'] as const) {
          await setTheme(page, theme);
          await page.waitForTimeout(250);
          await table.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${SHOTS}/ast-1440-${theme}.png` });
        }
      }
      const measure = page.locator('.ce-org pf-touch-btn').filter({ hasText: 'Measure' }).first();
      if (await measure.count()) {
        await setTheme(page, 'light');
        await measure.click();
        const modal = page.locator('pf-plate-measure .pm-panel');
        await expect(modal).toBeVisible();
        await expect(modal.locator('.pm-head__label')).toHaveText(/Measure zones/i);
        await expect(modal.locator('.pm-step')).toHaveCount(4);
        await page.waitForTimeout(1200);   // fake camera frames + reticle
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/measure-1440-light.png` });
        await page.setViewportSize({ width: 375, height: 812 });
        await page.waitForTimeout(400);
        const box = (await modal.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(370);   // full-width sheet
        expect(box.y).toBeGreaterThanOrEqual(0);         // header on screen, above the nav
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/measure-375-light.png` });
        await setTheme(page, 'dark');
        await page.waitForTimeout(200);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/measure-375-dark.png` });
        await modal.locator('.pm-x').click();
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    }
  });
});
