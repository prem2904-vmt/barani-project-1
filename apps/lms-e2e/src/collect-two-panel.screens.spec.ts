import type { Page, Request } from '@playwright/test';
import { test, expect, shotsDir, expectLayout } from './support/form-factor';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Collect page two-panel (owner 2026-11-19). Wide screens (>= 1024px): the pending queue is the LEFT side card, the
 * selected patient's collection runs in the main card on the right (first patient auto-selected, no band-corner Refresh).
 * Phones / tablet portrait keep list -> full-screen collection -> back chevron. API mocked, demo data only.
 * Screenshots under SHOTS_DIR/<project>/ (light + dark).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/collect-2p');
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
const fresh = () => PEOPLE.flatMap(([id, n]) => [
  mkSample(`${id}a`, id, 'pending', { createdAt: iso(minsAgo(90 - n)) }),
  ...(n === 2 ? [mkSample(`${id}b`, id, 'pending', { tubeColor: 'purple', createdAt: iso(minsAgo(90 - n)) })] : []),
]);
const theOrder = (id: string) => { const p = PEOPLE.find(x => x[0] === id) ?? PEOPLE[0]; return mkOrder(p[0], p[1], p[2], samples.filter(s => s.orderId === p[0])); };

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
  await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(() => ws.send('{}\x1e')); });
  await page.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1'); localStorage.clear();
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
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

test.beforeEach(async ({ page }) => {
  test.setTimeout(60_000); OUT = shotsDir(OUT_BASE);
  samples = fresh(); requests = [];
  await backend(page);
});

test('wide: queue = side card, collection = main card, first patient selected, no band Refresh', async ({ page }) => {
  await page.goto('/lab/collect');
  await page.waitForLoadState('networkidle').catch(() => {});
  if (!wide(page)) test.skip(true, 'two-panel is for wide screens');
  await expectLayout(page);
  const two = page.getByTestId('collect-two-panel');
  await expect(two).toBeVisible({ timeout: 20_000 });
  const side = two.locator('.pf-sc-qside');
  const host = two.locator('.pf-drawer--hosted');
  await expect(host).toBeVisible();
  // side card LEFT of the main card, 340px, same height
  const sb = (await side.boundingBox())!, hb = (await host.boundingBox())!;
  expect(sb.x + sb.width).toBeLessThanOrEqual(hb.x + 1);
  expect(Math.round(sb.width)).toBe(340);
  expect(Math.abs(sb.height - hb.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(sb.y - hb.y)).toBeLessThanOrEqual(2);
  // head says PENDING COLLECTION + the count; rows are the shared side-list
  await expect(side.locator('.pf-card__label')).toHaveText(/pending collection/i);
  await expect(page.getByTestId('collect-queue-count')).toHaveText('3');
  await expect(side.locator('.pf-side-list .pf-side-item')).toHaveCount(3);
  // first patient (oldest) auto-selected, their collection shows in the main card head
  await expect(side.locator('.pf-side-item.is-on')).toHaveCount(1);
  await expect(side.locator('.pf-side-item').first()).toHaveClass(/is-on/);
  await expect(host.locator('.pf-sc-hhead')).toContainText('Sathish');
  await expect(host.locator('.pf-sc-hhead')).toContainText('waiting');
  // actions live in the head (never at the bottom)
  await expect(host.locator('.pf-sc-hhead').getByRole('button', { name: /print labels/i })).toBeVisible();
  await expect(host.locator('.pf-sc-hhead').getByRole('button', { name: /can.t collect/i })).toBeVisible();
  await expect(host.locator('footer.pf-sc-foot')).toHaveCount(0);
  // no band-corner Refresh; a compact refresh icon is in the side card head
  await expect(page.locator('pf-hero-band .pf-hb-btn', { hasText: 'Refresh' })).toHaveCount(0);
  await expect(side.locator('.pf-card__head').getByRole('button', { name: 'Refresh' })).toBeVisible();
  // no page scroll; no card-in-card
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  expect(await host.locator('.pf-card').count()).toBe(0);
  await shot(page, 'wide-light'); await theme(page, 'dark'); await shot(page, 'wide-dark'); await theme(page, 'light');
  // select the second patient -> THEIR collection (two tubes) in the main card, no navigation
  await side.locator('.pf-side-item').nth(1).click();
  await expect(host.locator('.pf-sc-hhead')).toContainText('Nandini');
  await expect(side.locator('.pf-side-item.is-on')).toHaveCount(1);
  await expect(host.locator('.pf-sc-tile')).toHaveCount(2);
  expect(new URL(page.url()).pathname).toBe('/lab/collect');
  await shot(page, 'wide-second-light');
  // collect a vial in place
  await host.locator('.pf-sc-tile').first().click();
  await expect.poll(() => requests.some(r => /PATCH \/api\/samples\/o2[ab]\/collect/.test(r))).toBe(true);
  await expect(host.locator('.pf-sc-hdrawn')).toContainText('1/2');
  await theme(page, 'dark'); await shot(page, 'wide-collect-dark');
});

test('wide: Done for now moves to the next patient; empty queue shows the empty state', async ({ page }) => {
  await page.goto('/lab/collect');
  await page.waitForLoadState('networkidle').catch(() => {});
  if (!wide(page)) test.skip(true, 'two-panel is for wide screens');
  const two = page.getByTestId('collect-two-panel');
  const host = two.locator('.pf-drawer--hosted');
  await expect(host.locator('.pf-sc-hhead')).toContainText('Sathish');
  // draw the only tube, then Done -> Nandini (the next in line); Sathish is out of the queue
  await host.locator('.pf-sc-tile').first().click();
  await expect.poll(() => requests.some(r => /PATCH \/api\/samples\/o1a\/collect/.test(r))).toBe(true);
  await host.locator('.pf-sc-hhead').getByRole('button', { name: /done/i }).first().click();
  await expect(host.locator('.pf-sc-hhead')).toContainText('Nandini');
  await expect(two.locator('.pf-side-item')).toHaveCount(2);
  samples.forEach(s => { s.status = 'collected'; });
  await two.locator('.pf-sc-qside').getByRole('button', { name: 'Refresh' }).click();
  await expect(two.locator('.pf-sc__empty').first()).toContainText(/no samples waiting/i);
  await shot(page, 'wide-empty-light');
});

test('narrow: list first, tap opens the full-screen collection, back returns (no two panels)', async ({ page }) => {
  await page.goto('/lab/collect');
  await page.waitForLoadState('networkidle').catch(() => {});
  if (wide(page)) test.skip(true, 'phones / tablet portrait only');
  await expectLayout(page);
  await expect(page.getByTestId('collect-two-panel')).toHaveCount(0);
  const tile = page.locator('.pf-sc__pcard').first();
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.pf-drawer')).toHaveCount(0);
  await shot(page, 'narrow-list-light');
  await tile.click();
  const drawer = page.locator('.pf-drawer[role="dialog"]').first();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.pf-sc-tile').first()).toBeVisible();
  await shot(page, 'narrow-collect-light');
  await theme(page, 'dark'); await shot(page, 'narrow-collect-dark'); await theme(page, 'light');
  await drawer.locator('.pf-hb__back').click();
  await expect(page.locator('.pf-drawer')).toHaveCount(0);
  await expect(page.locator('.pf-sc__pcard').first()).toBeVisible();
});
