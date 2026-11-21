import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, isTouch, projectName } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg, ME } from './support/neg-backend';

/**
 * Small screens (owner 2026-11-21): ≥1024px (desktop, iPad landscape) keeps the work GRID; <1024px (iPad portrait,
 * phone) draws the SAME lists through ONE shared list component (`pf-work-list`: divider rows, name + token, the key
 * facts in the grid's column order, the status in words with the time on the right, ONE primary + ⋯ at the right
 * edge). Everywhere: no native <select>, no sideways scroll, ≥44px head controls on touch, labelled tab strips,
 * a week strip whose day cells never touch. API mocked, fake data only.
 *
 * SS_AUDIT=1 = audit mode: screenshots + a facts JSON per screen, no assertions (the "before" set for AUDIT.md).
 * Screenshots: SHOTS_DIR/<project>/ss-<screen>--{light,dark}.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/small-screens');
const AUDIT = process.env['SS_AUDIT'] === '1';

const FIXED = new Date('2026-11-21T05:00:00Z');
const now = FIXED.getTime();
const ago = (m: number) => new Date(now - m * 60000).toISOString();
const today = ago(0).slice(0, 10);

// ── Frontdesk ──
const pat = (n: number, name: string, sex = 'Female', age = 34) => ({ id: `p${n}`, displayName: name, firstName: name.split(' ')[1] ?? name, sex, gender: sex[0], age, mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const smp = (id: string, orderId: string, status: string) => ({
  id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, departmentId: 'd1', department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
  collectedAt: status === 'pending' ? null : ago(30), createdAt: ago(60),
  tests: [{ id: `${id}-t`, subOrderId: id, testId: 'y', name: 'Glucose', status: status === 'received' ? 'validated' : 'pending', test: { name: 'Glucose' } }],
});
const ord = (n: number, name: string, status: string, tubes: string[], o: { mins?: number; stage?: number; doctor?: string; priority?: string; bill?: string } = {}) => {
  const id = `o${n}`;
  return {
    id, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: today, patientId: `p${n}`, branchId: 'b1', patient: pat(n, name),
    module: 'lab', refDoctorName: o.doctor, priority: o.priority ?? 'Normal', source: 'walkin', collectionType: 'walkin', status, billStatus: o.bill ?? 'paid', netPaid: 400,
    createdAt: ago(o.mins ?? 90), updatedAt: ago(o.stage ?? 10), samples: tubes.map((s, i) => smp(`${id}s${i}`, id, s)),
  };
};
const ORDERS = [
  ord(1, 'Ms. Meenakshi Sundareswaran Ramanathan Iyer', 'billed', ['pending', 'pending'], { stage: 42, doctor: 'Dr. Rao' }),
  ord(2, 'Ms. Arya Stark', 'created', ['pending'], { stage: 12 }),
  ord(3, 'Mr. Sathish Kumar', 'sample_collected', ['collected'], { stage: 22 }),
  ord(4, 'Nithin Ragav Gopalakrishnan', 'billed', ['received'], { stage: 41, doctor: 'Dr. Menon' }),
  ord(5, 'Ms. Priya Nair', 'validated', ['received'], { stage: 5 }),
  ord(6, 'Mr. Prem Kumar K', 'billed', ['pending'], { stage: 8, priority: 'Urgent' }),
  ord(7, 'Ms. Noor Khan', 'validated', ['received'], { stage: 50 }),
];
const bill = (orderId: string, balance: number) => ({
  id: `b-${orderId}`, orderId, patientId: 'p', branchId: 'b1', type: 'lab', invoiceNumber: 'INV-1', isInterstate: false, subTotal: 600, overrideDiscount: 0, totalDiscount: 0,
  totalTaxable: 600, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0, totalPayable: 600, totalPaid: 600 - balance, balance, status: balance ? 'partial' : 'paid', createdAt: ago(60), items: [], payments: [],
});
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);
const APPTS = [
  { id: 'a0', patientId: 'p22', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: ago(-60), slotTime: hhmm(ago(-60)), status: 'booked', consultationFee: 0, createdAt: ago(0), patient: pat(22, 'Ms. Revathi Krishnamoorthy') },
  { id: 'a1', patientId: 'p21', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: ago(-120), slotTime: hhmm(ago(-120)), status: 'booked', consultationFee: 0, createdAt: ago(0), patient: pat(21, 'Mr. Gopal Krishnan') },
];
const OUTSOURCED = [
  { sampleId: 'os1', barcode: 'BIO26004', sampleStatus: 'outsourced', orderId: 'o4', orderNumber: 'LAB-2609-000157', patientId: 'p4', patientName: 'Mr. Suresh Babu Ramaswamy', dailyNo: 4, dailyNoDay: today,
    partnerLabId: 'pl1', partnerLabName: 'ABC Lab', createdAt: ago(300), collectedAt: ago(280), dispatchedAt: ago(240), status: 'outsourced', hasReport: false,
    tests: [{ orderTestId: 'ot1', testId: 't1', testName: 'Vitamin D (25-OH)', status: 'outsourced', completed: false }] },
  { sampleId: 'os2', barcode: 'BIO26005', sampleStatus: 'outsourced', orderId: 'o6', orderNumber: 'LAB-2609-000158', patientId: 'p6', patientName: 'Ms. Kavya Nair', dailyNo: 6, dailyNoDay: today,
    partnerLabId: 'pl1', partnerLabName: 'ABC Lab', createdAt: ago(200), collectedAt: ago(190), dispatchedAt: null, status: 'outsourced', hasReport: false,
    tests: [{ orderTestId: 'ot2', testId: 't2', testName: 'Testing', status: 'outsourced', completed: false }] },
];

// ── Lab ──
const HAE = { id: 'hae', name: 'Haematology', code: 'HAE' };
const BIO = { id: 'bio', name: 'Biochemistry', code: 'BIO' };
const lorder = (n: number, name: string, age: number, sex: string, priority = 'Normal') =>
  ({ id: `ord-${n}`, orderNumber: `LAB-2611-0001${String(n).padStart(2, '0')}`, dailyNo: n, dailyNoDay: today, priority, patient: { id: `lp${n}`, displayName: name, firstName: name, age, sex, gender: sex, mrn: `AA01${n}`, phone: '+919876543210' } });
type Line = Record<string, unknown>;
const line = (id: string, test: string, dept: typeof HAE, sample: { id: string; barcode: string; rec: number }, o: ReturnType<typeof lorder>, extra: Line = {}): Line => ({
  id, status: 'pending', assignedTo: ME.id,
  test: { id: `t-${id}`, name: test, tatHours: 2, departmentId: dept.id, department: dept },
  subOrder: { id: sample.id, barcode: sample.barcode, receivedAtLab: ago(sample.rec), departmentId: dept.id, department: dept, order: o },
  ...extra,
});
const S = (id: string, barcode: string, rec: number) => ({ id, barcode, rec });
const O1 = lorder(3, 'Ms. Arya Stark', 30, 'F', 'Urgent');
const O2 = lorder(7, 'Mrs. Venkatalakshmi Subramaniam', 62, 'F');
const O3 = lorder(11, 'Mr. Prem Kumar K', 41, 'M');
const MY_WORK: Line[] = [
  line('l1', 'Complete Blood Count', HAE, S('s1', '0126101', 40), O1),
  line('l3', 'Liver Function Test', BIO, S('s2', '0126102', 190), O2, { status: 'in_progress' }),
  line('l5', 'Lipid Profile', BIO, S('s3', '0126103', 30), O3, { status: 're_entry', rejectionReason: 'Sample looks haemolysed — please re-run' }),
];
const QUEUE: Line[] = [
  line('q1', 'Thyroid Profile', BIO, S('s7', '0126107', 25), lorder(14, 'Mr. Farid Rahman', 52, 'M'), { assignedTo: null }),
  line('q2', 'HbA1c', BIO, S('s8', '0126108', 75), lorder(15, 'Ms. Lakshmi Narayanan', 47, 'F'), { assignedTo: null }),
];
const PV: Line[] = [
  line('v1', 'Complete Blood Count', HAE, S('s21', '0126117', 50), O2, { status: 'entered', assignedTo: null, resultedAt: ago(12), currentResult: '{"flags":{"critical":true}}' }),
  line('v4', 'Liver Function Test', BIO, S('s23', '0126118', 200), O3, { status: 'entered', assignedTo: null, resultedAt: ago(90) }),
];
const DONE: Line[] = [
  line('d1', 'Complete Blood Count', HAE, S('s31', '0126120', 300), lorder(20, 'Ms. Sansa Stark', 22, 'F'), { status: 'validated', completedAt: ago(30), resultedAt: ago(40) }),
];
const cstage = (label: string, state: string, extra: Record<string, unknown> = {}) => ({ key: label.toLowerCase(), label, state, ...extra });
const CULTURES = [
  { orderTestId: 'cu1', caseState: 'in_progress', createdAt: ago(26 * 60), patient: { age: 34, sex: 'Female', mrn: 'AA0031' }, barcode: 'MICRO26001', sampleId: 'sc1', patientName: 'Mrs. Shanthi M', dailyNo: 31, dailyNoDay: today,
    testName: 'Bacterial Culture & Sensitivity', departmentName: 'Microbiology', specimen: 'Urine',
    stages: [cstage('Gram / Direct smear', 'done', { doneAt: ago(25 * 60) }), cstage('Growth', 'open', { incubateUntil: ago(-90) }), cstage('AST', 'open')] },
];
// Lab intake: dispatched orders awaiting arrival (+ one already received).
const dorder = (n: number, name: string, st: string) => ({
  ...ord(n, name, 'sample_collected', [st]), id: `do${n}`, dailyNo: 20 + n, orderNumber: `LAB-2611-0002${n}`,
  samples: [{ ...smp(`ds${n}`, `do${n}`, st), barcode: `2612${n}`, dispatchedAt: ago(20), receivedAt: st === 'received' ? ago(5) : null }],
});
const DISPATCHED = [dorder(1, 'Ms. Sansa Stark', 'dispatched'), dorder(2, 'Mr. Jon Snow Targaryen', 'dispatched'), dorder(3, 'Ms. Brienne of Tarth', 'received')];
const rep = (n: number, name: string, deliveryStatus: string, extra: Record<string, unknown> = {}) => ({
  id: `rq-${n}`, orderId: `ord-r${n}`, patientId: `pr${n}`, type: 'final', status: 'generated', deliveryStatus, qrToken: `tok-${n}`, createdAt: ago(10 + n * 9),
  order: { id: `ord-r${n}`, orderNumber: `LAB-2611-0003${n}`, dailyNo: 40 + n, dailyNoDay: today, patient: { displayName: name, age: 30, sex: 'F', mrn: `AA03${n}`, phone: '+919876543210' } }, ...extra,
});
const REPORTS = [rep(1, 'Ms. Meenakshi Sundareswaran Ramanathan Iyer', 'pending'), rep(2, 'Mr. Sathish Kumar', 'pending'), rep(3, 'Ms. Sansa Stark', 'delivered', { deliveredVia: 'print' })];
const xe = (id: string, description: string, categoryName: string, amount: number, paymentMode: string) => ({
  id, date: today, kind: 'expense', description, categoryName, amount, paymentMode, paidTo: null, branchName: 'Main', createdBy: ME.id,
  createdByName: 'Kavya Desk', createdAt: ago(60), canEdit: true, attachments: [],
});
const EXPENSES = {
  from: today, to: today, today, scope: 'own', closedThrough: null, days: [], truncated: false, totalExpenses: 7650, totalCashIn: 0,
  entries: [xe('e1', 'Vacutainers (box of 100)', 'Consumables', 1450, 'cash'), xe('e2', 'Electricity — November', 'Utilities', 6200, 'upi')],
};
const DEPTS = [{ id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true }, { id: 'd2', name: 'Haematology', code: 'HAE', isActive: true }];
const TESTS = Array.from({ length: 12 }, (_, i) => {
  const d = DEPTS[i % 2];
  return { id: `t${i + 1}`, testCode: `${d.code}${100 + i}`, name: ['Transferrin', 'Iron Studies', 'Serum Ferritin', 'Vitamin B12'][i % 4], shortName: `S${i}`, section: 'Routine',
    type: 'individual', isActive: true, price: 120 + i * 30, priceIsDefault: false, isOffered: true, tatHours: 4, department: { id: d.id, name: d.name, code: d.code }, departmentId: d.id, tubeColor: 'Red', parameters: '[]' };
});

/** Long lists (the scroll tests): 40 rows on every list. */
let BIG = false;
const many = <T,>(base: T[], n: number, f: (x: T, i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(base[i % base.length], i));
const bigOrders = () => many(ORDERS, 40, (o, i) => ({ ...o, id: `bo${i}`, dailyNo: i + 1, orderNumber: `LAB-2611-01${String(i).padStart(3, '0')}`, patient: { ...o.patient, id: `bp${i}`, displayName: `${o.patient.displayName} ${i + 1}` } }));
const bigDispatched = () => many(DISPATCHED, 40, (o, i) => ({ ...o, id: `bdo${i}`, dailyNo: 100 + i, samples: o.samples.map(sm => ({ ...sm, id: `bds${i}`, orderId: `bdo${i}`, barcode: `27${String(i).padStart(3, '0')}` })), patient: { ...o.patient, id: `bdp${i}`, displayName: `${o.patient.displayName} ${i + 1}` } }));
const bigLines = (base: Line[]) => many(base, 40, (l, i) => {
  const so = l['subOrder'] as Record<string, unknown>;
  const ord = so['order'] as Record<string, unknown>;
  return { ...l, id: `${l['id']}-${i}`, subOrder: { ...so, id: `${so['id']}-${i}`, barcode: `03${String(i).padStart(4, '0')}`, order: { ...ord, id: `${ord['id']}-${i}`, dailyNo: 200 + i } } };
});
const bigOutsourced = () => many(OUTSOURCED, 40, (t, i) => ({ ...t, sampleId: `bos${i}`, barcode: `BIO27${String(i).padStart(3, '0')}`, dailyNo: 300 + i, patientName: `${t.patientName} ${i + 1}` }));
const bigReports = () => many(REPORTS, 40, (r, i) => ({ ...r, id: `brq-${i}`, orderId: `bord-r${i}`, order: { ...r.order, id: `bord-r${i}`, dailyNo: 400 + i } }));
const bigExpenses = () => ({ ...EXPENSES, entries: many(EXPENSES.entries, 40, (e, i) => ({ ...e, id: `be${i}`, description: `${e.description} #${i + 1}` })) });

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  BIG = false;
  resetNeg();
  neg.bills = [bill('o4', 450)];
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/samples/outsourced') { const t = BIG ? bigOutsourced() : OUTSOURCED; return ok({ items: t, total: t.length, page: 1, pageSize: 50, counts: { outsourced: t.length, completed: 0 } }); }
    if (r.path === '/api/samples/outsourced-legacy') return ok({ items: OUTSOURCED, total: OUTSOURCED.length, page: 1, pageSize: 50, counts: { outsourced: 2, completed: 0 } });
    switch (r.path) {
      case '/api/orders/today': case '/api/orders/range': return ok(BIG ? bigOrders() : ORDERS);
      case '/api/appointments/today': case '/api/appointments': return ok(APPTS);
      case '/api/orders/dispatched': return ok(BIG ? bigDispatched() : DISPATCHED);
      case '/api/samples/in-transit': return ok([]);
      case '/api/results/my-work': return ok(BIG ? bigLines(MY_WORK) : MY_WORK);
      case '/api/results/queue': case '/api/results/service-queue': return ok(QUEUE);
      case '/api/results/completed': return ok(DONE);
      case '/api/validation/queue': return ok(BIG ? bigLines(PV) : PV);
      case '/api/validation/scope': return ok({ scoped: true, departments: [HAE, BIO], validatedToday: 14, validatedTodayByMe: 6 });
      case '/api/tenants/branch-lab-config': return ok({ effectiveQueueFocus: 'patient', queueFocus: 'patient' });
      case '/api/microbiology/culture-queue': return ok(CULTURES);
      case '/api/expenses': return ok(BIG ? bigExpenses() : EXPENSES);
      case '/api/tests': case '/api/tests/': return ok(TESTS);
      case '/api/tenants/departments': return ok(DEPTS);
      default: return undefined;
    }
  };
  await page.clock.setFixedTime(FIXED);
  await installNegBackend(page, context);
  // Results queue (paged; the query string carries the status tab).
  await page.route(/prefrontal\.health\/api\/reports\/queue/, async route => {
    const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ success: true, data: { items: BIG ? bigReports() : REPORTS, total: (BIG ? 40 : REPORTS.length), page: 1, pageSize: 50, hasMore: false, counts: { all: 3, pending: 2, delivered: 1, failed: 0 } } }) });
  });
  await page.addInitScript(() => {
    const css = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}';
    const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  });
});

