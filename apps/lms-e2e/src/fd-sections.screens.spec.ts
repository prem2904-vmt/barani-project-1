import type { Page } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { test, expect, shotsDir, isPhone, isTouch, projectName } from './support/form-factor';
import { deskAllStatuses } from './support/frontdesk';

/**
 * Frontdesk WORK body (owner mocks fd-sections/ColsGrouped + fd-morph-clinic, 2026-11-21) — API mocked, fake data only,
 * a BUSY day (Lab 12 orders, OPD 16 visits with 12 waiting, 2 IPD orders):
 *  - All with 2+ services = one section per service with its OWN columns; sticky headers; the user's order (drag the
 *    grip / Alt+↑↓), remembered per tenant + user across a reload; one service picked = just its table;
 *  - Clinic: the same rows in their places, rooms never overlap (10+ waiting), a chip opens the journey view, the
 *    choice is remembered;
 *  - the grids never scroll sideways (card 520 · 600 · 720 · 900 · 1200), no pill / button clipped, no word broken
 *    mid-word; light + dark screenshots in SHOTS_DIR/<project>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/fd-sections');
let OUT = OUT_BASE;

const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-fd', authId: 'sub-fd', first: 'Kavya', last: 'Desk' };
const ORDER_KEY = `pf.fd.sectionOrder.${TENANT.id}.${ME.id}`;
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
const ord = (n: number, name: string, status: string, tubes: string[], o: { stage?: number; module?: string; doctor?: string; priority?: string } = {}) => {
  const created = minsAgo(90);
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

const ORDERS = [
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
  // IPD orders (module 'ipd'): their own section — a row is never hidden, even for a service still in beta.
  ord(13, 'Mr. Ravi Shankar (IPD)', 'billed', ['pending'], { stage: 50, module: 'ipd', doctor: 'Dr. Rao' }),
  ord(14, 'Mrs. Latha Ramaswamy', 'billed', ['collected'], { stage: 20, module: 'ipd', doctor: 'Dr. Menon' }),
];
const NAMES = ['Asha Mohan', 'Vikram Subramanian', 'Fathima Begum', 'Rahul Dravid', 'Kiran Prakash', 'Deepa Natarajan', 'Suresh Kannan', 'Lakshmi Venkat', 'Imran Hussain', 'Geetha Raman', 'Mohan Lal', 'Sneha Jayaraman'];
const v = (i: number, name: string, status: string, doc: 1 | 2, mins: number, extra: Record<string, unknown> = {}) => ({
  id: `v${i}`, patientId: `pv${i}`, patientName: name, patientMeta: `${30 + i}/${i % 2 ? 'F' : 'M'} · AA01${String(i).padStart(2, '0')}`,
  doctorUserId: `d${doc}`, doctorName: doc === 1 ? 'Dr. Rao' : 'Dr. Menon', departmentName: doc === 1 ? 'General medicine' : 'Diabetology', visitNumber: `OPD-00${i}`,
  visitDate: dayOf(now), token: i, tokenLabel: `${doc === 1 ? 'R' : 'M'}-${i}`, status, isFollowUp: false, charged: 500, billStatus: 'paid', hasLabOrder: false,
  createdAt: iso(minsAgo(mins + 5)), checkedInAt: iso(minsAgo(mins)), vitalsFlagged: false, ...extra,
});
const VISITS = [
  ...NAMES.map((n, i) => v(i + 1, n, 'waiting', (i % 3 === 0 ? 2 : 1), [44, 37, 31, 28, 25, 21, 18, 14, 12, 9, 6, 3][i])),
  v(13, 'Mr. Gopal Thiruvengadam', 'in_consult', 1, 11),
  v(14, 'Anu Krishnamurthy', 'vitals', 2, 4, { vitalsSummary: 'BP 150/95 · SpO₂ 97%', vitalsFlagged: true }),
  v(15, 'Mr. Kannan Venkatesan', 'completed', 1, 90, { billStatus: 'pending', charged: 0 }),
  v(16, 'Baby Ira Raghavan', 'booked', 2, 0),
];

/** The OPD doctors board (classic desk) — Dr. Shah sits today with nobody booked yet. */
const BOARD = [
  { id: 'd1', name: 'Dr. Rao', department: 'General medicine', waiting: 8, vitals: 0, inConsult: 1, done: 1, nowServing: 'R-13' },
  { id: 'd2', name: 'Dr. Menon', department: 'Diabetology', waiting: 4, vitals: 1, inConsult: 0, done: 0, nowServing: null },
  { id: 'd9', name: 'Dr. Shah', department: 'Orthopaedics', waiting: 0, vitals: 0, inConsult: 0, done: 0, nowServing: null },
];
/** Procedures ordered "for later" (classic desk's "Procedures to book"). */
const PROCS = [
  { id: 'pb1', visitId: 'v13', patientId: 'pv13', patientName: 'Mr. Gopal Thiruvengadam', mrn: 'AA0113', procedureName: 'Knee joint injection',
    serviceId: 's1', doctorId: 'd1', doctorName: 'Dr. Rao', price: 1500, rulePrice: 1200, priceReason: 'Bilateral', preferredWithin: 'Within 2 weeks',
    prepNote: 'Fasting not needed', orderedAt: iso(minsAgo(30)) },
  { id: 'pb2', visitId: 'v14', patientId: 'pv14', patientName: 'Anu Krishnamurthy', mrn: 'AA0114', procedureName: 'Nerve conduction study',
    serviceId: 's2', doctorId: 'd2', doctorName: 'Dr. Menon', price: 2400, rulePrice: 2400, priceReason: null, preferredWithin: null,
    prepNote: null, orderedAt: iso(minsAgo(90)) },
];

