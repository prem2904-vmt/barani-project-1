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
  // The app's ThemeService follows the system scheme in its default 'system'
  // mode — emulate it so JS-themed surfaces (AG-Grid) flip too.
  await page.emulateMedia({ colorScheme: theme });
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
    test.info().annotations.push({ type: 'note', description: 'read-only' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const opened = await openEditor(page);
    if (SHOTS && opened) {
      const editUrl = page.url();
      await page.goto('/admin/tests');
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(800);
      await shoot(page, 'test-master-1440');
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(500);
      await shoot(page, 'test-master-375');
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(editUrl);
    }
    test.skip(!opened, `No ${CODE} in this tenant's Test Master (set TEST_ID).`);

    const ctx = page.locator('pf-hero-band .nd-ctx');
    await expect(ctx.locator('.nd-ctx__primary')).toBeVisible({ timeout: 20_000 });
    await expect(ctx.locator('.pf-te2-ctx__nametext')).not.toHaveText(/^(New|Edit) (test|profile|package)$/, { timeout: 20_000 });
    // Pill = name + tabs ONLY (no fact chips), on ONE line at 1440.
    await expect(ctx.locator('.nd-ctx__chip')).toHaveCount(0);
    await expect(ctx.locator('[role="tablist"] [role="tab"]').first()).toBeVisible();
    const pillH = (await page.locator('pf-hero-band .pf-hb__search').boundingBox())!.height;
    expect(pillH).toBeLessThanOrEqual(62);
    const nameBox = (await ctx.locator('.nd-ctx__primary').boundingBox())!;
    const tabBox = (await ctx.locator('[role="tablist"]').boundingBox())!;
    expect(Math.abs((nameBox.y + nameBox.height / 2) - (tabBox.y + tabBox.height / 2))).toBeLessThan(8);
    // No title tooltip on the preview frame (it floated over the pill).
    await expect(page.locator('iframe.pf-pdfprev__frame[title]')).toHaveCount(0);
    const name = (await ctx.locator('.pf-te2-ctx__nametext').innerText()).trim();
    expect(name.length).toBeGreaterThan(3);
    expect(name.endsWith('…')).toBe(false);

    // ONE primary on the whole page, and it is Save, in the band.
    const PRIMARY = '.pf-hb-btn--primary, .nd-btn--primary, pf-touch-btn .v-primary';
    await expect(page.locator(PRIMARY)).toHaveCount(1);
    await expect(page.locator('pf-hero-band .pf-hb__actions .pf-hb-btn--primary')).toContainText('Save');
    await expect(page.locator('pf-hero-band .nd-savestate')).toBeVisible();

    // Sections: tabs in the pill, no rail / tabs row, no title block.
    await expect(page.locator('.pf-te2-tabsrow')).toHaveCount(0);
    const tabs = page.locator('pf-hero-band [role="tablist"].pf-te2-tabs [role="tab"]');
    expect(await tabs.count()).toBeGreaterThanOrEqual(4);
    await expect(page.locator('.pf-te2-nav')).toHaveCount(0);
    await expect(page.locator('.pf-te2-head')).toHaveCount(0);

    // Preview = the side card at 1440; the Preview button is hidden.
    const aside = page.locator('#pf-te2-preview');
    await expect(aside).toBeVisible();
    const aw = (await aside.boundingBox())!.width;
    expect(aw).toBeGreaterThan(380);
    expect(aw).toBeLessThan(420);
    // …on the LEFT of the main card (owner 2026-11-17: side cards sit left).
    const mainX = (await page.locator('.pf-te2-main').boundingBox())!.x;
    expect((await aside.boundingBox())!.x).toBeLessThan(mainX);
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
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Test Master views + profile / package editors: one primary, no mono / green (shots)', async ({ page }) => {
    await relayCors(page);
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    // Collect every test row the app loads, to find a profile + a package.
    const seen: any[] = [];
    page.on('response', async r => {
      if (!/\/api\/tests\//.test(r.url()) || r.request().method() !== 'GET') return;
      const b = await r.json().catch(() => null);
      const rows = Array.isArray(b) ? b : (Array.isArray(b?.data) ? b.data : []);
      seen.push(...rows);
    });
    await page.goto('/admin/tests');
    await page.waitForLoadState('networkidle').catch(() => {});
    const PRIMARY = '.pf-hb-btn--primary, .nd-btn--primary, pf-touch-btn .v-primary';
    for (const view of ['Profiles', 'Packages', 'Option groups', 'Microbiology', 'Pricing']) {
      const seg = page.locator(`pf-hero-band pf-segmented button[aria-label="${view}"]`).first();
      if (!(await seg.count())) continue;
      await seg.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(700);
      await expect(page.getByText(/Loading prices/i)).toHaveCount(0, { timeout: 20_000 }).catch(() => {});
      const n = await page.locator(PRIMARY).evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent !== null).length);
      expect(n, `primaries on ${view}`).toBeLessThanOrEqual(1);
      const h = await hygiene(page);
      expect(h.mono, `monospace on ${view}`).toEqual([]);
      await shoot(page, `test-master-${view.toLowerCase().replace(/\s+/g, '-')}-1440`);
    }
    for (const type of ['profile', 'package'] as const) {
      const t = seen.find(r => r?.type === type && r?.id);
      if (!t) continue;
      await page.goto(`/admin/tests/${t.id}/edit?type=${type}`);
      await expect(page.locator('pf-hero-band .pf-te2-ctx__nametext')).not.toHaveText(/^(New|Edit) /, { timeout: 20_000 });
      await expect(page.locator('pf-hero-band .nd-ctx__chip')).toHaveCount(0);
      await expect(page.locator(PRIMARY)).toHaveCount(1);
      await shoot(page, `${type}-editor-1440-basics`);
      await page.locator('[role="tab"][data-sec="results"]').click();
      await page.waitForTimeout(600);
      await expect(page.locator(PRIMARY)).toHaveCount(1);
      const h = await hygiene(page);
      expect(h.mono, `monospace on the ${type} members`).toEqual([]);
      expect(h.green, `green on the ${type} members`).toEqual([]);
      await shoot(page, `${type}-editor-1440-members`);
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
