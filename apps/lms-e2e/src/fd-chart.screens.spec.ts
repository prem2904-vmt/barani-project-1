import type { Page } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, shotsDir, expectLayout, isPhone, isTouch, projectName } from './support/form-factor';
import { deskAllStatuses } from './support/frontdesk';

/**
 * Frontdesk side card "Who is where" (owner-approved 2026-11-20, mock fd-chart-v12) at every form factor — API
 * mocked, demo data only:
 *  - Lab + OPD at ≥1024px: tabs "Who is where | Appointments n | Home" fit the side card (never clipped), the
 *    sunburst + chips; a chip / slice pick is the ONE service filter — the grid, the bottom-bar shelf and the
 *    Appointments list (with its removable "Lab ✕" chip) follow; the overdue dot on Appointments;
 *  - lab-only: no chart, no tab — Appointments as today plus "+ New" (the existing booking flow);
 *  - phones / tablet portrait: no chart (the shelf / phone lists stay the filter); no page scroll anywhere.
 * Screenshots (light + dark) land in SHOTS_DIR/<project>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/fd-chart');
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
  if (withOpd) {
    orders.push(ord(13, 'Ms. Meera Iyer (OPD)', 'billed', ['pending'], { stage: 34, module: 'opd', doctor: 'Dr. Rao' }));
    orders.push(ord(14, 'Mr. Joseph Varghese (OPD)', 'created', ['pending'], { stage: 6, module: 'opd', doctor: 'Dr. Menon' }));
  }
  const late = minsAgo(20);
  // Later today, never past midnight (the spec must not depend on the clock).
  const eod = new Date(now); eod.setHours(23, 58, 0, 0);
  const soon = (m: number) => new Date(Math.min(now.getTime() + m * 60000, Math.max(now.getTime() + 60000, eod.getTime())));
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const appts = [
    { id: 'a0', tenantId: TENANT.id, patientId: 'p22', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: iso(late), slotTime: hhmm(late), status: 'booked', consultationFee: 0, createdAt: iso(now), patient: pat(22, 'Ms. Revathi Krishnamoorthy') },
    { id: 'a1', tenantId: TENANT.id, patientId: 'p20', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: iso(soon(60)), slotTime: hhmm(soon(60)), status: 'booked', consultationFee: 0, createdAt: iso(now), patient: pat(20, 'Ms. Anjali Raghunathan Subramaniam') },
    { id: 'a2', tenantId: TENANT.id, patientId: 'p21', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: iso(soon(90)), slotTime: hhmm(soon(90)), status: 'booked', consultationFee: 0, createdAt: iso(now), patient: pat(21, 'Mr. Gopal Krishnan') },
  ];
  return { orders, bills: [bill('o4', 450), bill('o1', 0)], appts };
}

let S = { opd: false, ...data(false) };
/** Every OPD API path the page asked for (OPD off ⇒ must stay empty). */
let opdCalls: string[] = [];
/** The OPD desk returns visits (off for the chart-load tests that count exact rows). */
let withVisits = true;
const OPD_VISITS = () => !withVisits ? [] : [
  { id: 'v1', patientId: 'p31', patientName: 'Ms. Lalitha Ramakrishnan (OPD visit)', patientMeta: '52/F · AA0131', doctorUserId: 'd1', doctorName: 'Dr. Rao', departmentName: 'General', visitNumber: 'OPD-0001', visitDate: dayOf(now), token: 1, tokenLabel: 'R-1', status: 'waiting', isFollowUp: false, charged: 500, billStatus: 'paid', hasLabOrder: false, createdAt: iso(minsAgo(48)), checkedInAt: iso(minsAgo(41)), vitalsFlagged: false },
  { id: 'v2', patientId: 'p32', patientName: 'Mr. Arun Prakash (OPD visit)', patientMeta: '33/M · AA0132', doctorUserId: 'd2', doctorName: 'Dr. Menon', departmentName: 'General', visitNumber: 'OPD-0002', visitDate: dayOf(now), token: 2, tokenLabel: 'M-2', status: 'in_consult', isFollowUp: false, charged: 500, billStatus: 'paid', hasLabOrder: false, createdAt: iso(minsAgo(20)), checkedInAt: iso(minsAgo(18)), vitalsFlagged: false },
  { id: 'v3', patientId: 'p33', patientName: 'Mr. Kannan Venkatesan', patientMeta: '60/M · AA0133', doctorUserId: 'd1', doctorName: 'Dr. Rao', departmentName: 'General', visitNumber: 'OPD-0003', visitDate: dayOf(now), token: 3, tokenLabel: 'R-3', status: 'completed', isFollowUp: false, charged: 0, billStatus: 'pending', hasLabOrder: false, createdAt: iso(minsAgo(90)), checkedInAt: iso(minsAgo(88)), vitalsFlagged: false },
];

