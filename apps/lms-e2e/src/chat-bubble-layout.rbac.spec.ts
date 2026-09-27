import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Floating chat rail ("SA" head) — REAL layout (jsdom can't lay out).
 * Owner's iPad: the minimised-chat head sat ON "Continue to payment". The
 * rail must never cover a primary action, the docked bottom navbar, or a
 * phone's full-width CTA — on Order & Payments, the billing counter, the
 * patient profile, result entry (My Work) and appointments, at 1440, 1024
 * (iPad landscape) and 375.
 *
 * Seeded Micro World Lab Admin, READ-ONLY: after login every non-GET API
 * call is aborted. The chat list is stubbed with one conversation ("Sam
 * Arul" → SA) pinned as a favourite so the rail shows deterministically.
 * Screenshots into $SHOTS_DIR. CORS_RELAY=1 relays backend calls so it can
 * run against a static build on a spare port.
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

const CONV = {
  id: '00000000-0000-4000-8000-00000000c5a1', isGroup: false, name: null, createdById: 'x',
  lastMessageAt: new Date().toISOString(), unreadCount: 1, lastMessage: null,
  participants: [
    { userId: '00000000-0000-4000-8000-0000000000aa', displayName: 'Sam Arul', email: '' },
  ],
};

const PRIMARY = [
  '[data-pf-cta]', '.nd-btn--primary', '.pf-hb-btn--primary', '.nd-ctx__primary', '.pf-oc-btn--primary',
  '.pf-btn-primary', '.btn-primary', '.pf-bc-primary', '.pf-mbar__btn--primary', '.pf-sc-bar__cta',
  '.pf-pp-act', '.pf-cartbar__inner', 'button[type="submit"]',
].join(',');

async function relayCors(page: Page) {
  if (!process.env['CORS_RELAY']) return;
  await page.route(/prefrontal\.health\/(api|hubs)\//, async route => {
    const origin = new URL(page.url() || 'http://localhost').origin;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

/** Messages on + one stubbed conversation, so the rail has a head. */
async function stubChat(page: Page) {
  await page.route(/\/api\/chat\/conversations(\?|$)/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data: [CONV] }) }));
  await page.route(/\/api\/tenants\/modules$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const json = await res.json().catch(() => null);
    const data = json?.data ?? json ?? {};
    let modules: Record<string, unknown> = {};
    try { modules = data.modulesJson ? JSON.parse(data.modulesJson) : {}; } catch { /* keep {} */ }
    const lab = (modules['lab'] as Record<string, unknown>) ?? {};
    const features = (lab['features'] as Record<string, unknown>) ?? {};
    modules['lab'] = { ...lab, enabled: true, features: { ...features, messages: true } };
    const patched = { ...data, modulesJson: JSON.stringify(modules), legacy: { ...(data.legacy ?? {}), messages: true } };
    await route.fulfill({ response: res, body: JSON.stringify(json?.data ? { ...json, data: patched } : patched) });
  });
}