/** Five bookings today: three overdue (slot passed, not arrived), two later. */
const APPTS = () => {
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const eod = new Date(now); eod.setHours(23, 58, 0, 0);
  const at = (m: number) => m < 0 ? minsAgo(-m) : new Date(Math.min(now.getTime() + m * 60000, eod.getTime()));
  return [[-50, 'Ms. Revathi Krishnamoorthy'], [-35, 'Mr. Dinesh Prabhu'], [-20, 'Ms. Farah Naaz'], [60, 'Mr. Kannan Velu'], [120, 'Baby Ira Menon']]
    .map(([m, name], i) => ({ id: `a${i}`, tenantId: TENANT.id, patientId: `pa${i}`, branchId: 'b1', type: 'appointment', collectionType: 'walkin',
      appointmentDate: iso(at(m as number)), slotTime: hhmm(at(m as number)), status: 'booked', consultationFee: 0, createdAt: iso(now), patient: pat(40 + i, name as string) }));
};

async function backend(page: Page, opd = true) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, d: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: d }) });
  const orders = opd ? ORDERS : ORDERS.filter(o => o.module === 'lab');
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (p === '/api/auth/me') return route.fulfill(ok(origin, {
      id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demo.test',
      tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Receptionist'], permissions: ['*'],
      branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false, opdEntitled: opd,
    }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/orders/today' || p === '/api/orders/range') return route.fulfill(ok(origin, orders));
    if (p === '/api/appointments/today') return route.fulfill(ok(origin, APPTS()));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: [bill('o4', 450)], refundsOwed: [] }));
    const m = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (m) return route.fulfill(ok(origin, orders.find(x => x.id === m[1]) ?? {}));
    if (p.startsWith('/api/opd/')) {
      if (p === '/api/opd/visits') return route.fulfill(ok(origin, opd ? VISITS : []));
      if (p === '/api/opd/visits/payments-due') return route.fulfill(ok(origin, [{ visitId: 'v15', billId: 'b15', kind: 'consult', patientId: 'pv15', patientName: 'Mr. Kannan Venkatesan', doctorUserId: 'd1', doctorName: 'Dr. Rao', tokenLabel: 'R-15', visitDate: dayOf(now), visitStatus: 'completed', lines: [], totalPayable: 500, totalPaid: 0, balance: 500, status: 'pending' }]));
      if (p === '/api/opd/queue/board') return route.fulfill(ok(origin, opd ? BOARD : []));
      if (p === '/api/opd/procedures/to-book') return route.fulfill(ok(origin, opd ? PROCS : []));
      if (/^\/api\/opd\/procedures\/[^/]+\/book$/.test(p)) return route.fulfill(ok(origin, { visitId: 'v99', date: dayOf(now) }));
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
async function shots(page: Page, name: string) {
  await theme(page, false);
  await page.screenshot({ path: `${OUT}/${name}--light.png` });
  await theme(page, true);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${OUT}/${name}--dark.png` });
  await theme(page, false);
}
const wide = (page: Page) => !isPhone() && (page.viewportSize()?.width ?? 0) >= 1024;
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true');

async function openDesk(page: Page) {
  await page.goto('/frontdesk');
  await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
  await theme(page, false);
  await deskAllStatuses(page);
  if (wide(page)) await expect(vis(page, '.pf-fd-flow .ag-row').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
}

async function expectNoPageScroll(page: Page, tag: string) {
  const o = await page.evaluate(() => { const se = document.scrollingElement as HTMLElement; return { v: se.scrollHeight - se.clientHeight, h: se.scrollWidth - se.clientWidth }; });
  expect(o.v, `${tag}: page scrolls vertically at ${projectName()}`).toBeLessThanOrEqual(1);
  expect(o.h, `${tag}: page scrolls sideways at ${projectName()}`).toBeLessThanOrEqual(1);
}

/** Every work grid on screen: no sideways scroll; every pill / button inside its cell; no word broken mid-word. */
async function expectGridsClean(page: Page, tag: string) {
  const r = await page.evaluate(() => {
    const out = { scroll: [] as string[], clipped: [] as string[], broken: [] as string[], grids: 0 };
    const grids = Array.from(document.querySelectorAll<HTMLElement>('.pf-fd-flow .ag-root-wrapper')).filter(g => g.getBoundingClientRect().width > 0);
    out.grids = grids.length;
    for (const g of grids) {
      // Columns fit the grid: the horizontal scroller has nothing to scroll and no cell / header ends past the grid.
      const gr = g.getBoundingClientRect();
      for (const vp of Array.from(g.querySelectorAll<HTMLElement>('.ag-body-horizontal-scroll-viewport'))) {
        if (vp.clientWidth > 0 && vp.scrollWidth > vp.clientWidth + 1) out.scroll.push(`h-scroll ${vp.scrollWidth}>${vp.clientWidth}`);
      }
      for (const el of Array.from(g.querySelectorAll<HTMLElement>('.ag-cell, .ag-header-cell'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > gr.right + 1) out.scroll.push(`${el.getAttribute('col-id')} ends at ${Math.round(r.right)} > ${Math.round(gr.right)}`);
      }
      for (const t of Array.from(g.querySelectorAll<HTMLElement>('.ag-header-cell-text'))) {
        if (t.clientWidth > 0 && t.scrollWidth > t.clientWidth + 1) out.clipped.push(`header "${t.textContent?.trim()}" cut`);
      }
      for (const cell of Array.from(g.querySelectorAll<HTMLElement>('.ag-cell'))) {
        const c = cell.getBoundingClientRect();
        if (c.width === 0) continue;
        for (const el of Array.from(cell.querySelectorAll<HTMLElement>('button, .fd-flow__stage, .pf-rowact, .fd-cell-tok, .fd-cell-pt__tok'))) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
          if (b.left < c.left - 1 || b.right > c.right + 1) out.clipped.push(`${cell.getAttribute('col-id')}: "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(b.left)}–${Math.round(b.right)} vs ${Math.round(c.left)}–${Math.round(c.right)}`);
        }
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const t = n.textContent ?? '';
          const re = /\S+/g;
          for (let m = re.exec(t); m; m = re.exec(t)) {
            const range = document.createRange();
            range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
            const rects = Array.from(range.getClientRects()).filter(x => x.width > 0);
            const tops = new Set(rects.map(x => Math.round(x.top)));
            if (tops.size > 1) out.broken.push(`${cell.getAttribute('col-id')}: "${m[0]}"`);
          }
        }
      }
    }
    return out;
  });
  expect(r.grids, `${tag}: a grid on screen`).toBeGreaterThan(0);
  expect(r.scroll, `${tag}: sideways scroll at ${projectName()}`).toEqual([]);
  expect(r.clipped, `${tag}: clipped pills / buttons at ${projectName()}`).toEqual([]);
  expect(r.broken, `${tag}: words broken mid-word at ${projectName()}`).toEqual([]);
}


