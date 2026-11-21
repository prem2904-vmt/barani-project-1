import type { Page, Request } from '@playwright/test';
import { test, expect, shotsDir } from './support/form-factor';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Collect — the right-side info panel can be shown / hidden (owner 2026-11-21).
 * Closed by default on every size (owner revision 2026-11-21); the chips show instead.
 * >= 1280px: the VIALS-head toggle opens it docked (the grid gives up the width). < 1280px: the toggle opens a right drawer over the vials (scrim, ✕, Esc; focus trapped and returned).
 * While hidden: Urgent / Fasting / "N of M left" chips in the patient head. The choice survives a reload.
 * API mocked, demo data only. Screenshots under SHOTS_DIR/<project>/ (light + dark).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/collect-info');
let OUT = OUT_BASE;
const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-1', authId: 'sub-1', first: 'Kavya', last: 'Desk' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;
const now = new Date();
const iso = (d: Date) => d.toISOString();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const PARAMS = JSON.stringify({ parameters: [{ name: 'glu', title: 'Glucose', unit: 'mg/dL' }] });
const pat = (id: string, name: string) => ({ id, displayName: name, firstName: name.split(' ')[0], gender: 'F', sex: 'Female', age: 34, mrn: `26${id.padStart(4, '0')}`, phone: '+919876543210' });
const mkSample = (id: string, orderId: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, collectedAt: status === 'pending' ? null : iso(minsAgo(70)), createdAt: iso(minsAgo(90)),
  department: { id: 'd1', name: 'Biochemistry', code: 'BIO' }, tests: [{ id: `${id}-t`, status: 'pending', test: { name: 'Glucose', parameters: PARAMS, sampleType: 'Plasma' } }], ...extra,
});
const PEOPLE: ReadonlyArray<readonly [string, number, string]> = [['o1', 1, 'Sathish Kumar'], ['o2', 2, 'Nandini Rao'], ['o3', 3, 'Meera Iyer']];
const mkOrder = (id: string, n: number, name: string, samples: any[]) => ({
  id, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: iso(now).slice(0, 10), patientId: `p${n}`, branchId: 'b1', patient: pat(String(n), name),
  priority: 'Normal', source: 'walkin', collectionType: 'walkin', status: 'sample_collected', createdAt: iso(minsAgo(90 - n)), updatedAt: iso(now), samples,
});

let samples: any[] = [];
let requests: string[] = [];
const OGTT = [120, 30, 180, 60];   // unsorted on purpose: the panel lists them sorted
const ogtt = (id: string, i: number) => mkSample(`${id}${'abcd'[i]}`, id, 'pending', { createdAt: iso(minsAgo(89)),
  tests: [{ id: `${id}${i}-t`, status: 'pending', test: { name: `OGTT – ${OGTT[i]} Minutes`, fastingRequired: true, parameters: PARAMS, sampleType: 'Plasma' } }] });
const fresh = () => PEOPLE.flatMap(([id, n]) => n === 1 ? [0, 1, 2, 3].map(i => ogtt(id, i)) : [
  mkSample(`${id}a`, id, 'pending', { createdAt: iso(minsAgo(90 - n)) }),
]);
const theOrder = (id: string) => { const p = PEOPLE.find(x => x[0] === id) ?? PEOPLE[0]; return { ...mkOrder(p[0], p[1], p[2], samples.filter(s => s.orderId === p[0])), priority: p[1] === 1 ? 'Urgent' : 'Normal' }; };