/** After login: nothing may be written. */
async function blockWrites(page: Page) {
  await page.route(/\/api\//, async route => {
    const m = route.request().method();
    if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return route.fallback();
    return route.abort();
  });
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
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png`, fullPage: false });
  }
  await setTheme(page, 'light');
}

/** Every head vs every visible primary + the docked navbar: no overlap. */
async function railClashes(page: Page) {
  return page.evaluate((primarySel) => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>('.pf-cw__rail .pf-cw__head'));
    const rail = document.querySelector('.pf-cw__rail');
    const vis = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const clashes: string[] = [];
    const targets = Array.from(document.querySelectorAll<HTMLElement>(primarySel))
      .filter(el => !rail?.contains(el) && getComputedStyle(el).visibility !== 'hidden');
    const nav = Array.from(document.querySelectorAll<HTMLElement>('.pf-bottom-nav, .pf-navbar--bottom, nav.pf-nb'))
      .filter(el => { const r = el.getBoundingClientRect(); return vis(r) && r.bottom >= innerHeight - 2; });
    for (const h of heads) {
      const hr = h.getBoundingClientRect();
      for (const t of targets) {
        const tr = t.getBoundingClientRect();
        if (vis(tr) && hit(hr, tr)) clashes.push(`head over ${t.className || t.tagName}: "${(t.textContent || '').trim().slice(0, 40)}"`);
      }
      for (const n of nav) if (hit(hr, n.getBoundingClientRect())) clashes.push('head over bottom nav');
      if (hr.bottom > innerHeight || hr.top < 0) clashes.push('head off screen');
    }
    return { heads: heads.length, clashes };
  }, PRIMARY);
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await page.waitForSelector('.pf-cw__rail .pf-cw__head', { timeout: 20_000 });
  await page.keyboard.press('Escape');       // close an auto-opened search dropdown
  await page.waitForTimeout(900);            // rail re-plan (debounced) + transition
}

const VIEWPORTS = [
  { tag: '1440', width: 1440, height: 900 },
  { tag: '1024', width: 1024, height: 768 },
  { tag: '375', width: 375, height: 812 },
] as const;

test.describe('Chat rail — never on a primary action', () => {
  test('Order & Payments, billing counter, patient profile, result entry, appointments × 1440 / 1024 / 375', async ({ page }) => {
    test.setTimeout(420_000);
    await relayCors(page);
    await stubChat(page);
    await page.addInitScript(() => { try { localStorage.setItem('pf-design', 'new'); } catch { /* */ } });

    const me = page.waitForResponse(r => /\/api\/auth\/me(\?|$)/.test(r.url()) && r.request().method() === 'GET', { timeout: 60_000 });
    await loginAs(page, 'admin');
    const meJson = await (await me).json().catch(() => null);
    const u = meJson?.data ?? meJson;
    expect(u?.id, '/api/auth/me answered').toBeTruthy();
    await blockWrites(page);
    // Pin the stubbed chat as a favourite for THIS user → a head on the rail.
    await page.evaluate(([tenant, user, id]) => {
      localStorage.setItem(`pf.chat.favourites:${tenant || 'no-tenant'}:${user}`, JSON.stringify([id]));
    }, [u.tenantId, u.id, CONV.id]);

    // A patient + a sample to open real screens with (read-only lookups).
    const orders = page.waitForResponse(r => /\/api\/orders\/today/.test(r.url()), { timeout: 30_000 }).catch(() => null);
    await page.goto('/frontdesk');
    const oj = await (await orders)?.json().catch(() => null);
    const list: Array<{ patientId?: string; samples?: Array<{ id: string; status: string }> }> = oj?.data ?? oj ?? [];
    const patientId = list.find(o => o.patientId)?.patientId;
    const sampleId = list.flatMap(o => o.samples ?? []).find(s => ['received', 'in_progress', 'processing'].includes(s.status))?.id;

    const screens: Array<{ name: string; url: string }> = [
      { name: 'order-payments', url: '/frontdesk/order' },
      { name: 'billing-counter', url: '/billing-counter' },
      ...(patientId ? [{ name: 'patient-profile', url: `/frontdesk/patients/${patientId}` }] : []),
      { name: 'result-entry', url: sampleId ? `/lab/sample/${sampleId}` : '/lab/my-work' },
      { name: 'appointments', url: '/frontdesk/appointments' },
    ];

    const report: string[] = [];
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const s of screens) {
        await open(page, s.url);
        const { heads, clashes } = await railClashes(page);
        report.push(`${vp.tag} ${s.name}: heads=${heads} clashes=${clashes.length ? clashes.join('; ') : 'none'}`);
        expect(heads, `${vp.tag} ${s.name}: rail rendered`).toBeGreaterThan(0);
        expect(clashes, `${vp.tag} ${s.name}`).toEqual([]);
        await shoot(page, `${s.name}-${vp.tag}`);
      }
    }
    console.log(report.join('\n'));
  });

  test('drag: the rail moves, swaps edges, and the spot survives a reload', async ({ page }) => {
    test.setTimeout(180_000);
    await relayCors(page);
    await stubChat(page);
    await page.addInitScript(() => { try { localStorage.setItem('pf-design', 'new'); } catch { /* */ } });
    const me = page.waitForResponse(r => /\/api\/auth\/me(\?|$)/.test(r.url()) && r.request().method() === 'GET', { timeout: 60_000 });
    await loginAs(page, 'admin');
    const u = ((await (await me).json().catch(() => null)) as any)?.data;
    await blockWrites(page);
    await page.evaluate(([tenant, user, id]) => {
      localStorage.setItem(`pf.chat.favourites:${tenant || 'no-tenant'}:${user}`, JSON.stringify([id]));
      localStorage.removeItem(`pf.chatRail:${tenant || 'no-tenant'}:${user}`);
    }, [u.tenantId, u.id, CONV.id]);
    await page.setViewportSize({ width: 1024, height: 768 });
    await open(page, '/frontdesk/appointments');

    const head = page.locator('.pf-cw__rail .pf-cw__head').first();
    const before = (await head.boundingBox())!;
    await page.mouse.move(before.x + 22, before.y + 22);
    await page.mouse.down();
    await page.mouse.move(before.x - 300, before.y - 180, { steps: 12 });
    await page.mouse.move(120, before.y - 200, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = (await head.boundingBox())!;
    expect(after.y).toBeLessThan(before.y - 100);
    expect(after.x).toBeLessThan(200);                       // docked on the LEFT edge now
    await expect(page.locator('.pf-cw__win')).toHaveCount(0); // the drop did not open the chat
    await shoot(page, 'dragged-left-1024');

    const saved = await page.evaluate(([tenant, user]) =>
      JSON.parse(localStorage.getItem(`pf.chatRail:${tenant || 'no-tenant'}:${user}`) || 'null'), [u.tenantId, u.id]);
    expect(saved?.side).toBe('left');
    expect(saved?.lift).toBeGreaterThan(100);

    await page.reload();
    await open(page, '/frontdesk/appointments');
    const restored = (await page.locator('.pf-cw__rail .pf-cw__head').first().boundingBox())!;
    expect(restored.x).toBeLessThan(200);
    // At the user's spot or higher (the auto-clear may add lift, never less).
    expect(restored.y).toBeLessThanOrEqual(before.y - saved.lift + 4);
  });
});