/** Every section hugs its rows (its last row ends where the section ends) and the next header starts right there. */
async function expectSectionsHug(page: Page, tag: string) {
  const r = await page.evaluate(() => {
    const out: string[] = [];
    const secs = Array.from(document.querySelectorAll<HTMLElement>('.fd-sec')).filter(s => s.getBoundingClientRect().height > 0);
    secs.forEach((sec, i) => {
      const rows = Array.from(sec.querySelectorAll<HTMLElement>('.ag-row[row-id]')).map(x => x.getBoundingClientRect()).filter(x => x.height > 0);
      if (!rows.length) { out.push(`${sec.dataset['sec']}: no rows`); return; }
      const last = Math.max(...rows.map(x => x.bottom));
      const end = sec.getBoundingClientRect().bottom;
      if (end - last > 1) out.push(`${sec.dataset['sec']}: ${Math.round(end - last)}px blank under its last row`);
      const next = secs[i + 1]?.querySelector<HTMLElement>('.fd-sec__h');
      if (next) {
        const gap = next.getBoundingClientRect().top - last;
        if (Math.abs(gap) > 1) out.push(`${sec.dataset['sec']} → ${secs[i + 1].dataset['sec']}: ${Math.round(gap)}px gap`);
      }
    });
    return { out, n: secs.map(s => `${s.dataset['sec']}:${s.querySelectorAll('.ag-row[row-id]').length}`) };
  });
  expect(r.out, `${tag} (${r.n.join(' ')}) at ${projectName()}`).toEqual([]);
}

/** Token · Patient · Waiting · Next start at the same x in every section (shown columns only). */
async function expectSectionsAligned(page: Page, tag: string) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const secs = Array.from(document.querySelectorAll<HTMLElement>('.fd-sec')).filter(s => s.getBoundingClientRect().height > 0);
    for (const col of ['sel', 'token', 'patient', 'wait', 'next']) {
      const xs = secs.map(sec => {
        const h = sec.querySelector<HTMLElement>(`.ag-header-cell[col-id="${col}"]`);
        const r = h?.getBoundingClientRect();
        return r && r.width > 0 ? Math.round(r.left) : null;
      });
      const shown = xs.filter((x): x is number => x !== null);
      if (shown.length !== xs.length && shown.length) out.push(`${col}: shown in some sections only (${xs.join(', ')})`);
      else if (shown.length && Math.max(...shown) - Math.min(...shown) > 1) out.push(`${col}: x ${shown.join(' / ')}`);
    }
    return out;
  });
  expect(bad, `${tag}: columns line up across sections at ${projectName()}`).toEqual([]);
}

/** Pick a Bookings pill — through the collapsed pill's menu when the pills don't fit (pf-segmented pill-fit). */
async function pickPill(page: Page, v: 'appt' | 'home' | 'proc') {
  const sideCard = page.locator('.pf-appt-split > .pf-appt-split__pane:not(.pf-appt-split__pane--work)');
  const p = sideCard.locator(`[data-testid="fd-bookings-pills"] [role="radio"][data-value="${v}"]`);
  if (await p.isVisible()) { await p.click(); return; }
  await sideCard.locator('[data-testid="fd-bookings-pills"] [data-seg-compact]').click();
  const name = { appt: /^Appointments/, home: /^Home/, proc: /^Procedures/ }[v];
  await page.getByRole('menuitemradio', { name }).locator('visible=true').first().click();
}