async function backend(page: Page, opd: boolean) {
  S = { opd, ...data(opd) };
  opdCalls = [];
  withVisits = true;
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
    // OPD desk feeds (the common Frontdesk reads them only while OPD is on).
    if (p.startsWith('/api/opd/')) {
      opdCalls.push(p);
      if (p === '/api/opd/visits') return route.fulfill(ok(origin, OPD_VISITS()));
      if (p === '/api/opd/visits/payments-due') return route.fulfill(ok(origin, [{ visitId: 'v3', billId: 'b3', kind: 'consult', patientId: 'p33', patientName: 'Mr. Kannan Venkatesan', doctorUserId: 'd1', doctorName: 'Dr. Rao', tokenLabel: 'R-3', visitDate: dayOf(now), visitStatus: 'completed', lines: [], totalPayable: 500, totalPaid: 0, balance: 500, status: 'pending' }]));
      if (p === '/api/opd/visits/desk') return route.fulfill(ok(origin, { today: dayOf(now), config: { workflow: { vitals: 'desk', labTestsAtDesk: true, billing: 'before_consult' }, queue: { organise: 'per_doctor', doctorUnavailable: 'manual' } }, doctors: [], departments: [] }));
      return route.fulfill(ok(origin, []));
    }
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
  await page.waitForTimeout(1100);   // the theme switch's view transition must finish (it paints over the top layer)
  await page.screenshot({ path: `${OUT}/${name}--dark.png` });
  await theme(page, false);
}


const sideCard = (page: Page) => page.locator('.pf-appt-split > .pf-appt-split__pane:not(.pf-appt-split__pane--work)');
/** The VISITS head's icon switch (owner 2026-11-21: replaces the tab row). */
const sideBtn = (page: Page) => sideCard(page).locator('[data-testid="fd-side-view-btn"]');
/** Show `view` in the side card: the icon toggles Who is where ↔ Bookings; the pills pick Appointments | Home. */
async function goSide(page: Page, view: string) {
  const btn = sideBtn(page);
  const onWho = (await btn.getAttribute('data-view')) === 'who';
  if ((view === 'who') !== onWho) await btn.click();
  await expect(btn).toHaveAttribute('data-view', view === 'who' ? 'who' : 'bookings');
  if (view !== 'who') {
    const pill = sideCard(page).locator(`[data-testid="fd-bookings-pills"] [role="radio"][data-value="${view}"]`);
    if (await pill.count() && (await pill.getAttribute('aria-checked')) !== 'true') await pill.click();
  }
  await page.waitForTimeout(300);
}

/** The VISITS head: the 44px icon switch + the view's title, whole (never clipped), inside the side card. */
async function expectTabsFit(page: Page, tag: string, _allowMenu = false) {
  const btn = sideBtn(page);
  await expect(btn).toBeVisible();
  const b = (await btn.boundingBox())!;
  expect(Math.min(b.width, b.height), `${tag}: the switch is a 44px target`).toBeGreaterThanOrEqual(44);
  const title = sideCard(page).locator('[data-testid="fd-side-view-title"]');
  expect(await title.evaluate(e => e.scrollWidth <= e.clientWidth + 1), `${tag}: title clipped at ${projectName()}`).toBe(true);
  const tb = (await title.boundingBox())!, card = (await sideCard(page).boundingBox())!;
  expect(tb.x + tb.width, `${tag}: title inside the side card`).toBeLessThanOrEqual(card.x + card.width + 1);
}

