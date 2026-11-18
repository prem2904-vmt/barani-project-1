import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, browser, isPhone, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';
import { callsOf, installFilesBackend, resetFiles } from './support/files-backend';

/**
 * Test Master prices in a Neuron sheet (sheet round-trip, beta `neuron`, dev only). API mocked (fake demo data); the Pricing view,
 * the Files editor band and the review dialog are the real app. With the Neuron engine in the build the sheet opens for real and
 * is edited through the engine's own scripting API; without it the engine steps skip.
 * Screenshots (light + dark): SHOTS_DIR/<form factor>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/prices-neuron');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
const tid = (page: Page, id: string) => vis(page, `[data-testid="${id}"]`);
const dlg = (page: Page) => vis(page, '[role="dialog"]');

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

const DEPTS = [{ id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true }, { id: 'd2', name: 'Haematology', code: 'HAE', isActive: true }];
const TESTS = Array.from({ length: 12 }, (_, i) => {
  const d = DEPTS[i % 2];
  return { id: `t${i + 1}`, testCode: `${d.code}${101 + i}`, name: `Demo test ${i + 1}`, type: i % 6 === 5 ? 'profile' : 'individual', isActive: true,
    price: 100 + i * 25, priceIsDefault: false, isOffered: i % 5 !== 4, department: { id: d.id, name: d.name, code: d.code }, departmentId: d.id, parameters: '[]' };
});
const patches: { url: string; body: unknown }[] = [];

async function boot(page: Page, context: BrowserContext, route = '/admin/tests?view=pricing') {
  resetNeg();
  resetFiles();
  patches.length = 0;
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/tenants/departments') return ok(DEPTS);
    if (r.path === '/api/tests/prices/specimens') return ok([]);
    return undefined;
  };
  await installNegBackend(page, context);
  await installFilesBackend(page);
  // The test list (with codes) and the batch price write: registered last, so they win over the Files mock's short /api/tests.
  await page.route(/prefrontal\.health\/api\/tests(\/|\?|$)/, async r => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fallback();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
    const p = new URL(req.url()).pathname;
    if (req.method() === 'PATCH' && p === '/api/tests/prices/bulk') { patches.push({ url: p, body: req.postDataJSON() }); return r.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data: { updated: 1 } }) }); }
    if (req.method() === 'GET' && (p === '/api/tests/' || p === '/api/tests')) return r.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data: TESTS }) });
    return r.fallback();
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await go(page, route);
  return errors;
}
const engineIn = async (page: Page) => {
  const r = await page.request.get('/neuron-engine/index.html').catch(() => null);
  return !!r && r.ok() && (await r.text()).includes('_bg.wasm');
};
/** Run one engine command inside the editor frame (the engine's own scripting API). */
const engineRun = async (page: Page, cmd: string, params: Record<string, unknown>) => {
  const fr = await (await page.locator('iframe[data-testid="files-frame"]').elementHandle())!.contentFrame();
  return fr!.evaluate(async ([c, p]) => { const n = (window as unknown as { neuron: { execute(c: string, p: unknown): unknown } }).neuron; try { return JSON.stringify(await n.execute(c as string, p)); } catch (e) { return 'ERR ' + String((e as Error)?.message ?? e); } }, [cmd, params] as const);
};

test.beforeEach(() => { test.setTimeout(240_000); });