const sectionIds = (page: Page) => page.locator('.fd-sec').evaluateAll(els => els.map(e => (e as HTMLElement).dataset['sec']));

test.describe('All = one screen split by service', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(240_000); OUT = shotsDir(OUT_BASE); await backend(page, true); });

  test('sections with their own columns, sticky headers, no sideways scroll, whole words', async ({ page }) => {
    await openDesk(page);
    await expectNoPageScroll(page, 'sections');
    if (!wide(page)) {
      await expect(vis(page, '.fd-sec')).toHaveCount(0);
      await expect(vis(page, '[data-testid="fd-work-view-btn"]')).toHaveCount(0);
      await shots(page, '01-sections');
      return;
    }
    // Default order = the Services shelf order (Lab, OPD), then the IPD rows (never hidden).
    expect(await sectionIds(page)).toEqual(['lab', 'opd', 'ipd']);
    const opdHead = page.locator('.fd-sec[data-sec="opd"] .fd-sec__h');
    await expect(opdHead).toContainText(/OPD\s*\d+/);
    await expect(opdHead.locator('.fd-sec__late')).toHaveText(/\d+ late/);
    const headers = (s: string) => page.locator(`.fd-sec[data-sec="${s}"] .ag-header-cell`).evaluateAll(els => els.map(e => (e.textContent ?? '').trim()).filter(Boolean));
    const opdCols = await headers('opd');
    // Each section draws its module's Work grid columns (Settings › Front desk; defaults = the owner's catalogue).
    expect(opdCols).toEqual(expect.arrayContaining(['Patient', 'Next', 'Where now']));
    expect(opdCols).not.toContain('Journey');   // the ring rides Where now (design D)
    expect(opdCols).not.toContain('Room');
    await expect(page.locator('.fd-sec[data-sec="opd"] .ag-row').first()).toBeVisible();
    if (opdCols.includes('Doctor')) {
      // OPD cells read the visit's own data: the consulting doctor.
      await expect(page.locator('.fd-sec[data-sec="opd"] .ag-cell[col-id="doctor"]').getByText(/Dr\. (Rao|Menon)/).first()).toBeVisible();
    }
    await expectGridsClean(page, 'sections');
    await expectSectionsHug(page, 'sections');
    await expectSectionsAligned(page, 'sections');
    await shots(page, '01-sections');
    // Sticky: scroll the body — the OPD header stays at the body's top while its rows pass.
    const body = page.locator('.fd-secs');
    await body.evaluate((el) => { const s = el.querySelector<HTMLElement>('.fd-sec[data-sec="opd"]')!; el.scrollTop = s.offsetTop + 200; });
    await page.waitForTimeout(200);
    const bt = (await body.boundingBox())!;
    const ht = (await opdHead.boundingBox())!;
    expect(Math.abs(ht.y - bt.y), 'the OPD header sticks to the top').toBeLessThanOrEqual(2);
    await shots(page, '02-sections-sticky');
  });

  test('the user orders the sections: drag the grip (mouse) / Alt+↑ — remembered after a reload', async ({ page }) => {
    await openDesk(page);
    if (!wide(page)) { test.info().annotations.push({ type: 'form-factor', description: 'sections only at ≥1024px' }); return; }
    expect(await sectionIds(page)).toEqual(['lab', 'opd', 'ipd']);
    // Keyboard: focus the IPD header, Alt+↑ → IPD above OPD.
    await page.locator('.fd-sec[data-sec="ipd"] .fd-sec__h').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => sectionIds(page)).toEqual(['lab', 'ipd', 'opd']);
    await expect(page.locator('.fd-sec[data-sec="ipd"] .fd-sec__h')).toBeFocused();
    if (!isTouch()) {
      // Mouse drag: OPD's grip (last section, below the fold) up above Lab — the body auto-scrolls near its top edge.
      await page.locator('.fd-sec[data-sec="opd"] .fd-sec__h').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const grip = (await page.locator('.fd-sec[data-sec="opd"] .fd-sec__grip').boundingBox())!;
      const body = (await page.locator('.fd-secs').boundingBox())!;
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      for (let i = 0; i < 80; i++) {
        await page.mouse.move(grip.x + grip.width / 2, body.y + 10 + (i % 2));
        if ((await page.locator('.fd-secs').evaluate(el => el.scrollTop)) === 0) break;
      }
      const lab = (await page.locator('.fd-sec[data-sec="lab"] .fd-sec__h').boundingBox())!;
      await page.mouse.move(grip.x + grip.width / 2, Math.max(lab.y + 4, body.y + 42), { steps: 4 });
      await expect(page.locator('.fd-secs__drop')).toBeVisible();
      await page.mouse.up();
      await expect.poll(() => sectionIds(page)).toEqual(['opd', 'lab', 'ipd']);
    } else {
      await page.locator('.fd-sec[data-sec="opd"] .fd-sec__h').focus();
      await page.keyboard.press('Alt+ArrowUp');
      await page.keyboard.press('Alt+ArrowUp');
      await expect.poll(() => sectionIds(page)).toEqual(['opd', 'lab', 'ipd']);
    }
    expect(JSON.parse((await page.evaluate(k => localStorage.getItem(k), ORDER_KEY)) ?? '[]')).toEqual(['opd', 'lab', 'ipd']);
    await page.reload();
    await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
    await deskAllStatuses(page);
    await expect(vis(page, '.fd-sec').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => sectionIds(page)).toEqual(['opd', 'lab', 'ipd']);
    await shots(page, '03-sections-reordered');
  });

  test('sections hug their rows with 1 row and with 5 rows (no blank row, no scrollbar strip)', async ({ page }) => {
    await openDesk(page);
    if (!wide(page)) return;
    // ONE search per screen (2026-11-21): the band's patient search filters the work list.
    const find = vis(page, 'pf-hero-band pf-patient-search input').first();
    for (const [q, n] of [['Arya', 1], ['Ms.', 5]] as const) {
      await find.fill(q);
      await page.waitForTimeout(700);
      await expect(page.locator('.fd-sec[data-sec="lab"] .ag-row[row-id]')).toHaveCount(n);
      await expectSectionsHug(page, `search "${q}"`);
      await shots(page, `02b-hug-${n}-row${n === 1 ? '' : 's'}`);
    }
    await find.fill('');
  });

  test('one service picked = just that service\'s table (no section headers)', async ({ page }) => {
    await openDesk(page);
    if (!wide(page)) return;
    await page.evaluate(k => localStorage.setItem(k, 'opd'), `pf-lms.frontdesk.service.${ME.id}`);
    await page.reload();
    await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
    await deskAllStatuses(page);
    await expect(vis(page, '.pf-fd-flow .ag-row').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.fd-sec')).toHaveCount(0);
    await expect(page.getByText(LONG)).toHaveCount(0);
    await expectGridsClean(page, 'one service');
    await shots(page, '04-one-service');
  });

  test('never scroll sideways: card 520 · 600 · 720 · 900 · 1200 (sections and the one table)', async ({ page }) => {
    await openDesk(page);
    if (!wide(page)) return;
    const vw = page.viewportSize()!.width;
    for (const w of [520, 600, 720, 900, 1200]) {
      if (w > vw - 120) continue;
      await page.addStyleTag({ content: `.pf-appt-split > .pf-appt-split__pane--work { flex: 0 0 ${w}px !important; width: ${w}px !important; max-width: ${w}px !important; }` });
      await page.waitForTimeout(700);
      await expectGridsClean(page, `sections @${w}`);
      await expectSectionsHug(page, `sections @${w}`);
      await expectSectionsAligned(page, `sections @${w}`);
      await expectNoPageScroll(page, `@${w}`);
      await theme(page, true);
      await page.waitForTimeout(1100);
      await expectGridsClean(page, `sections @${w} dark`);
      await shots(page, `05-width-${w}`);
    }
  });
});