test.describe('who is where — Lab + OPD user', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(180_000); OUT = shotsDir(OUT_BASE); await backend(page, true); });

  test('the chart tab, the sunburst + chips, the overdue dot; tabs fit; no page scroll', async ({ page }) => {
    await openDesk(page);
    await expectLayout(page, 'who is where');
    await expectNoPageScroll(page, 'who is where');
    if (!wide()) {
      // Phones / tablet portrait: no chart — the side card's tabs stay Appointments (| Home).
      await expect(vis(page, '[data-testid="who-is-where"]')).toHaveCount(0);
      await expect(sideCard(page).locator('[data-testid="fd-side-view-btn"][data-view="who"]')).toHaveCount(0);
      await shots(page, '01-who-is-where');
      return;
    }
    await expectTabsFit(page, 'who');
    // The card head: icon + "PATIENT FLOW" (was "Who is where").
    await expect(vis(page, '[data-testid="fd-side-title"]')).toHaveText(/^\s*Patient flow\s*$/i);
    // Both card heads line up (same height, same top).
    const sh = (await sideCard(page).locator('.pf-appt-split__hdr').boundingBox())!;
    const wh = (await page.locator('.pf-work-hdr').locator('visible=true').first().boundingBox())!;
    expect(Math.abs(sh.y - wh.y), 'heads share a top').toBeLessThanOrEqual(2);
    expect(Math.abs(sh.height - wh.height), `heads share a height (${sh.height} vs ${wh.height})`).toBeLessThanOrEqual(2);
    await expect(sideBtn(page)).toHaveAttribute('data-view', 'who');
    await expect(sideCard(page).locator('[data-testid="fd-side-view-title"]')).toHaveText(/patient flow/i);
    const chart = vis(page, '[data-testid="who-is-where"]');
    await expect(chart).toBeVisible();
    // 14 active rows: 12 lab orders minus the validated one + 2 OPD.
    await expect(chart.locator('.wiw__ctr')).toContainText('in the clinic');
    const n = Number((await chart.locator('.wiw__ctr b').textContent())?.trim());
    expect(n).toBeGreaterThanOrEqual(12);
    await expect(chart.locator('.wiw__chip[data-svc="lab"]')).toContainText('Lab');
    await expect(chart.locator('.wiw__chip[data-svc="opd"]')).toContainText(/OPD\s*4\s*2 late/);   // 2 OPD orders + 2 open OPD visits
    expect(await chart.locator('path.wiw__slice').count()).toBeGreaterThanOrEqual(4);
    // The chart fits the card: 240 (200 on short screens) and centred.
    const sun = (await chart.locator('.wiw__sun').boundingBox())!;
    expect(sun.width, 'the chart fills its panel (200–360px)').toBeGreaterThanOrEqual(200);
    expect(sun.width).toBeLessThanOrEqual(360);
    // Centred vertically too: the chart + chips block has about as much room above as below.
    const body = (await sideCard(page).locator('.fd-who-body').boundingBox())!;
    const block = (await chart.boundingBox())!;
    const above = block.y - body.y, below = body.y + body.height - (block.y + block.height);
    expect(Math.abs(above - below), `centred (above ${above}, below ${below})`).toBeLessThan(Math.max(40, body.height * 0.12));
    const card = (await sideCard(page).boundingBox())!;
    expect(sun.x).toBeGreaterThanOrEqual(card.x);
    expect(sun.x + sun.width).toBeLessThanOrEqual(card.x + card.width);
    // Overdue: a rose dot on the Appointments tab, said in its name.
    await expect(sideCard(page).locator('[data-testid="fd-side-overdue-dot"]')).toHaveAttribute('aria-label', '1 appointment overdue · show bookings');
    await expect(sideBtn(page)).toHaveAttribute('aria-label', '1 appointment overdue · show bookings');
    // The journey ring: one per row, with the service label (2+ services, no filter).
    const ring = vis(page, '.pf-fd-flow pf-journey-ring').first();
    await expect(ring.locator('.pf-jring__btn')).toHaveAttribute('aria-label', /^(Lab|OPD) · .*Open journey$/);
    await expect(ring.locator('text.pf-jring__lbl')).toHaveCount(1);
    await shots(page, '01-who-is-where');
    if (!isTouch()) {
      await ring.hover();
      await expect(page.locator('.pf-jring-tip')).toBeVisible();
      await shots(page, '01b-ring-hover');
      await page.mouse.move(5, 5);
    }

    // Hover (pointer only — the desktop projects) / keyboard focus: the description card + grey-out.
    if (!isTouch()) {
      await chart.locator('.wiw__chip[data-svc="lab"]').hover();
      await expect(vis(page, '.wiw__tip')).toContainText('Click to show only Lab');
      await expect(chart).toHaveClass(/wiw--hovering/);
      await shots(page, '02-hover-card');
      await page.mouse.move(5, 5);
    }
    await chart.locator('path.wiw__slice[data-step]').first().focus();
    await expect(vis(page, '.wiw__tip')).toBeVisible();
    await expect(vis(page, '.wiw__tip')).toContainText('›');
    await shots(page, '03-focus-slice');
    await page.keyboard.press('Enter');
    await expect(chart).toHaveClass(/wiw--filtered/);
    await chart.locator('.wiw__ctr').focus();          // focus leaves the slice: the centre names the filter
    await expect(chart.locator('.wiw__ctr')).toContainText('tap for all');
    await chart.locator('.wiw__ctr').click();
    await expect(chart).not.toHaveClass(/wiw--filtered/);
  });

  test('ONE filter: a Lab chip filters the grid, the shelf and the Appointments list ("Lab ✕" clears)', async ({ page }) => {
    await openDesk(page);
    if (!wide()) { test.info().annotations.push({ type: 'form-factor', description: 'no chart below 1024px' }); return; }
    const chart = vis(page, '[data-testid="who-is-where"]');
    await chart.locator('.wiw__chip[data-svc="opd"]').click();
    await expect(chart.locator('.wiw__chip[data-svc="opd"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Ms. Meera Iyer (OPD)').locator('visible=true').first()).toBeVisible();
    await expect(page.getByText(LONG).locator('visible=true')).toHaveCount(0);
    // The bottom-bar shelf shows the same pick (remembered under the same key).
    expect(await page.evaluate(k => localStorage.getItem(k), `pf-lms.frontdesk.service.${ME.id}`)).toBe('opd');
    const shelfOpd = page.locator('[data-testid="services-shelf"] [role="radio"][data-service="opd"]');
    if (await shelfOpd.isVisible()) await expect(shelfOpd).toHaveAttribute('aria-current', 'true');
    await expectNoPageScroll(page, 'OPD');
    // One service picked: the ring's inner label adds nothing → a blank disc.
    await expect(vis(page, '.pf-fd-flow pf-journey-ring').first().locator('text.pf-jring__lbl')).toHaveCount(0);
    await shots(page, '04-chart-opd');

    // Appointments carry the filter: Lab bookings only, so OPD shows none + the removable chip.
    await goSide(page, 'appt');
    await expectTabsFit(page, 'appointments');
    const chip = vis(page, '[data-testid="fd-side-filter-chip"]');
    await expect(chip).toHaveText(/OPD/);
    await expect(sideCard(page).getByText('None for OPD')).toBeVisible();
    await shots(page, '05-appointments-opd');

    // Shelf / chart → Lab: the appointments come back, still with the chip; the overdue one reads soft rose.
    await goSide(page, 'who');
    await chart.locator('.wiw__chip[data-svc="lab"]').click();
    await expect(page.getByText('Ms. Meera Iyer (OPD)').locator('visible=true')).toHaveCount(0);
    await goSide(page, 'appt');
    await expect(chip).toHaveText(/Lab/);
    await expect(page.getByText('Ms. Anjali Raghunathan Subramaniam').locator('visible=true').first()).toBeVisible();
    await expect(vis(page, '[data-testid="fd-appt-late"]').first()).toContainText(/Not arrived · \d+m late/);
    const newBtn = vis(page, '[data-testid="fd-new-appt"]');
    const nb = (await newBtn.boundingBox())!;
    expect(nb.height, '+ New: a head button (32px, 44px on touch)').toBeGreaterThanOrEqual(isTouch() ? 44 : 32);
    await expect(vis(page, '[data-testid="fd-side-cal"]')).toBeVisible();
    await shots(page, '06-appointments-lab');
    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect(page.getByText('Ms. Meera Iyer (OPD)').locator('visible=true').first()).toBeVisible();
    expect(await page.evaluate(k => localStorage.getItem(k), `pf-lms.frontdesk.service.${ME.id}`)).toBe('all');
    // "+ New" opens the EXISTING booking flow.
    await newBtn.click();
    await expect(page).toHaveURL(/\/frontdesk\/appointments\/new/);
  });
});

