import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { sheetColumns } from './support/xlsx-cols';
import { test, expect, isPhone, isTouch, shotsDir, routeOf, expectLayout } from './support/form-factor';

/**
 * Neuron, REAL BACKEND (no route mocks): login -> Reports -> Open in sheet -> results workbook from
 * GET /api/office/results-workbook -> edit -> File tab Save + band Save -> stored (list + content + ETag) -> reopen from the
 * saved Sheets list -> back chevron -> a second tab's 409. The API is prefrontal-mw's NeuronE2EHost (throwaway local database,
 * local MinIO, test-only auth); see playwright.neuron-real.config.ts. Fake, masked data only (P-0001 ...).
 */
const STACK = JSON.parse(fs.readFileSync(process.env['PF_STACK'] ?? '/dev/null', 'utf8')) as {
  apiUrl: string; admin: { authId: string; name: string }; tests: { name: string; id: string }[];
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: STACK.admin.authId, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400, email: `${STACK.admin.authId}@test.invalid` })}.sig`;

const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/neuron-real');
const out = () => shotsDir(OUT_BASE);
const FRAME = 'iframe[data-testid="neuron-frame"]';
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`).locator('visible=true').first();
const saveState = (page: Page) => tid(page, 'neuron-savestate');
const backChevron = (page: Page) => page.locator('button[aria-label="Go back"]').locator('visible=true').first();
const dlg = (page: Page) => page.locator('[role="dialog"]').locator('visible=true').first();

async function boot(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(([tok, t]) => {
    try {
      localStorage.setItem('pf.session', JSON.stringify({ access_token: tok, refresh_token: 'rt-neuron-real' }));
      localStorage.setItem('pf.beta.neuron', '1');
      localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf-theme', t);
    } catch { /* storage blocked */ }
  }, [TOKEN, theme] as const);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}