test.describe('Clinic view', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(240_000); OUT = shotsDir(OUT_BASE); await backend(page, true); });

  test('List | Clinic: rooms from real data, 10+ waiting with no overlap, chip → journey, remembered', async ({ page }) => {
    await openDesk(page);
    if (!wide(page)) { await expect(vis(page, '[data-testid="fd-work-view-btn"]')).toHaveCount(0); return; }
    // The card icon IS the switch: 44px, in the head (one row), "Show clinic view", aria-pressed false; title WORK.
    const head = (await vis(page, '.pf-work-hdr').first().boundingBox())!;
    const sw = vis(page, '[data-testid="fd-work-view-btn"]');
    const sb = (await sw.boundingBox())!;
    expect(Math.min(sb.width, sb.height), 'icon switch is a 44px target').toBeGreaterThanOrEqual(44);
    expect(head.height, 'head stays one row').toBeLessThanOrEqual(isTouch() ? 72 : 64);
    await expect(sw).toHaveAttribute('aria-pressed', 'false');
    await expect(sw).toHaveAttribute('aria-label', 'Show clinic view');
    await expect(vis(page, '[data-testid="fd-work-title"]')).toHaveText(/^\s*work\s*$/i);
    await expect(page.locator('.pf-work-hdr__view')).toHaveCount(0);
    // The morph: one tile per patient flies from its list row into its room — capture a tile's box mid-flight.
    const frames = path.join(OUT, 'morph');
    fs.mkdirSync(frames, { recursive: true });
    await sw.click();
    const tile = page.locator('.fd-tile[data-tile="o1"]');
    await tile.waitFor({ state: 'attached', timeout: 5000 });
    // In-page: sample the tile's box every frame while it flies (screenshots are too slow to time this on iPad).
    const moved = await tile.evaluate(el => new Promise<number>(res => {
      const r0 = el.getBoundingClientRect();
      let max = 0;
      const t = performance.now();
      const step = () => {
        const r = el.isConnected ? el.getBoundingClientRect() : null;
        if (r) max = Math.max(max, Math.hypot(r.left - r0.left, r.top - r0.top) + Math.abs(r.width - r0.width));
        if (performance.now() - t < 500 && el.isConnected) requestAnimationFrame(step); else res(max);
      };
      requestAnimationFrame(step);
    }));
    expect(moved, 'the tile flew from its row toward its room').toBeGreaterThan(20);
    // A frame sequence for the owner (the move is replayed: back to the list, then into the clinic again).
    await expect(page.locator('.fd-tiles')).toHaveCount(0, { timeout: 4000 });       // landed: the real clinic takes over
    await expect(sw).toHaveAttribute('aria-pressed', 'true');
    await expect(sw).toHaveAttribute('aria-label', 'Show list');
    await expect(vis(page, '[data-testid="fd-work-title"]')).toHaveText(/^\s*clinic\s*$/i);
    const clinic = vis(page, 'pf-fd-clinic');
    await expect(clinic).toBeVisible();
    await page.waitForTimeout(600);
    const titles = await clinic.locator('.cv-room__title').allTextContents();
    expect(titles).toEqual(expect.arrayContaining(['Waiting area', 'Vitals', 'Dr. Rao', 'Dr. Menon', 'Billing counter', 'Collection']));
    for (const t of titles) expect(t, 'no invented rooms').not.toMatch(/^Room \d|Bay \d|Ward [A-Z]/);
    // Rooms: every visible chip inside its room, no two chips overlapping, and the "+N" (when shown) too.
    const roomsClean = async (tag: string) => { const bad = await clinic.evaluate(root => {
      const out: string[] = [];
      for (const room of Array.from(root.querySelectorAll<HTMLElement>('.cv-room'))) {
        const R = room.getBoundingClientRect();
        const chips = Array.from(room.querySelectorAll<HTMLElement>('.cv-chips .cv-chip')).map(c => ({ c, r: c.getBoundingClientRect() }));
        for (const { c, r } of chips) if (r.right > R.right + 1 || r.bottom > R.bottom + 1 || r.left < R.left - 1) out.push(`${room.dataset['place']}: ${c.textContent?.trim()} outside`);
        for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
          const a = chips[i].r, b = chips[j].r;
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${room.dataset['place']}: overlap`);
        }
      }
      return out;
    });
    expect(bad, tag).toEqual([]); };
    await roomsClean('clinic');
    const waitRoom = clinic.locator('.cv-room[data-place="opd:wait"]');
    await expect(waitRoom.locator('.cv-big')).toHaveText('12');
    await expectNoPageScroll(page, 'clinic');
    await shots(page, '06-clinic');
    await roomsClean('clinic after the theme switches');
    // Narrow card: rooms degrade (dense / +N / count) — still no overlap.
    await page.addStyleTag({ content: '.pf-appt-split > .pf-appt-split__pane--work { flex: 0 0 600px !important; width: 600px !important; max-width: 600px !important; }' });
    await page.waitForTimeout(800);
    const levels = await clinic.locator('.cv-room').evaluateAll(els => els.map(e => (e as HTMLElement).dataset['fit']));
    expect(levels.some(l => l !== 'full'), 'a narrow card degrades some room').toBe(true);
    await roomsClean('clinic narrow');
    await shots(page, '07-clinic-narrow');
    await page.reload();
    await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
    await deskAllStatuses(page);
    // Remembered per user.
    await expect(vis(page, 'pf-fd-clinic')).toBeVisible({ timeout: 30_000 });
    const chip = vis(page, 'pf-fd-clinic .cv-chip[data-row]').first();
    await chip.click();
    await expect(page.locator('pf-journey-overlay [role="dialog"][aria-modal="true"]')).toBeVisible();
    // The journey view's action is OUTLINED (never a second violet primary).
    const act = page.locator('pf-journey-overlay .pf-jov__act');
    if (await act.count()) { await expect(act).toHaveClass(/pf-btn--secondary/); await expect(act).not.toHaveClass(/pf-btn--primary/); }
    await page.waitForTimeout(700);
    await shots(page, '08-clinic-journey');
    await page.keyboard.press('Escape');
    // Back to the list: the tiles fly out of the rooms into the rows.
    await vis(page, '[data-testid="fd-work-view-btn"]').click();
    await page.locator('.fd-tiles').waitFor({ state: 'attached', timeout: 5000 });
    for (const k of [1, 2, 3, 4]) { await page.screenshot({ path: `${frames}/to-list-${k}.png` }); await page.waitForTimeout(110); }
    await expect(page.locator('.fd-tiles')).toHaveCount(0, { timeout: 4000 });
    await expect(vis(page, '.fd-sec').first()).toBeVisible();
    await expect(vis(page, '[data-testid="fd-work-title"]')).toHaveText(/^\s*work\s*$/i);
    // Frames for the owner: list → clinic at real speed, then once more in 4× slow motion (labelled "slowmo").
    if (!isTouch()) {
      await page.waitForTimeout(400);
      await vis(page, '[data-testid="fd-work-view-btn"]').click();
      await page.locator('.fd-tiles').waitFor({ state: 'attached', timeout: 5000 });
      for (const k of [1, 2, 3, 4]) { await page.screenshot({ path: `${frames}/to-clinic-${k}.png` }); await page.waitForTimeout(90); }
      await expect(page.locator('.fd-tiles')).toHaveCount(0, { timeout: 4000 });
      await vis(page, '[data-testid="fd-work-view-btn"]').click();
      await expect(page.locator('.fd-tiles')).toHaveCount(0, { timeout: 4000 });
      await page.waitForTimeout(400);
      await page.addStyleTag({ content: '.fd-tile, .fd-tile * { transition-duration: 1040ms !important; } .fd-tile { transition-delay: 0ms !important; }' });
      await vis(page, '[data-testid="fd-work-view-btn"]').click();
      await page.locator('.fd-tiles').waitFor({ state: 'attached', timeout: 5000 });
      for (const k of [1, 2, 3, 4, 5]) { await page.screenshot({ path: `${frames}/slowmo-to-clinic-${k}.png` }); await page.waitForTimeout(220); }
    }
  });
});

test.describe('lab-only tenant: unchanged', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(180_000); OUT = shotsDir(OUT_BASE); await backend(page, false); });
  test('no sections, no Clinic switch, the one table', async ({ page }) => {
    await openDesk(page);
    await expect(vis(page, '.fd-sec')).toHaveCount(0);
    await expect(vis(page, '[data-testid="fd-work-view-btn"]')).toHaveCount(0);
    if (wide(page)) await expectGridsClean(page, 'lab only');
    await expectNoPageScroll(page, 'lab only');
    await shots(page, '09-lab-only');
  });
});

test.describe('VISITS head: Patient flow ↔ Bookings (icon) · Appointments | Home collection (pills)', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(180_000); OUT = shotsDir(OUT_BASE); });
  const side = (page: Page) => page.locator('.pf-appt-split > .pf-appt-split__pane:not(.pf-appt-split__pane--work)');
  const btn = (page: Page) => side(page).locator('[data-testid="fd-side-view-btn"]');
  const title = (page: Page) => side(page).locator('[data-testid="fd-side-view-title"]');
  const pill = (page: Page, v: string) => side(page).locator(`[data-testid="fd-bookings-pills"] [role="radio"][data-value="${v}"]`);

  test('two-state icon, the dot on the icon and on the pill, pills switch, remembered', async ({ page }) => {
    await backend(page, true);
    await openDesk(page);
    if (!wide(page)) { test.info().annotations.push({ type: 'form-factor', description: 'the chart is ≥1024px only' }); return; }
    await expect(btn(page)).toHaveAttribute('data-view', 'who');
    await expect(title(page)).toHaveText(/^\s*patient flow\s*$/i);
    await expect(side(page).locator('[data-testid="fd-bookings-pills"]')).toHaveCount(0);
    // Overdue while on the chart: the rose dot on the icon, and the icon says what a tap shows.
    await expect(side(page).locator('[data-testid="fd-side-overdue-dot"]')).toHaveAttribute('aria-label', '3 appointments overdue · show bookings');
    await expect(btn(page)).toHaveAttribute('aria-label', '3 appointments overdue · show bookings');
    const b = (await btn(page).boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    await shots(page, '10-visits-who');
    await btn(page).click();
    await expect(btn(page)).toHaveAttribute('data-view', 'bookings');
    await expect(btn(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(btn(page)).toHaveAttribute('aria-label', 'Show patient flow');
    await expect(title(page)).toHaveText(/^\s*bookings\s*$/i);
    await expect(side(page).locator('[data-testid="fd-side-overdue-dot"]')).toHaveCount(0);
    // The pills: Appointments 5 (rose dot: 3 overdue) | Home collection n; "+ New" on Appointments.
    await expect(pill(page, 'appt')).toHaveAttribute('aria-checked', 'true');
    await expect(pill(page, 'appt')).toContainText('5');
    if (await pill(page, 'appt').isVisible()) await expect(pill(page, 'appt').locator('.seg-alert')).toHaveCount(1);
    await expect(pill(page, 'appt')).toHaveAttribute('aria-label', /^Appointments, 5, 3 overdue$/);
    await expect(side(page).locator('[data-testid="fd-new-appt"]')).toBeVisible();
    await page.waitForTimeout(400);
    await shots(page, '11-visits-appointments');
    await pickPill(page, 'home');
    await expect(pill(page, 'home')).toHaveAttribute('aria-checked', 'true');
    await expect(side(page).locator('[data-testid="fd-new-appt"]')).toHaveCount(0);
    await page.waitForTimeout(400);
    await shots(page, '12-visits-home');
    // Back to the chart and again to Bookings: the last pill (Home collection) comes back.
    await btn(page).click();
    await expect(btn(page)).toHaveAttribute('data-view', 'who');
    await btn(page).click();
    await expect(pill(page, 'home')).toHaveAttribute('aria-checked', 'true');
    // Remembered (leftTab = 'home').
    await page.reload();
    await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
    await expect(btn(page)).toHaveAttribute('data-view', 'bookings');
    await expect(pill(page, 'home')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('pf.lms.frontdesk.leftTab'))).toBe('home');
  });

  test('lab-only: no icon switch, title BOOKINGS, the pills only', async ({ page }) => {
    await backend(page, false);
    await openDesk(page);
    if (!(await title(page).isVisible())) { test.info().annotations.push({ type: 'form-factor', description: 'stacked side card' }); return; }
    await expect(btn(page)).toHaveCount(0);
    await expect(title(page)).toHaveText(/^\s*bookings\s*$/i);
    if (await pill(page, 'home').count()) {
      await pickPill(page, 'home');
      await expect(pill(page, 'home')).toHaveAttribute('aria-checked', 'true');
      await pickPill(page, 'appt');
      await expect(pill(page, 'appt')).toHaveAttribute('aria-checked', 'true');
    }
    await shots(page, '14-visits-lab-only');
  });
});

test.describe('OPD board + Procedures to book, moved in from /opd/desk/classic', () => {
  test.beforeEach(async () => { test.setTimeout(180_000); OUT = shotsDir(OUT_BASE); });
  const side = (page: Page) => page.locator('.pf-appt-split > .pf-appt-split__pane:not(.pf-appt-split__pane--work)');
  const pill = (page: Page, v: string) => side(page).locator(`[data-testid="fd-bookings-pills"] [role="radio"][data-value="${v}"]`);

  test('OPD on: every board doctor has a Clinic room; a doctor\'s name shows their patients; Procedures pill lists and books', async ({ page }) => {
    await backend(page, true);
    await openDesk(page);
    if (!wide(page)) { test.info().annotations.push({ type: 'form-factor', description: 'Clinic + chart ≥1024px' }); return; }
    await vis(page, '[data-testid="fd-work-view-btn"]').click();
    const clinic = vis(page, 'pf-fd-clinic');
    // Let the morph start and land (the tiles exist only while they fly).
    await page.locator('.fd-tiles').waitFor({ state: 'attached', timeout: 5000 }).catch(() => { /* reduced motion: no morph */ });
    await expect(page.locator('.fd-tiles')).toHaveCount(0, { timeout: 8000 });
    await page.waitForTimeout(300);
    const shah = clinic.locator('.cv-room[data-place="opd:doc:d9"]');
    await expect(shah).toContainText('Dr. Shah');
    await expect(shah.locator('.cv-st')).toHaveText(/Free/);
    await expect(clinic.locator('.cv-room[data-place="opd:doc:d1"]')).toContainText(/Now R-13/);
    await shots(page, '15-clinic-doctors-board');
    await clinic.locator('.cv-room[data-place="opd:doc:d2"] .cv-room__doc').click();
    await expect(vis(page, '[data-testid="fd-work-title"]')).toHaveText(/^\s*work\s*$/i);
    await expect(page.locator('.fd-tiles')).toHaveCount(0, { timeout: 5000 });
    const opdRows = page.locator('.fd-sec[data-sec="opd"] .ag-row[row-id]');
    await expect(opdRows.first()).toBeVisible();
    expect(await page.locator('.fd-sec[data-sec="opd"]').innerText()).not.toContain('Dr. Rao');
    // Bookings → Procedures (2), with the classic desk's details and a Book that waits for a date.
    await side(page).locator('[data-testid="fd-side-view-btn"]').click();
    await expect(pill(page, 'proc')).toHaveAttribute('aria-label', 'Procedures to book, 2');
    await pickPill(page, 'proc');
    const rows = side(page).locator('[data-testid="fd-proc-rows"] [data-tobook]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Knee joint injection');
    await expect(rows.first()).toContainText('Set by Dr. Rao');
    await expect(rows.first().locator('.fd-proc__book')).toBeDisabled();
    await expect(side(page).locator('[data-testid="fd-new-appt"]')).toHaveCount(0);
    await page.waitForTimeout(400);
    await shots(page, '16-bookings-procedures');
  });

  test('OPD off: no Procedures pill, no board rooms', async ({ page }) => {
    await backend(page, false);
    await openDesk(page);
    await expect(page.locator('[data-testid="fd-bookings-pills"] [data-value="proc"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="fd-proc-rows"]')).toHaveCount(0);
  });
});

test.describe('touch: every head / band control is 44×44', () => {
  test.beforeEach(async () => { test.setTimeout(180_000); OUT = shotsDir(OUT_BASE); });
  const audit = (page: Page) => page.evaluate(() => {
    const out: string[] = [];
    const heads = document.querySelectorAll<HTMLElement>('.pf-card__head, .pf-2p__head, .pf-appt-split__hdr, .pf-work-hdr, pf-hero-band');
    for (const h of Array.from(heads)) {
      for (const el of Array.from(h.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [role="radio"]'))) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (r.width < 43.5 || r.height < 43.5) out.push(`${(el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return out;
  });

  test('Frontdesk, Results and Pathologist heads on a tablet', async ({ page }) => {
    if (!isTouch()) { test.info().annotations.push({ type: 'form-factor', description: 'touch only' }); return; }
    await backend(page, true);
    await openDesk(page);
    expect(await audit(page), `Frontdesk at ${projectName()}`).toEqual([]);
    await shots(page, '17-touch-frontdesk');
    for (const route of ['/reports', '/pathologist']) {
      await page.goto(route);
      await page.locator('pf-hero-band').first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1200);
      expect(await audit(page), `${route} at ${projectName()}`).toEqual([]);
      if (route === '/pathologist') {
        // Review next is the band's one violet primary; nothing at the bottom of the side card.
        await expect(page.locator('pf-hero-band [data-testid="pv-review-next"]')).toHaveCount(1);
        await expect(page.locator('.pv-side .pv-next, .pf-bottombar .pv-next')).toHaveCount(0);
      }
      await shots(page, `17-touch${route.replace('/', '-')}`);
    }
  });
});
