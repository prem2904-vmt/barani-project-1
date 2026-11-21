import type { Page, Request } from '@playwright/test';
import { test, expect, shotsDir } from './support/form-factor';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Collect — merge tubes in place (owner-approved design 2026-11-21, mock tube-pour-v1, "Pour").
 * Drag a tube onto another: not drawn → it slides in; drawn → it pours; a different additive asks INLINE on
 * the target card (Keep apart / Pour) — never a dialog; the screen updates without refetching; Undo in the
 * toast and the chip's Separate take the tube back out. API mocked, demo data only. Frames + screenshots
 * (light + dark) under SHOTS_DIR/<project>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/collect-merge');
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
const PEOPLE: ReadonlyArray<readonly [string, number, string]> = [['o1', 1, 'Baby Leo S'], ['o2', 2, 'Nandini Rao']];
const mkOrder = (id: string, n: number, name: string, samples: any[]) => ({
  id, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: iso(now).slice(0, 10), patientId: `p${n}`, branchId: 'b1', patient: pat(String(n), name),
  priority: 'Normal', source: 'walkin', collectionType: 'walkin', status: 'sample_collected', createdAt: iso(minsAgo(90 - n)), updatedAt: iso(now), samples,
});

let samples: any[] = [];
let requests: string[] = [];

const TUBES: Array<[string, string, string, string]> = [['g', '26309', 'fluoride', 'Glucose'], ['s', '26310', 'sst', 'Cholesterol'], ['r', '26311', 'plain', 'Bilirubin'], ['l', '26312', 'edta', 'CBC']];
const ADD: Record<string, string> = { fluoride: 'fluoride', sst: 'serum', plain: 'serum', edta: 'edta' };
let withTimed = false;
let separateMode: 'ok' | '404' = 'ok';
let mergeDelay = 250;
const fresh = () => [
  ...(withTimed ? [mkSample('o1t', 'o1', 'pending', { barcode: '26313', tubeColor: 'sst', repeatOffsetMin: 120, repeatProfileTestId: 'ser-1', createdAt: iso(minsAgo(89)),
    tests: [{ id: 'o1t-t', status: 'pending', test: { name: 'Glucose +2h', parameters: PARAMS, sampleType: 'Serum' } }] })] : []),
  ...TUBES.map(([k, code, color, test]) => mkSample(`o1${k}`, 'o1', 'pending', { barcode: code, tubeColor: color, createdAt: iso(minsAgo(89)),
    tests: [{ id: `o1${k}-t`, status: 'pending', test: { name: test, parameters: PARAMS, sampleType: 'Plasma' } }] })),
  mkSample('o2a', 'o2', 'pending', { createdAt: iso(minsAgo(80)) }),
];
const theOrder = (id: string) => { const p = PEOPLE.find(x => x[0] === id) ?? PEOPLE[0]; return mkOrder(p[0], p[1], p[2], samples.filter(s => s.orderId === p[0])); };
let pendingGets = 0;
let gone: Record<string, any> = {};