// ───────────────────────── helpers ─────────────────────────
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
}
async function shots(page: Page, name: string) {
  const out = path.join(OUT_BASE, projectName()); fs.mkdirSync(out, { recursive: true });
  for (const dark of [false, true]) {
    await theme(page, dark);
    await page.waitForTimeout(1100);
    await page.screenshot({ path: `${out}/ss-${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await theme(page, false);
  await page.waitForTimeout(600);
}
const settle = async (page: Page, text?: string) => {
  if (text) await page.getByText(text).locator('visible=true').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
};

/** Pick a scope / tab the way a person does on this size: a phone tab, a pill, or the collapsed pill's menu. */
async function pick(page: Page, label: string): Promise<boolean> {
  const re = new RegExp(`^\\s*${label}`, 'i');
  const tries = [
    page.locator(`[role="tab"][aria-label="${label}"]`),
    page.locator('[role="tab"]').filter({ hasText: re }),
    page.locator('[role="radio"]').filter({ hasText: re }),
  ];
  for (const t of tries) {
    const v = t.locator('visible=true').first();
    if (await v.count()) { await v.click().catch(() => undefined); await page.waitForTimeout(900); return true; }
  }
  const compact = page.locator('pf-segmented [data-seg-compact]').locator('visible=true').first();
  if (await compact.count()) {
    await compact.click().catch(() => undefined);
    const item = page.getByRole('menuitemradio', { name: re }).locator('visible=true').first();
    if (await item.count()) { await item.click().catch(() => undefined); await page.waitForTimeout(900); return true; }
    await page.keyboard.press('Escape');
  }
  return false;
}

interface Facts {
  screen: string; project: string; width: number;
  gridHeader: number; agRoot: number; workList: number; workListRows: number; rowsWithoutAction: number; pillsInList: number;
  boxedCards: number; nativeSelect: number; sortDropdown: number; sideScroll: boolean; gridSideScroll: boolean;
  smallHeadControls: string[]; iconOnlyTabs: string[]; weekStripOverlap: string[]; cutNames: number;
}
async function facts(page: Page, screen: string): Promise<Facts> {
  const f = await page.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const all = (sel: string) => Array.from(document.querySelectorAll(sel)).filter(vis);
    const se = document.scrollingElement as HTMLElement;
    const gridSide = all('.ag-center-cols-viewport').some(v => (v as HTMLElement).scrollWidth > (v as HTMLElement).clientWidth + 2);
    const heads = all('.pf-card__head, .pf-mw-pane__hdr, .pf-work-hdr, .pf-mtabs, .pf-2p__head, .pf-wl-head');
    const small: string[] = [];
    for (const h of heads) for (const c of Array.from(h.querySelectorAll('button, input, [role="tab"], [role="radio"], [role="button"], a[href]')).filter(vis)) {
      // The tap target = the box, grown by a ::after hit area (the kit's 44px trick for slim pills / icons).
      const b = c.getBoundingClientRect();
      const a = getComputedStyle(c, '::after');
      const hasHit = a.content !== 'none' && a.position === 'absolute';
      const r = { width: Math.max(b.width, hasHit ? parseFloat(a.width) || 0 : 0, hasHit ? parseFloat(a.minWidth) || 0 : 0), height: Math.max(b.height, hasHit ? parseFloat(a.height) || 0 : 0) };
      if (r.height < 43.5 || r.width < 43.5) small.push(`${c.tagName.toLowerCase()}${(c as HTMLElement).className ? '.' + String((c as HTMLElement).className).split(' ')[0] : ''} "${((c as HTMLElement).getAttribute('aria-label') || (c as HTMLElement).innerText || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // Every tab is named (aria-label or words), and the SELECTED tab shows its label on screen.
    const words = (t: Element) => ((t as HTMLElement).innerText || '').replace(/[\d\s]/g, '');
    const iconOnly = [
      ...all('[role="tab"]').filter(t => !words(t) && !(t as HTMLElement).getAttribute('aria-label')).map(() => 'unnamed tab'),
      ...all('[role="tab"][aria-selected="true"]').filter(t => !words(t)).map(t => `selected "${(t as HTMLElement).getAttribute('aria-label') || '?'}" shows no label`),
    ];
    const overlap: string[] = [];
    for (const strip of all('.pf-daystrip')) {
      const days = Array.from(strip.querySelectorAll('.pf-daystrip__day')).filter(vis).map(d => d.getBoundingClientRect());
      for (let i = 1; i < days.length; i++) if (days[i].left < days[i - 1].right + 4) overlap.push(`day ${i} gap ${Math.round(days[i].left - days[i - 1].right)}px`);
      for (const d of Array.from(strip.querySelectorAll('.pf-daystrip__dow, .pf-daystrip__n')).filter(vis)) {
        if ((d as HTMLElement).scrollWidth > (d as HTMLElement).clientWidth + 1) overlap.push(`"${(d as HTMLElement).innerText}" overflows`);
      }
    }
    const rows = all('.pf-wl__row:not(.pf-wl__row--skel)');
    const cutNames = all('.pf-wl__name, .wg-who__name, .pf-wrow__name').filter(n => getComputedStyle(n).textOverflow === 'ellipsis' && (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth).length;
    return {
      width: window.innerWidth,
      gridHeader: all('.ag-header-row').length, agRoot: all('.ag-root-wrapper').length,
      workList: all('pf-work-list').length, workListRows: rows.length,
      rowsWithoutAction: rows.filter(r => !r.hasAttribute('data-noact') && !Array.from(r.querySelectorAll('.pf-wl__act button, .pf-wl__act [role="button"]')).some(vis)).length,
      pillsInList: all('pf-work-list .pf-pill, pf-work-list .wg-pill, pf-work-list .pf-chip--static').length,
      boxedCards: all('.wg-card, .pf-out__row, .pf-rs-row, ul.pf-cards > li .pf-wrow, .pf-tq').length,
      nativeSelect: document.querySelectorAll('select').length,
      sortDropdown: all('pf-lab-sort').length,
      sideScroll: se.scrollWidth > se.clientWidth + 1, gridSideScroll: gridSide,
      smallHeadControls: small, iconOnlyTabs: iconOnly, weekStripOverlap: overlap, cutNames,
    };
  });
  return { screen, project: projectName(), ...f };
}
function record(f: Facts) {
  const out = path.join(OUT_BASE, projectName()); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `facts-${f.screen}.json`), JSON.stringify(f, null, 2));
}