async function backend(page: Page) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req: Request = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (req.method() !== 'GET') requests.push(`${req.method()} ${p}`);
    if (p === '/api/auth/me') return route.fulfill(ok(origin, { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/tenants/departments') return route.fulfill(ok(origin, [{ id: 'bio', name: 'Biochemistry' }]));
    if (p === '/api/tenants/branches') return route.fulfill(ok(origin, [{ id: 'b1', name: 'Main' }]));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/samples/pending-collection') return route.fulfill(ok(origin, samples.filter(s => s.status === 'pending').map(s => ({ ...s, order: theOrder(s.orderId) }))));
    if (p === '/api/samples/outsourced' || p === '/api/samples/in-transit') return route.fulfill(ok(origin, []));
    let m = /^\/api\/samples\/([^/]+)\/collect$/.exec(p);
    if (m && req.method() === 'PATCH') { const s = samples.find(x => x.id === m![1]); if (s) { s.status = 'collected'; s.collectedAt = iso(new Date()); } return route.fulfill(ok(origin, s ?? {})); }
    m = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (m) return route.fulfill(ok(origin, theOrder(m[1])));
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86400, user: { id: ME.authId, aud: 'authenticated', email: 'desk@demo.test' } }) });
  });
  // Answer ONLY the SignalR handshake: replying `{}` to every frame is an invalid payload -> the hub disconnects and
  // reconnects in a tight loop (thousands of chat/sync calls) that starves the test runner.
  await page.routeWebSocket(/\/hubs\//, ws => { let hs = false; ws.onMessage(() => { if (!hs) { hs = true; ws.send('{}\x1e'); } }); });
  await page.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1'); localStorage.clear();
      localStorage.setItem('pf.startHintSeen', '1');
      localStorage.setItem('pf.session', session as string); localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf.wa.manual.reminded', '1');
    }
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` })] as const);
}

async function theme(page: Page, mode: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: mode });
  await page.evaluate(m => { const r = document.documentElement; r.classList.remove('dark', 'light'); r.classList.add(m); r.setAttribute('data-theme', m); }, mode);
  await page.waitForTimeout(400);
}
async function shots(page: Page, name: string) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}-light.png` });
  await theme(page, 'dark'); await page.screenshot({ path: `${OUT}/${name}-dark.png` }); await theme(page, 'light');
}
const docked = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280;

/** Opens the first patient's collection (wide: auto-selected in the main card; narrow: tap the queue card). */
async function openCollect(page: Page) {
  await page.goto('/lab/collect');
  const toggle = page.getByTestId('collect-info-toggle');
  const card = page.locator('.pf-sc__pcard').first();
  await expect(toggle.or(card).first()).toBeVisible({ timeout: 30_000 });
  if (!(await toggle.isVisible())) await card.click();
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);   // the open (zoom) transition settles before any screenshot
  return toggle;
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000); OUT = shotsDir(OUT_BASE);
  samples = fresh(); requests = [];
  await backend(page);
});

