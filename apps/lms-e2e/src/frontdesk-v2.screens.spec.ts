import type { Page } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, shotsDir, expectLayout, expectFitsWidth, formFactor, isPhone, isDesktopWeb, projectName } from './support/form-factor';
import { deskTab, deskAllStatuses } from './support/frontdesk';

/**
 * Frontdesk redesign (owner-approved 2026-11-19) at every form factor — API mocked, demo data only.
 *  - two-panel frame, no page scroll (1440 · 1720 · iPad 1180×820 touch · phone 390);
 *  - the shared splitter: drag → the width survives a reload;
 *  - the FLOW GRID (≥1024px): full names (never cut), opaque dark header while the rows scroll;
 *  - the Services shelf: a lab-only user sees exactly today's bar; a Lab + OPD user sees "Services" and a pick
 *    filters BOTH panels.
 * Screenshots (light + dark) land in SHOTS_DIR/<project>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/frontdesk-v2');
let OUT = OUT_BASE;

const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-fd', authId: 'sub-fd', first: 'Kavya', last: 'Desk' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;

const now = new Date();
const iso = (d: Date) => d.toISOString();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const dayOf = (d: Date) => iso(d).slice(0, 10);
const LONG = 'Ms. Meenakshi Sundareswaran Ramanathan Iyer';
/** Later today, never past midnight (fd-chart: the appointments must stay in Today whatever the clock says). */
const soon = (m: number) => { const eod = new Date(now); eod.setHours(23, 58, 0, 0); return new Date(Math.min(now.getTime() + m * 60000, Math.max(now.getTime() + 60000, eod.getTime()))); };