type Kind = 'list' | 'list-any' | 'grid' | 'none';
/** The rules. `kind` = what the screen's main list is: a work list (grid ≥1024, shared list below: 'list'), the
 *  shared list at every size ('list-any': Outsourced, Lab intake — never a grid), a grid-only screen ('grid'), or none. */
function check(f: Facts, kind: Kind) {
  if (AUDIT) return;
  const tag = `${f.screen} @${f.project}`;
  expect(f.nativeSelect, `${tag}: no native <select>`).toBe(0);
  expect(f.sideScroll, `${tag}: no sideways page scroll`).toBe(false);
  expect(f.sortDropdown, `${tag}: no sort dropdown (headers / the Sort chip sort)`).toBe(0);
  expect(f.weekStripOverlap, `${tag}: week strip day cells never touch`).toEqual([]);
  expect(f.iconOnlyTabs, `${tag}: every tab shows a label`).toEqual([]);
  if (isTouch()) expect(f.smallHeadControls, `${tag}: head controls ≥44px`).toEqual([]);
  if (kind === 'list' || kind === 'list-any') {
    if (kind === 'list' && f.width >= 1024) {
      expect(f.gridHeader, `${tag}: ≥1024 keeps the grid header row`).toBeGreaterThan(0);
      expect(f.gridSideScroll, `${tag}: grid never scrolls sideways`).toBe(false);
    } else {
      expect(f.workList, `${tag}: <1024 draws the shared list`).toBeGreaterThan(0);
      if (f.width < 1024) expect(f.agRoot, `${tag}: <1024 has no AG-Grid`).toBe(0);
      expect(f.boxedCards, `${tag}: no boxed cards`).toBe(0);
      expect(f.rowsWithoutAction, `${tag}: every row shows its action`).toBe(0);
      expect(f.pillsInList, `${tag}: status in words, not pills`).toBe(0);
      expect(f.cutNames, `${tag}: names never ellipsis-cut`).toBe(0);
    }
  } else if (kind === 'grid') {
    expect(f.gridSideScroll || false, `${tag}: grid never scrolls sideways`).toBe(false);
  }
}