test('desktop: closed by default with chips; toggle opens it DOCKED (grid narrows) and closes it; remembered', async ({ page }) => {
  await page.goto('/lab/collect');
  await page.locator('pf-hero-band').first().waitFor({ timeout: 20_000 }).catch(() => {});
  if (!docked(page)) test.skip(true, 'docked panel is for >= 1280px');
  const toggle = await openCollect(page);
  const panel = page.getByTestId('collect-info-panel');
  const grid = page.locator('.pf-sc-vials');
  // default = closed on desktop too: chips carry Urgent / Fasting / left
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-controls', 'pf-sc-info-panel');
  await expect(toggle).toHaveAttribute('title', 'Show details');
  await expect(panel).toBeHidden();
  const box = (await toggle.boundingBox())!;
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(44); expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  const chips = page.getByTestId('collect-info-chips').filter({ visible: true });
  await expect(chips.getByTestId('chip-urgent')).toHaveText('Urgent');
  await expect(chips.getByTestId('chip-fasting')).toBeVisible();
  await expect(chips.getByTestId('chip-fasting')).toHaveAttribute('title', /OGTT 30 min · 60 min · 120 min · 180 min/);
  await expect(chips.getByTestId('chip-left')).toContainText('4 of 4 left');
  const closedW = (await grid.boundingBox())!.width;
  await shots(page, 'desktop-collapsed');
  await chips.getByTestId('chip-fasting').click();
  await expect(chips.locator('.pf-sc-ichip__pop')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/desktop-fasting-pop-light.png` });
  await chips.getByTestId('chip-fasting').click();

  // open → docked beside the vials (never a drawer / scrim), grid gives up the width
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('title', 'Hide details');
  await expect(panel).toBeVisible();
  await expect(page.locator('.pf-sc-side--drawer')).toHaveCount(0);
  await expect(page.getByTestId('collect-info-scrim')).toHaveCount(0);
  await expect(panel.locator('.pf-sc-fast')).toContainText('30 min · 60 min · 120 min · 180 min');
  await expect(panel).toContainText('4 of 4');
  await expect(page.getByTestId('collect-info-chips')).toHaveCount(0);
  await expect.poll(async () => (await grid.boundingBox())!.width).toBeLessThan(closedW - 200);
  await shots(page, 'desktop-open');

  // remembered after reload (the user's choice wins over the closed default)
  await page.reload();
  await expect(page.getByTestId('collect-info-toggle')).toHaveAttribute('aria-expanded', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('collect-info-panel')).toBeVisible();
  await page.getByTestId('collect-info-toggle').click();
  await expect(page.getByTestId('collect-info-panel')).toBeHidden();
  await expect(page.getByTestId('collect-info-chips').filter({ visible: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('collect-info-toggle')).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
});

test('desktop: a choice saved under the old key is ignored (default changed to closed)', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('pf-lms.collect.info.app-1.desktop', '1'); } catch { /* */ } });
  await page.goto('/lab/collect');
  await page.locator('pf-hero-band').first().waitFor({ timeout: 20_000 }).catch(() => {});
  if (!docked(page)) test.skip(true, 'desktop only');
  const toggle = await openCollect(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('collect-info-panel')).toBeHidden();
});

test('below 1280: hidden by default with chips; drawer opens, Esc / scrim / close shut it, focus returns; remembered', async ({ page }) => {
  await page.goto('/lab/collect');
  await page.locator('pf-hero-band').first().waitFor({ timeout: 20_000 }).catch(() => {});
  if (docked(page)) test.skip(true, 'drawer is for < 1280px');
  const toggle = await openCollect(page);
  const panel = page.getByTestId('collect-info-panel');
  const chips = page.getByTestId('collect-info-chips').filter({ visible: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(chips.getByTestId('chip-urgent')).toBeVisible();
  await expect(chips.getByTestId('chip-left')).toContainText('4 of 4 left');
  await expect(page.locator('.pf-sc-side--drawer')).toHaveCount(0);
  await expect(panel.locator('.pf-sc-timeline')).toBeHidden();
  // the chips never squeeze the patient's name away
  const who = page.locator('.pf-sc-chip--patient, .pf-sc-hid__name').filter({ visible: true }).first();
  expect((await who.boundingBox())!.width).toBeGreaterThan(80);
  await shots(page, 'hidden');

  // open → drawer (dialog), focus inside, scrim shown
  await toggle.click();
  const drawer = page.locator('.pf-sc-side--drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('role', 'dialog');
  await expect(drawer.locator('.pf-sc-timeline')).toBeVisible();
  await expect(drawer.locator('.pf-sc-fast')).toContainText('30 min · 60 min · 120 min · 180 min');
  await expect(page.getByTestId('collect-info-scrim')).toBeVisible();
  await expect(drawer.locator('.pf-sc-side__close')).toBeVisible();
  await expect(drawer.locator('.pf-sc-side__close')).toBeFocused();
  // an opaque surface over the vials (never see-through)
  // (the light theme paints outer panels on a ::before glass layer, so either surface counts)
  const surfaces = await drawer.evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el, '::before').backgroundColor]);
  expect(surfaces.some(c => !/rgba\(0, 0, 0, 0\)|transparent/.test(c))).toBe(true);
  const vb = page.viewportSize()!; const db = (await drawer.boundingBox())!;
  expect(Math.round(db.x + db.width)).toBeGreaterThanOrEqual(vb.width - 40);   // pinned to the right
  await page.waitForTimeout(300);
  await shots(page, 'drawer');
  // Tab stays inside
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(await drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);

  // Esc closes, focus back on the toggle
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // scrim tap closes
  await toggle.click();
  await expect(drawer).toBeVisible();
  await page.getByTestId('collect-info-scrim').click({ position: { x: 12, y: 12 } });
  await expect(drawer).toHaveCount(0);

  // ✕ closes
  await toggle.click();
  await drawer.locator('.pf-sc-side__close').click();
  await expect(drawer).toHaveCount(0);
  await expect(toggle).toBeFocused();

  // open stays open after a reload (remembered for this tier)
  await toggle.click();
  await expect(drawer).toBeVisible();
  await page.reload();
  const t2 = await openCollect(page);
  await expect(t2).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.pf-sc-side--drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pf-sc-side--drawer')).toHaveCount(0);
});

// Owner bug 2026-11-21: press-and-hold on a tube showed the peek popover / pour ghost in the CENTRE of the screen.
// They must sit next to the finger / pointer (top layer, offset, clamped to the viewport).
const distTo = (b: { x: number; y: number; width: number; height: number }, x: number, y: number) =>
  Math.hypot(Math.max(b.x - x, 0, x - (b.x + b.width)), Math.max(b.y - y, 0, y - (b.y + b.height)));
async function fixedTraps(page: Page, sel: string) {
  return page.evaluate(s => {
    const out: string[] = [];
    let el = document.querySelector(s)?.parentElement ?? null;
    while (el) {
      const c = getComputedStyle(el);
      const trap = (c.transform !== 'none' && c.transform) || (c.filter !== 'none' && c.filter) || ((c as any).backdropFilter && (c as any).backdropFilter !== 'none' && (c as any).backdropFilter)
        || (c.perspective !== 'none' && c.perspective) || (/(transform|filter|perspective)/.test(c.willChange) && c.willChange) || (/(paint|layout|strict|content)/.test(c.contain) && c.contain) || (c.containerType && c.containerType !== 'normal' && c.containerType);
      if (trap) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')} → ${trap}`);
      el = el.parentElement;
    }
    return out;
  }, sel);
}

