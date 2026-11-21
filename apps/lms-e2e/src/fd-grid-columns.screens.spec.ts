import type { Page } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, shotsDir, isTouch, projectName } from './support/form-factor';
import { deskAllStatuses } from './support/frontdesk';

/**
 * Settings › Lab › Front desk › Work grid columns (owner mock grid-settings-v3, 2026-11-21) — API mocked, fake data only.
 * The work-grid store is mocked per test (GET / PUT /api/appointments/work-grid[/lab]) so a reload reads what was saved.
 *  - drag a column from AVAILABLE into the preview header, Save (band) → the Frontdesk grid shows it at that position;
 *  - ✕ removes it → gone from the Frontdesk; a reload keeps it; Reset to default;
 *  - staff hide: "Hide column" in the Frontdesk header menu (per person), gone when the admin switches it off;
 *  - touch drag (tablet landscape, real touch events);
 *  Desktop + tablet-landscape, light + dark screenshots in SHOTS_DIR/<project>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/grid-columns');
let OUT = OUT_BASE;

const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-admin', authId: 'sub-admin', first: 'Kavya', last: 'Admin' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;

const now = new Date();
const iso = (d: Date) => d.toISOString();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const pat = (n: number, name: string) => ({ id: `p${n}`, displayName: name, firstName: name, sex: 'Female', gender: 'F', age: 34, mrn: `AA00${n}`, phone: '+919876543210' });
const smp = (id: string, orderId: string, status: string) => ({ id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, departmentId: 'd1',
  collectedAt: status === 'pending' ? null : iso(minsAgo(30)), createdAt: iso(minsAgo(60)), tests: [] });
const ord = (n: number, name: string, status: string, tubes: string[], o: { priority?: string; doctor?: string } = {}) => ({
  id: `o${n}`, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: iso(now).slice(0, 10), patientId: `p${n}`, branchId: 'b1', patient: pat(n, name), module: 'lab',
  refDoctorName: o.doctor, priority: o.priority ?? 'Normal', source: 'walkin', collectionType: 'walkin', status, createdAt: iso(minsAgo(90)), updatedAt: iso(minsAgo(12)),
  samples: tubes.map((s, i) => smp(`o${n}s${i}`, `o${n}`, s)),
});
const ORDERS = [
  ord(1, 'Nithin Ragav Gopalakrishnan', 'billed', ['pending', 'pending'], { doctor: 'Dr. Rao', priority: 'Urgent' }),
  ord(2, 'Ms. Arya Stark', 'created', ['pending']),
  ord(3, 'Mr. Sathish Kumar', 'sample_collected', ['collected'], { doctor: 'Dr. Menon' }),
];

async function backend(page: Page, store: { grid: Record<string, unknown>; puts: number }) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, d: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: d }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (p === '/api/auth/me') return route.fulfill(ok(origin, {
      id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'admin@demo.test',
      tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Admin'], permissions: ['*'],
      branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false, opdEntitled: false,
    }));
    if (p === '/api/appointments/work-grid') return route.fulfill(ok(origin, store.grid));
    const put = /^\/api\/appointments\/work-grid\/([a-z]+)$/.exec(p);
    if (put && req.method() === 'PUT') {
      store.grid = { ...store.grid, [put[1]]: req.postDataJSON() };
      store.puts++;
      return route.fulfill(ok(origin, store.grid));
    }
    if (p === '/api/appointments/config') return route.fulfill(ok(origin, { branchId: 'b1', slotMinutes: 30, open24h: true, weeklyScheduleJson: null, maxConcurrentSlots: 1, queueMode: 'token_queue',
      queueOptions: { appointmentGraceMinutes: 15, noShowThresholdMinutes: 30, avgCollectionMinutes: 5, waitWeight: 1, baseAppointment: 500, baseWalkin: 100, baseFollowup: 300, urgentOverrideScore: 9999, latePenalty: 200 } }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/orders/today' || p === '/api/orders/range') return route.fulfill(ok(origin, ORDERS));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: [], refundsOwed: [] }));
    const m = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (m) return route.fulfill(ok(origin, ORDERS.find(x => x.id === m[1]) ?? {}));
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86400, user: { id: ME.authId, aud: 'authenticated', email: 'admin@demo.test' } }) });
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

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => {
    const r = document.documentElement;
    r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light');
  }, dark);
  await page.waitForTimeout(400);
}
async function shots(page: Page, name: string) {
  await theme(page, false);
  await page.screenshot({ path: `${OUT}/${name}--light.png` });
  await theme(page, true);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${OUT}/${name}--dark.png` });
  await theme(page, false);
}

const PREVIEW = '[data-testid="fdgc-preview"]';
const bandSave = (page: Page) => page.locator('[data-testid="band-save"] .pf-ssv__save').locator('visible=true').first();

async function openSettings(page: Page) {
  await page.goto('/admin/lab/front-desk?tab=columns');
  await expect(page.locator(`${PREVIEW} .ag-header-cell[col-id="patient"]`)).toBeVisible({ timeout: 60_000 });
  // Hint row at the top: palette + preview header in view together (tablets stack them).
  await page.locator('.fdgc__split').evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
}
async function openDesk(page: Page) {
  await page.goto('/frontdesk');
  await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
  await deskAllStatuses(page);
  await expect(page.locator('pf-fd-work-view .ag-row').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
}
/** AG column ids left → right (visible header cells only). */
async function headOrder(page: Page, scope: string): Promise<string[]> {
  return page.locator(`${scope} .ag-header-cell[col-id]`).evaluateAll(els => els
    .map(e => ({ id: e.getAttribute('col-id') ?? '', x: e.getBoundingClientRect().left, w: e.getBoundingClientRect().width }))
    .filter(c => c.w > 0 && c.id !== 'sel').sort((a, b) => a.x - b.x).map(c => c.id));
}
const DESK = 'pf-fd-work-view';
/** The preview shows EVERY column inside its box (scaled to fit) — nothing clipped, no sideways scroll. */
async function expectPreviewFits(page: Page, tag: string) {
  await page.waitForTimeout(300);
  const r = await page.evaluate((sel) => {
    const box = document.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
    const cells = Array.from(document.querySelectorAll<HTMLElement>(`${sel} .ag-header-cell[col-id]`)).filter(c => c.getBoundingClientRect().width > 0);
    return { n: cells.length, out: cells.filter(c => { const b = c.getBoundingClientRect(); return b.right > box.right + 1 || b.left < box.left - 1; }).map(c => c.getAttribute('col-id')) };
  }, PREVIEW);
  expect(r.n, `${tag}: header cells`).toBeGreaterThan(5);
  expect(r.out, `${tag}: preview columns clipped at ${projectName()}`).toEqual([]);
}
/** The preview's column list (catalogue ids) as the page holds it. */
const previewOrder = (page: Page) => page.locator('.fdgc[data-fd-order]').getAttribute('data-fd-order').then(v => (v ?? '').split(','));
const FD_OF: Record<string, string> = { wait: 'waiting', pay: 'payment' };
/** The Frontdesk's visible columns as catalogue ids (journey + where = one). */
async function deskColumns(page: Page): Promise<string[]> {
  const ids = (await headOrder(page, DESK)).map(id => FD_OF[id] ?? id);
  return ids.filter((id, i) => ids.indexOf(id) === i);
}
/** Saved order on screen, folded from the RIGHT: the visible middle columns are a prefix of the saved ones. */
function expectFoldedPrefix(deskIn: string[], savedIn: string[]) {
  // Waiting is fixed right before Next (a narrow grid folds it into the Where cell): compare the movable middle only.
  const desk = deskIn.filter(id => id !== 'waiting');
  const saved = savedIn.filter(id => id !== 'waiting');
  if (deskIn.includes('waiting')) expect(deskIn[deskIn.length - 2]).toBe('waiting');
  expect(desk.slice(0, 2)).toEqual(['token', 'patient']);
  expect(desk[desk.length - 1]).toBe('next');
  const mid = desk.slice(2, -1);
  expect(mid.length).toBeGreaterThan(0);
  expect(mid).toEqual(saved.slice(2, 2 + mid.length));
}