async function mode(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
/** Light + dark of the current screen. */
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) {
    await mode(page, dark);
    await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await mode(page, false);
}
async function apiCtx(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: STACK.apiUrl, extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}`, 'X-PF-BETA': 'neuron' } });
}
type FileDto = { id: string; name: string; version: number; sizeBytes: number; kind: string };
async function listFiles(api: APIRequestContext): Promise<FileDto[]> {
  const r = await api.get('/api/office/files?kind=sheet');
  expect(r.status()).toBe(200);
  return (await r.json()).data as FileDto[];
}
async function content(api: APIRequestContext, id: string) {
  const r = await api.get(`/api/office/files/${id}/content`);
  expect(r.status()).toBe(200);
  return { etag: r.headers()['etag'], bytes: await r.body() };
}

/** The first-run "Tap the logo for the Start menu" hint covers the bottom-left corner of every shot: dismiss it once. */
async function dismissHint(page: Page) {
  const got = page.getByRole('button', { name: 'Got it' }).locator('visible=true').first();
  if (await got.isVisible().catch(() => false)) await got.click();
}

/** The engine is up and a workbook is open. */
async function needGrid(page: Page) {
  await expect(page.locator(FRAME)).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(async () => (await page.locator('[data-testid="neuron-loading"]').count()) === 0, { timeout: 180_000, intervals: [500] }).toBe(true);
  await expect(page.locator('[data-testid="neuron-failed"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await ((document.querySelector('iframe[data-testid="neuron-frame"]') as HTMLIFrameElement).contentWindow as any).neuron.docInspect({}); return true; } catch { return false; }
  }), { timeout: 90_000, intervals: [500] }).toBe(true);
}
const gcExec = (page: Page, cmd: string, params: unknown) => page.evaluate(([c, p]) => {
  const w = (document.querySelector('iframe[data-testid="neuron-frame"]') as HTMLIFrameElement).contentWindow as unknown as { neuron: { execute(c: string, p: unknown): Promise<unknown> } };
  return w.neuron.execute(c as string, p);
}, [cmd, params] as const);
/** A direct method of the engine's scripting handle (docInspect, uiInspect, ...). */
const gcCall = (page: Page, method: string, params: unknown) => page.evaluate(([m, p]) => {
  const w = (document.querySelector('iframe[data-testid="neuron-frame"]') as HTMLIFrameElement).contentWindow as unknown as Record<string, Record<string, (p: unknown) => Promise<unknown>>>;
  return w['neuron'][m as string](p);
}, [method, params] as const);
const edit = async (page: Page, input: string) => {
  await gcExec(page, 'cell.set', { cell: 'O1', input });
  await expect(saveState(page)).toHaveAttribute('data-state', 'Unsaved changes', { timeout: 20_000 });
};
/** The File screen is the engine's own, drawn in the frame: mouse clicks at its fixed spots. */
async function fileScreen(page: Page) {
  const box = (await page.locator(FRAME).boundingBox())!;
  const click = async (x: number, y: number) => { await page.mouse.move(box.x + x, box.y + y); await page.waitForTimeout(250); await page.mouse.click(box.x + x, box.y + y, { delay: 80 }); };
  const backstage = () => page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const i = await ((document.querySelector('iframe[data-testid="neuron-frame"]') as HTMLIFrameElement).contentWindow as any).neuron.uiInspect({});
    return (i as { backstage: string | null }).backstage;
  });
  const open = async () => { if (!(await backstage())) await click(30, 15); await expect.poll(backstage, { timeout: 10_000 }).not.toBeNull(); await page.waitForTimeout(500); };
  return { click, open };
}
/** Sheets (the saved spreadsheets) is an account-menu entry: on a computer the avatar opens it; on a phone / iPad it is the
 *  Start menu's "Account and status" button. The Start menu itself is shot first (it is the "start" of the path). */
async function openSheetsFromMenu(page: Page, shotName: string) {
  const start = page.locator('button[aria-label="Start menu"]').locator('visible=true').first();
  await start.click();
  await page.waitForTimeout(500);
  await shot(page, shotName);
  if (isTouch()) {
    await page.locator('[data-sm-account]').locator('visible=true').first().click();
  } else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.locator('button:has(.pf-avatar-status)').locator('visible=true').first().click();
  }
  await page.waitForTimeout(500);
  await page.locator('.pf-profile-pop').getByText('Sheets', { exact: true }).locator('visible=true').first().click();
}

test.beforeEach(() => { test.setTimeout(300_000); });

test.describe('neuron (real backend)', () => {
  test('Reports -> Open in sheet -> results workbook -> edit -> File tab Save + band Save -> stored -> reopen -> back', async ({ page }) => {
    test.skip(isPhone(), 'phone is view-only: no Insert results / Save (its own test below)');
    const errors = await boot(page);
    const api = await apiCtx();
    const before = (await listFiles(api)).length;

    // login lands in the app signed in (test-only auth); Reports is the origin screen
    await page.goto('/reports');
    await expect(tid(page, 'open-in-sheet')).toBeVisible({ timeout: 90_000 });
    await dismissHint(page);
    await expectLayout(page, 'reports');
    await shot(page, '1-reports-open-in-sheet');
    const origin = routeOf(page.url());

    // Open in sheet -> the Insert results card (the band already carries the lab)
    await tid(page, 'open-in-sheet').click();
    await expect(tid(page, 'neuron-insert-card')).toBeVisible({ timeout: 30_000 });
    expect(routeOf(page.url())).toMatch(/^\/sheet/);
    await tid(page, 'neuron-insert-card').locator('pf-select').first().click();
    for (const t of ['Fasting Glucose (MW)', 'Serum Creatinine (MW)']) await page.getByRole('option', { name: t, exact: true }).locator('visible=true').first().click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await shot(page, '2-insert-card');

    // the real server builds the workbook (GET /api/office/results-workbook)
    const resultsReq = page.waitForResponse(r => r.url().includes('/api/office/results-workbook'), { timeout: 60_000 });
    await tid(page, 'neuron-insert-go').click();
    const resp = await resultsReq;
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toContain('spreadsheetml');
    const rowCount = Number(resp.headers()['x-row-count']);
    expect(rowCount, 'two tests x eight masked patients').toBeGreaterThanOrEqual(16);
    const wb = await resp.body();
    expect(wb.subarray(0, 2).toString('latin1')).toBe('PK');
    await expect(tid(page, 'neuron-name')).toContainText('.xlsx', { timeout: 30_000 });
    await needGrid(page);

    // the band says whose lab this is, with its logo
    const band = page.locator('pf-hero-band').locator('visible=true').first();
    await expect(band).toContainText('Micro World');
    await expect(band.locator('img[src^="data:image/svg"]').first()).toBeVisible();
    await expect(band).not.toContainText(/neuron/i);

    // no column cuts its text. (1) the server's own <cols> (what Excel would show) ...
    const server = sheetColumns(wb);
    expect(server.widths.size).toBeGreaterThanOrEqual(14);
    for (const [c, longest] of server.longest) expect(server.widths.get(c) ?? 0, `server column ${c + 1}: ${longest} chars`).toBeGreaterThanOrEqual(longest);
    // (2) ... and the sheet as the engine holds it after its own fit (saved out through the engine, nothing stored)
    await page.waitForTimeout(2500);
    const bytesOut = Buffer.from(((await gcExec(page, 'file.saveBytes', { format: 'xlsx' })) as { base64: string }).base64, 'base64');
    const fitted = sheetColumns(bytesOut);
    for (const [c, longest] of fitted.longest) expect(fitted.widths.get(c) ?? 0, `engine column ${c + 1}: ${longest} chars`).toBeGreaterThanOrEqual(longest * 0.9);
    fs.writeFileSync(`${out()}/column-widths.json`, JSON.stringify({ serverWidths: [...server.widths], engineWidths: [...fitted.widths], longest: [...fitted.longest] }));
    await expect(saveState(page)).toHaveAttribute('data-state', 'Unsaved changes');
    await shot(page, '3-sheet-results-band-columns');

    // edit a cell (the app's own command) -> Unsaved changes
    await edit(page, 'Checked by Lakshmi');

    // File tab -> Save: a workbook with no file of its own goes to Save As; its Download button stores it (POST)
    const fs_ = await fileScreen(page);
    await fs_.open();
    await shot(page, '4-file-tab-lab-templates');
    await fs_.click(64, 246);
    await page.waitForTimeout(500);
    const created = page.waitForResponse(r => r.url().endsWith('/api/office/files') && r.request().method() === 'POST', { timeout: 60_000 });
    await fs_.click(288, 195);
    const createdResp = await created;
    expect(createdResp.status()).toBe(201);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 30_000 });
    const files1 = await listFiles(api);
    expect(files1.length).toBe(before + 1);
    const stored = (await createdResp.json()).data as FileDto;
    expect(files1.map(f => f.id)).toContain(stored.id);
    expect(stored.version).toBe(1);
    const c1 = await content(api, stored.id);
    expect(c1.etag).toBe('"1"');
    expect(c1.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    await shot(page, '5-saved-via-file-tab');

    // edit again -> the BAND Save (PUT with If-Match "1") -> version 2
    await edit(page, 'Checked twice');
    const put = page.waitForResponse(r => r.url().includes(`/api/office/files/${stored.id}/content`) && r.request().method() === 'PUT', { timeout: 60_000 });
    await tid(page, 'neuron-save').click();
    const putResp = await put;
    expect(putResp.status()).toBe(200);
    expect(putResp.request().headers()['if-match']).toBe('"1"');
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 30_000 });
    const c2 = await content(api, stored.id);
    expect(c2.etag).toBe('"2"');
    expect(c2.bytes.equals(c1.bytes)).toBe(false);
    expect((await listFiles(api)).find(f => f.id === stored.id)!.version).toBe(2);

    // edit again -> File tab Save on a stored file -> version 3
    await edit(page, 'Checked three times');
    await fs_.open();
    const put3 = page.waitForResponse(r => r.url().includes(`/api/office/files/${stored.id}/content`) && r.request().method() === 'PUT', { timeout: 60_000 });
    await fs_.click(64, 246);
    await page.waitForTimeout(500);
    await fs_.click(288, 195);   // the engine's Save screen offers the workbook as a download: it lands on our page
    expect((await put3).status()).toBe(200);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 30_000 });
    expect((await content(api, stored.id)).etag).toBe('"3"');

    // back chevron: from a screen-opened sheet it returns to the screen that opened it
    await backChevron(page).click();
    await expect.poll(() => routeOf(page.url()), { timeout: 30_000 }).toBe(origin);
    await expect(tid(page, 'open-in-sheet')).toBeVisible({ timeout: 30_000 });
    await shot(page, '6-back-on-reports');

    // reopen from the saved-sheets list under the start menu
    await openSheetsFromMenu(page, '7-start-menu');
    await expect(tid(page, 'neuron-files')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(stored.name, { exact: true }).locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
    await shot(page, '8-saved-sheets-list');
    await page.getByText(stored.name, { exact: true }).locator('visible=true').first().click();
    await needGrid(page);
    await expect(tid(page, 'neuron-name')).toContainText(stored.name);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved');
    // the saved edit is really in the stored file (read it back from the engine)
    const cell = await gcExec(page, 'cell.get', { cell: 'O1' }).catch(() => null);
    fs.writeFileSync(`${out()}/reopened-cell.json`, JSON.stringify(cell));
    await shot(page, '9-reopened-from-list');

    // back chevron from the list-opened sheet returns to the Sheets list
    await backChevron(page).click();
    await expect(tid(page, 'neuron-files')).toBeVisible({ timeout: 30_000 });
    await shot(page, '10-back-on-list');
    expect(errors, 'no page errors').toEqual([]);
  });

  test('two tabs edit the same file: the second save gets the 409 choice and nothing is overwritten', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only');
    await boot(page);
    const api = await apiCtx();
    // a file of our own, made through the API
    const up = await api.post('/api/office/files', {
      multipart: { name: 'Two tabs.xlsx', kind: 'sheet', file: { name: 'Two tabs.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await (await api.get('/api/office/results-workbook?testIds=' + STACK.tests[0].id + '&from=' + new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10) + '&to=' + new Date().toISOString().slice(0, 10))).body()) } },
    });
    expect(up.status()).toBe(201);
    const id = (await up.json()).data.id as string;

    const open = async (p: Page) => {
      await p.goto('/sheet');
      await expect(tid(p, 'neuron-files')).toBeVisible({ timeout: 90_000 });
      await p.getByText('Two tabs.xlsx', { exact: true }).locator('visible=true').first().click();
      await needGrid(p);
    };
    await open(page);
    const tab2 = await context.newPage();
    await boot(tab2);
    await open(tab2);

    // tab 1 saves first
    await edit(page, 'tab one');
    await tid(page, 'neuron-save').click();
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 30_000 });
    const afterOne = await content(api, id);
    expect(afterOne.etag).toBe('"2"');

    // tab 2 (still on version 1) saves: 409
    await edit(tab2, 'tab two');
    const put = tab2.waitForResponse(r => r.url().includes(`/api/office/files/${id}/content`) && r.request().method() === 'PUT', { timeout: 60_000 });
    await tid(tab2, 'neuron-save').click();
    expect((await put).status()).toBe(409);
    const d = dlg(tab2);
    await expect(d).toContainText('Someone else saved this file', { timeout: 30_000 });
    await expect(d.getByRole('button', { name: 'Reload their version' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Save mine as a copy' })).toBeVisible();
    await shot(tab2, '11-conflict-409');
    // tab 1's version is untouched on the server
    const still = await content(api, id);
    expect(still.etag).toBe('"2"');
    expect(still.bytes.equals(afterOne.bytes)).toBe(true);
    // Save mine as a copy -> a NEW file, the original stays
    await d.getByRole('button', { name: 'Save mine as a copy' }).click();
    await expect(saveState(tab2)).toHaveAttribute('data-state', 'Saved', { timeout: 30_000 });
    const names = (await listFiles(api)).map(f => f.name);
    expect(names).toContain('Two tabs (copy).xlsx');
    expect((await content(api, id)).etag).toBe('"2"');
  });

  test('phone: Sheets from the start menu lists the saved files, opens one view-only, back returns to the list', async ({ page }) => {
    test.skip(!isPhone(), 'phone only');
    const errors = await boot(page);
    const api = await apiCtx();
    const files = await listFiles(api);
    expect(files.length, 'the desktop run stored files').toBeGreaterThan(0);
    await page.goto('/reports');
    await expect(page.locator('pf-hero-band').locator('visible=true').first()).toBeVisible({ timeout: 90_000 });
    await dismissHint(page);
    await shot(page, '1-reports-phone');
    await openSheetsFromMenu(page, '2-start-menu-phone');
    await expect(tid(page, 'neuron-files')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(files[0].name, { exact: true }).locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
    const band = page.locator('pf-hero-band').locator('visible=true').first();
    await expect(band).toContainText('Micro World');
    await expect(tid(page, 'neuron-new'), 'phone: no New sheet').toHaveCount(0);
    await shot(page, '3-saved-sheets-list-phone');
    await page.getByText(files[0].name, { exact: true }).locator('visible=true').first().click();
    await needGrid(page);
    await expect(tid(page, 'neuron-save'), 'phone: view only').toHaveCount(0);
    await page.waitForTimeout(1500);
    await shot(page, '4-sheet-view-only-phone');
    await backChevron(page).click();
    await expect(tid(page, 'neuron-files')).toBeVisible({ timeout: 30_000 });
    await shot(page, '5-back-on-list-phone');
    expect(isTouch()).toBe(true);
    expect(errors, 'no page errors').toEqual([]);
  });
});