const pat = (n: number, name: string, sex = 'Female', age = 34) => ({ id: `p${n}`, displayName: name, firstName: name.split(' ')[1] ?? name, sex, gender: sex[0], age, mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const tst = (id: string, status = 'pending') => ({ id, subOrderId: 'x', testId: 'y', name: 'Glucose', status, test: { name: 'Glucose' } });
const smp = (id: string, orderId: string, status: string) => ({
  id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, departmentId: 'd1', department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
  collectedAt: status === 'pending' ? null : iso(minsAgo(30)), createdAt: iso(minsAgo(60)), tests: [tst(`${id}-t`, status === 'received' ? 'validated' : 'pending')],
});
const ord = (n: number, name: string, status: string, tubes: string[], o: { mins?: number; stage?: number; module?: string; doctor?: string; priority?: string } = {}) => {
  const created = minsAgo(o.mins ?? 90);
  const id = `o${n}`;
  return {
    id, orderNumber: `${(o.module ?? 'lab').toUpperCase()}-2611-0000${n}`, dailyNo: n, dailyNoDay: dayOf(created), patientId: `p${n}`, branchId: 'b1', patient: pat(n, name),
    module: o.module ?? 'lab', refDoctorName: o.doctor, priority: o.priority ?? 'Normal', source: 'walkin', collectionType: 'walkin', status,
    createdAt: iso(created), updatedAt: iso(minsAgo(o.stage ?? 10)), samples: tubes.map((s, i) => smp(`${id}s${i}`, id, s)),
  };
};
const bill = (orderId: string, balance: number) => ({
  id: `b-${orderId}`, orderId, patientId: 'p', branchId: 'b1', type: 'lab', invoiceNumber: 'INV-1', isInterstate: false, subTotal: 600, overrideDiscount: 0, totalDiscount: 0,
  totalTaxable: 600, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0, totalPayable: 600, totalPaid: 600 - balance, balance, status: balance ? 'partial' : 'paid', createdAt: iso(now), items: [], payments: [],
});

function data(withOpd: boolean) {
  const orders = [
    ord(1, LONG, 'billed', ['pending', 'pending'], { stage: 42, doctor: 'Dr. Rao' }),
    ord(2, 'Ms. Arya Stark', 'created', ['pending'], { stage: 12 }),
    ord(3, 'Mr. Sathish Kumar', 'sample_collected', ['collected'], { stage: 22 }),
    ord(4, 'Nithin Ragav Gopalakrishnan', 'billed', ['received'], { stage: 41, doctor: 'Dr. Menon' }),
    ord(5, 'Master Sasi Kumar', 'validated', ['received'], { stage: 5 }),
    ord(6, 'Mr. Prem Kumar K', 'billed', ['pending'], { stage: 8, priority: 'Urgent' }),
    ord(7, 'Ms. Kavya Nair', 'billed', ['collected', 'pending'], { stage: 15 }),
    ord(8, 'Mr. Ravi Shankar Venkataraman', 'billed', ['received'], { stage: 18 }),
    ord(9, 'Ms. Divya Menon', 'billed', ['pending'], { stage: 3 }),
    ord(10, 'Mr. Farid Rahman', 'billed', ['pending'], { stage: 33 }),
    ord(11, 'Ms. Lakshmi Narayanan', 'billed', ['pending'], { stage: 7 }),
    ord(12, 'Mr. Joseph Antony', 'billed', ['pending'], { stage: 2 }),
  ];
  if (withOpd) orders.push(ord(13, 'Ms. Meera Iyer (OPD)', 'billed', ['pending'], { stage: 34, module: 'opd', doctor: 'Dr. Rao' }));
  const appts = [
    { id: 'a1', tenantId: TENANT.id, patientId: 'p20', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: iso(soon(60)), slotTime: '11:00', status: 'booked', consultationFee: 0, createdAt: iso(now), patient: pat(20, 'Ms. Anjali Raghunathan Subramaniam') },
    { id: 'a2', tenantId: TENANT.id, patientId: 'p21', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: iso(soon(90)), slotTime: '11:30', status: 'booked', consultationFee: 0, createdAt: iso(now), patient: pat(21, 'Mr. Gopal Krishnan') },
  ];
  return { orders, bills: [bill('o4', 450), bill('o1', 0)], appts };
}

let S = { opd: false, ...data(false) };

async function backend(page: Page, opd: boolean) {
  S = { opd, ...data(opd) };
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, d: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: d }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (p === '/api/auth/me') return route.fulfill(ok(origin, {
      id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demo.test',
      tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Receptionist'], permissions: ['*'],
      branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false, opdEntitled: S.opd,
    }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/orders/today') return route.fulfill(ok(origin, S.orders));
    if (p === '/api/orders/range') return route.fulfill(ok(origin, S.orders));
    if (p === '/api/appointments/today') return route.fulfill(ok(origin, S.appts));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: S.bills.filter(b => b.balance > 0), refundsOwed: [] }));
    const m = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (m) return route.fulfill(ok(origin, S.orders.find(x => x.id === m[1]) ?? {}));
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

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => {
    const r = document.documentElement;
    r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light');
  }, dark);
  await page.waitForTimeout(400);
}
const wide = () => !isPhone() && (page_w ?? 0) >= 1024;
let page_w: number | undefined;
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true');

