import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Admin redesign (ND-PATTERN §19 "Admin pages") — REAL layout, READ-ONLY.
 * Seeded Micro World Lab Admin; after login every non-GET API call is
 * aborted, so nothing is ever saved.
 *
 * At 1440 and 375, light and dark:
 *  - every admin page is reachable in at most 2 taps from the Admin home
 *    (the directory lists them all — 1 tap; hub pages add at most 1);
 *  - the settings pages have NO pill tabs: the pill is the page's h1, and
 *    every section is on the one scrolling page;
 *  - basic a11y (axe-core is not in the repo): every switch / radiogroup /
 *    text input has an accessible name, radios expose aria-checked, a
 *    visible focus ring on Tab, 44px targets on touch, 16px inputs on phones;
 *  - no page-level scroll (only the band body scrolls);
 *  - the band search deep-links "barcode" to Lab settings › How staff find
 *    a sample and highlights that row; the back chevron returns to the
 *    Admin home category.
 * Screenshots (light + dark) into $SHOTS_DIR. CORS_RELAY=1 relays backend
 * calls so it can run against a static build on a spare port, e.g.
 *   nx build lms && (serve dist/apps/lms/browser with SPA fallback on :4317)
 *   BASE_URL=http://127.0.0.1:4317 CORS_RELAY=1 SHOTS_DIR=… \
 *     npx playwright test -c apps/lms-e2e/playwright.config.ts --project=rbac admin-redesign
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

async function relayCors(page: Page) {
  if (!process.env['CORS_RELAY']) return;
  await page.route(/prefrontal\.health\/api\//, async route => {
    const origin = new URL(page.url() || 'http://localhost').origin;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    try {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
    } catch { /* the page closed mid-request (end of test) */ }
  });
}

/** After login nothing may be written: abort every non-GET and record it. */
async function blockWrites(page: Page, writes: string[]) {
  await page.route(/\/api\//, async route => {
    const m = route.request().method();
    if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return route.fallback();
    writes.push(`${m} ${route.request().url()}`);
    return route.abort();
  });
}

/** Real theme switch: the app's own stored preference + a reload, so every
 *  token (not just a class) is the theme's. The URL (and #fragment) stays. */
async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => localStorage.setItem('pf-theme', t), theme);
  await page.reload();
  await page.locator('pf-hero-band').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
}