test.describe('who is where — lab-only tenant', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(150_000); OUT = shotsDir(OUT_BASE); await backend(page, false); });

  test('no chart, no "Who is where" tab: Appointments as today plus "+ New"', async ({ page }) => {
    await openDesk(page);
    await expectNoPageScroll(page, 'lab-only');
    await expect(page.locator('[data-testid="who-is-where"]')).toHaveCount(0);
    await expect(sideCard(page).locator('[data-testid="fd-side-view-btn"][data-view="who"]')).toHaveCount(0);
    if (wide()) {
      await expect(vis(page, '[data-testid="fd-side-title"]')).toHaveText(/^\s*Bookings\s*$/i);
      await expect(vis(page, '[data-testid="fd-new-appt"]')).toBeVisible();
      await expect(vis(page, '[data-testid="fd-side-filter-chip"]')).toHaveCount(0);
      await expect(page.getByText('Ms. Anjali Raghunathan Subramaniam').locator('visible=true').first()).toBeVisible();
      // Appointment rows are the shared side-list rows: no card in the card, name by whole words, phone in the
      // normal font, a 44px Check in at the right, the overdue status soft rose.
      const rows = vis(page, '[data-testid="fd-appt-rows"] .fd-vrow');
      await expect(rows.first()).toBeVisible();
      await expect(sideCard(page).locator('.pf-cards .pf-card').locator('visible=true')).toHaveCount(0);
      const btnBox = (await rows.first().locator('.fd-vrow__btn').boundingBox())!;
      expect(btnBox.height, 'Check in ≥ 44px').toBeGreaterThanOrEqual(44);
      const font = await rows.first().locator('.fd-vrow__tel').evaluate(e => getComputedStyle(e).fontFamily);
      expect(font).not.toMatch(/mono/i);
      await expect(rows.first().locator('.fd-vrow__status--late')).toContainText(/Not arrived/);
      // Standalone lab: the ring keeps its steps but no "LAB" label.
      const ring = vis(page, '.pf-fd-flow pf-journey-ring').first();
      await expect(ring.locator('.pf-jring__btn')).toHaveAttribute('aria-label', /^Lab · /);
      await expect(ring.locator('text.pf-jring__lbl')).toHaveCount(0);
    }
    await shots(page, '07-lab-only');
  });
});

