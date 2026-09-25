import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Patient registration — REAL layout (ND-PATTERN "Patient registration";
 * jsdom can't lay out). Signs in as the seeded Micro World Lab Admin, opens
 * /frontdesk/patients/new and checks at 1440 and 375: ONE primary (Register
 * patient) in the band, the pill = the subject name + the section tabs only,
 * one section card (no page scroll), 40px fields (44px on phones, phone
 * inputs ≥16px), no monospace / green, validation opening the right section.
 *
 * NOTHING IS WRITTEN: every POST / PATCH to /api/patients is answered in the
 * browser (and asserted never to be needed); the edit-mode shots load a
 * made-up patient answered in the browser too.
 * Screenshots (1440 / 375 × light / dark) into $SHOTS_DIR when set.
 *
 * CORS_RELAY=1 relays the backend calls from the runner so it can run
 * against a static build on a non-allowlisted port (BASE_URL=…:4310).
 */

const SHOTS = process.env['SHOTS_DIR'] || '';
const FAKE_ID = '00000000-0000-4000-8000-00000000e2e1';

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

/** Never create or change a patient: answer writes in the browser. Registered
 *  AFTER relayCors so it wins for these URLs. Returns the write counter. */
async function blockPatientWrites(page: Page) {
  const writes: string[] = [];
  await page.route(/\/api\/patients\/?(\?.*)?$|\/api\/patients\/[0-9a-f-]{36}\/?(\?.*)?$/, async route => {
    const req = route.request();
    const origin = new URL(page.url() || 'http://localhost').origin;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'POST' || req.method() === 'PATCH' || req.method() === 'PUT') {
      writes.push(`${req.method()} ${req.url()}`);
      return route.fulfill({ status: 409, headers: cors, body: JSON.stringify({ error: 'blocked_in_e2e', message: 'Blocked by the layout check' }) });
    }
    if (req.url().includes(FAKE_ID)) {
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ success: true, data: { patient: {
        id: FAKE_ID, displayName: 'Mrs. Lakshmi Venkataraman Subramanian', title: 'Mrs.', firstName: 'Lakshmi',
        fathersName: 'Venkataraman Subramanian', sex: 'Female', phone: '+919840012345', dateOfBirth: '1984-03-12T00:00:00Z',
        mrn: 'AA0999', abhaId: '91234567890123', email: 'lakshmi@example.com', bloodGroup: 'B+',
      }, history: [] } }) });
    }
    return route.fallback();
  });
  return writes;
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
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

