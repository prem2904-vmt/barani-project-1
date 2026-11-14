import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, browser, engine, formFactor, isDesktopApp, isPhone, isTouch, expectLayout, expectFitsWidth, shotsDir, routeOf } from './support/form-factor';
import { resetNeg, installNegBackend, go, visible } from './support/neg-backend';
import { addFile, calls, installNeuronBackend, office, resetOffice, someoneElseSaved } from './support/neuron-backend';

/**
 * The sheet editor (beta `neuron`, dev only) on EVERY form factor and browser. API mocked (support/neuron-backend.ts,
 * fake masked data); the spreadsheet engine is the REAL static build in apps/lms/public/neuron-engine (tools/fetch-neuron.sh), framed
 * same-origin. Phone = list + view-only; tablet / desktop / desktop app edit.
 *
 * Firefox in the Docker image has NO WebGL, so the engine itself reports `neuron:failed`: that project asserts the plain-words
 * failure message instead of the grid (`needGrid`). Every other project must reach a working grid.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/neuron');
const out = () => shotsDir(OUT_BASE);
const FAILED_TEXT = "This computer can't show the spreadsheet because graphics acceleration is turned off. Try Chrome or Edge, or ask your IT person to turn on hardware acceleration.";

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`).locator('visible=true').first();
const FRAME = 'iframe[data-testid="neuron-frame"]';

async function boot(page: Page, context: BrowserContext, o: { beta?: boolean; seed?: boolean; theme?: 'light' | 'dark' } = {}) {
  resetNeg();
  resetOffice(o.seed !== false);
  await installNegBackend(page, context);
  await installNeuronBackend(page, { beta: o.beta });
  if (o.theme) await page.addInitScript(t => { try { localStorage.setItem('pf-theme', t); } catch { /* blocked */ } }, o.theme);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await go(page, '/sheet');
  return errors;
}
async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(350);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) {
    await theme(page, dark);
    await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await theme(page, false);
}

const filesReady = (page: Page) => expect(tid(page, 'neuron-files')).toBeVisible({ timeout: 60_000 });
/** Wait for the engine to come up, or to say it can't. */
async function outcome(page: Page): Promise<'ready' | 'failed'> {
  await expect(page.locator(FRAME)).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(async () => (await page.locator('[data-testid="neuron-loading"]').count()) === 0, { timeout: 180_000, intervals: [500] }).toBe(true);
  return (await page.locator('[data-testid="neuron-failed"]').count()) ? 'failed' : 'ready';
}
/** True when the grid is up. On Firefox (no WebGL) asserts the plain failure message and returns false. */
async function needGrid(page: Page): Promise<boolean> {
  const o = await outcome(page);
  if (o === 'ready') {
    // "no workbook open" until the open finishes: poll the engine before any command.
    await expect.poll(() => page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { await ((document.querySelector('iframe[data-testid="neuron-frame"]') as HTMLIFrameElement).contentWindow as any).neuron.docInspect({}); return true; } catch { return false; }
    }), { timeout: 90_000, intervals: [500] }).toBe(true);
    return true;
  }
  expect(browser(), 'only Firefox (no WebGL in Docker) may fail to start the engine').toBe('firefox');
  await expect(tid(page, 'neuron-failed')).toContainText(FAILED_TEXT);
  await expect(page.locator(FRAME)).toHaveCount(1);
  return false;
}
const gc = (page: Page, method: string, params: unknown) => page.evaluate(([m, p]) => {
  const w = (document.querySelector('iframe[data-testid="neuron-frame"]') as HTMLIFrameElement).contentWindow as unknown as { neuron: { request(m: string, p: unknown): Promise<unknown> } };
  return w.neuron.request(m as string, p);
}, [method, params] as const);
const gcExec = (page: Page, cmd: string, params: unknown) => page.evaluate(([c, p]) => {
  const w = (document.querySelector('iframe[data-testid="neuron-frame"]') as HTMLIFrameElement).contentWindow as unknown as { neuron: { execute(c: string, p: unknown): Promise<unknown> } };
  return w.neuron.execute(c as string, p);
}, [cmd, params] as const);
/** The upload carried an .xlsx: its `PK` header. Playwright's WebKit shows a route NEITHER the multipart body nor its length
 *  (the part arrives empty), so on Safari only the request itself is asserted; the byte proof runs on every other engine
 *  (and the unit specs pin that the saved bytes are copied into the page's own realm, which is what Safari needs). */