test.describe('journey view — tap a ring', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(150_000); OUT = shotsDir(OUT_BASE); await backend(page, true); });

  test('the ring opens the journey view (✕ / Esc / backdrop close, focus back on the ring); phone layout stacks', async ({ page }) => {
    await openDesk(page);
    if (!wide()) { test.info().annotations.push({ type: 'form-factor', description: 'rings live in the ≥1024px grid' }); return; }
    // Row 4 (Nithin, ₹450 due, late) — its ring button.
    const btn = page.locator('.pf-fd-flow .ag-row[row-id="o4"] .pf-jring__btn').first();
    await expect(btn).toHaveAttribute('aria-label', /Open journey$/);
    const b = (await btn.boundingBox())!;
    expect(Math.min(b.width, b.height), 'ring tap target ≥ 44px').toBeGreaterThanOrEqual(44);
    await btn.click();
    const dlg = page.locator('pf-journey-overlay [role="dialog"][aria-modal="true"]');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Nithin Ragav Gopalakrishnan');
    await expect(dlg.locator('.pf-jov__pt')).toContainText(/Journey · Step \d of \d/);
    await expect(dlg.locator('.pf-jov__step').first()).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator('pf-journey-overlay .pf-jov__close')).toBeFocused();
    await shots(page, '08-journey-open');
    // The view covers EVERYTHING (the bottom bar included), in both themes.
    for (const dark of [false, true]) {
      await theme(page, dark);
      await page.waitForTimeout(1500);              // the theme switch runs a view transition: let it finish
      const top = await page.evaluate(() => {
        const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 20);
        return { inside: !!el?.closest('pf-journey-overlay'), what: el ? `${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)}` : 'none' };
      });
      expect(top.inside, `bottom of the screen is covered (${dark ? 'dark' : 'light'}): ${top.what}`).toBe(true);
    }
    await theme(page, false);
    // Esc closes and focus returns to the ring.
    await page.keyboard.press('Escape');
    await expect(page.locator('pf-journey-overlay')).toHaveCount(0, { timeout: 3000 });
    await expect(btn).toBeFocused();
    // Backdrop closes too.
    await btn.click();
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(700);
    await page.mouse.click(8, Math.round((page.viewportSize()!.height) / 2));
    await expect(page.locator('pf-journey-overlay')).toHaveCount(0, { timeout: 3000 });
    // Phone layout (390 wide): stacked, nothing sideways.
    await btn.click();
    await page.waitForTimeout(700);
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const pw = await page.locator('pf-journey-overlay .pf-jov__panel').boundingBox();
    expect(pw!.x).toBeGreaterThanOrEqual(0);
    expect(pw!.x + pw!.width).toBeLessThanOrEqual(391);
    await shots(page, '09-journey-phone-layout');
    await page.locator('pf-journey-overlay .pf-jov__close').click();
    await expect(page.locator('pf-journey-overlay')).toHaveCount(0, { timeout: 3000 });
    await page.setViewportSize(vp);
  });
});