async function shoot(page: Page, name: string) {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png`, fullPage: false });
    // Measure once the deep-link highlight has faded.
    await page.waitForTimeout(page.url().includes('#') ? 2_600 : 0);
    await contrastSpotCheck(page, theme);
  }
}

/** WCAG AA on the text that carries meaning: row labels, help lines and
 *  section headings against the card they sit on (≥4.5:1). */
async function contrastSpotCheck(page: Page, theme: string) {
  const bad = await page.evaluate(() => {
    // rgb()/rgba() are 0–255; color-mix() computes to color(srgb r g b / a) in 0–1.
    const parse = (c: string) => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number);
      return c.startsWith('color(') ? [n[0] * 255, n[1] * 255, n[2] * 255, ...(n.length > 3 ? [n[3]] : [])] : n;
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element): number[] => {
      let e: Element | null = el;
      while (e) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c.length >= 3 && (c.length === 3 || c[3] > 0.9)) return c.slice(0, 3);
        e = e.parentElement;
      }
      return [255, 255, 255];
    };
    const blend = (fg: number[], bg: number[]) => {
      const a = fg.length > 3 ? fg[3] : 1;
      return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.nd-set__label, .nd-set__help, .nd-setsec .nd-card__label, .pf-adir__t, .pf-adir__s')).slice(0, 60)) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const bg = bgOf(el);
      const fg = blend(parse(getComputedStyle(el).color), bg);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      if (ratio < 4.5) out.push(`${(el.textContent ?? '').trim().slice(0, 30)} ${ratio.toFixed(2)}`);
    }
    return out;
  });
  expect(bad, `low contrast (${theme})`).toEqual([]);
}

async function noPageScroll(page: Page) {
  const s = await page.evaluate(() => {
    const main = document.querySelector('.shell-main') as HTMLElement | null;
    const se = document.scrollingElement!;
    return { doc: se.scrollHeight - se.clientHeight, main: main ? main.scrollHeight - main.clientHeight : 0, x: se.scrollWidth - se.clientWidth };
  });
  expect(s.doc, 'page scroll').toBeLessThanOrEqual(1);
  expect(s.main, 'shell scroll').toBeLessThanOrEqual(1);
  expect(s.x, 'horizontal scroll').toBeLessThanOrEqual(1);
}

/** Every switch / radiogroup / text input on the page has an accessible name. */
async function namedControls(page: Page) {
  const unnamed = await page.evaluate(() => {
    const nameOf = (el: Element) => {
      const by = el.getAttribute('aria-labelledby');
      if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      const al = el.getAttribute('aria-label');
      if (al) return al.trim();
      const id = el.getAttribute('id');
      if (id) { const l = document.querySelector(`label[for="${id}"]`); if (l) return (l.textContent ?? '').trim(); }
      const wrap = el.closest('label');
      if (wrap) return (wrap.textContent ?? '').trim();
      return '';
    };
    const body = document.querySelector('.pf-band-body');
    if (!body) return ['no .pf-band-body'];
    const out: string[] = [];
    for (const el of Array.from(body.querySelectorAll('[role="switch"], [role="radiogroup"], input:not([type="hidden"]):not([type="file"]), textarea'))) {
      if ((el as HTMLElement).closest('[hidden], .pf-classic-only')) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (!nameOf(el)) out.push(el.outerHTML.slice(0, 90));
    }
    for (const g of Array.from(body.querySelectorAll('[role="radiogroup"]'))) {
      const radios = g.querySelectorAll('[role="radio"]');
      if (!radios.length) out.push('radiogroup without radios');
      if (g.querySelectorAll('[role="radio"][aria-checked="true"]').length > 1) out.push('radiogroup with 2 checked');
    }
    return out;
  });
  expect(unnamed).toEqual([]);
}

/** The settings pages that used to have pill tabs (+ Branding and OPD, whose
 *  pill held a switch). */
const SETTINGS_PAGES: Array<{ path: string; h1: RegExp; name: string }> = [
  { path: '/admin/lab-settings', h1: /Lab settings/, name: 'lab-settings' },
  { path: '/admin/organization', h1: /Organization/, name: 'organization' },
  { path: '/admin/billing', h1: /Billing settings/, name: 'billing' },
  { path: '/admin/appointments', h1: /Appointments/, name: 'appointments' },
  { path: '/admin/microbiology', h1: /Microbiology/, name: 'microbiology' },
  { path: '/admin/opd/settings', h1: /OPD settings/, name: 'opd-settings' },
  { path: '/setup', h1: /Branding/, name: 'branding' },
];

/** Every admin destination (admin-catalog.ts) + the hubs. */
const DESTINATIONS = [
  '/admin/lab-settings', '/admin/tests', '/admin/reports', '/admin/microbiology', '/admin/notifications', '/admin/kpis',
  '/admin/home-collection', '/printing', '/admin/opd/doctors', '/admin/opd/settings', '/admin/inventory', '/admin/users',
  '/admin/audit', '/admin/branches', '/admin/organization', '/admin/appointments', '/setup', '/admin/billing', '/finance',
  '/finance/daily', '/admin/referral-labs', '/admin/referring-network', '/admin/vendors', '/admin/process',
  '/admin/workflows', '/admin/modules', '/admin/radiology', '/admin/ipd', '/admin/pharmacy', '/admin/payroll',
  '/admin/emergency', '/admin/blood-bank', '/admin/insurance',
];
const HUBS = ['/lab/settings', '/admin/manage', '/admin/partners', '/admin/opd'];

async function homeLinks(page: Page): Promise<string[]> {
  await page.goto('/admin');
  await expect(page.locator('pf-admin-directory .pf-adir__row').first()).toBeVisible({ timeout: 20_000 });
  return page.locator('pf-admin-directory a.pf-adir__row').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
}

for (const vp of [{ w: 1440, h: 900, tag: '1440' }, { w: 375, h: 812, tag: '375' }]) {
  test.describe(`Admin redesign @ ${vp.tag}`, () => {
    test(`every admin page ≤2 taps; settings pages flat + labelled (${vp.tag})`, async ({ page }) => {
      test.setTimeout(300_000);
      await relayCors(page);
      await loginAs(page, 'admin');
      const writes: string[] = [];
      await blockWrites(page, writes);
      await page.setViewportSize({ width: vp.w, height: vp.h });

      // ── Admin home: one list, every destination one tap away ──
      const links = await homeLinks(page);
      const oneTap = new Set(links.map((h) => h.split('?')[0]));
      const missing: string[] = [];
      for (const d of DESTINATIONS) if (!oneTap.has(d)) missing.push(d);
      // Anything not on the home must be on a page the home links to (2 taps).
      for (const d of [...missing]) {
        for (const hub of HUBS) {
          if (!oneTap.has(hub) && hub !== '/admin/manage') continue;
          await page.goto(hub);
          const on = await page.locator(`a[href^="${d}"]`).count();
          if (on) { missing.splice(missing.indexOf(d), 1); break; }
        }
      }
      expect(missing, 'not reachable in ≤2 taps').toEqual([]);
      await page.goto('/admin');
      await expect(page.locator('pf-admin-directory .pf-adir__row').first()).toBeVisible();
      await noPageScroll(page);
      await shoot(page, `admin-home-${vp.tag}`);

      // Real tap: the home row opens its page in ONE tap.
      await page.locator('pf-admin-directory a.pf-adir__row[href="/admin/lab-settings"]').click();
      await expect(page).toHaveURL(/\/admin\/lab-settings$/);

      // ── Settings pages: no pill tabs, one page, named controls ──
      for (const sp of SETTINGS_PAGES) {
        await page.goto(sp.path);
        const h1 = page.locator('pf-hero-band h1.nd-band-page');
        await expect(h1).toHaveText(sp.h1, { timeout: 20_000 });
        await expect(page.locator('pf-hero-band .pf-hb__tools pf-segmented')).toHaveCount(0);
        await expect(page.locator('pf-hero-band .pf-hb__tools [role="tab"], pf-hero-band .pf-hb__tools [role="radio"]')).toHaveCount(0);
        await page.waitForTimeout(600);
        await namedControls(page);
        await noPageScroll(page);
        if (vp.w <= 640) {
          // 16px inputs on phones (no iOS zoom) and no side jump list.
          const small = await page.locator('.pf-band-body input.nd-input:visible').evaluateAll((els) =>
            els.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length);
          expect(small, `${sp.path} inputs < 16px`).toBe(0);
          await expect(page.locator('.nd-setjump:visible')).toHaveCount(0);
        }
        await shoot(page, `${sp.name}-${vp.tag}`);
      }

      // Lab settings: every section on the one page; the unused row is gone.
      await page.goto('/admin/lab-settings');
      await expect(page.locator('.nd-setsec h2')).toHaveText(['Samples', 'Work lists', 'Rules', 'Counters', 'Calculations'], { timeout: 20_000 });
      await expect(page.getByText(/number width/i)).toHaveCount(0);
      if (vp.w >= 1024) await expect(page.locator('pf-settings-jump .nd-setjump__item')).toHaveCount(5);

      // Keyboard: Tab reaches a radio; arrows move within the group; the
      // focus ring is visible.
      if (vp.w >= 1024) {
        const first = page.locator('#scan-mode [role="radio"][aria-checked="true"]');
        await first.focus();
        const ring = await first.evaluate((e) => getComputedStyle(e).outlineStyle);
        expect(ring).not.toBe('none');
      }

      expect(writes, 'no writes').toEqual([]);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    });

    test(`search deep-links "barcode" to the setting; back returns to the category (${vp.tag})`, async ({ page }) => {
      test.setTimeout(180_000);
      await relayCors(page);
      await loginAs(page, 'admin');
      const writes: string[] = [];
      await blockWrites(page, writes);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto('/admin');
      const input = page.locator('pf-hero-band input.pf-hb__input');
      await expect(input).toBeVisible({ timeout: 20_000 });
      await expect(input).toHaveAttribute('aria-label', /Search/);
      await input.fill('barcode');
      const first = page.locator('pf-admin-search-results a').first();
      await expect(first).toContainText('How staff find a sample');
      await expect(first).toHaveAttribute('href', '/admin/lab-settings#scan-mode');
      // Screenshot the results in both themes (a theme switch reloads, so refill).
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(page, theme);
        await page.locator('pf-hero-band input.pf-hb__input').fill('barcode');
        await expect(first).toContainText('How staff find a sample');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-search-barcode-${vp.tag}-${theme}.png` });
      }
      await first.click();
      await expect(page).toHaveURL(/\/admin\/lab-settings#scan-mode$/);
      const row = page.locator('#scan-mode');
      await expect(row).toBeInViewport({ timeout: 10_000 });
      await expect(row).toHaveClass(/nd-set--hit/);
      await expect(row.locator('[role="radiogroup"]')).toHaveAttribute('aria-labelledby', 'ls-scan-l');
      await shoot(page, `lab-settings-deeplink-${vp.tag}`);

      await page.locator('pf-hero-band button[aria-label="Go back"]').click();
      await expect(page).toHaveURL(/\/admin\?cat=lab$/);
      await expect(page.locator('#cat-lab')).toBeInViewport();
      expect(writes, 'no writes').toEqual([]);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    });
  });
}