function expectXlsxUpload(c: { head: string | null }): void {
  if (engine() === 'webkit') return;
  expect(c.head, 'the bytes are an xlsx').toBe('PK');
}
const saveState = (page: Page) => tid(page, 'neuron-savestate');
const edit = async (page: Page) => { await gcExec(page, 'cell.set', { cell: 'F1', input: 'Checked' }); await expect(saveState(page)).toHaveAttribute('data-state', 'Unsaved changes', { timeout: 20_000 }); };
const openRow = async (page: Page, name: string) => {
  await page.getByText(name, { exact: true }).locator('visible=true').first().click();
};
/** The band's back chevron (returns to the screen that opened the sheet, or to the Sheets list). */
const backChevron = (page: Page) => page.locator('button[aria-label="Go back"]').locator('visible=true').first();
const dlg = (page: Page) => page.locator('[role="dialog"]').locator('visible=true').first();

test.beforeEach(() => { test.setTimeout(240_000); });

test.describe('neuron: files view', () => {
  test('lists the stored files with the right layout', async ({ page, context }) => {
    const errors = await boot(page, context);
    await filesReady(page);
    await expect(page.getByText('Glucose results.xlsx').locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Monthly budget.xlsx').locator('visible=true').first()).toBeVisible();
    await expectLayout(page, 'neuron files');
    if (isPhone()) {
      await expect(tid(page, 'neuron-new'), 'phone: no New sheet').toHaveCount(0);
      await expect(tid(page, 'neuron-insert'), 'phone: no Insert results').toHaveCount(0);
    } else {
      await expect(tid(page, 'neuron-new')).toBeVisible();
      await expect(tid(page, 'neuron-insert')).toBeVisible();
    }
    await shot(page, 'files');
    expect(errors, 'no uncaught errors').toEqual([]);

  });

  test('empty state when there are no files', async ({ page, context }) => {
    const errors = await boot(page, context, { seed: false });
    await expect(tid(page, 'neuron-empty')).toBeVisible({ timeout: 60_000 });
    await expect(tid(page, 'neuron-empty')).toContainText('No spreadsheets yet');
    await expectLayout(page, 'neuron empty');
    await shot(page, 'files-empty');
    expect(errors).toEqual([]);
  });

  test('Rename and Delete go through the dialogs (never the browser\'s)', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only: Rename / Delete are for tablet and desktop');
    await boot(page, context);
    await filesReady(page);
    const row = page.locator('.ag-row', { hasText: 'Monthly budget.xlsx' }).locator('visible=true').first();
    await row.locator('[data-act="rename"]').click();
    const d = dlg(page);
    await expect(d).toBeVisible();
    await d.locator('input, textarea').first().fill('Budget 2026.xlsx');
    await d.getByRole('button', { name: 'Rename' }).click();
    await expect.poll(() => calls('PATCH').map(c => c.name)).toEqual(['Budget 2026.xlsx']);
    await expect(page.getByText('Budget 2026.xlsx', { exact: true }).locator('visible=true').first()).toBeVisible();

    const row2 = page.locator('.ag-row', { hasText: 'Budget 2026.xlsx' }).locator('visible=true').first();
    await row2.locator('[data-act="delete"]').click();
    await expect(dlg(page)).toContainText('Delete this file?');
    await dlg(page).getByRole('button', { name: 'Keep it' }).click();
    expect(calls('DELETE')).toHaveLength(0);
    await row2.locator('[data-act="delete"]').click();
    await dlg(page).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => calls('DELETE').length).toBe(1);
    await expect(page.getByText('Budget 2026.xlsx', { exact: true })).toHaveCount(0);
  });

  test('the files list failing says so in plain words and Try again works', async ({ page, context }) => {
    resetNeg(); resetOffice();
    await installNegBackend(page, context);
    await installNeuronBackend(page);
    let fail = true;
    await page.route(/prefrontal\.health\/api\/office\/files\?kind=sheet/, route => {
      if (route.request().method() === 'OPTIONS' || !fail) return route.fallback();
      return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': route.request().headers()['origin'] ?? '*', 'content-type': 'text/plain' }, body: '' });
    });
    await go(page, '/sheet');
    await expect(tid(page, 'neuron-files-error')).toContainText('Something went wrong on our side', { timeout: 60_000 });
    fail = false;
    await tid(page, 'neuron-files-error').getByRole('button', { name: 'Try again' }).click();
    await filesReady(page);
    await expect(page.getByText('Glucose results.xlsx').locator('visible=true').first()).toBeVisible();
  });
});