async function backend(page: Page) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
  const meta = (s: any) => { try { return s.metadata ? JSON.parse(s.metadata) : {}; } catch { return {}; } };
  await page.route(/prefrontal\.health\//, async route => {
    const req: Request = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (req.method() !== 'GET') requests.push(`${req.method()} ${p}`);
    if (p === '/api/auth/me') return route.fulfill(ok(origin, { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/samples/pending-collection') { pendingGets++; return route.fulfill(ok(origin, samples.filter(s => s.status === 'pending' || s.status === 'collected').map(s => ({ ...s, order: theOrder(s.orderId) })))); }
    if (p === '/api/samples/outsourced' || p === '/api/samples/in-transit') return route.fulfill(ok(origin, []));
    let m = /^\/api\/samples\/([^/]+)\/collect$/.exec(p);
    if (m && req.method() === 'PATCH') { const s = samples.find(x => x.id === m![1]); if (s) { s.status = 'collected'; s.collectedAt = iso(new Date()); } return route.fulfill(ok(origin, s ?? {})); }
    m = /^\/api\/samples\/([^/]+)\/merge-candidates$/.exec(p);
    if (m) {
      const keep = samples.find(x => x.id === m![1]);
      return route.fulfill(ok(origin, samples.filter(x => x.orderId === keep?.orderId && x.id !== keep?.id).map(x => ({
        id: x.id, barcode: x.barcode, tubeColor: x.tubeColor, status: x.status, tests: x.tests.map((t: any) => t.test.name), eligible: true,
        warnings: ADD[x.tubeColor] !== ADD[keep?.tubeColor] ? [{ code: 'additive_mismatch', message: 'Different additive' }] : [],
      }))));
    }
    m = /^\/api\/samples\/([^/]+)\/merge$/.exec(p);
    if (m && req.method() === 'POST') {
      await new Promise(r => setTimeout(r, mergeDelay));   // a real round trip
      const body = req.postDataJSON(); const keep = samples.find(x => x.id === m![1]);
      const g = samples.find(x => x.id === body.sampleIds[0]);
      if (ADD[g.tubeColor] !== ADD[keep.tubeColor] && !body.confirmWarnings)
        return route.fulfill({ status: 409, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false, error: 'merge_needs_confirm', message: 'Different additive', data: { warnings: [{ code: 'additive_mismatch', message: 'Different additive' }] } }) });
      const mm = meta(keep);
      mm.manualMerge = [...(mm.manualMerge ?? []), { barcode: g.barcode, tubeColor: g.tubeColor, by: ME.id, at: iso(new Date()), restore: { sampleId: g.id, drawn: g.status !== 'pending' } }];
      mm.mergedFromBarcodes = [...(mm.mergedFromBarcodes ?? []), g.barcode];
      keep.metadata = JSON.stringify(mm); keep.tests = [...keep.tests, ...g.tests];
      if (g.status !== 'pending' && keep.status === 'pending') { keep.status = 'collected'; keep.collectedAt = g.collectedAt; }
      gone[g.id] = g; samples = samples.filter(x => x.id !== g.id);
      return route.fulfill(ok(origin, { sample: keep, warnings: [], retired: [g.barcode] }));
    }
    m = /^\/api\/samples\/([^/]+)\/separate$/.exec(p);
    if (m && req.method() === 'POST') {
      // dev before the Separate backend ships: no such route (empty 404).
      if (separateMode === '404') return route.fulfill({ status: 404, headers: cors(origin), body: '' });
      const body = req.postDataJSON(); const keep = samples.find(x => x.id === m![1]); const g = gone[body.sampleId];
      const mm = meta(keep);
      mm.manualMerge = (mm.manualMerge ?? []).filter((e: any) => e.barcode !== g.barcode);
      mm.mergedFromBarcodes = (mm.mergedFromBarcodes ?? []).filter((b: string) => b !== g.barcode);
      keep.metadata = JSON.stringify(mm); keep.tests = keep.tests.filter((t: any) => !g.tests.some((x: any) => x.id === t.id));
      samples.splice(samples.indexOf(keep) + 1, 0, g); delete gone[g.id];
      return route.fulfill(ok(origin, { sample: keep, restored: g }));
    }
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
  await page.routeWebSocket(/\/hubs\//, ws => { let hs = false; ws.onMessage(() => { if (!hs) { hs = true; ws.send('{}\x1e'); } }); });
  await page.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1'); localStorage.clear();
      localStorage.setItem('pf.session', session as string); localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf.wa.manual.reminded', '1'); localStorage.setItem('pf.startHintSeen', '1');
      localStorage.setItem('pf.collect.pourDragHint', '1');
    }
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` })] as const);
}

async function theme(page: Page, mode: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: mode });
  await page.evaluate(m => { const r = document.documentElement; r.classList.remove('dark', 'light'); r.classList.add(m); r.setAttribute('data-theme', m); }, mode);
  await page.waitForTimeout(300);
}
const tile = (page: Page, code: string) => page.locator('.pf-tube-wrap', { hasText: `Sample ID ${code}` }).first();
const center = async (page: Page, code: string) => { const b = (await tile(page, code).locator('.pf-tube').boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height * 0.4 }; };
const isTouch = () => !!test.info().project.use.hasTouch;

async function openBaby(page: Page) {
  await page.goto('/lab/collect');
  const card = page.locator('.pf-sc__pcard', { hasText: 'Baby Leo' }).first();
  const host = page.locator('.pf-drawer--hosted .pf-sc-hhead');
  await expect(card.or(host).first()).toBeVisible({ timeout: 30_000 });
  if (await card.isVisible()) await card.click();
  await expect(tile(page, '26309')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
}

/** Drag the tube with Sample ID `from` onto `to` (mouse, or a touch hold + move). `frames` = screenshots right after the drop. */
async function drag(page: Page, from: string, to: string, frames?: { name: string; at: number[] }) {
  const a = await center(page, from), b = await center(page, to);
  if (isTouch()) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
    await page.waitForTimeout(330);
    for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * i / 12, y: a.y + (b.y - a.y) * i / 12 }] }); await page.waitForTimeout(20); }
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12); await page.waitForTimeout(20); }
    await page.waitForTimeout(150);
    await page.mouse.up();
  }
  if (frames) {
    const t0 = Date.now();
    for (let i = 0; i < frames.at.length; i++) {
      const wait = frames.at[i] - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.screenshot({ path: `${OUT}/${frames.name}-frame${i + 1}.png` });
    }
  }
}

async function noDialogs(page: Page) {
  await expect(page.locator('.pf-dh-root')).toHaveCount(0);
  await expect(page.locator('.pf-pour')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  // Owner scope: desktop + tablet (touch). Phones auto-scroll the vial list under a long drag; covered by unit specs.
  test.skip(test.info().project.name.startsWith('phone'), 'desktop + tablet');
  test.setTimeout(120_000); OUT = shotsDir(OUT_BASE);
  withTimed = /timed/i.test(test.info().title); separateMode = /404/.test(test.info().title) ? '404' : 'ok';
  mergeDelay = /still running/.test(test.info().title) ? 2500 : 250;
  samples = fresh(); requests = []; pendingGets = 0; gone = {};
  await backend(page);
});

test('not drawn: Gold slides into Red — chip, "2 tubes in one", toast with Undo; no dialog, no refetch', async ({ page }) => {
  await openBaby(page);
  const gets = pendingGets;
  await drag(page, '26310', '26311', { name: 'slide', at: [60, 220, 420, 620] });
  await expect(tile(page, '26310')).toHaveCount(0, { timeout: 5000 });
  const red = tile(page, '26311');
  await expect(red.getByTestId('merge-chip')).toHaveText(/\+ Gold · 26310/);
  await expect(red.getByTestId('tubes-in-one')).toHaveText('2 tubes in one');
  const toast = page.locator('.toast-item', { hasText: 'Merged Gold 26310 into Red 26311' });
  await expect(toast).toBeVisible();
  await expect(toast.getByTestId('toast-action')).toHaveText('Undo');
  expect(requests).toContain('POST /api/samples/o1r/merge');
  await noDialogs(page);
  expect(pendingGets).toBe(gets);
  await page.screenshot({ path: `${OUT}/slide-done-light.png` });
  await theme(page, 'dark'); await page.screenshot({ path: `${OUT}/slide-done-dark.png` }); await theme(page, 'light');

  // Undo → Separate → Gold is back with its own Sample ID
  await toast.getByTestId('toast-action').click();
  await expect(tile(page, '26310')).toBeVisible({ timeout: 5000 });
  await expect(tile(page, '26311').getByTestId('merge-chip')).toHaveCount(0);
  expect(requests).toContain('POST /api/samples/o1r/separate');
  expect(pendingGets).toBe(gets);
});

test('drawn: Gold pours into Red (stream, wobble), then Separate from the chip', async ({ page }) => {
  await openBaby(page);
  for (const code of ['26310', '26311']) { await tile(page, code).locator('.pf-tube').click(); }
  await expect.poll(() => requests.filter(r => /collect$/.test(r)).length).toBe(2);
  await page.waitForTimeout(700);
  const gets = pendingGets;
  await drag(page, '26310', '26311', { name: 'pour', at: [150, 560, 850, 1150] });
  await expect(tile(page, '26310')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.toast-item', { hasText: 'Poured Gold 26310 into Red 26311' })).toBeVisible();
  await noDialogs(page);
  await page.screenshot({ path: `${OUT}/pour-done-light.png` });

  // Separate any time later: chip → inline confirm → the tube pops back out; toast offers Print label
  await tile(page, '26311').getByTestId('merge-chip').click();
  const ask = tile(page, '26311').getByTestId('inline-ask');
  await expect(ask).toContainText('Take Gold 26310 back out?');
  await page.screenshot({ path: `${OUT}/separate-ask-light.png` });
  await theme(page, 'dark'); await page.screenshot({ path: `${OUT}/separate-ask-dark.png` }); await theme(page, 'light');
  await ask.getByTestId('inline-go').click();
  await expect(tile(page, '26310')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.toast-item', { hasText: 'Gold 26310 is its own tube again' }).getByTestId('toast-action')).toHaveText('Print label');
  expect(requests).toContain('POST /api/samples/o1r/separate');
  await noDialogs(page);
  expect(pendingGets).toBe(gets);
});

/** Drag Gold over Grey (fluoride): rose + "Serum into Fluoride · check" while over it; release → the inline question. */
async function hoverThenAsk(page: Page, mode: 'light' | 'dark') {
  const ask = tile(page, '26309').getByTestId('inline-ask');
  const a = await center(page, '26310'), b = await center(page, '26309');
  if (!isTouch()) {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12); await page.waitForTimeout(20); }
    await expect(tile(page, '26309').getByTestId('drop-warn')).toHaveText('Serum into Fluoride · check');
    await page.screenshot({ path: `${OUT}/warn-hover-${mode}.png` });
    await page.mouse.up();
  } else {
    await drag(page, '26310', '26309');
  }
  await expect(ask).toContainText('Serum into Fluoride. Different additive. Pour anyway?');
  await noDialogs(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/warn-ask-${mode}.png` });
}

