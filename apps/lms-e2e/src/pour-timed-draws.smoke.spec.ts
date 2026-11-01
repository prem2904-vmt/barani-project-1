import { test, expect, type Page } from '@playwright/test';

/**
 * Pour timed draws, FULLY OFFLINE (made-up "Demo Lab", one demo patient): the
 * collection screen offers a 60-minute draw "Pour into another tube…", and the
 * target list holds exactly the other series' 60-minute tube (not the 120-minute
 * one, not the baselines). Screenshots into $SHOTS_DIR when set (light + dark).
 *
 *   node serve-spa.mjs dist/apps/lms/browser 4319 &
 *   BASE_URL=http://127.0.0.1:4319 SHOTS_DIR=/tmp/shots ./node_modules/.bin/playwright test \
 *     --config=apps/lms-e2e/playwright.offline.config.ts pour-timed-draws
 */
const SHOTS = process.env['SHOTS_DIR'] || '';
const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-1', authId: 'sub-1' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;
const iso = new Date().toISOString();

const bio = { id: 'd-b', name: 'Biochemistry', code: 'BIO', containerColor: 'fluoride' };
const order = { id: 'o1', orderNumber: 'LAB-2611-000042', createdAt: iso, status: 'collecting', priority: 'routine',
  patient: { id: 'p1', displayName: 'Meena Iyer', firstName: 'Meena', age: 42, sex: 'Female', mrn: 'MW0042' } };
const tube = (id: string, barcode: string, off: number, series: string, test: string, status = 'collected') => ({
  id, orderId: 'o1', status, barcode, tubeColor: 'fluoride', rejectionCount: 0, departmentId: 'd-b', department: bio, departments: [bio],
  createdAt: iso, order, repeatOffsetMin: off, repeatProfileTestId: series,
  collectedAt: status === 'collected' ? iso : undefined,
  tests: [{ id: 'l-' + id, status: 'pending', test: { name: test, departmentId: 'd-b' } }],
});
const TUBES = [
  tube('og0', '26301', 0, 'ogtt', 'Glucose OGTT fasting'),
  tube('in0', '26302', 0, 'ins', 'Insulin fasting'),
  tube('og60', '26303', 60, 'ogtt', 'Glucose OGTT 60 min'),
  tube('in60', '26304', 60, 'ins', 'Insulin 60 min'),
  tube('in120', '26305', 120, 'ins', 'Insulin 120 min'),
];

async function offlineBackend(page: Page) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ success: true, data }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (p === '/api/auth/me') {
      return route.fulfill(ok(origin, {
        id: ME.id, authId: ME.authId, firstName: 'Demo', fathersName: 'Tech', displayName: 'Demo Tech',
        email: 'tech@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main',
        roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false,
      }));
    }
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/samples/pending-collection') return route.fulfill(ok(origin, TUBES));
    if (p === '/api/orders/o1') return route.fulfill(ok(origin, { ...order, samples: TUBES }));
    const cand = p.match(/^\/api\/samples\/([^/]+)\/merge-candidates$/);
    if (cand) {
      // The server's verdicts for the SOURCE tube (og60) poured into `cand[1]`.
      const eligible = cand[1] === 'in60';
      return route.fulfill(ok(origin, TUBES.filter(t => t.id !== cand[1]).map(t => ({
        id: t.id, barcode: t.barcode, tubeColor: t.tubeColor, status: t.status, tests: t.tests.map(x => x.test.name),
        eligible: t.id === 'og60' ? eligible : false, reason: t.id === 'og60' && eligible ? null : 'merge_timed_series', warnings: [],
      }))));
    }
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86400,
        user: { id: ME.authId, aud: 'authenticated', email: 'tech@demo.test' } }) });
  });
  await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(() => ws.send('{}\x1e')); });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`pour dialog on a 60-minute draw (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await offlineBackend(page);
    await page.addInitScript(([session, mode]) => {
      if (sessionStorage.getItem('pf.e2e.seeded')) return;
      sessionStorage.setItem('pf.e2e.seeded', '1');
      localStorage.clear();
      localStorage.setItem('pf.session', session);
      localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf-theme', mode);
    }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` }), scheme]);
    await page.goto('/lab/collect?orderId=o1');
    const tile = page.locator('.pf-tube-wrap', { hasText: '26303' });
    await expect(tile).toBeVisible({ timeout: 30_000 });
    await tile.locator('[data-testid="pour-tube"]').click();
    const sheet = page.locator('.pf-pour');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('26304');
    await expect(sheet).not.toContainText('26305');
    await expect(sheet.locator('[data-testid="pour-refusal"]')).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/pour-timed-${scheme}.png` });
    await ctx.close();
  });
}