test.describe('neuron: open, edit, save', () => {
  test('opens a stored file in the framed engine; phone is view-only; edit + Save is a PUT with If-Match', async ({ page, context }) => {
    const errors = await boot(page, context);
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    await expect(tid(page, 'neuron-loading')).toBeVisible({ timeout: 20_000 }).catch(() => undefined); // may be quick when cached
    const grid = await needGrid(page);
    await expect(tid(page, 'neuron-name')).toContainText('Glucose results.xlsx');
    expect(await page.evaluate(() => (document.querySelector('iframe') as HTMLIFrameElement).src)).toMatch(/\/neuron-engine\/index\.html\?host=parent&chrome=notitlebar&author=[^&]*&theme=(light|dark|system)/);
    if (!grid) return;
    // the stored workbook is what the engine shows
    await expect.poll(async () => JSON.stringify(await gc(page, 'sheet.read', { range: 'A1:D3' })), { timeout: 60_000 }).toContain('Glucose');
    if (!isPhone()) await expect(saveState(page)).toHaveAttribute('data-state', 'Saved');
    await expectLayout(page, 'neuron sheet');
    await shot(page, 'sheet');
    if (isPhone()) {
      await expect(tid(page, 'neuron-viewonly')).toBeVisible();
      await expect(tid(page, 'neuron-save')).toHaveCount(0);
      await expect(tid(page, 'neuron-new')).toHaveCount(0);
      return;
    }
    await edit(page);
    await tid(page, 'neuron-save').click();
    await expect.poll(() => calls('PUT').length, { timeout: 30_000 }).toBe(1);
    const put = calls('PUT')[0];
    expect(put.path).toMatch(/\/api\/office\/files\/file-1\/content$/);
    expect(put.ifMatch).toBe('"3"');
    expectXlsxUpload(put);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 20_000 });
    // the next save carries the NEW version
    await gcExec(page, 'cell.set', { cell: 'F2', input: 'Again' });
    await expect(saveState(page)).toHaveAttribute('data-state', 'Unsaved changes', { timeout: 20_000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S').catch(() => undefined);
    // the keystroke goes to the page only when the page has focus; the band button is the same path
    // Ctrl/Cmd+S only reaches the page when it has focus; if no save arrived, the band button is the same path.
    await expect.poll(() => calls('PUT').length, { timeout: 4_000 }).toBeGreaterThanOrEqual(2).catch(async () => { await tid(page, 'neuron-save').click(); });
    await expect.poll(() => calls('PUT').length, { timeout: 30_000 }).toBe(2);
    expect(calls('PUT')[1].ifMatch).toBe('"4"');
    expect(errors).toEqual([]);
  });

  test('New sheet: Save is a POST, the file shows up in the list, and the name can be changed inline', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only: no New sheet');
    await boot(page, context);
    await filesReady(page);
    await tid(page, 'neuron-new').click();
    if (!(await needGrid(page))) return;
    await expect(saveState(page)).toHaveAttribute('data-state', 'Not saved yet');
    await tid(page, 'neuron-name').click();
    await tid(page, 'neuron-name-input').fill('Weekly tally');
    await page.keyboard.press('Enter');
    await expect(tid(page, 'neuron-name')).toContainText('Weekly tally.xlsx');
    await edit(page);
    await tid(page, 'neuron-save').click();
    await expect.poll(() => calls('POST').length, { timeout: 30_000 }).toBe(1);
    const post = calls('POST')[0];
    expect(post.name).toBe('Weekly tally.xlsx');
    expect(post.kind).toBe('sheet');
    expectXlsxUpload(post);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 20_000 });
    await backChevron(page).click();
    await filesReady(page);
    await expect(page.getByText('Weekly tally.xlsx', { exact: true }).locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
  });

  test('File tab: Export as PDF is a download only (nothing stored); Save as .xlsx from the app is stored', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view and copy only');
    await boot(page, context);
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    if (!(await needGrid(page))) return;
    // The app's own File tab runs these commands; the page routes what comes back by its header.
    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), gcExec(page, 'file.exportPdf', {})]);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/i);
    expect(fs.readFileSync((await pdf.path())!).subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(calls('PUT')).toHaveLength(0);
    expect(calls('POST')).toHaveLength(0);
    await edit(page);
    await gcExec(page, 'file.save', {});
    await expect.poll(() => calls('PUT').length, { timeout: 30_000 }).toBe(1);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 20_000 });
  });

  test('File tab: opens the File screen INSIDE our frame; Save, Save As, Export PDF and Export CSV all land on our page', async ({ page, context }) => {
    test.skip(isTouch(), 'the File screen is driven by mouse here; phone is view-only and the tablet layout differs');
    await boot(page, context);
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    if (!(await needGrid(page))) return;
    const box = (await page.locator(FRAME).boundingBox())!;
    const click = async (x: number, y: number) => { await page.mouse.move(box.x + x, box.y + y); await page.waitForTimeout(250); await page.mouse.click(box.x + x, box.y + y, { delay: 80 }); };
    const backstage = () => page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const i = await ((document.querySelector('iframe[data-testid="neuron-frame"]') as HTMLIFrameElement).contentWindow as any).neuron.uiInspect({});
      return (i as { backstage: string | null }).backstage;
    });
    const openFile = async () => { if (!(await backstage())) { await click(30, 15); } await expect.poll(backstage, { timeout: 10_000 }).not.toBeNull(); await page.waitForTimeout(500); };
    await edit(page);
    await openFile();
    await shot(page, 'file-tab');
    // The File screen is the app's own, inside our frame (our band and the bottom nav stay around it).
    await expect(tid(page, 'neuron-save')).toBeVisible();
    // File → Save: a workbook with no file of its own goes to the Save As screen; its Download button hands the xlsx to our page
    await click(64, 246);
    await page.waitForTimeout(500);
    await click(288, 195);
    await expect.poll(() => calls('PUT').length, { timeout: 30_000 }).toBe(1);
    // Save As → Download (.xlsx) → neuron:save (xlsx) → stored as this file
    await openFile();
    await click(64, 284);
    await page.waitForTimeout(500);
    await click(288, 195);
    await expect.poll(() => calls('PUT').length, { timeout: 30_000 }).toBe(2);
    await shot(page, 'file-saveas');
    // Export → Create PDF → neuron:save (pdf) → a download, nothing stored
    await openFile();
    await click(64, 360);
    await page.waitForTimeout(500);
    await shot(page, 'file-export');
    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), click(326, 99)]);
    expect(fs.readFileSync((await pdf.path())!).subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Export → CSV → a plain copy download
    await openFile();
    await click(64, 360);
    await page.waitForTimeout(500);
    const [csv] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), click(362, 208)]);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/i);
    expect(calls('PUT')).toHaveLength(2);
    expect(calls('POST')).toHaveLength(0);
  });

  test('the sheet fills the space between the band and the bottom nav: full-width stage, one slim band, no card', async ({ page, context }) => {
    await boot(page, context);
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    await expect(page.locator(FRAME)).toHaveCount(1);
    const vw = page.viewportSize()!.width;
    const stage = (await tid(page, 'neuron-stage').boundingBox())!;
    expect(Math.round(stage.x), 'stage starts at the left edge').toBeLessThanOrEqual(1);
    expect(Math.round(stage.width), 'stage spans the full width').toBeGreaterThanOrEqual(vw - 1);
    await expect(page.locator('.pf-card.nr-main')).toHaveCount(0);
    await expect(page.locator('.pf-hb__searchrow')).toHaveCount(0);
    await expect(page.locator('[data-testid="neuron-more"]')).toHaveCount(0);
    await expectLayout(page, 'sheet fills');
    await expect(page.locator('pf-hero-band').locator('visible=true').first()).not.toContainText(/neuron/i);
  });
});

