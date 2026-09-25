import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Test editor — REAL layout (ND-PATTERN "Editors"; jsdom can't lay out).
 * Signs in as the seeded Micro World Lab Admin, opens the OGTT (BIO005 —
 * or $TEST_ID) and checks at 1440 and 375: the band carries ONE primary
 * (Save), the pill is the CONTEXT BAR (full test name + chips), the
 * sections are a tabs row (no rail), the live preview is the side card at
 * 1440 and a sheet behind "Preview" at 375, no page-level scroll, no
 * monospace and no green anywhere on the editor. READ-ONLY: it never saves.
 * Screenshots (1440 / 375 × light / dark) into $SHOTS_DIR when set.
 *
 * CORS_RELAY=1 relays the backend calls from the runner so it can run
 * against a static build on a non-allowlisted port (BASE_URL=…:4310).
 */

const SHOTS = process.env['SHOTS_DIR'] || '';
const CODE = process.env['TEST_CODE'] || 'BIO005';

async function relayCors(page: Page) {
  if (!process.env['CORS_RELAY']) return;
  await page.route(/prefrontal\.health\/api\//, async route => {
    const origin = new URL(page.url() || 'http://localhost').origin;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.toggle('dark', t === 'dark');
    r.classList.toggle('light', t === 'light');
    r.setAttribute('data-theme', t);
  }, theme);
}

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png`, fullPage: false });
  }
  await setTheme(page, 'light');
}

/** Find the test's id from Test Master's own list call, then open its editor. */
async function openEditor(page: Page): Promise<boolean> {
  const direct = process.env['TEST_ID'];
  if (direct) { await page.goto(`/admin/tests/${direct}/edit?type=individual`); return true; }
  const listed = page.waitForResponse(r => /\/api\/tests\/(\?.*)?$/.test(new URL(r.url()).pathname + new URL(r.url()).search)
    && r.request().method() === 'GET', { timeout: 30_000 });
  await page.goto('/admin/tests');
  const res = await listed.catch(() => null);
  if (!res) return false;
  const body = await res.json().catch(() => null);
  const rows: any[] = Array.isArray(body) ? body : (body?.data ?? []);
  const t = rows.find(r => (r.testCode ?? '').toUpperCase() === CODE);
  if (!t) return false;
  await page.goto(`/admin/tests/${t.id}/edit?type=individual`);
  return true;
}

/** Elements on the page whose computed font is a monospace face, or whose
 *  text / fill is a GREEN hue (tube-cap swatches are the functional exception). */
async function hygiene(page: Page) {
  return page.evaluate(() => {
    const scope = document.querySelector('pf-test-editor') ?? document.body;
    const mono: string[] = [];
    const green: string[] = [];
    const hue = (c: string): { h: number; s: number; a: number } | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(',').map(v => parseFloat(v));
      if (a < 0.2) return null;
      const R = r / 255, G = g / 255, B = b / 255;
      const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
      if (d < 0.12) return null;
      let h = 0;
      if (max === R) h = ((G - B) / d) % 6; else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
      h = (h * 60 + 360) % 360;
      const l = (max + min) / 2;
      const s = d / (1 - Math.abs(2 * l - 1));
      return { h, s, a };
    };
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
      if (el.closest('.pf-tube, .pf-livewrap__pdf, pf-report-pdf-preview, .nd-ai-glow')) continue;
      const cs = getComputedStyle(el);
      if (el.offsetParent === null && cs.position !== 'fixed') continue;
      if (/mono|courier|consolas|menlo/i.test(cs.fontFamily)) mono.push(el.className?.toString() || el.tagName);
      for (const c of [cs.color, cs.backgroundColor]) {
        const x = hue(c);
        if (x && x.h >= 90 && x.h <= 170 && x.s > 0.3) { green.push(`${el.tagName}.${el.className}`); break; }
      }
    }
    return { mono: mono.slice(0, 8), green: green.slice(0, 8) };
  });
}

test.describe('Test editor — real layout', () => {
  test('1440 + 375: band + context bar, one primary, tabs row, preview side card / sheet', async ({ page }) => {
    await relayCors(page);
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    const opened = await openEditor(page);
    test.skip(!opened, `No ${CODE} in this tenant's Test Master (set TEST_ID).`);

    const ctx = page.locator('pf-hero-band .nd-ctx');
    await expect(ctx.locator('.nd-ctx__primary')).toBeVisible({ timeout: 20_000 });
    await expect(ctx.locator('.nd-ctx__chip[data-k="Code"]')).toContainText(CODE);
    const name = (await ctx.locator('.pf-te2-ctx__nametext').innerText()).trim();
    expect(name.length).toBeGreaterThan(3);
    expect(name.endsWith('…')).toBe(false);

    // ONE primary on the whole page, and it is Save, in the band.
    const PRIMARY = '.pf-hb-btn--primary, .nd-btn--primary, pf-touch-btn .v-primary';
    await expect(page.locator(PRIMARY)).toHaveCount(1);
    await expect(page.locator('pf-hero-band .pf-hb__actions .pf-hb-btn--primary')).toContainText('Save');
    await expect(page.locator('pf-hero-band .nd-savestate')).toBeVisible();

    // Sections: a tabs row, no rail, no title block.
    const tabs = page.locator('[role="tablist"].pf-te2-tabs [role="tab"]');
    expect(await tabs.count()).toBeGreaterThanOrEqual(4);
    await expect(page.locator('.pf-te2-nav')).toHaveCount(0);
    await expect(page.locator('.pf-te2-head')).toHaveCount(0);

    // Preview = the side card at 1440; the Preview button is hidden.
    const aside = page.locator('#pf-te2-preview');
    await expect(aside).toBeVisible();
    const aw = (await aside.boundingBox())!.width;
    expect(aw).toBeGreaterThan(380);
    expect(aw).toBeLessThan(420);
    await expect(page.locator('.pf-te2-previewbtn')).toBeHidden();

    // No page-level scroll: only the card bodies scroll.
    const pageScroll = await page.evaluate(() => {
      const main = document.querySelector('.shell-main') as HTMLElement | null;
      const se = document.scrollingElement!;
      return { doc: se.scrollHeight - se.clientHeight, main: main ? main.scrollHeight - main.clientHeight : 0 };
    });
    expect(pageScroll.doc).toBeLessThanOrEqual(1);
    expect(pageScroll.main).toBeLessThanOrEqual(1);

    let h = await hygiene(page);
    expect(h.mono, 'monospace on the editor').toEqual([]);
    expect(h.green, 'green on the editor').toEqual([]);
    await shoot(page, 'test-editor-1440-basics');

    for (const sec of ['pricing', 'results', 'layout'] as const) {
      await page.locator(`[role="tab"][data-sec="${sec}"]`).click();
      await expect(page.locator(`#sec-${sec}`)).toBeVisible();
      await page.waitForTimeout(400);
      await expect(page.locator(PRIMARY), `one primary on ${sec}`).toHaveCount(1);
      h = await hygiene(page);
      expect(h.mono, `monospace on ${sec}`).toEqual([]);
      expect(h.green, `green on ${sec}`).toEqual([]);
      await shoot(page, `test-editor-1440-${sec}`);
    }
    await page.locator('[role="tab"][data-sec="identity"]').click();

    // ── Phone ────────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(400);
    await expect(ctx.locator('.nd-ctx__primary')).toBeVisible();
    // Tabs scroll sideways (never wrap / squeeze).
    const tl = await page.locator('[role="tablist"].pf-te2-tabs').evaluate(e => ({
      ox: getComputedStyle(e).overflowX, sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height }));
    expect(['auto', 'scroll']).toContain(tl.ox);
    expect(tl.h).toBeLessThan(60);
    // Band actions are 44px icons; the save state keeps only its check.
    const save = page.locator('pf-hero-band .pf-hb-btn--primary');
    const sb = (await save.boundingBox())!;
    expect(sb.width).toBeLessThanOrEqual(60);
    // Preview hides behind the button, opens as a sheet above the navbar.
    await expect(aside).toBeHidden();
    const btn = page.locator('.pf-te2-previewbtn');
    await expect(btn).toBeVisible();
    await shoot(page, 'test-editor-375-basics');
    await btn.click();
    await expect(aside).toBeVisible();
    const navH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nd-nav-h')) || 0);
    const ab = (await aside.boundingBox())!;
    expect(ab.y + ab.height).toBeLessThanOrEqual(812 - navH + 1);
    await shoot(page, 'test-editor-375-preview');
    await page.keyboard.press('Escape');
    await expect(aside).toBeHidden();
  });
});