/** Monospace faces or GREEN text / fills anywhere on the registration page. */
async function hygiene(page: Page) {
  return page.evaluate(() => {
    const scope = document.querySelector('pf-patient-register') ?? document.body;
    const mono: string[] = [];
    const green: string[] = [];
    const hue = (c: string): { h: number; s: number } | null => {
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
      return { h, s: d / (1 - Math.abs(2 * l - 1)) };
    };
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
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

async function noPageScroll(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('.shell-main') as HTMLElement | null;
    const se = document.scrollingElement!;
    return { doc: se.scrollHeight - se.clientHeight, main: main ? main.scrollHeight - main.clientHeight : 0 };
  });
}

const PRIMARY = '.pf-hb-btn--primary, .nd-btn--primary, .pf-btn-primary, pf-touch-btn .v-primary';

test.describe('Patient registration — real layout', () => {
  test('1440 + 375: band + name/tabs pill, one primary, section card, kit fields (no writes)', async ({ page }) => {
    await relayCors(page);
    const writes = await blockPatientWrites(page);
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/frontdesk/patients/new');

    const ctx = page.locator('pf-hero-band .nd-ctx.pf-reg-ctx');
    await expect(ctx.locator('.pf-reg-ctx__nametext')).toHaveText('New patient', { timeout: 30_000 });
    await expect(page.locator('[data-field="first_name"] input')).toBeVisible({ timeout: 30_000 });

    // Pill = the name + the section tabs, nothing else, on ONE line at 1440.
    await expect(ctx.locator('.nd-ctx__chip')).toHaveCount(0);
    const tabs = ctx.locator('[role="tablist"] [role="tab"]');
    const labels = (await tabs.allInnerTexts()).map(t => t.trim());
    expect(labels[0]).toBe('Identity');
    expect(labels.length).toBeGreaterThanOrEqual(2);
    const nameBox = (await ctx.locator('.nd-ctx__primary').boundingBox())!;
    const tabBox = (await ctx.locator('[role="tablist"]').boundingBox())!;
    expect(Math.abs((nameBox.y + nameBox.height / 2) - (tabBox.y + tabBox.height / 2))).toBeLessThan(8);

    // ONE primary on the page, in the band: Register patient.
    await expect(page.locator(PRIMARY)).toHaveCount(1);
    await expect(page.locator('pf-hero-band .pf-hb__actions .pf-hb-btn--primary')).toHaveText(/Register patient/);
    await expect(page.locator('pf-screen-header')).toHaveCount(0);

    // One section card; no page scroll.
    await expect(page.locator('#pf-reg-sec.nd-card')).toBeVisible();
    let sc = await noPageScroll(page);
    expect(sc.doc).toBeLessThanOrEqual(1);
    expect(sc.main).toBeLessThanOrEqual(1);

    // 40px fields: inputs, the Title / Sex segments.
    const h = async (sel: string) => (await page.locator(sel).first().boundingBox())?.height ?? 0;
    expect(await h('[data-field="first_name"] input')).toBeCloseTo(40, 0);
    expect(await h('[data-field="title"] .nd-seg')).toBeGreaterThanOrEqual(40);
    expect(await h('[data-field="title"] .nd-seg')).toBeLessThanOrEqual(42);
    // Title pills keep their natural width on web (not a full-width bar).
    expect((await page.locator('[data-field="title"] .nd-seg').boundingBox())!.width).toBeLessThan(600);

    let hy = await hygiene(page);
    expect(hy.mono, 'monospace').toEqual([]);
    expect(hy.green, 'green').toEqual([]);
    await shoot(page, 'register-1440-identity');

    // Every section: one primary, 40px controls, clean palette.
    for (let i = 1; i < labels.length; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
      await page.waitForTimeout(350);
      await expect(page.locator(PRIMARY)).toHaveCount(1);
      if (await page.locator('[data-field="phone"] .pf-di-phone').count()) {
        expect(await h('[data-field="phone"] .pf-di-phone')).toBeCloseTo(40, 0);
      }
      hy = await hygiene(page);
      expect(hy.mono, `monospace on ${labels[i]}`).toEqual([]);
      expect(hy.green, `green on ${labels[i]}`).toEqual([]);
      await shoot(page, `register-1440-${labels[i].toLowerCase().replace(/[^a-z]+/g, '-')}`);
    }

    // Validation walks every section: Register with nothing filled opens
    // Identity with the message — and nothing is posted.
    await page.locator('.pf-reg-primary').click();
    await expect(page.locator('.pf-wr-err')).toContainText('Required');
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await shoot(page, 'register-1440-validation');

    // The pill follows the typed name — in full.
    await page.locator('[data-field="first_name"] input').fill('Venkatasubramanian');
    await page.locator('[data-field="fathers_name"] input').fill('Ramakrishnan');
    await expect(ctx.locator('.pf-reg-ctx__nametext')).toHaveText('Venkatasubramanian Ramakrishnan');
    await page.locator('[data-field="title"] .nd-seg__item', { hasText: /^Mr\.$/ }).click();
    await expect(page.locator('[data-field="sex"] .nd-seg__item[aria-pressed="true"]')).toHaveText('Male');
    await shoot(page, 'register-1440-filled');

    // ── Phone ────────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(450);
    // The primary is a 44px-ish icon at the top of the band, above the pill.
    const pb = (await page.locator('pf-hero-band .pf-hb-btn--primary').boundingBox())!;
    expect(pb.width).toBeLessThanOrEqual(60);
    expect(pb.y + pb.height).toBeLessThanOrEqual(nameBox.y + 400); // sanity
    const pillTop = (await ctx.boundingBox())!.y;
    expect(pb.y).toBeLessThan(pillTop);
    await expect(page.locator('.pf-reg-cancel')).toBeHidden();
    // Tabs scroll sideways inside the pill (never wrap / squeeze), ≥40px tall.
    const tl = await ctx.locator('[role="tablist"]').evaluate(e => ({
      ox: getComputedStyle(e).overflowX, h: e.getBoundingClientRect().height }));
    expect(['auto', 'scroll']).toContain(tl.ox);
    const tabH = (await tabs.first().boundingBox())!.height;
    expect(tabH).toBeGreaterThanOrEqual(40);
    // Fields full width, ≥44px, 16px text (iOS never zooms).
    const card = (await page.locator('#pf-reg-sec .nd-card__body').boundingBox())!;
    const fn = page.locator('[data-field="first_name"] input');
    const fb = (await fn.boundingBox())!;
    expect(fb.width).toBeGreaterThan(card.width - 40);
    expect(fb.height).toBeGreaterThanOrEqual(44);
    expect(await fn.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    // The card ends above the always-visible bottom navbar; no page scroll.
    const navH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nd-nav-h')) || 0);
    const cb = (await page.locator('#pf-reg-sec').boundingBox())!;
    expect(cb.y + cb.height).toBeLessThanOrEqual(812 - navH + 1);
    sc = await noPageScroll(page);
    expect(sc.doc).toBeLessThanOrEqual(1);
    // The card label beats the global phone h2 cap (12px, like result entry).
    expect(await page.locator('#pf-reg-sec .nd-card__label').evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeLessThanOrEqual(13);
    await shoot(page, 'register-375-identity');
    for (let i = 1; i < labels.length; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(350);
      const tel = page.locator('[data-field="phone"] input[type="tel"]');
      if (await tel.count()) {
        expect(await tel.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
        expect((await page.locator('[data-field="phone"] .pf-di-phone').boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await shoot(page, `register-375-${labels[i].toLowerCase().replace(/[^a-z]+/g, '-')}`);
    }

    expect(writes, 'no patient writes').toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('edit mode (a patient answered in the browser): name in the pill, Save changes, save state', async ({ page }) => {
    await relayCors(page);
    const writes = await blockPatientWrites(page);
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/frontdesk/patients/new?patientId=${FAKE_ID}`);
    const ctx = page.locator('pf-hero-band .nd-ctx.pf-reg-ctx');
    await expect(ctx.locator('.pf-reg-ctx__nametext')).toHaveText('Mrs. Lakshmi Venkataraman Subramanian', { timeout: 30_000 });
    await expect(page.locator(PRIMARY)).toHaveCount(1);
    await expect(page.locator('pf-hero-band .pf-hb-btn--primary')).toHaveText(/Save changes/);
    await expect(page.locator('pf-hero-band .nd-savestate')).toContainText('All changes saved');
    await page.locator('[data-field="first_name"] input').fill('Lakshmi V');
    await expect(page.locator('pf-hero-band .nd-savestate')).toContainText('Unsaved changes');
    await shoot(page, 'edit-1440-identity');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(450);
    await shoot(page, 'edit-375-identity');
    expect(writes, 'no patient writes').toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