test.describe('neuron: insert results', () => {
  test('pick tests + dates, results open in a NEW unsaved sheet named from the response', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only: Insert results is for tablet and desktop');
    await boot(page, context);
    await filesReady(page);
    await tid(page, 'neuron-insert').click();
    const card = tid(page, 'neuron-insert-card');
    await expect(card).toBeVisible();
    await expectFitsWidth(page, '[data-testid="neuron-insert-card"]', 'insert card');
    // nothing picked yet
    await tid(page, 'neuron-insert-go').click();
    await expect(tid(page, 'neuron-insert-error')).toContainText('Pick at least one test.');
    // pf-select, searchable + multiple
    await card.locator('pf-select').first().click();
    await page.getByRole('option', { name: /Glucose/ }).locator('visible=true').first().click();
    await page.getByRole('option', { name: /Blood Urea/ }).locator('visible=true').first().click();
    await page.keyboard.press('Escape');
    await shot(page, 'insert-card');
    await tid(page, 'neuron-insert-go').click();
    await expect.poll(() => calls('GET').filter(c => c.path === '/api/office/results-workbook').length, { timeout: 30_000 }).toBe(1);
    const q = calls('GET').find(c => c.path === '/api/office/results-workbook')!.query;
    expect(q).toMatch(/testIds=t-glu,t-urea|testIds=t-glu%2Ct-urea/);
    expect(q).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(q).toMatch(/to=\d{4}-\d{2}-\d{2}/);
    await expect(tid(page, 'neuron-name')).toContainText('Glucose results.xlsx', { timeout: 30_000 });
    await expect(saveState(page)).toHaveAttribute('data-state', 'Unsaved changes');
    await expect(tid(page, 'neuron-notice')).toContainText('3 rows inserted');
    expect(calls('POST'), 'nothing is stored until Save').toHaveLength(0);
    if (!(await needGrid(page))) return;
    await expect.poll(async () => JSON.stringify(await gc(page, 'sheet.read', { range: 'A1:D3' })), { timeout: 60_000 }).toContain('Glucose');
    await shot(page, 'results-sheet');
  });

  test('the server cut the rows at 5,000: the notice says so', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only');
    await boot(page, context);
    office.results = 'truncated';
    await filesReady(page);
    await tid(page, 'neuron-insert').click();
    await tid(page, 'neuron-insert-card').locator('pf-select').first().click();
    await page.getByRole('option', { name: /Glucose/ }).locator('visible=true').first().click();
    await page.keyboard.press('Escape');
    await tid(page, 'neuron-insert-go').click();
    await expect(tid(page, 'neuron-notice')).toContainText('Only the first 5,000 rows were included. Narrow the dates to get the rest.', { timeout: 30_000 });
    await shot(page, 'results-truncated');
  });

  test('a broken (non-xlsx) response opens nothing and says why; a 500 says so too', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only');
    await boot(page, context);
    await filesReady(page);
    await tid(page, 'neuron-insert').click();
    await tid(page, 'neuron-insert-card').locator('pf-select').first().click();
    await page.getByRole('option', { name: /Glucose/ }).locator('visible=true').first().click();
    await page.keyboard.press('Escape');
    office.results = 'csv';
    await tid(page, 'neuron-insert-go').click();
    await expect(tid(page, 'neuron-insert-error')).toContainText("isn't a spreadsheet", { timeout: 30_000 });
    await expect(page.locator(FRAME)).toHaveCount(0);
    expect(calls('POST')).toHaveLength(0);
    office.results = 'error';
    await tid(page, 'neuron-insert-go').click();
    await expect(tid(page, 'neuron-insert-error')).toContainText('Something went wrong on our side', { timeout: 30_000 });
    await expect(page.locator(FRAME)).toHaveCount(0);
    await shot(page, 'results-error');
  });
});