async function openDesk(page: Page) {
  await page.goto('/frontdesk');
  await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
  page_w = page.viewportSize()?.width;
  await theme(page, false);
  await deskAllStatuses(page);
  if (wide()) await expect(vis(page, '.pf-fd-flow .ag-row').first()).toBeVisible({ timeout: 30_000 });
  else await expect(page.getByText(LONG).locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
}

/** No page scroll: only the cards' bodies (and the grid) scroll. */
async function expectNoPageScroll(page: Page, tag: string) {
  const o = await page.evaluate(() => {
    const se = document.scrollingElement as HTMLElement;
    return { v: se.scrollHeight - se.clientHeight, h: se.scrollWidth - se.clientWidth };
  });
  expect(o.v, `${tag}: page scrolls vertically at ${projectName()}`).toBeLessThanOrEqual(1);
  expect(o.h, `${tag}: page scrolls sideways at ${projectName()}`).toBeLessThanOrEqual(1);
}

async function shots(page: Page, name: string) {
  await theme(page, false);
  await page.screenshot({ path: `${OUT}/${name}--light.png` });
  await theme(page, true);
  await page.screenshot({ path: `${OUT}/${name}--dark.png` });
  await theme(page, false);
}

test.describe('frontdesk v2 — lab-only tenant', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(150_000); OUT = shotsDir(OUT_BASE); await backend(page, false); });

  test('two-panel frame, no page scroll, flow grid ≥1024px (phone / tablet portrait keep their list); exactly today\'s bar', async ({ page }) => {
    await openDesk(page);
    await expectLayout(page, 'frontdesk v2');
    await expectNoPageScroll(page, 'frontdesk');
    // A lab-only user: ONE service → no Services shelf, ever.
    await expect(page.locator('[data-testid="services-shelf"]')).toHaveCount(0);
    if (wide()) {
      await expect(vis(page, 'pf-pane-splitter[role="separator"]')).toHaveCount(1);
      const head = await page.locator('.pf-fd-flow .ag-header-cell-text').allTextContents();
      const heads = head.map(t => t.trim()).filter(Boolean);
      expect(heads).toEqual(expect.arrayContaining(['Token', 'Patient', 'Payment', 'Next']));
      // fd-chart: narrow grids (iPad) shorten "Where now" / "Waiting" so no header label is ever cut.
      expect(heads.some(h => /^Where( now)?$/.test(h)) && heads.some(h => /^Wait(ing)?$/.test(h))).toBe(true);
      // Card head: icon tile + WORK, the status pill with its dots, "Today" + the More filters icon.
      await expect(vis(page, '.pf-work-hdr__title .pf-card__label')).toHaveText(/work/i);
      await expect(vis(page, '.pf-work-hdr__range')).toHaveText('Today');
      // Next = ONE contextual button + ⋯ (44px hit areas on touch).
      const next = vis(page, '.pf-fd-flow .fd-cell-next__btn').first();
      await expect(next).toBeVisible();
      if (formFactor() === 'tablet') {
        const b = (await next.boundingBox())!;
        expect(b.height, 'touch: Next ≥ 44px').toBeGreaterThanOrEqual(44);
        const m = (await vis(page, '.pf-fd-flow .fd-cell-next__more').first().boundingBox())!;
        expect(Math.min(m.width, m.height), 'touch: ⋯ ≥ 44px').toBeGreaterThanOrEqual(44);
      }
    } else {
      await expect(vis(page, 'pf-pane-splitter')).toHaveCount(0);
      await expect(vis(page, '.pf-fd-flow')).toHaveCount(0);
      await expect(vis(page, '.pf-work-find__filter')).toHaveCount(1);
    }
    await shots(page, '01-frontdesk');
  });

  test('names are never truncated (grid and list), the late wait and the due read rose', async ({ page }) => {
    await openDesk(page);
    const name = page.getByText(LONG).locator('visible=true').first();
    await expect(name).toBeVisible();
    const cut = await name.evaluate(e => {
      const cs = getComputedStyle(e);
      return { ellipsis: cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible', clipped: e.scrollWidth > e.clientWidth + 1, nowrap: cs.whiteSpace === 'nowrap' };
    });
    expect(cut.clipped, 'the full name fits (wraps)').toBe(false);
    expect(cut.ellipsis, 'no ellipsis').toBe(false);
    if (wide()) {
      expect(cut.nowrap).toBe(false);
      await expect(vis(page, '.fd-flow__wait--late').first()).toBeVisible();
      await expect(vis(page, '.fd-flow__pay--due').first()).toContainText('due');
    }
  });

  test('the splitter: drag resizes the side card, the width survives a reload, Home resets', async ({ page }) => {
    await openDesk(page);
    if (!wide()) {
      test.info().annotations.push({ type: 'form-factor', description: 'stacked layout: no splitter' });
      await expect(vis(page, 'pf-pane-splitter')).toHaveCount(0);
      return;
    }
    const side = page.locator('.pf-appt-split > .pf-appt-split__pane:not(.pf-appt-split__pane--work)');
    const sep = vis(page, 'pf-pane-splitter');
    const w0 = (await side.boundingBox())!.width;
    const s = (await sep.boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2 + 40, s.y + s.height / 2, { steps: 4 });
    await page.mouse.move(s.x + s.width / 2 + 90, s.y + s.height / 2, { steps: 4 });
    await page.mouse.up();
    const w1 = (await side.boundingBox())!.width;
    expect(w1 - w0, 'dragged ~90px wider').toBeGreaterThan(70);
    expect(Number(await sep.getAttribute('aria-valuenow'))).toBeCloseTo(w1, -1);
    const saved = await page.evaluate(k => localStorage.getItem(k), `pf-lms.frontdesk.side-w.${ME.id}`);
    expect(Number(saved)).toBeCloseTo(w1, -1);
    await page.reload();
    await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
    await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBeGreaterThan(Math.round(w1) - 3);
    expect(Math.round((await side.boundingBox())!.width)).toBeLessThan(Math.round(w1) + 3);
    await expectNoPageScroll(page, 'after drag');
    await shots(page, '02-splitter-wider');
    // Keyboard: focus + Home = back to the default width.
    await sep.focus();
    await page.keyboard.press('Home');
    await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBeLessThan(Math.round(w0) + 3);
    expect(await page.evaluate(k => localStorage.getItem(k), `pf-lms.frontdesk.side-w.${ME.id}`)).toBeNull();
  });

  test('dark: the grid header stays opaque while the rows scroll under it', async ({ page }) => {
    await openDesk(page);
    if (!wide()) { test.info().annotations.push({ type: 'form-factor', description: 'no grid below 1024px' }); return; }
    await theme(page, true);
    // Scroll the grid's rows under its header (a wheel over the rows).
    const r = (await vis(page, '.pf-fd-flow .ag-row').nth(1).boundingBox())!;
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(400);
    // The header is its own layer: after the scroll no row paints under it, and what shows behind its labels is
    // the grid's own (theme) surface — never a see-through strip with rows behind it.
    const probe = await page.locator('.pf-fd-flow .ag-header').first().evaluate(h => {
      const r = h.getBoundingClientRect();
      // The topmost thing under the header's middle is the header itself, never a scrolled row.
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const rowUnder = !top?.closest('.ag-header') || !!top?.closest('.ag-row');
      // The first painted layer behind the header cells, walking up to the grid root.
      let bg = 'rgba(0, 0, 0, 0)';
      for (let e: HTMLElement | null = h.querySelector('.ag-header-cell') as HTMLElement; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) { bg = c; break; }
        if (e.classList.contains('ag-root-wrapper')) break;
      }
      return { rowUnder, bg };
    });
    expect(probe.rowUnder, 'no grid row under the header after scrolling').toBe(false);
    const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(probe.bg)?.[1];
    test.info().annotations.push({ type: 'header-bg', description: probe.bg });
    expect(alpha === undefined ? 1 : Number(alpha), `header surface ${probe.bg}`).toBe(1);
    await page.screenshot({ path: `${OUT}/03-grid-scrolled--dark.png` });
    await theme(page, false);
  });

  test('More filters: only with dues, then Clear', async ({ page }) => {
    await openDesk(page);
    const btn = wide() ? vis(page, '.pf-work-hdr__date .pf-hdr-filter__btn') : vis(page, '.pf-work-find__filter');
    await btn.first().click();
    const dlg = vis(page, '[role="dialog"][aria-label="More filters"]');
    await expect(dlg).toBeVisible();
    await expectFitsWidth(page, '[role="dialog"][aria-label="More filters"]', 'More filters');
    await expect(page.locator('select, datalist')).toHaveCount(0);
    await shots(page, '04-more-filters');
    await dlg.locator('[data-filter="dues"]').click();
    await expect(page.getByText('Nithin Ragav Gopalakrishnan').locator('visible=true').first()).toBeVisible();
    await expect(page.getByText(LONG).locator('visible=true')).toHaveCount(0);
    await dlg.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.getByText(LONG).locator('visible=true').first()).toBeVisible();
  });
});