async function screen(page: Page, name: string, kind: Kind) {
  await shots(page, name);
  const f = await facts(page, name);
  record(f);
  check(f, kind);
}

// ───────────────────────── screens ─────────────────────────
test.describe('small screens — one list family, grid ≥1024', () => {
  test('Frontdesk: All', async ({ page }) => {
    await go(page, '/frontdesk');
    await settle(page, 'Arya Stark');
    // Phones / iPad portrait open on Bookings (the first tab); wide = the work grid.
    await screen(page, 'fd-all', wide(page) ? 'list' : 'none');
  });
  for (const [label, name] of [['In progress', 'fd-ip'], ['Completed', 'fd-done'], ['Payments due', 'fd-billing'], ['Outsourced', 'fd-out']] as const) {
    test(`Frontdesk: ${label}`, async ({ page }) => {
      await go(page, '/frontdesk');
      await settle(page, 'Arya Stark');
      const ok = await pick(page, label);
      if (!ok && !AUDIT) throw new Error(`${name}: no ${label} scope control`);
      await page.waitForTimeout(900);
      await screen(page, name, name === 'fd-out' ? 'list-any' : 'list');
    });
  }
  test('Frontdesk: Bookings (week strip)', async ({ page }) => {
    await go(page, '/frontdesk');
    await settle(page, 'Arya Stark');
    await pick(page, 'Appointments');
    const bk = page.locator('[data-testid="fd-left-view-btn"], button[aria-label*="bookings" i]').locator('visible=true').first();
    if (await bk.count() && !(await page.locator('.pf-daystrip').locator('visible=true').count())) await bk.click().catch(() => undefined);
    await page.waitForTimeout(900);
    await screen(page, 'fd-bookings', 'none');
  });

  test('Lab: My Work', async ({ page }) => {
    await go(page, '/lab/my-work');
    await settle(page, 'Arya Stark');
    await screen(page, 'lab-mywork', 'list');
  });
  for (const [label, name] of [['Intake', 'lab-intake'], ['Queue', 'lab-queue'], ['Completed', 'lab-completed'], ['Culture', 'lab-culture']] as const) {
    test(`Lab: ${label}`, async ({ page }) => {
      await go(page, '/lab/my-work');
      await settle(page, 'Arya Stark');
      let ok = label === 'Intake' && wide(page) ? false : await pick(page, label);
      if (!ok && label === 'Completed') ok = await pick(page, 'Done');
      // Wide: Lab Intake is the left pane (a labelled rail until opened).
      if (label === 'Intake') {
        const rail = page.locator('button[aria-label="Open Lab Intake"]').locator('visible=true').first();
        if (await rail.count()) { await rail.click(); await page.waitForTimeout(900); }
      }
      await page.waitForTimeout(900);
      await screen(page, name, label === 'Intake' ? 'list-any' : 'list');
    });
  }

  const OTHERS: [string, string, Kind, string?][] = [
    ['lab-receive', '/lab/receive', 'none', 'Sansa Stark'],
    ['collect', '/lab/collect', 'none'],
    ['pathologist', '/pathologist', 'list', 'Liver Function Test'],
    ['results', '/reports', 'list'],
    ['expenses', '/expenses', 'list', 'Vacutainers'],
    ['insights', '/insights', 'none'],
    ['test-master', '/admin/tests', 'grid', 'Transferrin'],
    ['stores', '/stores', 'grid'],
    ['settings-users', '/admin/users', 'grid'],
  ];
  for (const [name, route, kind, wait] of OTHERS) {
    test(`${name} (${route})`, async ({ page }) => {
      await go(page, route);
      await settle(page, wait);
      await page.waitForTimeout(1200);
      await screen(page, name, kind);
    });
  }

  // ── Long lists below 1024px: the band search and the list head (Sort / Filters) never scroll away (owner 2026-11-21).
  // Pattern: the band + tab strip stay put, the card head stays put, ONLY the list scrolls (inside the card).
  const SCROLL: [string, string, string?, string?][] = [
    ['fd-ip', '/frontdesk', 'In progress', '.pf-work-find__filter'],
    ['fd-out', '/frontdesk', 'Outsourced', '.pf-work-find__filter'],
    ['lab-intake', '/lab/my-work', 'Intake'],
    ['lab-mywork', '/lab/my-work'],
    ['pathologist', '/pathologist'],
    ['results', '/reports'],
    ['expenses', '/expenses'],
  ];
  for (const [name, route, tab, headSel] of SCROLL) {
    test(`long list stays usable mid-scroll: ${name}`, async ({ page }) => {
      test.skip(!['phone', 'tablet'].includes(projectName()), 'below 1024px only (wider = the grid, which scrolls inside its card already)');
      BIG = true;
      await go(page, route);
      await page.locator('pf-work-list .pf-wl__row').locator('visible=true').first().waitFor({ timeout: 45_000 }).catch(() => undefined);
      if (tab) { await pick(page, tab); await page.waitForTimeout(1200); }
      if (tab === 'Intake') {
        // iPad portrait: Lab Intake is the stacked pane (a labelled bar until opened).
        const rail = page.locator('button[aria-label="Open Lab Intake"]').locator('visible=true').first();
        if (await rail.count()) { await rail.click(); await page.waitForTimeout(1200); }
      }
      await page.locator('pf-work-list .pf-wl__row').locator('visible=true').nth(10).waitFor({ timeout: 30_000 });
      if (process.env['SS_PROBE'] === '1') console.log(`CHAIN ${name} @${projectName()}\n` + await page.evaluate(() => {
        const out: string[] = []; let e = document.querySelector('pf-work-list') as HTMLElement | null;
        while (e && e.tagName !== 'BODY') { const c = getComputedStyle(e); const r = e.getBoundingClientRect();
          out.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 3).join('.')} disp=${c.display} ov=${c.overflowY} h=${Math.round(r.height)} sh=${e.scrollHeight} flex=${c.flex} minh=${c.minHeight} hgt=${c.height}`); e = e.parentElement; }
        return out.join('\n');
      }));
      // Scroll the way a finger does: the wheel over the list (whatever element owns the scroll), 2000px.
      const list = page.locator('pf-work-list').locator('visible=true').first();
      const box = (await list.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, Math.min(box.y + 200, (page.viewportSize()!.height) - 160));
      for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(60); }
      await page.waitForTimeout(600);
      const moved = await page.evaluate(() => {
        const l = Array.from(document.querySelectorAll('pf-work-list .pf-wl__row')).find(r => r.getBoundingClientRect().height > 0);
        let e: HTMLElement | null = l as HTMLElement | null; let top = 0;
        while (e) { top = Math.max(top, e.scrollTop); e = e.parentElement; }
        return top;
      });
      const inView = async (sel: string) => {
        const el = page.locator(sel).locator('visible=true').first();
        if (!(await el.count())) return `${sel}: missing`;
        const b = await el.boundingBox();
        const vh = page.viewportSize()!.height;
        return b && b.y >= 0 && b.y + b.height <= vh ? 'ok' : `${sel}: out of view (${b ? Math.round(b.y) : '?'})`;
      };
      const searchSel = 'pf-hero-band input';
      const sortSel = headSel ?? '[data-testid="sort-chip"]';
      await shots(page, `scroll-${name}`);
      if (AUDIT) return;
      expect(moved, `${name}: the list really scrolled`).toBeGreaterThan(600);
      expect(await inView(searchSel), `${name}: band search still on screen`).toBe('ok');
      expect(await inView(sortSel), `${name}: Sort / Filters still on screen`).toBe('ok');
      expect(await page.evaluate(() => { const se = document.scrollingElement as HTMLElement; return se.scrollWidth > se.clientWidth + 1; }), `${name}: no sideways scroll`).toBe(false);
    });
  }
});