test.describe('Test Master prices in Neuron', () => {
  test('Pricing head: "Open in Neuron" (secondary) beside the branch / bulk tools; not on a phone (Files is view-only there)', async ({ page, context }) => {
    const errors = await boot(page, context);
    await expect(vis(page, '[data-testid="pr-main"] .pf-card__head')).toContainText('12 tests', { timeout: 60_000 });
    if (isPhone()) {
      await expect(page.locator('[data-testid="pr-open-neuron"]')).toHaveCount(0);
    } else {
      const b = tid(page, 'pr-open-neuron');
      await expect(b).toBeVisible({ timeout: 20_000 });
      await expect(b).toHaveText(/Open in Neuron/);
      await expect(b).toHaveClass(/pf-btn--secondary/);
      const box = await b.boundingBox();
      const head = await vis(page, '[data-testid="pr-main"] .pf-card__head').boundingBox();
      expect(box!.y >= head!.y && box!.y + box!.height <= head!.y + head!.height + 1, 'inside the Prices card head').toBeTruthy();
    }
    await page.waitForTimeout(500);
    await shot(page, 'pricing-head');
    expect(errors).toEqual([]);
  });

  test('Open in Neuron → sheet stored in Files (no patient-data flag) → editor with "Send to Prefrontal"; edit → review → Apply = the grid batch write', async ({ page, context }) => {
    test.skip(isPhone(), 'phones are view-only for Files: no Open in Neuron');
    const withEngine = (await engineIn(page)) && browser() !== 'firefox';
    if (!withEngine) await page.route('**/neuron-engine/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><script type="module">/* stub ./neuron-web-stub_bg.wasm */</script></body></html>' }));
    const errors = await boot(page, context);
    await tid(page, 'pr-open-neuron').click();
    await expect(page).toHaveURL(/\/files\/sheet\/file-\d+/, { timeout: 30_000 });
    const posts = callsOf('POST', /^\/api\/office\/files$/);
    expect(posts).toHaveLength(1);
    const body = posts[0].body as Record<string, string>;
    expect(body['name']).toMatch(/^Prices – .+ – \d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(body['kind']).toBe('sheet');
    expect(body['phiSource']).toBeUndefined();
    expect(posts[0].head).toBe('PK');
    await expect(tid(page, 'files-send')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="files-phi-chip"]')).toHaveCount(0);
    if (!withEngine) { await shot(page, 'editor-band-no-engine'); expect(errors).toEqual([]); return; }

    await expect(page.locator('[data-testid="files-loading"]')).toHaveCount(0, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'editor-price-sheet');
    // The engine honours the file: Code is locked, Price is editable, Offered takes only Yes / No from its drop-down.
    expect(await engineRun(page, 'cell.set', { sheet: 'Prices', cell: 'A2', input: 'HACK' })).toMatch(/^ERR .*protected/);
    const insp = JSON.parse(await (await (await page.locator('iframe[data-testid="files-frame"]').elementHandle())!.contentFrame())!.evaluate(async () => JSON.stringify(await (window as unknown as { neuron: { docInspect(p: unknown): unknown } }).neuron.docInspect({}))));
    const prices = insp.sheets.find((s: { name: string }) => s.name === 'Prices');
    expect(prices.protected).toBe(true);
    expect(prices.freeze).toEqual([1, 0]);
    expect(prices.autofilter).toBe('A1:F13');
    expect(prices.validations).toBe(1);
    const read = JSON.parse(await engineRun(page, 'sheet.read', { sheet: 'Prices', range: 'A1:F3' }));
    expect(read.values[0]).toEqual(['Code', 'Test', 'Department', 'Type', 'Offered', 'Price (₹)']);
    const row2Code = read.values[1][0] as string;
    const t = TESTS.find(x => x.testCode === row2Code)!;
    expect(await engineRun(page, 'cell.set', { sheet: 'Prices', cell: 'F2', input: '999' })).not.toMatch(/^ERR/);
    expect(await engineRun(page, 'cell.set', { sheet: 'Prices', cell: 'F3', input: 'free' })).not.toMatch(/^ERR/);

    await tid(page, 'files-send').click();
    await expect(dlg(page)).toContainText('Send to Prefrontal', { timeout: 30_000 });
    await expect(dlg(page)).toContainText('1 price changes');
    await expect(dlg(page)).toContainText('1 row ignored');
    await expect(dlg(page)).toContainText(`${t.name} (${t.testCode}): Price (₹) ₹${t.price.toLocaleString('en-IN')} → ₹999`);
    await expect(dlg(page)).toContainText('is not a number ("free")');
    await page.waitForTimeout(400);
    await shot(page, 'review-dialog');
    await dlg(page).getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => patches.length, { timeout: 20_000 }).toBe(1);
    expect(patches[0].body).toEqual(expect.objectContaining({ updates: [{ testId: t.id, price: 999 }] }));
    await expect(vis(page, '.pf-toast, [role="status"]')).toBeAttached();
    expect(errors).toEqual([]);
  });

  test('an ordinary sheet has no "Send to Prefrontal"', async ({ page, context }) => {
    test.skip(isPhone(), 'view-only');
    await page.route('**/neuron-engine/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><script type="module">/* stub ./neuron-web-stub_bg.wasm */</script></body></html>' }));
    await boot(page, context, '/files/sheet/file-4');
    await expect(tid(page, 'files-save')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="files-send"]')).toHaveCount(0);
  });
});
