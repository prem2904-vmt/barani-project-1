import type { Page, Route } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, projectName, isDesktopApp } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * Pill fit (owner 2026-11-20): a segmented pill group never wraps its card head onto a second row, never clips a
 * label and never scrolls sideways — it tightens, then collapses into ONE pill (selected option + count + chevron)
 * that opens the options menu. Checked on Results, Frontdesk (side card, Work, Outsourced cards) and three more
 * screens that use the shared pill (Turnaround, Notifications, Pathologist), at 1440 · 1024 · 820 · 390, light + dark.
 * API mocked, made-up data only. Screenshots: SHOTS_DIR/<width>/pill-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/pill-fit-shots');

/** The widths each project covers (the tablet-landscape project also runs the owner's iPad width, 1024). */
function widths(): number[] {
  switch (projectName()) {
    case 'desktop': return [1440];
    case 'tablet-landscape': return [1024];
    case 'tablet': return [820];
    case 'phone': return [390];
    default: return [];
  }
}
const HEIGHT: Record<number, number> = { 1440: 900, 1024: 768, 820: 1180, 390: 844 };

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(350);
}
async function shot(page: Page, w: number, name: string) {
  const dir = path.join(OUT_BASE, String(w)); fs.mkdirSync(dir, { recursive: true });
  for (const dark of [false, true]) {
    await theme(page, dark);
    await expectPillHeadsFit(page, `${name} ${w} ${dark ? 'dark' : 'light'}`);
    await page.screenshot({ path: `${dir}/pill-${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await theme(page, false);
}

/**
 * Every visible head that carries a pill group: ONE row (all its visible children share a horizontal band), nothing
 * past its edges, nothing scrolling sideways inside it, and no pill label cut.
 */
async function expectPillHeadsFit(page: Page, tag: string) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const shown = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const heads = new Set<HTMLElement>();
    for (const seg of Array.from(document.querySelectorAll('pf-segmented'))) {
      if (!shown(seg)) continue;
      const head = seg.closest<HTMLElement>('.pf-card__head, .pf-appt-split__hdr');
      if (head && shown(head)) heads.add(head);
    }
    for (const head of heads) {
      const hr = head.getBoundingClientRect();
      const name = (head.className || '').toString().split(' ').slice(0, 3).join('.');
      const kids = Array.from(head.children).filter(k => shown(k) && getComputedStyle(k).position !== 'absolute');
      const rects = kids.map(k => k.getBoundingClientRect());
      const maxTop = Math.max(...rects.map(r => r.top));
      const minBottom = Math.min(...rects.map(r => r.bottom));
      if (rects.length && maxTop >= minBottom - 1) out.push(`${name}: head wraps to a second row`);
      for (const [i, r] of rects.entries()) {
        if (r.right > hr.right + 1 || r.left < hr.left - 1) out.push(`${name}: child ${(kids[i].className || kids[i].tagName).toString().slice(0, 40)} sticks out (${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(hr.left)}–${Math.round(hr.right)})`);
      }
      if (head.scrollWidth > head.clientWidth + 1) out.push(`${name}: head overflows sideways by ${head.scrollWidth - head.clientWidth}px`);
      for (const seg of Array.from(head.querySelectorAll<HTMLElement>('pf-segmented'))) {
        if (!shown(seg)) continue;
        for (let e: HTMLElement | null = seg; e && e !== head; e = e.parentElement) {
          if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') out.push(`${name}: pill scrolls sideways inside ${e.tagName.toLowerCase()}.${(e.className || '').toString().slice(0, 30)}`);
        }
        const bar = seg.querySelector<HTMLElement>('.bar');
        const sr = seg.getBoundingClientRect();
        if (bar && shown(bar)) {
          const br = bar.getBoundingClientRect();
          if (br.right > sr.right + 1) out.push(`${name}: the full pill is wider than its slot (${Math.round(br.width)} > ${Math.round(sr.width)})`);
        }
        for (const l of Array.from(seg.querySelectorAll<HTMLElement>('.seg-lbl'))) {
          if (shown(l) && l.scrollWidth > l.clientWidth + 1) out.push(`${name}: pill label "${l.textContent?.trim()}" is cut`);
        }
      }
    }
    return out;
  });
  expect(bad, `${tag}: pill heads fit`).toEqual([]);
}

/** The pill's state: 'full' | 'tight' | 'menu' (or 'none' when the head shows no pill at this width). */
async function pillState(page: Page, sel: string): Promise<string> {
  return page.evaluate(s => {
    const seg = Array.from(document.querySelectorAll<HTMLElement>(s)).find(e => e.getBoundingClientRect().width > 0);
    if (!seg) return 'none';
    return seg.classList.contains('is-menu') ? 'menu' : seg.classList.contains('is-tight') ? 'tight' : 'full';
  }, sel);
}

/** Pick an option of a pill in whichever state it shows (a radio, or the collapsed pill's menu). */
async function pickPill(page: Page, sel: string, label: string) {
  const state = await pillState(page, sel);
  if (state === 'menu') {
    await page.locator(`${sel} [data-seg-compact]`).locator('visible=true').first().click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).locator('visible=true').first().click();
    await expect(page.locator(`${sel} [data-seg-compact]`).locator('visible=true').first()).toContainText(label);
  } else {
    await page.locator(`${sel} [role="radio"]:has-text("${label}")`).locator('visible=true').first().click();
  }
}

// ── Results (/reports) ───────────────────────────────────────────────────────────────────────────────────────────
const now = new Date();
const isoAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
const today = isoAgo(0).slice(0, 10);
const rpat = (n: number, name: string, age: number, sex: string) => ({ displayName: name, age, sex, mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const rep = (n: number, name: string, deliveryStatus: string, extra: Record<string, unknown> = {}) => ({
  id: `rq-${n}`, orderId: `ord-${n}`, patientId: `p${n}`, type: 'final', status: 'generated', deliveryStatus, qrToken: `tok-${n}`,
  createdAt: isoAgo(10 + n * 9), order: { id: `ord-${n}`, orderNumber: `LAB-2611-0001${String(n).padStart(2, '0')}`, dailyNo: n, dailyNoDay: today, patient: rpat(n, name, 30 + n, n % 2 ? 'M' : 'F') },
  ...extra,
});
const QUEUE = [
  rep(1, 'Ms. Arya Stark', 'pending'), rep(2, 'Mr. Prem Kumar K', 'pending', { type: 'partial' }), rep(3, 'Mr. Sathish Kumar', 'pending'),
  rep(4, 'Nithin Ragav Gopalakrishnan', 'delivered', { deliveredVia: 'whatsapp', deliveredAt: isoAgo(20) }), rep(5, 'Ms. Meenakshi Sundareswaran Ramanathan Iyer', 'pending'),
  rep(6, 'Baby Leo S', 'failed', { deliveryNote: 'Number not on WhatsApp' }), rep(7, 'Ms. Sansa Stark', 'delivered', { deliveredVia: 'print', deliveredAt: isoAgo(50) }),
  rep(8, 'Master Sasi Kumar', 'pending'), rep(9, 'Mr. Ravi Shankar Venkataraman', 'pending'), rep(10, 'Ms. Divya Menon', 'delivered', { deliveredVia: 'whatsapp', deliveredAt: isoAgo(70) }),
];
function queuePage(url: URL) {
  const status = url.searchParams.get('status') ?? 'all';
  const rows = QUEUE.filter(r => status === 'all' || r.deliveryStatus === status);
  const n = (s: string) => QUEUE.filter(r => r.deliveryStatus === s).length;
  return { items: rows, total: rows.length, page: 1, pageSize: 50, hasMore: false, counts: { all: QUEUE.length, pending: n('pending'), delivered: n('delivered'), failed: n('failed') } };
}
const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
const okJson = (route: Route, data: unknown) => {
  const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1';
  return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
};

// ── Frontdesk (/frontdesk) — work orders + appointments + outsourced tubes ──────────────────────────────────────
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const pat = (n: number, name: string) => ({ id: `p${n}`, displayName: name, firstName: name.split(' ')[1] ?? name, sex: 'Female', gender: 'F', age: 34, mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const smp = (id: string, orderId: string, status: string) => ({
  id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, departmentId: 'd1', department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
  collectedAt: status === 'pending' ? null : minsAgo(30).toISOString(), createdAt: minsAgo(60).toISOString(),
  tests: [{ id: `${id}-t`, subOrderId: 'x', testId: 'y', name: 'Glucose', status: status === 'received' ? 'validated' : 'pending', test: { name: 'Glucose' } }],
});
const ord = (n: number, name: string, status: string, tubes: string[]) => ({
  id: `o${n}`, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: today, patientId: `p${n}`, branchId: 'b1', patient: pat(n, name),
  module: 'lab', priority: 'Normal', source: 'walkin', collectionType: 'walkin', status, createdAt: minsAgo(90).toISOString(), updatedAt: minsAgo(10).toISOString(),
  samples: tubes.map((s, i) => smp(`o${n}s${i}`, `o${n}`, s)),
});
const ORDERS = [
  ord(1, 'Ms. Meenakshi Sundareswaran Ramanathan Iyer', 'billed', ['pending']), ord(2, 'Ms. Arya Stark', 'created', ['pending']),
  ord(3, 'Mr. Sathish Kumar', 'sample_collected', ['collected']), ord(4, 'Nithin Ragav Gopalakrishnan', 'billed', ['received']),
  ord(5, 'Master Sasi Kumar', 'validated', ['received']), ord(6, 'Mr. Prem Kumar K', 'billed', ['pending']),
];
const APPTS = [
  { id: 'a1', tenantId: 't-demo', patientId: 'p20', branchId: 'b1', type: 'appointment', collectionType: 'walkin', appointmentDate: new Date(now.getTime() + 3600000).toISOString(), slotTime: '11:00', status: 'booked', consultationFee: 0, createdAt: now.toISOString(), patient: pat(20, 'Ms. Anjali Raghunathan Subramaniam') },
];
const tube = (n: number, partner: string, dispatched: boolean, status: 'outsourced' | 'completed') => ({
  sampleId: `os${n}`, barcode: `BIO2600${n}`, sampleStatus: 'collected', tubeColor: 'red', orderId: `o${n}`, orderNumber: `LAB-2611-0000${n}`, patientId: `p${n}`,
  patientName: ['Ms. Arya Stark', 'Mr. Sathish Kumar', 'Ms. Meenakshi Sundareswaran Ramanathan Iyer', 'Mr. Prem Kumar K'][n % 4], dailyNo: n, dailyNoDay: today,
  partnerLabId: 'pl1', partnerLabName: partner, createdAt: minsAgo(120).toISOString(), collectedAt: minsAgo(100).toISOString(),
  dispatchedAt: dispatched ? minsAgo(60).toISOString() : null, status, hasReport: status === 'completed',
  tests: [{ orderTestId: `ot${n}`, testId: `t${n}`, testName: 'Vitamin D (25-OH)', status, completed: status === 'completed', report: null }],
});
const OUT_TUBES = [tube(4, 'ABC Lab', true, 'outsourced'), tube(7, 'ABC Lab', false, 'outsourced'), tube(8, 'Metropolis Partner Lab', true, 'outsourced')];

async function frontdeskBackend(page: Page) {
  await page.route(/prefrontal\.health\/api\/(orders\/(today|range)|appointments\/today|billing\/outstanding|samples\/outsourced)/, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (p.endsWith('/orders/today') || p.endsWith('/orders/range')) return okJson(route, ORDERS);
    if (p.endsWith('/appointments/today')) return okJson(route, APPTS);
    if (p.endsWith('/billing/outstanding')) return okJson(route, { due: [], refundsOwed: [] });
    return okJson(route, { items: OUT_TUBES, total: OUT_TUBES.length, page: 1, pageSize: 50, hasMore: false, counts: { outsourced: OUT_TUBES.length, completed: 0 } });
  });
}

async function openAt(page: Page, w: number, route: string) {
  await page.setViewportSize({ width: w, height: HEIGHT[w] });
  await go(page, route);
  await page.waitForTimeout(600);
}

test.describe('pill fit', () => {
  test.beforeEach(async ({ page, context }) => {
    test.skip(isDesktopApp() || widths().length === 0, 'covered by the web projects');
    test.setTimeout(240_000);
    resetNeg();
    neg.hook = r => {
      if (r.method !== 'GET') return undefined;
      if (r.path === '/api/orders/partial-ready') return { status: 200, body: { success: true, data: [] } };
      return undefined;
    };
    await installNegBackend(page, context);
    await page.route(/prefrontal\.health\/api\/reports\/queue/, async route => {
      const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1';
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
      return okJson(route, queuePage(new URL(route.request().url())));
    });
    await frontdeskBackend(page);
  });

  test('Results: ONE-row head (pill tightens / collapses, count gives way), row actions fully visible', async ({ page }) => {
    for (const w of widths()) {
      await openAt(page, w, '/reports');
      await expect(page.locator('[data-testid="rq-main"]').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
      // ≥1024: the grid; below, the shared <pf-work-list> (owner 2026-11-21, small-screens).
      if (w >= 1024) await expect(page.locator('.ag-row').locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
      else await expect(page.locator('[data-testid="rq-main"] pf-work-list .pf-wl__row').locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
      await shot(page, w, 'results');
      // Row actions (grid buttons, or the list's right-edge control): every button inside the card, never past its right edge.
      {
        const cut = await page.evaluate(() => {
          const main = document.querySelector('[data-testid="rq-main"]')!.getBoundingClientRect();
          const out: string[] = [];
          for (const b of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="rq-main"] .pf-rq2-acts button, [data-testid="rq-main"] .pf-wl__act button'))) {
            const r = b.getBoundingClientRect();
            if (r.width === 0) continue;
            if (r.right > main.right - 1 || r.left < main.left) out.push(`${b.getAttribute('aria-label')} ${Math.round(r.left)}–${Math.round(r.right)} vs card ${Math.round(main.right)}`);
            if (matchMedia('(pointer: coarse)').matches && (r.width < 43.5 || r.height < 43.5)) out.push(`${b.getAttribute('aria-label')} is ${Math.round(r.width)}×${Math.round(r.height)} on touch`);
          }
          const vp = document.querySelector<HTMLElement>('[data-testid="rq-main"] .ag-center-cols-viewport');
          if (vp && vp.scrollWidth > vp.clientWidth + 1) out.push(`grid scrolls sideways by ${vp.scrollWidth - vp.clientWidth}px`);
          return out;
        });
        expect(cut, `results ${w}: row actions fully visible`).toEqual([]);
      }
      // The pill still filters, in whichever state it shows.
      const state = await pillState(page, '[data-testid="rq-pill"]');
      test.info().annotations.push({ type: `results-pill-${w}`, description: state });
      if (state !== 'none') {
        if (state === 'menu') {
          // The collapsed pill's menu, open (light + dark).
          for (const dark of [false, true]) {
            await theme(page, dark);
            await page.locator('[data-testid="rq-pill"] [data-seg-compact]').locator('visible=true').first().click();
            await expect(page.getByRole('menuitemradio', { name: /^Delivered/ }).locator('visible=true').first()).toBeVisible();
            await page.waitForTimeout(500);   // the popover's fade / rise has settled
            fs.mkdirSync(path.join(OUT_BASE, String(w)), { recursive: true });
            await page.screenshot({ path: path.join(OUT_BASE, String(w), `pill-results-menu-open--${dark ? 'dark' : 'light'}.png`) });
            await page.keyboard.press('Escape');
          }
          await theme(page, false);
        }
        await pickPill(page, '[data-testid="rq-pill"]', 'Delivered');
        await expect(page.locator('.ag-row .pf-rq2-who__name:has-text("Nithin Ragav"), pf-work-list .pf-wl__name:has-text("Nithin Ragav")').locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('.ag-row .pf-rq2-who__name:has-text("Ms. Arya Stark"), pf-work-list .pf-wl__name:has-text("Ms. Arya Stark")').locator('visible=true')).toHaveCount(0);
        if (state === 'menu') await shot(page, w, 'results-delivered-menu');
        await pickPill(page, '[data-testid="rq-pill"]', 'All');
      } else if (w > 900) {
        // Results filters (owner 2026-11-20): the status moved from the head's pill into the FILTERS side card.
        const row = page.locator('[data-testid="rq-side"] [data-filter="delivered"]').locator('visible=true').first();
        await row.click();
        await expect(page.locator('.ag-row .pf-rq2-who__name:has-text("Nithin Ragav"), pf-work-list .pf-wl__name:has-text("Nithin Ragav")').locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('.ag-row .pf-rq2-who__name:has-text("Ms. Arya Stark"), pf-work-list .pf-wl__name:has-text("Ms. Arya Stark")').locator('visible=true')).toHaveCount(0);
        await row.click();
      }
    }
  });

  test('Frontdesk: side card + Work heads ONE row; the search folds; Outsourced upload sits on the chip row', async ({ page }) => {
    for (const w of widths()) {
      await openAt(page, w, '/frontdesk');
      await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
      await shot(page, w, 'frontdesk');
      const ws = await pillState(page, '.pf-work-hdr pf-segmented');
      test.info().annotations.push({ type: `frontdesk-work-pill-${w}`, description: ws });
      // The folded search opens on tap and covers the head; Escape-free: tapping elsewhere folds it back.
      const find = page.locator('.pf-work-hdr > .pf-work-find').locator('visible=true').first();
      if (await find.count()) {
        const b = (await find.boundingBox())!;
        if (b.width <= 46) {
          expect(b.height, 'folded search is a 44px target').toBeGreaterThanOrEqual(43.5);
          await find.click();
          const open = (await find.boundingBox())!;
          expect(open.width, 'tap opens the search over the head').toBeGreaterThan(200);
          await page.keyboard.type('Arya');
          await shot(page, w, 'frontdesk-search-open');
          // Tap outside (the page margin under the band): the search folds back, the dot says a search is on.
          await page.mouse.click(6, HEIGHT[w] - 140);
          await expect.poll(async () => (await find.boundingBox())!.width).toBeLessThanOrEqual(46);
          await shot(page, w, 'frontdesk-search-folded-with-query');
          await page.locator('.pf-work-hdr > .pf-work-find input').first().fill('');
          await page.mouse.click(6, HEIGHT[w] - 140);
        }
      }
      // Outsourced cards (Work → Outsourced): the upload button shares the chip row.
      const outTab = page.locator('[role=radio][aria-label="Outsourced"], [role=tab][aria-label="Outsourced"]').locator('visible=true').first();
      if (await outTab.count()) await outTab.click();
      else if (ws === 'menu') {
        await page.locator('.pf-work-hdr pf-segmented [data-seg-compact]').locator('visible=true').first().click();
        await page.getByRole('menuitemradio', { name: /^Outsourced/ }).locator('visible=true').first().click();
      }
      // New design (owner 2026-11-21, small-screens): Outsourced draws through the ONE shared work list — divider rows,
      // status in words, the upload control at the row's right edge (the classic card rows are `.pf-out__row`).
      const ROW = '[data-testid="out-list"] .pf-wl__row:not(.pf-wl__row--skel), .pf-out__row';
      const row = page.locator(ROW).locator('visible=true').first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      const lay = await page.evaluate(sel => Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(r => r.getBoundingClientRect().width > 0).map(r => {
        const rr = r.getBoundingClientRect();
        const meta = (r.querySelector('.pf-wl__main, .pf-out__meta') as HTMLElement).getBoundingClientRect();
        const acts = (r.querySelector('.pf-wl__act, .pf-out__acts') as HTMLElement).getBoundingClientRect();
        // The upload control shares the row's text block (never alone on a line of its own) and stays inside the row.
        return { ok: acts.width > 0 && acts.top < meta.bottom && acts.bottom > meta.top && acts.right <= rr.right + 0.5, right: Math.round(rr.right - acts.right) };
      }), ROW);
      expect(lay.every(l => l.ok), `frontdesk ${w}: upload button on the row's line, inside the row ${JSON.stringify(lay)}`).toBe(true);
      await shot(page, w, 'frontdesk-outsourced');
    }
  });

  for (const s of [
    { name: 'turnaround', route: '/dashboard', ready: '.pf-card__head' },
    { name: 'notifications', route: '/notifications', ready: 'pf-segmented' },
    { name: 'pathologist', route: '/pathologist', ready: 'pf-segmented' },
    { name: 'stores', route: '/stores', ready: 'pf-segmented' },
  ]) {
    test(`${s.name}: the shared pill never wraps / clips / scrolls its head`, async ({ page }) => {
      for (const w of widths()) {
        await openAt(page, w, s.route);
        await page.locator(s.ready).locator('visible=true').first().waitFor({ timeout: 60_000 });
        await page.waitForTimeout(500);
        await shot(page, w, s.name);
      }
    });
  }
});