/** Extra loads for the chart: one patient, and a busy morning (40 rows across Lab + OPD, many late). */
function busyOrders() {
  const out: ReturnType<typeof data>['orders'] = [];
  const names = ['Asha Menon', 'Vikram Singh', 'Fathima Beevi', 'Rahul Dev', 'Kiran Pillai', 'Deepa Nair', 'Suresh Kumar', 'Lakshmi Venkat', 'Imran Hussain', 'Geetha Raman'];
  const shapes: [string, string[]][] = [['created', ['pending']], ['billed', ['pending']], ['sample_collected', ['collected']], ['billed', ['received']], ['billed', ['collected', 'pending']]];
  for (let i = 0; i < 40; i++) {
    const [st, tubes] = shapes[i % shapes.length];
    out.push(ord(100 + i, `${names[i % names.length]} ${i + 1}`, st, tubes, { stage: (i * 7) % 55, module: i % 4 === 0 ? 'opd' : 'lab', doctor: i % 2 ? 'Dr. Rao' : 'Dr. Menon' }));
  }
  return out;
}

test.describe('who is where — one patient / busy day', () => {
  test.beforeEach(async () => { test.setTimeout(150_000); OUT = shotsDir(OUT_BASE); });

  for (const load of ['one', 'busy'] as const) {
    test(`${load}: the chart fills and centres in its panel; labels never sit on a seam`, async ({ page }) => {
      await backend(page, true);
      S.orders = load === 'one' ? [S.orders[2]] : busyOrders();
      withVisits = false;
      await page.goto('/frontdesk');
      await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
      page_w = page.viewportSize()?.width;
      await theme(page, false);
      if (!wide()) { test.info().annotations.push({ type: 'form-factor', description: 'no chart below 1024px' }); return; }
      const chart = vis(page, '[data-testid="who-is-where"]');
      await expect(chart).toBeVisible();
      await expect(chart.locator('.wiw__ctr b')).toHaveText(load === 'one' ? '1' : /^\d{2}$/);
      if (load === 'one') await expect(chart.locator('text.wiw__n')).toHaveCount(0);   // one slice per ring: the centre says it
      await expectNoPageScroll(page, `chart ${load}`);
      await shots(page, `10-chart-${load}`);
    });
  }
});

test.describe('side card at narrow / default / wide widths', () => {
  test.beforeEach(async () => { test.setTimeout(150_000); OUT = shotsDir(OUT_BASE); });

  for (const w of [280, 340, 420]) {
    test(`side card ${w}px: pill-fit, no orphan rows, nothing clipped`, async ({ page }) => {
      await backend(page, true);
      await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* */ } }, [`pf-lms.frontdesk.side-w.${ME.id}`, String(w)] as const);
      await openDesk(page);
      if (!wide()) { test.info().annotations.push({ type: 'form-factor', description: 'stacked below 1024px' }); return; }
      for (const tab of ['appt', 'who'] as const) {
        await goSide(page, tab);
        await expectTabsFit(page, `${w} ${tab}`, true);
        // Nothing inside the side card spills past it; the head stays one row.
        const spill = await sideCard(page).evaluate(card => {
          const c = card.getBoundingClientRect();
          return [...card.querySelectorAll<HTMLElement>('.pf-appt-split__hdr *, .pf-daystrip *, .fd-side-sub *')]
            .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > c.right + 1 || r.left < c.left - 1); })
            .map(e => e.className || e.tagName).slice(0, 5);
        });
        expect(spill, `${w} ${tab}: spills`).toEqual([]);
        const head = (await sideCard(page).locator('.pf-appt-split__hdr').boundingBox())!;
        expect(head.height, `${w} ${tab}: head stays one row`).toBeLessThan(64);
        await expectNoPageScroll(page, `side ${w}`);
        await shots(page, `11-side-${w}-${tab}`);
      }
    });
  }
});