test.describe('neuron: roles and theme', () => {
  test('a role that may only read results: can insert + export, cannot create, save, rename or delete; sees the patient-names note', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only');
    resetNeg(); resetOffice();
    await installNegBackend(page, context);
    await installNeuronBackend(page);
    await page.route(/prefrontal\.health\/api\/auth\/me$/, async route => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      const origin = route.request().headers()['origin'] ?? '*';
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, data: { id: 'app-9', authId: 'sub-1', firstName: 'Ravi', fathersName: 'Viewer', displayName: 'Ravi Viewer', email: 'viewer@demolab.example', tenantId: 't-demo', tenantName: 'Demo Lab', branchId: 'b1', branchName: 'Main', roles: ['Report Viewer'], permissions: ['view_report'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false } }) });
    });
    await go(page, '/sheet');
    await filesReady(page);
    await expect(tid(page, 'neuron-new')).toHaveCount(0);
    await expect(tid(page, 'neuron-insert')).toBeVisible();
    await expect(page.locator('[data-act="rename"], [data-act="delete"]')).toHaveCount(0);
    await tid(page, 'neuron-insert').click();
    await expect(tid(page, 'neuron-patient-note')).toContainText('Patient names are hidden for your role.');
    await shot(page, 'read-only-insert');
  });

  test('the sheet is told which look to use: the frame URL carries the LMS theme', async ({ page, context }) => {
    await boot(page, context, { theme: 'dark' });
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    await expect(page.locator(FRAME)).toHaveAttribute('src', /theme=dark/);
  });
});

