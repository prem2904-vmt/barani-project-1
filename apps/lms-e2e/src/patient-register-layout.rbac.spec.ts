import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Patient registration — REAL layout (ND-PATTERN §15 "one single form, no
 * tabs, keyboard-first"; jsdom can't lay out). Signs in as the seeded Micro
 * World Lab Admin, opens /frontdesk/patients/new and checks: at 1440×900 the
 * three section cards side by side with NO page / body scroll, the pill at
 * the STANDARD band-pill size (also at 2000px) = the name + the ABHA helpers
 * at its right, an EMPTY date of birth, no number spinners, ONE primary,
 * First name focused, Enter to the next field,
 * field-level errors, Title → Sex, 40px fields, no mono / green; at 1024 two
 * columns; at 375 one column scrolling under the pinned band (icon primary,
 * full-width 44px / 16px fields).
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
    // Let the theme cross-fade finish (a mid-fade capture looked half-dark).
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/v3-${name}-${theme}.png`, fullPage: false });
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

test.describe('Patient registration — real layout (one form)', () => {
  test('1440 / 1024 / 375: one form, cards 3 / 2 / 1, keyboard-first, field errors (no writes)', async ({ page }) => {
    await relayCors(page);
    const writes = await blockPatientWrites(page);
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/frontdesk/patients/new');

    const ctx = page.locator('pf-hero-band .nd-ctx.pf-reg-ctx');
    await expect(ctx.locator('.pf-reg-ctx__nametext')).toHaveText('New patient', { timeout: 30_000 });
    const firstName = page.locator('[data-field="first_name"] input');
    await expect(firstName).toBeVisible({ timeout: 30_000 });

    // Pill = the name ✎ … ABHA helpers (quiet grey, icon + label); no tabs, no chips.
    await expect(page.locator('[role="tablist"], [role="tab"], .nd-ctx__chip, .pf-reg-next')).toHaveCount(0);
    const pillAbha = ctx.locator('.pf-reg-ctx__abha .nd-btn--quiet');
    await expect(pillAbha).toHaveCount(2);
    await expect(pillAbha.first()).toContainText('Fill from ABHA');
    await expect(page.locator('.pf-wr-card .nd-card__head button')).toHaveCount(0);
    // The pill is the STANDARD band-pill size, centred — never full width.
    const pillW = async () => {
      const b = (await page.locator('pf-hero-band .pf-hb__search').boundingBox())!;
      const vw = page.viewportSize()!.width;
      return { w: b.width, left: b.x, right: vw - b.x - b.width };
    };
    let pw = await pillW();
    expect(pw.w).toBeLessThanOrEqual(1124);
    expect(Math.abs(pw.left - pw.right)).toBeLessThan(4);
    // The ABHA buttons sit at the pill's right edge.
    const abhaBox = (await pillAbha.last().boundingBox())!;
    expect(1440 - pw.right - (abhaBox.x + abhaBox.width)).toBeLessThan(40);

    // Date of birth is EMPTY (no prefilled / greyed date); no spinners anywhere.
    const dobIn = page.locator('[data-field="date_of_birth"] input[data-pf-stop]');
    await expect(dobIn).toHaveValue('');
    await expect(dobIn).toHaveAttribute('placeholder', 'dd/mm/yyyy');
    const spinners = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('pf-patient-register input'))
      .filter(i => i.type === 'number' && getComputedStyle(i).appearance !== 'textfield').map(i => i.className));
    expect(spinners, 'number inputs with spinners').toEqual([]);
    await expect(page.locator('[data-field="date_of_birth"] .pf-di-dob__age')).toHaveAttribute('inputmode', 'numeric');
    // ONE primary on the page, in the band.
    await expect(page.locator(PRIMARY)).toHaveCount(1);
    await expect(page.locator('pf-hero-band .pf-hb__actions .pf-hb-btn--primary')).toHaveText(/Register patient/);

    // Every section at once: three cards side by side.
    const cards = page.locator('.pf-wr-cards > .pf-wr-card');
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(3);
    const boxes = await Promise.all([0, 1, 2].map(i => cards.nth(i).boundingBox()));
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
    expect(Math.abs(boxes[1]!.y - boxes[2]!.y)).toBeLessThan(2);
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width - 1);
    await expect(page.locator('[data-field="phone"] input[type="tel"]')).toBeVisible();

    // No page scroll AND no body scroll with the default form at 1440×900.
    const sc = await noPageScroll(page);
    expect(sc.doc).toBeLessThanOrEqual(1);
    expect(sc.main).toBeLessThanOrEqual(1);
    const bodyScroll = await page.locator('.pf-reg-body').evaluate(e => e.scrollHeight - e.clientHeight);
    expect(bodyScroll).toBeLessThanOrEqual(1);
    // The cards end above the navbar.
    const navH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nd-nav-h')) || 0);
    expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(900 - navH + 1);

    // Keyboard-first: First name is focused on arrival; Enter → Last name.
    await expect(firstName).toBeFocused();
    await page.keyboard.type('Venkatasubramanian');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-field="fathers_name"] input')).toBeFocused();
    await page.keyboard.type('Ramakrishnan');
    await expect(ctx.locator('.pf-reg-ctx__nametext')).toHaveText('Venkatasubramanian Ramakrishnan');

    // 40px fields.
    const h = async (sel: string) => (await page.locator(sel).first().boundingBox())?.height ?? 0;
    expect(await h('[data-field="first_name"] input')).toBeCloseTo(40, 0);
    expect(await h('[data-field="phone"] .pf-di-phone')).toBeCloseTo(40, 0);
    expect(await h('[data-field="date_of_birth"] input[data-pf-stop]')).toBeCloseTo(40, 0);

    const hy = await hygiene(page);
    expect(hy.mono, 'monospace').toEqual([]);
    expect(hy.green, 'green').toEqual([]);
    await shoot(page, 'register-1440');

    // Title → Sex; Sex quick keys.
    await page.locator('[data-field="title"] [role="radio"]', { hasText: /^Mrs\.$/ }).click();
    await expect(page.locator('[data-field="sex"] [role="radio"][aria-checked="true"]')).toHaveText('Female');
    await page.locator('[data-field="sex"] [role="radio"][aria-checked="true"]').focus();
    await page.keyboard.press('o');
    await expect(page.locator('[data-field="sex"] [role="radio"][aria-checked="true"]')).toHaveText('Other');

    // Field-level errors: the missing phone is outlined, has its message and gets focus.
    await dobIn.fill('15051990');
    await expect(dobIn).toHaveValue('15/05/1990');
    await page.locator('.pf-reg-primary').click();
    const phone = page.locator('[data-field="phone"]');
    await expect(phone.locator('.pf-di-err')).toContainText(/Required/);
    await expect(phone.locator('.pf-di-phone--err')).toHaveCount(1);
    await expect(phone.locator('input[type="tel"]')).toBeFocused();
    await expect(page.locator('[data-field="first_name"] .pf-di-err')).toHaveCount(0);
    await shoot(page, 'register-1440-errors');

    // Wide desktop (the owner's ~2000px): the pill stays the standard size.
    await page.setViewportSize({ width: 2000, height: 1000 });
    await page.waitForTimeout(400);
    pw = await pillW();
    expect(pw.w).toBeLessThanOrEqual(1124);
    expect(Math.abs(pw.left - pw.right)).toBeLessThan(4);
    await shoot(page, 'register-2000');

    // ── Tablet: two columns ─────────────────────────────────────────────
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(400);
    const t = await Promise.all([0, 1, 2].map(i => cards.nth(i).boundingBox()));
    expect(Math.abs(t[0]!.y - t[1]!.y)).toBeLessThan(2);
    expect(t[2]!.y).toBeGreaterThan(t[0]!.y + 10);
    await shoot(page, 'register-1024');

    // ── Phone: one column, band pinned ──────────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(450);
    const p = await Promise.all([0, 1, 2].map(i => cards.nth(i).boundingBox()));
    expect(Math.abs(p[0]!.x - p[1]!.x)).toBeLessThan(2);
    expect(p[1]!.y).toBeGreaterThan(p[0]!.y + p[0]!.height - 1);
    const pb = (await page.locator('pf-hero-band .pf-hb-btn--primary').boundingBox())!;
    expect(pb.width).toBeLessThanOrEqual(60);
    expect(pb.y).toBeLessThan((await ctx.boundingBox())!.y);
    await expect(page.locator('.pf-reg-cancel')).toBeHidden();
    // ABHA helpers are icon-only in the pill on phones.
    for (const b of await pillAbha.all()) {
      const bb = (await b.boundingBox())!;
      expect(bb.width).toBeLessThanOrEqual(44);
    }
    const card = (await page.locator('.pf-wr-card').first().locator('.nd-card__body').boundingBox())!;
    const fb = (await firstName.boundingBox())!;
    expect(fb.width).toBeGreaterThan(card.width - 40);
    expect(fb.height).toBeGreaterThanOrEqual(44);
    expect(await firstName.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await page.locator('.pf-wr-card').first().locator('.nd-card__label').evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeLessThanOrEqual(13);
    const doc = await noPageScroll(page);
    expect(doc.doc).toBeLessThanOrEqual(1);
    await shoot(page, 'register-375-top');
    // The body scrolls; the band stays put.
    const bandY = (await page.locator('pf-hero-band').boundingBox())!.y;
    await page.locator('.pf-reg-body').evaluate(e => e.scrollTo({ top: e.scrollHeight }));
    await page.waitForTimeout(300);
    expect((await page.locator('pf-hero-band').boundingBox())!.y).toBeCloseTo(bandY, 0);
    const tel = page.locator('[data-field="phone"] input[type="tel"]');
    expect(await tel.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    await shoot(page, 'register-375-bottom');

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
    await expect(ctx.locator('.pf-reg-ctx__abha .nd-btn--quiet')).toHaveText(/Verify \/ create ABHA/);
    await expect(page.locator('[data-field="date_of_birth"] input[data-pf-stop]')).toHaveValue('12/03/1984');
    await page.locator('[data-field="first_name"] input').fill('Lakshmi V');
    await expect(page.locator('pf-hero-band .nd-savestate')).toContainText('Unsaved changes');
    await shoot(page, 'edit-1440');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(450);
    await shoot(page, 'edit-375');
    expect(writes, 'no patient writes').toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