test.describe('work grid column filters + alignment', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(150_000); OUT = shotsDir(OUT_BASE); await backend(page, false); });

  test('Payment "Has dues" column filter ANDs with the head search; headers align with their cells', async ({ page }) => {
    await openDesk(page);
    if (!wide()) { test.info().annotations.push({ type: 'form-factor', description: 'grid ≥1024px only' }); return; }
    const grid = vis(page, '.pf-fd-flow').first();
    // Alignment: Token / Journey / Waiting / Payment centred, Patient / Where now left, Next right — header = cells.
    const payShown = await grid.locator('.ag-header-cell[col-id="pay"]').count() > 0;
    // A narrow grid folds Waiting into the Where cell (never a sideways scroll, owner 2026-11-21).
    const waitShown = await grid.locator('.ag-header-cell[col-id="wait"]').count() > 0;
    for (const [col, cls] of [['token', 'center'], ['journey', 'center'], ['wait', 'center'], ['pay', 'center'], ['patient', 'left'], ['where', 'left'], ['next', 'right']] as const) {
      if (col === 'pay' && !payShown) continue;                        // iPad folds Payment into the Patient line
      if (col === 'wait' && !waitShown) continue;
      await expect(grid.locator(`.ag-header-cell[col-id="${col}"]`)).toHaveClass(new RegExp(`wg-h-${cls}`));
      await expect(grid.locator(`.ag-cell[col-id="${col}"]`).first()).toHaveClass(new RegExp(`wg-c-${cls}`));
    }
    // Every data column has a filter button; the action column and the ring don't.
    for (const col of ['token', 'patient', 'where', ...(waitShown ? ['wait'] : []), ...(payShown ? ['pay'] : [])]) {
      await expect(grid.locator(`.ag-header-cell[col-id="${col}"] .ag-header-cell-filter-button`)).toHaveCount(1);
    }
    await expect(grid.locator('.ag-header-cell[col-id="next"] .ag-header-cell-filter-button')).toHaveCount(0);
    const fcol = payShown ? 'pay' : 'where';
    if (isTouch()) {
      // A 44px hit area around the small icon: a tap 18px above / below / right of its centre still lands on it —
      // but never over the label: there the tap SORTS (owner 2026-11-21, grid-sort).
      const hit = await grid.locator(`.ag-header-cell[col-id="${fcol}"] .ag-header-cell-filter-button`).evaluate(b => {
        const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const label = b.closest('.ag-header-cell')!.querySelector('.ag-header-cell-label')!;
        const left = document.elementFromPoint(x - 18, y);
        return [[x, y - 18], [x, y + 18], [x + 18, y]].every(([px, py]) => b.contains(document.elementFromPoint(px, py)))
          && (b.contains(left) || label.contains(left));
      });
      expect(hit, 'touch: header filter has a 44px hit area').toBe(true);
    }
    // The row's ⋯ stays inside the grid (nothing pushed off the right edge).
    const gb = (await grid.boundingBox())!;
    const more = (await grid.locator('.fd-cell-next__more').first().boundingBox())!;
    expect(more.x + more.width, '⋯ inside the grid').toBeLessThanOrEqual(gb.x + gb.width + 1);
    // Whole words only: no patient name or status pill splits a word across lines; pills stay on one line.
    const split = await grid.evaluate(g => {
      const out: string[] = [];
      for (const el of g.querySelectorAll<HTMLElement>('.fd-cell-pt__name, .fd-flow__stage')) {
        const words = (el.textContent ?? '').trim().split(/\s+/);
        if (el.classList.contains('fd-flow__stage') && el.getBoundingClientRect().height > 30) out.push('pill on 2 lines: ' + el.textContent?.trim());
        // a word wider than the element = it would have to break mid-word
        for (const w of words) {
          const probe = document.createElement('span'); probe.textContent = w; probe.style.whiteSpace = 'nowrap';
          el.appendChild(probe); const pw = probe.getBoundingClientRect().width; probe.remove();
          if (pw > el.getBoundingClientRect().width + 1) out.push('word: ' + w);
        }
      }
      return out;
    });
    expect(split, `split words at ${projectName()}`).toEqual([]);
    // Header labels are never cut (no ellipsis) on any form factor.
    const cut = await grid.locator('.ag-header-cell-text').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    expect(cut, `cut header labels at ${projectName()}`).toEqual([]);
    // Payment "Due" (or, on iPad where Payment folds away, Where now "Billed" — Nithin's order is Billed and due).
    await grid.locator(`.ag-header-cell[col-id="${fcol}"] .ag-header-cell-filter-button`).click();
    if (payShown) {
      // Payment is MONEY (owner 2026-11-21): a number filter on the rupees due, with a "Has dues" preset.
      await page.locator('.ag-popup .ag-filter-select').locator('visible=true').first().click();
      await page.locator('.ag-list-item, .ag-select-list-item').filter({ hasText: 'Has dues' }).locator('visible=true').first().click();
    } else {
      await page.locator('pf-work-set-filter [data-value="Billed"]').locator('visible=true').first().click();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByText('Nithin Ragav Gopalakrishnan').locator('visible=true').first()).toBeVisible();
    if (payShown) await expect(page.getByText(LONG).locator('visible=true')).toHaveCount(0);
    await expect(grid.locator(`.ag-header-cell[col-id="${fcol}"]`)).toHaveClass(/ag-header-cell-filtered/);
    await shots(page, '12-column-filter-due');
    // AND with the head search: a name that is not due shows nothing.
    const find = vis(page, '.pf-work-find__input').first();
    await find.fill('Arya');
    await expect(grid.locator('.ag-row')).toHaveCount(0);
    await find.fill('Nithin');
    await expect(page.getByText('Nithin Ragav Gopalakrishnan').locator('visible=true').first()).toBeVisible();
    await find.fill('');
  });
});

