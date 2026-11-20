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
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const appts = [
    { id: 'a0', tenantId: TENANT.id, patientId: 'p22', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: iso(late), slotTime: hhmm(late), status: 'booked', consultationFee: 0, createdAt: iso(now), patient: pat(22, 'Ms. Revathi Krishnamoorthy') },
    { id: 'a1', tenantId: TENANT.id, patientId: 'p20', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: iso(new Date(now.getTime() + 60 * 60000)), slotTime: hhmm(new Date(now.getTime() + 60 * 60000)), status: 'booked', consultationFee: 0, createdAt: iso(now), patient: pat(20, 'Ms. Anjali Raghunathan Subramaniam') },
    { id: 'a2', tenantId: TENANT.id, patientId: 'p21', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: iso(new Date(now.getTime() + 90 * 60000)), slotTime: hhmm(new Date(now.getTime() + 90 * 60000)), status: 'booked', consultationFee: 0, createdAt: iso(now), patient: pat(21, 'Mr. Gopal Krishnan') },
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
  await page.waitForTimeout(1100);   // the theme switch's view transition must finish (it paints over the top layer)
  await page.screenshot({ path: `${OUT}/${name}--dark.png` });
  await theme(page, false);
}


const sideCard = (page: Page) => page.locator('.pf-appt-split > .pf-appt-split__pane:not(.pf-appt-split__pane--work)');
const sideTab = (page: Page, value: string) => sideCard(page).locator(`pf-segmented.pf-tabs [role="radio"][data-value="${value}"]`);

/** Every tab label whole: no option clipped, none collapsed into the selected-pill menu. */
async function expectTabsFit(page: Page, tag: string) {
  const seg = sideCard(page).locator('pf-segmented.pf-tabs');
  await expect(seg).toBeVisible();
  expect(await seg.evaluate(e => e.classList.contains('is-menu')), `${tag}: tabs folded into a menu at ${projectName()}`).toBe(false);
  const clipped = await seg.locator('.seg-item').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent?.trim()));
  expect(clipped, `${tag}: clipped tab labels at ${projectName()}`).toEqual([]);
  const box = (await seg.boundingBox())!, card = (await sideCard(page).boundingBox())!;
  expect(box.x + box.width, `${tag}: tabs inside the side card`).toBeLessThanOrEqual(card.x + card.width + 1);
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
      await expect(sideCard(page).locator('[role="radio"][data-value="who"]')).toHaveCount(0);
      await shots(page, '01-who-is-where');
      return;
    }
    await expectTabsFit(page, 'who');
    await expect(sideTab(page, 'who')).toHaveAttribute('aria-checked', 'true');
    const chart = vis(page, '[data-testid="who-is-where"]');
    await expect(chart).toBeVisible();
    // 14 active rows: 12 lab orders minus the validated one + 2 OPD.
    await expect(chart.locator('.wiw__ctr')).toContainText('in the clinic');
    const n = Number((await chart.locator('.wiw__ctr b').textContent())?.trim());
    expect(n).toBeGreaterThanOrEqual(12);
    await expect(chart.locator('.wiw__chip[data-svc="lab"]')).toContainText('Lab');
    await expect(chart.locator('.wiw__chip[data-svc="opd"]')).toContainText(/OPD\s*2\s*1 late/);
    expect(await chart.locator('path.wiw__slice').count()).toBeGreaterThanOrEqual(4);
    // The chart fits the card: 240 (200 on short screens) and centred.
    const sun = (await chart.locator('.wiw__sun').boundingBox())!;
    expect([200, 240]).toContain(Math.round(sun.width));
    const card = (await sideCard(page).boundingBox())!;
    expect(sun.x).toBeGreaterThanOrEqual(card.x);
    expect(sun.x + sun.width).toBeLessThanOrEqual(card.x + card.width);
    // Overdue: a rose dot on the Appointments tab, said in its name.
    await expect(sideTab(page, 'appt').locator('.seg-alert')).toHaveCount(1);
    await expect(sideTab(page, 'appt')).toHaveAttribute('aria-label', /^Appointments, 3, 1 overdue$/);
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
    await sideTab(page, 'appt').click();
    await expectTabsFit(page, 'appointments');
    const chip = vis(page, '[data-testid="fd-side-filter-chip"]');
    await expect(chip).toHaveText(/OPD/);
    await expect(sideCard(page).getByText('None for OPD')).toBeVisible();
    await shots(page, '05-appointments-opd');

    // Shelf / chart → Lab: the appointments come back, still with the chip; the overdue one reads soft rose.
    await sideTab(page, 'who').click();
    await chart.locator('.wiw__chip[data-svc="lab"]').click();
    await expect(page.getByText('Ms. Meera Iyer (OPD)').locator('visible=true')).toHaveCount(0);
    await sideTab(page, 'appt').click();
    await expect(chip).toHaveText(/Lab/);
    await expect(page.getByText('Ms. Anjali Raghunathan Subramaniam').locator('visible=true').first()).toBeVisible();
    await expect(vis(page, '[data-testid="fd-appt-late"]').first()).toContainText(/Not arrived · \d+m late/);
    const newBtn = vis(page, '[data-testid="fd-new-appt"]');
    const nb = (await newBtn.boundingBox())!;
    expect(nb.height, '+ New ≥ 44px').toBeGreaterThanOrEqual(44);
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
    await expect(sideCard(page).locator('[role="radio"][data-value="who"]')).toHaveCount(0);
    if (wide()) {
      await expect(vis(page, '[data-testid="fd-side-sub"]')).toContainText('Booked today');
      await expect(vis(page, '[data-testid="fd-new-appt"]')).toBeVisible();
      await expect(vis(page, '[data-testid="fd-side-filter-chip"]')).toHaveCount(0);
      await expect(page.getByText('Ms. Anjali Raghunathan Subramaniam').locator('visible=true').first()).toBeVisible();
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