test.describe('neuron: opened from a screen and back', () => {
  test('Reports → Open in sheet → pick results → edit → Save → Back lands on the same screen (URL + filters kept)', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only: no Insert results / Save');
    await boot(page, context);
    await filesReady(page);
    await go(page, '/reports?q=nair');
    await expect(tid(page, 'open-in-sheet')).toBeVisible({ timeout: 60_000 });
    const before = routeOf(page.url());
    await shot(page, 'flow-1-reports');
    await tid(page, 'open-in-sheet').click();
    await expect(tid(page, 'neuron-insert-card')).toBeVisible({ timeout: 30_000 });
    expect(routeOf(page.url())).toMatch(/^\/sheet/);
    // the section it came from stays lit in the bottom nav
    await expect(page.locator('.pf-topnav-link--on, .pf-topnav-active, .pf-nav-item--on, [aria-current="page"]').locator('visible=true').first()).toBeVisible();
    await expect(page.locator('pf-hero-band').first()).not.toContainText(/neuron/i);
    await tid(page, 'neuron-insert-card').locator('pf-select').first().click();
    await page.getByRole('option', { name: /Glucose/ }).locator('visible=true').first().click();
    await page.keyboard.press('Escape');
    await shot(page, 'flow-2-insert');
    await tid(page, 'neuron-insert-go').click();
    await expect(tid(page, 'neuron-name')).toContainText('Glucose results.xlsx', { timeout: 30_000 });
    if (!(await needGrid(page))) return;
    await edit(page);
    await shot(page, 'flow-3-sheet');
    await tid(page, 'neuron-save').click();
    await expect.poll(() => calls('POST').length, { timeout: 30_000 }).toBe(1);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 20_000 });
    await backChevron(page).click();
    await expect.poll(() => routeOf(page.url()), { timeout: 30_000 }).toBe(before);
    await expect(tid(page, 'open-in-sheet')).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => new URL(location.href.replace('/#/', '/')).searchParams.get('q'))).toBe('nair');
    await shot(page, 'flow-4-back');
  });

  test('back with unsaved changes asks first; Stay keeps the sheet, Leave goes back to the screen', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only');
    await boot(page, context);
    await filesReady(page); // let the first navigation settle before the next one (WebKit interrupts it otherwise)
    await go(page, '/reports');
    await tid(page, 'open-in-sheet').click();
    await tid(page, 'neuron-insert-card').locator('pf-select').first().click();
    await page.getByRole('option', { name: /Glucose/ }).locator('visible=true').first().click();
    await page.keyboard.press('Escape');
    await tid(page, 'neuron-insert-go').click();
    if (!(await needGrid(page))) return;
    await backChevron(page).click();
    await expect(dlg(page)).toContainText('Leave without saving?');
    await dlg(page).getByRole('button', { name: 'Stay' }).click();
    expect(routeOf(page.url())).toMatch(/^\/sheet/);
    await backChevron(page).click();
    await dlg(page).getByRole('button', { name: 'Leave without saving' }).click();
    await expect.poll(() => routeOf(page.url()), { timeout: 30_000 }).toMatch(/^\/reports/);
    expect(calls('POST')).toHaveLength(0);
  });
});