test('dark: the rose drop state and the inline question', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openBaby(page);
  await theme(page, 'dark');
  await page.waitForTimeout(400);
  await hoverThenAsk(page, 'dark');
});

test('different additive: target turns rose, asks INLINE — Keep apart changes nothing, Pour merges', async ({ page }) => {
  await openBaby(page);
  const gets = pendingGets;
  const ask = tile(page, '26309').getByTestId('inline-ask');
  await hoverThenAsk(page, 'light');
  await ask.getByTestId('inline-no').click();
  await expect(ask).toHaveCount(0);
  await expect(tile(page, '26310')).toBeVisible();
  expect(requests.filter(r => r.endsWith('/merge'))).toEqual([]);

  await drag(page, '26310', '26309');
  await tile(page, '26309').getByTestId('inline-go').click();
  await expect(tile(page, '26310')).toHaveCount(0, { timeout: 5000 });
  await expect(tile(page, '26309').getByTestId('merge-chip')).toHaveText(/\+ Gold · 26310/);
  expect(requests.filter(r => r.endsWith('/merge'))).toEqual(['POST /api/samples/o1g/merge']);
  await noDialogs(page);
  expect(pendingGets).toBe(gets);
});

test('timed series: a +2h draw is not droppable — the reason shows while over it, a drop pours nothing', async ({ page }) => {
  await openBaby(page);
  const timed = tile(page, '26313');
  await expect(timed).toBeVisible();
  await expect(timed.locator('.pf-tube')).not.toHaveClass(/pf-tube--draggable/);   // nothing to pour it into
  const a = await center(page, '26310'), b = await center(page, '26313');
  if (!isTouch()) {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12); await page.waitForTimeout(20); }
    await expect(timed.locator('.pf-tube')).toHaveClass(/pf-tube--pour-no/);
    await expect(timed).toContainText('Timed draws can’t be poured');
    await page.screenshot({ path: `${OUT}/timed-refused-light.png` });
    await page.mouse.up();
  } else {
    await drag(page, '26310', '26313');
  }
  await expect(page.locator('.toast-item', { hasText: 'Timed draws can’t be poured' })).toBeVisible();
  await expect(tile(page, '26310')).toBeVisible();
  expect(requests.filter(r => r.endsWith('/merge'))).toEqual([]);
  await noDialogs(page);
});