test.describe('OPD visits in the common Frontdesk', () => {
  test.beforeEach(async () => { test.setTimeout(150_000); OUT = shotsDir(OUT_BASE); });

  test('OPD on: visits are OPD rows (counted, filtered, journey ring); /opd/desk lands here with OPD picked', async ({ page }) => {
    await backend(page, true);
    await openDesk(page);
    if (!wide()) { test.info().annotations.push({ type: 'form-factor', description: 'grid ≥1024px only' }); return; }
    expect(opdCalls).toContain('/api/opd/visits');
    const grid = vis(page, '.pf-fd-flow').first();
    await expect(page.getByText('Ms. Lalitha Ramakrishnan (OPD visit)').locator('visible=true').first()).toBeVisible();
    const row = grid.locator('.ag-row[row-id="opd:v1"]');
    await expect(row.locator('.fd-cell-tok--opd')).toHaveText('R-1');
    await expect(row.locator('.pf-jring__btn')).toHaveAttribute('aria-label', /^OPD · step 3 of 4 · Doctor queue · late/);
    await expect(row.locator('.fd-cell-next__btn')).toHaveText('Open');
    // The chart and the shelf count them: OPD = 2 orders + 2 open visits.
    await expect(vis(page, '[data-testid="who-is-where"] .wiw__chip[data-svc="opd"]')).toContainText(/OPD\s*4/);
    await shots(page, '13-opd-on');
    // Filter: Lab hides the visits; OPD shows only OPD.
    await vis(page, '[data-testid="who-is-where"] .wiw__chip[data-svc="lab"]').click();
    await expect(page.getByText('Ms. Lalitha Ramakrishnan (OPD visit)').locator('visible=true')).toHaveCount(0);
    await vis(page, '[data-testid="who-is-where"] .wiw__chip[data-svc="opd"]').click();
    await expect(page.getByText('Ms. Lalitha Ramakrishnan (OPD visit)').locator('visible=true').first()).toBeVisible();
    await expect(page.getByText(LONG).locator('visible=true')).toHaveCount(0);
    await shots(page, '14-opd-filtered');
    // Next opens the existing visit screen.
    await row.locator('.fd-cell-next__btn').click();
    await expect(page).toHaveURL(/\/opd\/visit\/v1/);
    // The retired desk's link lands back here with OPD picked.
    await page.evaluate(k => localStorage.setItem(k, 'all'), `pf-lms.frontdesk.service.${ME.id}`);
    await page.goto('/opd/desk');
    await expect(page).toHaveURL(/\/frontdesk\?service=opd/);
    await expect.poll(() => page.evaluate(k => localStorage.getItem(k), `pf-lms.frontdesk.service.${ME.id}`)).toBe('opd');
  });

  test('OPD off: no OPD rows, no OPD in the chart / shelf, not one OPD request; /opd/desk stays gated', async ({ page }) => {
    await backend(page, false);
    await openDesk(page);
    await page.waitForTimeout(800);
    expect(opdCalls, 'OPD off: no OPD request').toEqual([]);
    await expect(page.getByText('Ms. Lalitha Ramakrishnan (OPD visit)').locator('visible=true')).toHaveCount(0);
    await expect(page.locator('[data-testid="who-is-where"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="services-shelf"]')).toHaveCount(0);
    await shots(page, '15-opd-off');
    await page.goto('/opd/desk');
    await expect(page).not.toHaveURL(/service=opd/);
    expect(opdCalls).toEqual([]);
  });
});