test('hold: the peek popover and the pour ghost sit next to the pointer (not the screen centre)', async ({ page }) => {
  const toggle = await openCollect(page);
  void toggle;
  const tile = page.locator('.pf-sc-tile').first();
  const tb = (await tile.boundingBox())!;
  // press near the tile's top-left quarter, so the centre of the tile / screen is clearly elsewhere
  const x = Math.round(tb.x + tb.width * 0.3), y = Math.round(tb.y + tb.height * 0.35);
  const touch = (page.viewportSize()?.width ?? 0) < 1280 || !!test.info().project.use.hasTouch;
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const tStart = (px: number, py: number) => cdp!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px, y: py }] });
  const tMove = (px: number, py: number) => cdp!.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py }] });
  const tEnd = () => cdp!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  // 1) still hold ~2s → the tests popover, beside the pointer
  if (touch) await tStart(x, y); else { await page.mouse.move(x, y); await page.mouse.down(); }
  const pop = page.getByTestId('peek-pop');
  await expect(pop).toBeVisible({ timeout: 6000 });
  console.log('[hold] peek traps', JSON.stringify(await fixedTraps(page, '.pf-tube__peekpop')));
  const pb = (await pop.boundingBox())!;
  console.log('[hold] pointer', x, y, 'peek box', JSON.stringify(pb));
  expect(distTo(pb, x, y)).toBeLessThanOrEqual(80);
  expect(pb.x).toBeGreaterThanOrEqual(0); expect(pb.y).toBeGreaterThanOrEqual(0);
  expect(pb.x + pb.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.screenshot({ path: `${OUT}/hold-peek-light.png` });
  await theme(page, 'dark'); await page.screenshot({ path: `${OUT}/hold-peek-dark.png` }); await theme(page, 'light');
  if (touch) await tEnd(); else await page.mouse.up();
  await expect(pop).toHaveCount(0);
  await page.waitForTimeout(400);

  // 2) hold then drag → the pour ghost follows the pointer
  if (touch) { await tStart(x, y); await page.waitForTimeout(450); } else { await page.mouse.move(x, y); await page.mouse.down(); }
  let px = x, py = y;
  for (let i = 1; i <= 10; i++) { px = x + i * 8; py = y + i * 5; if (touch) await tMove(px, py); else await page.mouse.move(px, py); await page.waitForTimeout(40); }
  const ghost = page.getByTestId('pour-ghost');
  await expect(ghost).toBeVisible({ timeout: 4000 });
  console.log('[hold] ghost traps', JSON.stringify(await fixedTraps(page, '[data-testid="pour-ghost"]')));
  const gb = (await ghost.boundingBox())!;
  console.log('[hold] pointer', px, py, 'ghost box', JSON.stringify(gb));
  expect(distTo(gb, px, py)).toBeLessThanOrEqual(80);
  await page.screenshot({ path: `${OUT}/hold-drag-light.png` });
  await theme(page, 'dark'); await page.screenshot({ path: `${OUT}/hold-drag-dark.png` }); await theme(page, 'light');
  if (touch) await tEnd(); else await page.mouse.up();
});