test('Undo after the merge completed, separate missing on the server (404): plain words, the merge stays', async ({ page }) => {
  await openBaby(page);
  await drag(page, '26310', '26311');
  await expect(tile(page, '26310')).toHaveCount(0, { timeout: 5000 });
  await expect.poll(() => requests.includes('POST /api/samples/o1r/merge')).toBe(true);
  await page.waitForTimeout(600);   // the merge answered
  await page.locator('.toast-item', { hasText: 'Merged Gold 26310 into Red 26311' }).getByTestId('toast-action').click();
  const err = page.locator('.toast-item', { hasText: 'Couldn’t undo: this server can’t take tubes back out yet.' });
  await expect(err).toBeVisible();
  await expect(page.locator('.toast-item', { hasText: /Http failure|404/ })).toHaveCount(0);
  await expect(tile(page, '26311').getByTestId('merge-chip')).toHaveText(/\+ Gold · 26310/);   // the truth: still merged
  expect(requests).toContain('POST /api/samples/o1r/separate');
  await page.screenshot({ path: `${OUT}/undo-404-light.png` });
  await noDialogs(page);
});

test('Undo while the merge call is still running: undone on the screen at once, then taken back out on the server', async ({ page }) => {
  await openBaby(page);
  await drag(page, '26310', '26311');
  await expect(tile(page, '26310')).toHaveCount(0, { timeout: 5000 });
  expect(requests.includes('POST /api/samples/o1r/separate')).toBe(false);
  await page.locator('.toast-item', { hasText: 'Merged Gold 26310 into Red 26311' }).getByTestId('toast-action').click();
  await expect(tile(page, '26310')).toBeVisible();                      // back immediately, no request needed
  await expect(tile(page, '26311').getByTestId('merge-chip')).toHaveCount(0);
  expect(requests.includes('POST /api/samples/o1r/separate')).toBe(false);
  // the merge then lands → the screen asks the server to take it back out
  await expect.poll(() => requests.includes('POST /api/samples/o1r/separate'), { timeout: 8000 }).toBe(true);
  await expect(tile(page, '26310')).toBeVisible();
  await expect(page.locator('.toast-item', { hasText: 'Couldn’t undo' })).toHaveCount(0);
});