test.describe('frontdesk v2 — Lab + OPD user (Services shelf)', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(150_000); OUT = shotsDir(OUT_BASE); await backend(page, true); });

  test('the shelf shows "Services" with All · Lab · OPD; a pick filters BOTH panels and is remembered', async ({ page }) => {
    await openDesk(page);
    const shelf = page.locator('[data-testid="services-shelf"]');
    if (isPhone()) {
      // Phones never show a bottom-bar shelf (drafts neither).
      await expect(shelf.locator('visible=true')).toHaveCount(0);
      return;
    }
    await expect(shelf).toBeVisible();
    const chip = (id: string) => shelf.locator(`[role="radio"][data-service="${id}"]`);
    // A tight bar folds chips behind "+N" (the Drafts shelf's measured fit): pick there when the chip isn't inline.
    const pick = async (id: string) => {
      if (await chip(id).isVisible()) { await chip(id).click(); return; }
      await shelf.locator('.pf-draftshelf__more').click();
      await page.locator(`.pf-am-panel [data-action="${id}"]`).click();
    };
    const selected = async (id: string) => {
      const saved = await page.evaluate(k => localStorage.getItem(k), `pf-lms.frontdesk.service.${ME.id}`);
      if (await chip(id).isVisible()) return (await chip(id).getAttribute('aria-current')) === 'true';
      return (saved ?? 'all') === id && (await shelf.locator('.pf-draftshelf__more').getAttribute('data-current')) === 'true';
    };
    // "Services" leads: the quiet label with inline chips, or — on a bar too busy for one chip — the collapsed
    // "Services N" chip (the Drafts shelf's own rule).
    await expect(shelf).toContainText('Services');
    await expect.poll(() => selected('all')).toBe(true);
    if (await chip('all').isVisible()) expect((await chip('all').textContent())?.replace(/\s+/g, '')).toMatch(/^All\d+$/);
    if (await chip('opd').isVisible()) {
      await expect(chip('opd').locator('.pf-svcshelf__late'), 'the OPD row waits 34m: a rose dot').toHaveCount(1);
    }
    await shots(page, '05-services-all');

    await pick('opd');
    await expect.poll(() => selected('opd')).toBe(true);
    await expect(page.getByText('Ms. Meera Iyer (OPD)').locator('visible=true').first()).toBeVisible();
    await expect(page.getByText(LONG).locator('visible=true')).toHaveCount(0);
    // The left panel (Lab appointments) empties too.
    await expect(page.getByText('Ms. Anjali Raghunathan Subramaniam').locator('visible=true')).toHaveCount(0);
    await expectNoPageScroll(page, 'OPD only');
    await shots(page, '06-services-opd');

    await page.reload();
    await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
    await expect.poll(() => selected('opd')).toBe(true);
    await deskAllStatuses(page);
    await pick('lab');
    await expect(page.getByText(LONG).locator('visible=true').first()).toBeVisible();
    await expect(page.getByText('Ms. Meera Iyer (OPD)').locator('visible=true')).toHaveCount(0);
    // The appointments card sits beside the list at ≥1024px (stacked layouts keep it collapsed behind its header).
    // (2+ services: the side card opens on "Who is where" — fd-chart — so switch it to Appointments first.)
    if (wide()) {
      const apptTab = page.locator('.pf-appt-split pf-segmented.pf-tabs [role="radio"][data-value="appt"]').locator('visible=true');
      const folded = page.locator('.pf-appt-split pf-segmented.pf-tabs [data-seg-compact]').locator('visible=true');
      if (await apptTab.count()) await apptTab.click();
      else if (await folded.count()) {
        await folded.click();
        await page.getByRole('menuitemradio', { name: /^Appointments/ }).locator('visible=true').first().click();
      }
      await expect(page.getByText('Ms. Anjali Raghunathan Subramaniam').locator('visible=true').first()).toBeVisible();
    }
    await pick('all');
    await expect(page.getByText('Ms. Meera Iyer (OPD)').locator('visible=true').first()).toBeVisible();
  });
});

test.describe('frontdesk v2 — wide desktop 1720', () => {
  test.use({ viewport: { width: 1720, height: 1000 } });
  test.beforeEach(async ({ page }) => { test.setTimeout(150_000); OUT = shotsDir(OUT_BASE); await backend(page, false); });

  test('no page scroll at 1720 and every column on show', async ({ page }) => {
    test.skip(!isDesktopWeb(), 'the 1720 check runs on the desktop browser project');
    await openDesk(page);
    await expectNoPageScroll(page, '1720');
    const head = (await page.locator('.pf-fd-flow .ag-header-cell-text').allTextContents()).map(t => t.trim()).filter(Boolean);
    expect(head).toEqual(['Token', 'Patient', 'Journey', 'Where now', 'Waiting', 'Payment', 'Next']);   // fd-chart: the ring replaced Visit for + the dots
    await shots(page, '07-desktop-1720');
    await deskTab(page, 'In progress');
    await expectNoPageScroll(page, '1720 in progress');
  });
});