/** Mouse drag with intermediate moves (pointer events). */
async function mouseDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
  await page.waitForTimeout(150);
  await page.mouse.up();
}
/** A real finger drag (Chromium: CDP touch events → pointerType "touch"). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) });
  for (let i = 1; i <= 14; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14) });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
const centre = async (page: Page, sel: string) => {
  // hover() scrolls it into view and checks nothing covers it (sticky band, tips).
  await page.locator(sel).first().hover({ trial: true });
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** A point just left of a header cell's centre (inserts BEFORE that column). */
const beforeHead = async (page: Page, colId: string) => {
  const b = (await page.locator(`${PREVIEW} .ag-header-cell[col-id="${colId}"]`).boundingBox())!;
  return { x: b.x + Math.min(12, b.width / 4), y: b.y + b.height / 2 };
};

test.describe('Settings › Front desk › Work grid columns', () => {
  test.beforeEach(async () => {
    test.skip(!['desktop', 'tablet-landscape'].includes(projectName()), 'desktop + tablet landscape');
    test.setTimeout(240_000);
    OUT = shotsDir(OUT_BASE);
  });

  test('drag a column in, Save → the Frontdesk shows it there; remove → gone; a reload keeps it; Reset', async ({ page }) => {
    const store = { grid: {} as Record<string, unknown>, puts: 0 };
    await backend(page, store);
    await openSettings(page);
    await expect(bandSave(page)).toBeDisabled();
    await expect(page.locator('[data-testid="fdgc-reset"]').locator('visible=true').first()).toBeDisabled();
    expect(await previewOrder(page)).toEqual(['token', 'patient', 'where', 'samples', 'payment', 'waiting', 'next']);
    expect(await headOrder(page, PREVIEW)).toEqual(['token', 'patient', 'where', 'samples', 'pay', 'wait', 'next']);
    await expectPreviewFits(page, 'default');
    // Where now (ring + words) and Waiting are fixed: no ✕, no Journey column.
    await expect(page.locator(`${PREVIEW} [data-fd-remove="waiting"], ${PREVIEW} [data-fd-remove="where"]`)).toHaveCount(0);
    await expect(page.locator(`${PREVIEW} .ag-header-cell[col-id="journey"]`)).toHaveCount(0);
    // Needs data: greyed, no +.
    await expect(page.locator('[data-fd-soon="due"]')).toHaveAttribute('aria-disabled', 'true');
    await shots(page, '01-settings-default');

    // Drag "Priority" from AVAILABLE in front of Samples.
    const drag = isTouch() ? touchDrag : mouseDrag;
    await drag(page, await centre(page, '[data-fd-item="priority"]'), await beforeHead(page, 'samples'));
    await expect.poll(() => previewOrder(page)).toEqual(['token', 'patient', 'where', 'priority', 'samples', 'payment', 'waiting', 'next']);
    await expect(page.locator('[data-fd-item="priority"]')).toHaveCount(0);
    await expect(bandSave(page)).toBeEnabled();
    await expectPreviewFits(page, 'after drag-in');
    await shots(page, '02-settings-dragged-in');

    // Drag a header to move it: Samples in front of Priority.
    await drag(page, await centre(page, `${PREVIEW} .ag-header-cell[col-id="samples"] .fd-hd__label`), await beforeHead(page, 'priority'));
    await expect.poll(() => previewOrder(page)).toEqual(['token', 'patient', 'where', 'samples', 'priority', 'payment', 'waiting', 'next']);
    await shots(page, '02b-settings-header-moved');
    // Keyboard: Alt+→ on Samples puts it back after Priority.
    await page.locator(`${PREVIEW} [data-fd-head="samples"]`).focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect.poll(() => previewOrder(page)).toEqual(['token', 'patient', 'where', 'priority', 'samples', 'payment', 'waiting', 'next']);

    await bandSave(page).click();
    await expect.poll(() => store.puts).toBe(1);
    expect((store.grid['lab'] as { columns: string[] }).columns).toEqual(['token', 'patient', 'where', 'priority', 'samples', 'payment', 'waiting', 'next']);
    await expect(bandSave(page)).toBeDisabled();

    await openDesk(page);
    const saved1 = ['token', 'patient', 'where', 'priority', 'samples', 'payment', 'waiting', 'next'];
    const desk = await deskColumns(page);
    expectFoldedPrefix(desk, saved1);
    if (!isTouch()) {
      // 1440: the saved order, the right-most ones folded away (Payment rides the patient line).
      expect(desk).toContain('priority');
      await expect(page.locator(`${DESK} .ag-cell[col-id="priority"]`).getByText('Urgent').first()).toBeVisible();
    }
    await shots(page, '03-frontdesk-with-priority');

    // ✕ removes Samples (back on the settings page), Save → gone from the Frontdesk; reload persists.
    await openSettings(page);
    expect(await previewOrder(page)).toContain('priority');
    await page.locator(`${PREVIEW} [data-fd-remove="samples"]`).click({ force: true });
    await expect.poll(() => previewOrder(page)).not.toContain('samples');
    await expect(page.locator('[data-fd-item="samples"]')).toBeVisible();
    await bandSave(page).click();
    await expect.poll(() => store.puts).toBe(2);
    const saved2 = ['token', 'patient', 'where', 'priority', 'payment', 'waiting', 'next'];
    await openDesk(page);
    expect(await deskColumns(page)).not.toContain('samples');
    expectFoldedPrefix(await deskColumns(page), saved2);
    await page.reload();
    await openDesk(page);
    const after = await deskColumns(page);
    expect(after).not.toContain('samples');
    expectFoldedPrefix(after, saved2);

    // Reset to default (Save keeps it).
    await openSettings(page);
    const reset = page.locator('[data-testid="fdgc-reset"]').locator('visible=true').first();
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect.poll(() => previewOrder(page)).toEqual(['token', 'patient', 'where', 'samples', 'payment', 'waiting', 'next']);
    await expect(reset).toBeDisabled();
    await bandSave(page).click();
    await expect.poll(() => store.puts).toBe(3);
    await openDesk(page);
    const reset3 = await deskColumns(page);
    expect(reset3).not.toContain('priority');
    expectFoldedPrefix(reset3, ['token', 'patient', 'where', 'samples', 'payment', 'waiting', 'next']);
    await shots(page, '06-frontdesk-after-reset');
  });

  test('staff hide: "Hide column" in the header menu, per person; off when the admin switches it off', async ({ page }) => {
    const store = { grid: {} as Record<string, unknown>, puts: 0 };
    await backend(page, store);
    await openDesk(page);
    // Fixed columns (Token · Patient · Where now · Waiting · Next) have no menu; the first movable one does.
    await expect(page.locator(`${DESK} [data-fd-menu="where"], ${DESK} [data-fd-menu="waiting"]`)).toHaveCount(0);
    const menu = page.locator(`${DESK} [data-fd-menu]`).locator('visible=true').first();
    if (await menu.count()) {
      const hid = (await menu.getAttribute('data-fd-menu'))!;
      await menu.locator('button').click();
      await page.getByRole('menuitem', { name: /Hide column/ }).locator('visible=true').first().click();
      await expect.poll(() => deskColumns(page)).not.toContain(hid);
      await shots(page, '04-frontdesk-staff-hid-column');
      await page.reload();
      await openDesk(page);
      expect(await deskColumns(page)).not.toContain(hid);
      // Show it again from another column's menu (when another movable column is on show).
      const other = page.locator(`${DESK} [data-fd-menu]`).locator('visible=true').first();
      if (await other.count()) {
        await other.locator('button').click();
        await page.getByRole('menuitem', { name: /Show the hidden column/ }).locator('visible=true').first().click();
        await expect.poll(() => deskColumns(page)).toContain(hid);
      }
    } else {
      // This width folds every movable column away (right-most first); only the fixed ones show — nothing to hide.
      test.info().annotations.push({ type: 'form-factor', description: 'no movable column on show at this width' });
    }

    // Admin switches "Staff may hide" off → no menu.
    await openSettings(page);
    const sw = page.locator('[data-testid="fdgc-staff-hide"] [role="switch"]').first();
    await sw.scrollIntoViewIfNeeded();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(bandSave(page)).toBeEnabled();
    await shots(page, '05-settings-staff-hide-off');
    await bandSave(page).click();
    await expect.poll(() => store.puts).toBe(1);
    expect((store.grid['lab'] as { staffMayHide: boolean }).staffMayHide).toBe(false);
    await openDesk(page);
    await expect(page.locator(`${DESK} [data-fd-menu]`)).toHaveCount(0);
  });
});