test.describe('neuron: negative scenarios', () => {
  test('409 conflict: both choices are offered, nothing is overwritten; "Save mine as a copy" makes a new file', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only');
    await boot(page, context);
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    if (!(await needGrid(page))) return;
    await edit(page);
    someoneElseSaved('file-1');
    await tid(page, 'neuron-save').click();
    const d = dlg(page);
    await expect(d).toContainText('Someone else saved this file', { timeout: 30_000 });
    await expect(d.getByRole('button', { name: 'Reload their version' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Save mine as a copy' })).toBeVisible();
    await shot(page, 'conflict');
    expect(calls('PUT')).toHaveLength(1);
    expect(office.files.get('file-1')!.version, 'their version stays').toBe(4);
    await d.getByRole('button', { name: 'Save mine as a copy' }).click();
    await expect.poll(() => calls('POST').length, { timeout: 30_000 }).toBe(1);
    expect(calls('POST')[0].name).toBe('Glucose results (copy).xlsx');
    expect(calls('PUT'), 'never retried / forced').toHaveLength(1);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 20_000 });
    await expect(tid(page, 'neuron-name')).toContainText('Glucose results (copy).xlsx');
  });

  test('409 conflict: "Reload their version" loads the newer one and keeps theirs on the server', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only');
    await boot(page, context);
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    if (!(await needGrid(page))) return;
    await edit(page);
    someoneElseSaved('file-1');
    await tid(page, 'neuron-save').click();
    await page.evaluate(() => document.querySelector('iframe[data-testid="neuron-frame"]')?.setAttribute('data-old', '1'));
    await dlg(page).getByRole('button', { name: 'Reload their version' }).click();
    await expect.poll(() => calls('GET').filter(c => /file-1\/content$/.test(c.path)).length, { timeout: 30_000 }).toBe(2);
    expect(calls('PUT')).toHaveLength(1);
    expect(calls('POST')).toHaveLength(0);
    // the sheet is REPLACED by their version: wait for the new frame, not the old one
    await expect(page.locator(FRAME + ':not([data-old])')).toHaveCount(1, { timeout: 30_000 });
    if (!(await needGrid(page))) return;
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 30_000 });
    // the next save uses THEIR version (4), so it goes through
    await edit(page);
    await tid(page, 'neuron-save').click();
    await expect.poll(() => calls('PUT').length, { timeout: 30_000 }).toBe(2);
    expect(calls('PUT')[1].ifMatch).toBe('"4"');
  });

  test('a 500 on save keeps the sheet unsaved and says so; Save again works', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only');
    await boot(page, context);
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    if (!(await needGrid(page))) return;
    await edit(page);
    office.putStatus = 500;
    await tid(page, 'neuron-save').click();
    await expect(tid(page, 'neuron-notice')).toContainText("couldn't save this sheet", { timeout: 30_000 });
    await expect(tid(page, 'neuron-notice')).toContainText('Something went wrong on our side');
    await expect(saveState(page)).toHaveAttribute('data-state', 'Unsaved changes');
    await shot(page, 'save-error');
    await tid(page, 'neuron-save').click();
    await expect.poll(() => calls('PUT').length, { timeout: 30_000 }).toBe(2);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Saved', { timeout: 20_000 });
    await expect(tid(page, 'neuron-notice')).toHaveCount(0);
  });

  test('neuron:failed (the engine cannot start): plain words, a way back, no crash', async ({ page, context }) => {
    resetNeg(); resetOffice();
    await installNegBackend(page, context);
    await installNeuronBackend(page);
    // The framed page is replaced by one that reports what a computer without graphics acceleration reports.
    await page.route(/\/neuron-engine\/index\.html/, route => route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<!doctype html><title>stub</title><script>parent.postMessage({type:"neuron:failed",error:"no WebGL2 or WebGPU"},location.origin)</script>',
    }));
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/sheet');
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    await expect(tid(page, 'neuron-failed')).toContainText(FAILED_TEXT, { timeout: 30_000 });
    await expect(tid(page, 'neuron-failed')).not.toContainText(/webgl|webgpu|wasm/i);
    await expect(tid(page, 'neuron-loading')).toHaveCount(0);
    await shot(page, 'engine-failed');
    await tid(page, 'neuron-failed').getByRole('button', { name: 'Back' }).click();
    await filesReady(page);
    expect(errors).toEqual([]);
  });

  test('a message from another origin is ignored (no state change)', async ({ page, context }) => {
    resetNeg(); resetOffice();
    await installNegBackend(page, context);
    await installNeuronBackend(page);
    await page.route(/\/neuron-engine\/index\.html/, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>quiet</p>' }));
    await go(page, '/sheet');
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    await expect(tid(page, 'neuron-loading')).toBeVisible({ timeout: 30_000 });
    // from the TOP window (not the frame): ignored although it is our own origin
    await page.evaluate(() => window.postMessage({ type: 'neuron:ready' }, location.origin));
    await page.evaluate(() => window.postMessage({ type: 'neuron:failed', error: 'x' }, location.origin));
    await page.waitForTimeout(500);
    await expect(tid(page, 'neuron-loading')).toBeVisible();
    await expect(page.locator('[data-testid="neuron-failed"]')).toHaveCount(0);
  });

  test('the beta is off: a direct visit to /sheet goes home and no screen offers "Open in sheet"', async ({ page, context }) => {
    await boot(page, context, { beta: false });
    await expect.poll(() => routeOf(page.url()), { timeout: 60_000 }).not.toMatch(/^\/sheet/);
    await expect(page.locator('[data-testid="neuron-page"]')).toHaveCount(0);
    await go(page, '/reports');
    await expect(page.locator('[data-testid="pf-hero-band"], pf-hero-band').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="open-in-sheet"]')).toHaveCount(0);
    expect(calls('GET').filter(c => c.path.startsWith('/api/office/'))).toHaveLength(0);
  });

  test('the beta is on in the browser but the server says no: still hidden', async ({ page, context }) => {
    resetNeg(); resetOffice();
    await installNegBackend(page, context);
    await installNeuronBackend(page, { beta: true, serverFlag: false });
    await go(page, '/sheet');
    await expect.poll(() => routeOf(page.url()), { timeout: 60_000 }).not.toMatch(/^\/sheet/);
    await expect(page.locator('[data-testid="neuron-page"]')).toHaveCount(0);
  });

  test('beta on: the Reports screen offers "Open in sheet" (and nothing in the bottom nav)', async ({ page, context }) => {
    await boot(page, context);
    await filesReady(page); // let the first navigation settle before the next one (WebKit interrupts it otherwise)
    await go(page, '/reports');
    await expect(tid(page, 'open-in-sheet')).toBeVisible({ timeout: 60_000 });
    await expectLayout(page, 'reports with open-in-sheet');
    await expect(page.locator('.pf-topstrip-bar').getByText(/^Sheets?$/)).toHaveCount(0);
  });

  test('leaving with unsaved changes asks first (Stay keeps the sheet, Leave goes)', async ({ page, context }) => {
    test.skip(isPhone(), 'phone is view-only');
    await boot(page, context);
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    if (!(await needGrid(page))) return;
    await edit(page);
    // Close
    await backChevron(page).click();
    await expect(dlg(page)).toContainText('Leave without saving?');
    await shot(page, 'leave-guard');
    await dlg(page).getByRole('button', { name: 'Stay' }).click();
    await expect(page.locator(FRAME)).toHaveCount(1);
    await expect(saveState(page)).toHaveAttribute('data-state', 'Unsaved changes');
    // Navigating away (the lab logo goes Home) is guarded the same way (canDeactivate)
    await page.locator('a.pf-hb__home').locator('visible=true').first().click();
    await expect(dlg(page)).toContainText('Leave without saving?');
    await dlg(page).getByRole('button', { name: 'Stay' }).click();
    expect(routeOf(page.url())).toMatch(/^\/sheet/);
    await page.locator('a.pf-hb__home').locator('visible=true').first().click();
    await dlg(page).getByRole('button', { name: 'Leave without saving' }).click();
    await expect.poll(() => routeOf(page.url()), { timeout: 30_000 }).not.toMatch(/^\/sheet/);
    expect(calls('PUT')).toHaveLength(0);
  });

  test('closing the tab while unsaved raises the browser\'s own leave warning (Chromium)', async ({ page, context }) => {
    test.skip(engine() !== 'chromium', 'beforeunload dialogs are only reliable to assert in Chromium');
    test.skip(isPhone(), 'phone is view-only');
    await boot(page, context);
    await filesReady(page);
    await openRow(page, 'Glucose results.xlsx');
    if (!(await needGrid(page))) return;
    await edit(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    const seen = new Promise<string>(resolve => page.on('dialog', d => { const t = d.type(); void d.dismiss(); resolve(t); }));
    await page.close({ runBeforeUnload: true });
    expect(await Promise.race([seen, new Promise<string>(r => setTimeout(() => r('none'), 5000))])).toBe('beforeunload');
  });
});

