import type { Locator, Page } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, isPhone, isTouch, projectName, shotsDir } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg, ME } from './support/neg-backend';
import { deskAllStatuses } from './support/frontdesk';

/**
 * Work grids sort on the REAL value (owner 2026-11-21: "wherever the math is there, it should sort by the math").
 * For EVERY work grid (Frontdesk one-table + per-service sections, My Work · Queue · Completed · Culture,
 * Pathologist, Results): every data column has a sort AND a filter; a click on the header LABEL sorts asc → desc →
 * none and the rows then read in numeric order (minutes, ₹, drawn/total, day + token, time) with "—" last both ways;
 * the filter icon only opens the filter (never sorts); on touch a tap on the sort ARROW still sorts; headers are
 * never cut, even with the arrow showing; no duration reads "1364h 20m". API mocked, fake data only.
 * Screenshots: SHOTS_DIR/<project>/grid-sort-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/grid-sort');

const now = Date.now();
const ago = (m: number) => new Date(now - m * 60000).toISOString();
const istDay = (m = 0) => new Date(now - m * 60000 + 330 * 60000).toISOString().slice(0, 10);
const TODAY = istDay();
const DAY = 1440;

// ── reading what the grid shows ──────────────────────────────────────────────────────────────────────────────
type Kind = 'dur' | 'money' | 'ratio' | 'token' | 'date' | 'num' | 'text' | 'rank' | 'none';
interface ColCheck { col: string; kind: Kind; sel?: string; rank?: (t: string) => number | null }
const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Minutes from "in 25m" / "12m late" / "2d 4h" / "6h 59m" / "Just now"; null for "—" / "Done" / nothing. */
function minutes(t: string): number | null {
  const s = t.trim();
  if (!s || s === '—' || /^done$/i.test(s)) return null;
  if (/just now/i.test(s)) return 0;
  const m = /((?:\d+\s*[dhm]\b\s*)+)/i.exec(s);
  if (!m) return null;
  let v = 0;
  for (const p of m[1].matchAll(/(\d+)\s*([dhm])/gi)) v += Number(p[1]) * (p[2].toLowerCase() === 'd' ? DAY : p[2].toLowerCase() === 'h' ? 60 : 1);
  return /late/i.test(s) ? -v : v;
}
function money(t: string): number | null {
  const m = /₹\s*([\d,]+(?:\.\d+)?)/.exec(t);
  if (m) return Number(m[1].replace(/,/g, ''));
  return /\bpaid\b/i.test(t) && !/unpaid/i.test(t) ? 0 : null;
}
function ratio(t: string): number | null {
  const s = t.trim();
  const m = /(\d+)\s+of\s+(\d+)/.exec(s);
  if (m) return Number(m[1]) / Number(m[2]);
  if (/^all \d+ drawn/i.test(s) || /^drawn$/i.test(s)) return 1;
  if (/^not drawn$/i.test(s)) return 0;
  return null;
}
const utcDay = (y: number, mo: number, d: number) => Date.UTC(y, mo, d) / 86_400_000;
/** "12" (today) · "2 · 1 Oct" (an older day) · "R-5" (OPD, today). */
function token(t: string): number | null {
  const m = /(\d+)\s*(?:·\s*(\d{1,2})\s+([A-Za-z]{3}))?\s*$/.exec(t.trim());
  if (!m) return null;
  const y = Number(TODAY.slice(0, 4));
  const today = utcDay(y, Number(TODAY.slice(5, 7)) - 1, Number(TODAY.slice(8, 10)));
  let day = today;
  if (m[2]) { day = utcDay(y, MON[m[3].toLowerCase()], Number(m[2])); if (day > today) day = utcDay(y - 1, MON[m[3].toLowerCase()], Number(m[2])); }
  return day * 100_000 + Number(m[1]);
}
/** "21 Nov, 9:48 PM" · "9:48 PM" (today) · "Yesterday" · "18 Nov" → epoch minutes (coarse is fine for order). */
function date(t: string): number | null {
  const s = t.trim();
  if (!s || s === '—') return null;
  const tm = /(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(s);
  let h = 0;
  if (tm) h = tm[3] ? Number(tm[1]) % 12 + (/pm/i.test(tm[3]) ? 12 : 0) : Number(tm[1]);
  const mi = tm ? Number(tm[2]) : 0;
  const d = new Date(now);
  const dm = /(\d{1,2})\s+([A-Za-z]{3})/.exec(s);
  if (dm) { d.setMonth(MON[dm[2].toLowerCase()], Number(dm[1])); if (d.getTime() > now + DAY * 60000) d.setFullYear(d.getFullYear() - 1); }
  else if (/yesterday/i.test(s)) d.setDate(d.getDate() - 1);
  d.setHours(h, mi, 0, 0);
  return Math.round(d.getTime() / 60000);
}
const PARSE: Record<Exclude<Kind, 'text' | 'rank' | 'none'>, (t: string) => number | null> = {
  dur: minutes, money, ratio, token, date, num: t => { const m = /-?\d+/.exec(t); return m ? Number(m[0]) : null; },
};

/** The column's cells in DISPLAYED order (row-index), as the text a person reads. Rows without the cell (an inline
 *  detail row) are skipped. `sel` = the element inside the cell holding the value; chips (daily no.) are dropped. */
async function columnTexts(grid: Locator, col: string, sel?: string): Promise<string[]> {
  // Rows of a list that was just replaced fade out for a moment (animateRows): wait for them to go.
  await expect.poll(() => grid.locator('.ag-row.ag-opacity-zero, .ag-row.ag-row-removed').count(), { timeout: 5000 }).toBe(0).catch(() => undefined);
  return grid.locator('.ag-row[row-index]').evaluateAll((rows, [col, sel]) => {
    const out: Array<{ i: number; t: string }> = [];
    for (const r of rows) {
      if (r.classList.contains('ag-opacity-zero') || getComputedStyle(r).opacity === '0') continue;
      const cell = r.querySelector<HTMLElement>(`.ag-cell[col-id="${col}"]`);
      if (!cell) continue;
      const el = (sel ? cell.querySelector<HTMLElement>(sel) : null) ?? cell;
      const c = el.cloneNode(true) as HTMLElement;
      c.querySelectorAll('pf-daily-no, .pf-dayno, .fd-cell-pt__tok, .wg-prio, .wg-note, .fd-flow__sub, .wg-who__meta').forEach(x => x.remove());
      const t = (c.textContent ?? '').replace(/\s+/g, ' ').trim();
      out.push({ i: Number(r.getAttribute('row-index')), t });
    }
    return out.sort((a, b) => a.i - b.i).map(x => x.t);
  }, [col, sel ?? ''] as const);
}

const blankText = (t: string) => !t.trim() || t.trim() === '—';
/** The values are in order (asc / desc) with the blanks LAST, both ways. */
function expectOrdered(label: string, texts: string[], c: ColCheck, dir: 'asc' | 'desc') {
  if (c.kind === 'none') return;
  const key = (t: string): number | string | null =>
    c.kind === 'text' ? (blankText(t) ? null : t.trim()) : c.kind === 'rank' ? c.rank!(t) : PARSE[c.kind](t);
  const vals = texts.map(key);
  const firstBlank = vals.findIndex(v => v === null);
  if (firstBlank >= 0) expect(vals.slice(firstBlank).every(v => v === null), `${label}: blanks last (${dir}) — ${JSON.stringify(texts)}`).toBe(true);
  const real = vals.filter(v => v !== null) as Array<number | string>;
  const cmp = (a: number | string, b: number | string) => typeof a === 'number' && typeof b === 'number'
    ? a - b : String(a).localeCompare(String(b), 'en', { sensitivity: 'base', numeric: true });
  for (let i = 1; i < real.length; i++) {
    const d = cmp(real[i - 1], real[i]);
    expect(dir === 'asc' ? d <= 0 : d >= 0, `${label}: ${dir} order at ${i} — ${JSON.stringify(texts)}`).toBe(true);
  }
}

const header = (grid: Locator, col: string) => grid.locator(`.ag-header-cell[col-id="${col}"]`).first();
const ariaSort = async (grid: Locator, col: string) => (await header(grid, col).getAttribute('aria-sort')) ?? 'none';
const popupOpen = (page: Page) => page.locator('.ag-popup .ag-filter, .ag-popup pf-work-set-filter, .ag-popup .ag-filter-wrapper').locator('visible=true').count();

/** Clicks each header's label: asc (rows in order) → desc (reverse order) → none; the filter icon opens only the filter. */
async function checkGrid(page: Page, grid: Locator, name: string, cols: ColCheck[]) {
  await expect(grid.locator('.ag-row').first()).toBeVisible({ timeout: 30_000 });
  const present = (await grid.locator('.ag-header-cell[col-id]').evaluateAll(hs => hs.filter(h => (h as HTMLElement).getBoundingClientRect().width > 0).map(h => h.getAttribute('col-id')))).filter(Boolean) as string[];
  const checked: string[] = [];
  for (const c of cols) {
    if (!present.includes(c.col)) continue;
    const h = header(grid, c.col);
    // BOTH a sort and a filter on every data column.
    await expect(h, `${name}/${c.col} sortable`).toHaveClass(/ag-header-cell-sortable/);
    await expect(h.locator('.ag-header-cell-filter-button'), `${name}/${c.col} has a filter`).toHaveCount(1);
    const label = h.locator('.ag-header-cell-text');
    await label.click();
    await expect.poll(() => ariaSort(grid, c.col), { message: `${name}/${c.col} asc` }).toBe('ascending');
    expectOrdered(`${name}/${c.col}`, await columnTexts(grid, c.col, c.sel), c, 'asc');
    // The header words are never cut, even with the arrow showing.
    const cut = await label.evaluate(e => (e.scrollWidth > e.clientWidth + 1 ? `${e.textContent} ${e.scrollWidth}>${e.clientWidth}` : ''));
    expect(cut, `${name}/${c.col}: header cut with the arrow showing at ${projectName()}`).toBe('');
    if (isTouch()) {
      // A tap ON the sort arrow sorts (the filter's 44px hit area never covers it).
      const arrow = h.locator('.ag-sort-indicator-icon:not(.ag-hidden)').first();
      const box = (await arrow.boundingBox())!;
      const hit = await page.evaluate(([x, y]) => {
        const e = document.elementFromPoint(x, y) as HTMLElement | null;
        return e?.closest('.ag-header-cell-filter-button') ? 'filter' : e?.closest('.ag-header-cell-label') ? 'label' : String(e?.className);
      }, [box.x + box.width / 2, box.y + box.height / 2] as const);
      expect(hit, `${name}/${c.col}: the arrow is the label's, not the filter's`).toBe('label');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await label.click();
    }
    await expect.poll(() => ariaSort(grid, c.col), { message: `${name}/${c.col} desc` }).toBe('descending');
    expect(await popupOpen(page), `${name}/${c.col}: sorting never opens the filter`).toBe(0);
    expectOrdered(`${name}/${c.col}`, await columnTexts(grid, c.col, c.sel), c, 'desc');
    await label.click();
    await expect.poll(() => ariaSort(grid, c.col), { message: `${name}/${c.col} none` }).toBe('none');
    // The filter icon opens the filter and does NOT sort.
    await h.locator('.ag-header-cell-filter-button').click();
    await expect.poll(() => popupOpen(page), { message: `${name}/${c.col} filter opens` }).toBeGreaterThan(0);
    expect(await ariaSort(grid, c.col), `${name}/${c.col}: the filter icon never sorts`).toBe('none');
    await page.keyboard.press('Escape');
    const closed = await expect.poll(() => popupOpen(page), { timeout: 1500 }).toBe(0).then(() => true, () => false);
    if (!closed) await page.mouse.click(2, 2);
    await expect.poll(() => popupOpen(page)).toBe(0);
    checked.push(c.col);
  }
  expect(checked.length, `${name}: columns checked at ${projectName()} (${present.join(',')})`).toBeGreaterThan(0);
  // Durations over a day read "2d 4h", never "1364h 20m".
  const long = await grid.locator('.ag-cell').evaluateAll(cs => cs.map(c => c.textContent ?? '')
    .filter(t => [...t.matchAll(/(\d+)d\s+(\d+)h|(\d+)h/g)].some(m => m[3] !== undefined && Number(m[3]) >= 24)));
  expect(long, `${name}: hours past a day`).toEqual([]);
  test.info().annotations.push({ type: 'checked', description: `${projectName()} ${name}: ${checked.join(', ')}` });
  return checked;
}

async function shot(page: Page, name: string) {
  const dir = shotsDir(OUT_BASE);
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/grid-sort-${name}-${dark ? 'dark' : 'light'}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { const r = document.documentElement; r.classList.remove('dark'); r.classList.add('light'); r.setAttribute('data-theme', 'light'); });
}

// ── LAB fixtures (My Work · Queue · Completed · Culture · Pathologist) ───────────────────────────────────────
const HAE = { id: 'hae', name: 'Haematology', code: 'HAE' };
const BIO = { id: 'bio', name: 'Biochemistry', code: 'BIO' };
const pat = (n: number, name: string) => ({ id: `p${n}`, displayName: name, firstName: name.split(' ')[1] ?? name, age: 30 + n, sex: 'F', gender: 'F', mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const ord = (n: number, name: string, priority = 'Normal', dayAgo = 0) => ({ id: `ord-${n}`, orderNumber: `LAB-2611-000${n}`, dailyNo: n, dailyNoDay: istDay(dayAgo * DAY), priority, patient: pat(n, name) });
type L = Record<string, unknown>;
const line = (id: string, dept: typeof HAE, sid: string, rec: number, o: ReturnType<typeof ord>, extra: L = {}): L => ({
  id, status: 'pending', assignedTo: ME.id,
  test: { id: `t-${id}`, name: 'Complete Blood Count', tatHours: 2, departmentId: dept.id, department: dept },
  subOrder: { id: sid, barcode: `0126${sid.replace(/\D/g, '').padStart(3, '0')}`, receivedAtLab: ago(rec), departmentId: dept.id, department: dept, order: o },
  ...extra,
});
// Waiting 41m · 6h 59m · 56d 20h (81860 min = the old "1364h 20m") · 5m (URGENT — the old sort kept Urgent on top).
const MY_WORK = [
  line('l1', HAE, 's1', 41, ord(3, 'Ms. Arya Stark')),
  line('l2', BIO, 's2', 419, ord(7, 'mrs. venkatalakshmi Iyer')),
  line('l3', BIO, 's3', 81860, ord(11, 'Mr. Prem Kumar K', 'Normal', 56)),
  line('l4', HAE, 's4', 5, ord(12, 'Baby Leo S', 'Urgent')),
  line('l5', HAE, 's5', 150, ord(14, 'Dr. Bala Murugan')),
];
const QUEUE = [
  line('q1', BIO, 's6', 25, ord(15, 'Mr. Sathish Kumar'), { assignedTo: null }),
  line('q2', BIO, 's7', 2900, ord(16, 'Ms. Sansa Stark', 'Urgent', 2), { assignedTo: null }),
  line('q3', HAE, 's8', 95, ord(17, 'Master Sasi Kumar'), { assignedTo: 'other-tech' }),
];
const COMPLETED = [
  line('c1', BIO, 's9', 80, ord(18, 'Nithin Ragav G'), { status: 'validated', resultedAt: ago(30), validatedAt: ago(10) }),
  line('c2', HAE, 's10', 3000, ord(19, 'ms. priya nair', 'Normal', 2), { status: 'entered', resultedAt: ago(2 * DAY + 60) }),
  line('c3', BIO, 's11', 600, ord(20, 'Mr. Rahul Dev'), { status: 'validated', resultedAt: ago(400), validatedAt: ago(390) }),
];
const PV = [
  line('v1', HAE, 's21', 50, ord(21, 'Mrs. Meena Raghavan'), { status: 'entered', assignedTo: null, resultedAt: ago(12) }),
  line('v3', BIO, 's22', 30, ord(22, 'Ms. Arya Stark', 'Urgent'), { status: 'entered', assignedTo: null, resultedAt: ago(8) }),
  line('v4', BIO, 's23', 81860, ord(23, 'Mr. Prem Kumar K', 'Normal', 56), { status: 'entered', assignedTo: null, resultedAt: ago(81000) }),
  line('v5', BIO, 's24', 40, ord(24, 'baby Leo S'), { status: 'entered', assignedTo: null, resultedAt: ago(419) }),
];
const cstage = (label: string, state: string, extra: L = {}) => ({ key: label.toLowerCase(), label, state, ...extra });
const CULTURES = [
  { orderTestId: 'cu1', caseState: 'in_progress', createdAt: ago(26 * 60), patient: { age: 34, sex: 'Female', mrn: 'AA0031' }, barcode: 'MICRO26001', sampleId: 'sc1', patientName: 'Mrs. Shanthi M', dailyNo: 31, dailyNoDay: TODAY,
    testName: 'Bacterial Culture & Sensitivity', departmentName: 'Microbiology', specimen: 'Urine',
    stages: [cstage('Gram / Direct smear', 'done', { doneAt: ago(25 * 60) }), cstage('Growth', 'open', { incubateUntil: ago(-90) }), cstage('ID', 'open'), cstage('AST', 'open')] },
  { orderTestId: 'cu2', caseState: 'in_progress', createdAt: ago(50 * 60), patient: { age: 62, sex: 'Female', mrn: 'AA0007' }, barcode: 'MICRO26002', sampleId: 'sc2', patientName: 'ms. Kavya Nair', dailyNo: 32, dailyNoDay: TODAY,
    testName: 'Blood Culture', departmentName: 'Microbiology', specimen: 'Blood',
    stages: [cstage('Gram / Direct smear', 'done', { doneAt: ago(49 * 60) }), cstage('Growth', 'open', { incubateUntil: ago(40) }), cstage('AST', 'open')] },
  { orderTestId: 'cu3', caseState: 'in_progress', createdAt: ago(3 * 60), patient: { age: 41, sex: 'Male', mrn: 'AA0011' }, barcode: 'MICRO26003', sampleId: 'sc3', patientName: 'Mr. Prem Kumar K', dailyNo: 33, dailyNoDay: TODAY,
    testName: 'Pus Culture', departmentName: 'Microbiology', specimen: 'Pus', stages: [cstage('Gram / Direct smear', 'open'), cstage('Growth', 'open')] },
  { orderTestId: 'cu4', caseState: 'awaiting_signout', createdAt: ago(9 * DAY), barcode: 'MICRO26004', sampleId: 'sc4', patientName: 'Baby Leo S', dailyNo: 34, dailyNoDay: istDay(9 * DAY),
    testName: 'Stool Culture', departmentName: 'Microbiology', specimen: 'Stool', stages: [cstage('Gram / Direct smear', 'done'), cstage('Growth', 'done')] },
];

const prioRank = (t: string) => (/urgent/i.test(t) ? 0 : /normal/i.test(t) ? 1 : null);
const LAB_WORK: ColCheck[] = [
  { col: 'sample', kind: 'text', sel: '.wg-id' },
  { col: 'patient', kind: 'text', sel: '.wg-who__name' },
  { col: 'priority', kind: 'rank', rank: prioRank },
  { col: 'due', kind: 'dur', sel: '.wg-tat' },
  { col: 'wait', kind: 'dur', sel: '.wg-tat' },
  { col: 'status', kind: 'text', sel: '.wg-pill' },
];

let focus: 'patient' | 'sample' = 'sample';
async function labBackend(page: Page, context: Parameters<typeof installNegBackend>[1]) {
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    switch (r.path) {
      case '/api/results/my-work': return ok(MY_WORK);
      case '/api/results/service-queue': return ok(QUEUE);
      case '/api/results/completed': return ok(COMPLETED);
      case '/api/validation/queue': return ok(PV);
      case '/api/validation/scope': return ok({ scoped: true, departments: [HAE, BIO], validatedToday: 4, validatedTodayByMe: 2 });
      case '/api/critical-results/lookup': return ok([]);
      case '/api/tenants/branch-lab-config': return ok({ effectiveQueueFocus: focus, queueFocus: focus });
      case '/api/users/': return ok([{ id: 'other-tech', displayName: 'Ravi T' }]);
      case '/api/microbiology/culture-queue': return ok(CULTURES);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
}
async function labTab(page: Page, label: string) {
  const radio = page.locator(`[role="radio"]:has-text("${label}")`).locator('visible=true').first();
  if (await radio.count()) { await radio.click(); return; }
  const compact = page.locator('pf-segmented [data-seg-compact]').locator('visible=true').first();
  if (await compact.count()) { await compact.click(); await page.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).locator('visible=true').first().click(); }
}

test.describe('lab work grids', () => {
  test.beforeEach(async ({ page, context }) => { test.setTimeout(420_000); focus = 'sample'; await labBackend(page, context); });

  test('My Work · Queue · Completed · Culture — every column sorts on the real value', async ({ page }) => {
    if (isPhone()) { test.info().annotations.push({ type: 'form-factor', description: 'phones have card rows (no headers)' }); return; }
    await go(page, '/lab/my-work');
    const grid = page.locator('[data-testid="mw-grid"]').locator('visible=true').first();
    await expect(grid.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    // Default order = Urgent first (no header owns it: no arrow anywhere).
    expect(await grid.locator('.ag-header-cell[aria-sort="ascending"], .ag-header-cell[aria-sort="descending"]').count()).toBe(0);
    await checkGrid(page, grid, 'my-work', LAB_WORK);
    // The owner's case: Waiting desc puts the 56-day tube first even though the 5m one is Urgent.
    if (await header(grid, 'wait').isVisible()) {
      await header(grid, 'wait').locator('.ag-header-cell-text').click();
      await header(grid, 'wait').locator('.ag-header-cell-text').click();
      expect((await columnTexts(grid, 'wait'))[0]).toBe('56d 20h');
      await shot(page, 'mywork-wait-desc');
      await header(grid, 'wait').locator('.ag-header-cell-text').click();
    }

    await labTab(page, 'Queue');
    await expect(grid.getByText('Ms. Sansa Stark')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await checkGrid(page, grid, 'queue', LAB_WORK);

    await labTab(page, 'Completed');
    await expect(grid.getByText('Nithin Ragav G')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await checkGrid(page, grid, 'completed', [
      { col: 'sample', kind: 'text', sel: '.wg-id' }, { col: 'patient', kind: 'text', sel: '.wg-who__name' },
      { col: 'status', kind: 'text', sel: '.wg-pill' }, { col: 'when', kind: 'date' },
    ]);

    await labTab(page, 'Culture');
    const cg = page.locator('[data-testid="cg-grid"]').locator('visible=true').first();
    await expect(cg.locator('.ag-row').first()).toBeVisible({ timeout: 30_000 });
    const nextRank = (t: string) => ({ 'Gram / Direct smear': 0, Growth: 1, ID: 2, AST: 2, 'Sign-out': 9 } as Record<string, number>)[t.trim()] ?? null;
    await checkGrid(page, cg, 'culture', [
      { col: 'sample', kind: 'text', sel: '.wg-id' }, { col: 'patient', kind: 'text', sel: '.wg-who__name' },
      { col: 'test', kind: 'none' }, { col: 'day', kind: 'num' }, { col: 'next', kind: 'rank', rank: nextRank }, { col: 'due', kind: 'dur' },
    ]);
    await shot(page, 'culture');
  });

  test('My Work patient focus — every column sorts; inline tubes stay under their patient', async ({ page }) => {
    if (isPhone()) return;
    focus = 'patient';
    await go(page, '/lab/my-work');
    const grid = page.locator('[data-testid="mw-grid"]').locator('visible=true').first();
    await expect(grid.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
    await checkGrid(page, grid, 'my-work-patient', LAB_WORK.filter(c => c.col !== 'sample'));
    // The kept view state (view-state) brings a sort back after in-app navigation — any column, here Due desc — and
    // the comparators still order it by minutes.
    const due = header(grid, 'due').locator('.ag-header-cell-text');
    await due.click(); await due.click();
    await expect.poll(() => ariaSort(grid, 'due')).toBe('descending');
    const inApp = (p: string) => page.evaluate(path => {
      if (location.hash.startsWith('#/')) location.hash = '#' + path;
      else { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }
    }, p);
    await inApp('/reports');
    await page.waitForURL(/\/reports/, { timeout: 30_000 });
    await expect(grid).toHaveCount(0, { timeout: 30_000 });
    await inApp('/lab/my-work');
    await expect(grid.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => ariaSort(grid, 'due'), { message: 'Due desc restored' }).toBe('descending');
    expectOrdered('my-work-patient/due restored', await columnTexts(grid, 'due', '.wg-tat'), { col: 'due', kind: 'dur' }, 'desc');
  });

  test('Pathologist — every column sorts on the real value', async ({ page }) => {
    if (isPhone()) return;
    await go(page, '/pathologist');
    const grid = page.locator('[data-testid="pv-grid"]').locator('visible=true').first();
    await expect(grid.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
    await checkGrid(page, grid, 'pathologist', [
      { col: 'sample', kind: 'text', sel: '.pv-tile__id' }, { col: 'patient', kind: 'text', sel: '.wg-who__name' },
      { col: 'status', kind: 'text', sel: '.wg-pill' }, { col: 'due', kind: 'dur', sel: '.pv-due' }, { col: 'wait', kind: 'dur', sel: '.wg-tat' },
    ]);
    await shot(page, 'pathologist');
  });
});

// ── RESULTS ───────────────────────────────────────────────────────────────────────────────────────────────
const rpat = (n: number, name: string) => ({ displayName: name, age: 30 + n, sex: n % 2 ? 'F' : 'M', mrn: `AA01${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const rep = (n: number, name: string, deliveryStatus: string, mins: number, extra: L = {}) => ({
  id: `rq-${n}`, orderId: `ord-${n}`, patientId: `p${n}`, type: 'final', status: 'generated', deliveryStatus, qrToken: `tok-${n}`,
  createdAt: ago(mins), order: { id: `ord-${n}`, orderNumber: `LAB-2611-0001${String(n).padStart(2, '0')}`, dailyNo: n, dailyNoDay: istDay(mins), patient: rpat(n, name) },
  ...extra,
});
const REPORTS = [
  rep(12, 'Ms. Arya Stark', 'pending', 20),
  rep(2, 'mr. prem kumar K', 'delivered', 3 * DAY, { deliveredVia: 'print' }),
  rep(30, 'Nithin Ragav G', 'failed', 90, { deliveryNote: 'Number not on WhatsApp' }),
  rep(3, 'Baby Leo S', 'delivered', 70, { deliveredVia: 'email' }),
  rep(9, 'Ms. Lakshmi Narayanan', 'pending', 2 * DAY),
];
const statusRank = (t: string) => (/ready|completed|to send/i.test(t) ? 0 : /partial|partly/i.test(t) ? 1 : /fail/i.test(t) ? 2 : /deliver/i.test(t) ? 3 : null);

test('Results — every column sorts on the real value', async ({ page, context }) => {
  test.setTimeout(300_000);
  if (isPhone()) return;
  resetNeg();
  neg.hook = r => (r.method === 'GET' && r.path === '/api/orders/partial-ready' ? { status: 200, body: { success: true, data: [] } } : undefined);
  await installNegBackend(page, context);
  await page.route(/prefrontal\.health\/api\/reports\/queue/, async route => {
    const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const n = (s: string) => REPORTS.filter(r => r.deliveryStatus === s).length;
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: {
      items: REPORTS, total: REPORTS.length, page: 1, pageSize: 50, hasMore: false, counts: { all: REPORTS.length, pending: n('pending'), delivered: n('delivered'), failed: n('failed') } } }) });
  });
  await go(page, '/reports');
  const grid = page.locator('[data-testid="rq-main"] pf-data-grid').locator('visible=true').first();
  await expect(grid.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
  await checkGrid(page, grid, 'results', [
    { col: 'no', kind: 'token' }, { col: 'patient', kind: 'text', sel: '.pf-rq2-who__name' }, { col: 'order', kind: 'text' },
    { col: 'status', kind: 'rank', sel: '.pf-rq2-pill', rank: statusRank }, { col: 'generated', kind: 'date' }, { col: 'sent', kind: 'none' },
  ]);
  await shot(page, 'results');
});

// ── FRONTDESK (one table · per-service sections) ─────────────────────────────────────────────────────────────
const FD_TENANT = { id: 't-demo', name: 'Demo Lab' };
const FD_ME = { id: 'app-fd', authId: 'sub-fd' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;
const smp = (id: string, orderId: string, status: string) => ({
  id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, departmentId: 'd1', department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
  collectedAt: status === 'pending' ? null : ago(30), createdAt: ago(60), tests: [{ id: `${id}-t`, subOrderId: 'x', testId: 'y', name: 'Glucose', status: status === 'received' ? 'validated' : 'pending', test: { name: 'Glucose' } }],
});
const fdOrd = (n: number, name: string, status: string, tubes: string[], o: { stage: number; module?: string; priority?: string; dayAgo?: number; doctor?: string }) => {
  const id = `o${n}`;
  return {
    id, orderNumber: `${(o.module ?? 'lab').toUpperCase()}-2611-0000${n}`, dailyNo: n, dailyNoDay: istDay((o.dayAgo ?? 0) * DAY), patientId: `p${n}`, branchId: 'b1', patient: pat(n, name),
    module: o.module ?? 'lab', refDoctorName: o.doctor, priority: o.priority ?? 'Normal', source: 'walkin', collectionType: 'walkin', status,
    createdAt: ago(Math.max(o.stage + 5, (o.dayAgo ?? 0) * DAY + 5)), updatedAt: ago(o.stage), samples: tubes.map((s, i) => smp(`${id}s${i}`, id, s)),
  };
};
const FD_ORDERS = [
  fdOrd(1, 'Ms. Meenakshi Sundareswaran', 'billed', ['pending', 'pending'], { stage: 42, doctor: 'Dr. Rao' }),
  fdOrd(2, 'Mr. Sathish Kumar', 'sample_collected', ['collected', 'pending'], { stage: 419 }),
  fdOrd(3, 'nithin Ragav', 'billed', ['received'], { stage: 81860, dayAgo: 56 }),
  fdOrd(4, 'Ms. Arya Stark', 'billed', ['pending'], { stage: 5, priority: 'Urgent' }),
  fdOrd(5, 'Baby Leo S', 'billed', ['collected', 'collected', 'pending'], { stage: 150, dayAgo: 1 }),
  fdOrd(13, 'Mr. Ravi Shankar (IPD)', 'billed', ['pending'], { stage: 50, module: 'ipd', doctor: 'Dr. Rao', dayAgo: 2 }),
  fdOrd(14, 'Mrs. Latha Ramaswamy', 'billed', ['collected'], { stage: 20, module: 'ipd', doctor: 'Dr. Menon' }),
];
const fdBill = (orderId: string, balance: number) => ({
  id: `b-${orderId}`, orderId, patientId: 'p', branchId: 'b1', type: 'lab', invoiceNumber: 'INV-1', isInterstate: false, subTotal: 1500, overrideDiscount: 0, totalDiscount: 0,
  totalTaxable: 1500, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0, totalPayable: 1500, totalPaid: 1500 - balance, balance, status: balance ? 'partial' : 'paid', createdAt: ago(0), items: [], payments: [],
});
const visit = (i: number, name: string, status: string, doc: 1 | 2, mins: number, extra: L = {}) => ({
  id: `v${i}`, patientId: `pv${i}`, patientName: name, patientMeta: `${30 + i}/F · AA02${String(i).padStart(2, '0')}`,
  doctorUserId: `d${doc}`, doctorName: doc === 1 ? 'Dr. Rao' : 'Dr. Menon', departmentName: 'General medicine', visitNumber: `OPD-00${i}`,
  visitDate: TODAY, token: i, tokenLabel: `${doc === 1 ? 'R' : 'M'}-${i}`, status, isFollowUp: false, charged: 500, billStatus: 'paid', hasLabOrder: false,
  createdAt: ago(mins + 5), checkedInAt: ago(mins), vitalsFlagged: false, ...extra,
});
const VISITS = [
  visit(1, 'Asha Mohan', 'waiting', 1, 44), visit(2, 'vikram Subramanian', 'waiting', 2, 81860), visit(10, 'Fathima Begum', 'waiting', 1, 9),
  visit(3, 'Rahul Dravid', 'in_consult', 1, 419), visit(4, 'Anu Krishnamurthy', 'vitals', 2, 4, { vitalsSummary: 'BP 150/95', vitalsFlagged: true }),
];

async function fdBackend(page: Page, opd: boolean) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, d: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: d }) });
  const orders = opd ? FD_ORDERS : FD_ORDERS.filter(o => o.module === 'lab');
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (p === '/api/auth/me') return route.fulfill(ok(origin, {
      id: FD_ME.id, authId: FD_ME.authId, firstName: 'Kavya', fathersName: 'Desk', displayName: 'Kavya Desk', email: 'desk@demo.test',
      tenantId: FD_TENANT.id, tenantName: FD_TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Receptionist'], permissions: ['*'],
      branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false, opdEntitled: opd,
    }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: FD_TENANT.id, name: FD_TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/orders/today' || p === '/api/orders/range') return route.fulfill(ok(origin, orders));
    if (p === '/api/appointments/today') return route.fulfill(ok(origin, []));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: [fdBill('o1', 450), fdBill('o3', 1200.5), fdBill('o5', 99), fdBill('o13', 700)], refundsOwed: [] }));
    const m = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (m) return route.fulfill(ok(origin, orders.find(x => x.id === m[1]) ?? {}));
    if (p.startsWith('/api/opd/')) {
      if (p === '/api/opd/visits') return route.fulfill(ok(origin, opd ? VISITS : []));
      if (p === '/api/opd/visits/desk') return route.fulfill(ok(origin, { today: TODAY, config: { workflow: { vitals: 'desk', labTestsAtDesk: true, billing: 'before_consult' }, queue: { organise: 'per_doctor', doctorUnavailable: 'manual' } }, doctors: [], departments: [] }));
      return route.fulfill(ok(origin, []));
    }
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ access_token: jwt(FD_ME.authId), refresh_token: `rt-${FD_ME.authId}`, token_type: 'bearer', expires_in: 86400, user: { id: FD_ME.authId, aud: 'authenticated', email: 'desk@demo.test' } }) });
  });
  await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(() => ws.send('{}\x1e')); });
  await page.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1'); localStorage.clear();
      localStorage.setItem('pf.session', session as string); localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf.wa.manual.reminded', '1');
    }
  }, [JSON.stringify({ access_token: jwt(FD_ME.authId), refresh_token: `rt-${FD_ME.authId}` })] as const);
}
async function openDesk(page: Page) {
  await page.goto('/frontdesk');
  await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
  await deskAllStatuses(page);
  await page.waitForTimeout(800);
}
const FD_COMMON: ColCheck[] = [
  { col: 'token', kind: 'token', sel: '.fd-cell-tok' }, { col: 'patient', kind: 'text', sel: '.fd-cell-pt__name' },
];
const FD_TAIL: ColCheck[] = [{ col: 'wait', kind: 'dur', sel: '.fd-flow__wait, .fd-flow__txt' }, { col: 'pay', kind: 'money', sel: '.fd-flow__pay, .fd-flow__txt' }];

test.describe('Frontdesk work grids', () => {
  test.beforeEach(() => { test.setTimeout(420_000); });

  test('one table (a single-service lab) — every column sorts on the real value', async ({ page }) => {
    await fdBackend(page, false);
    await openDesk(page);
    const grid = page.locator('pf-fd-flow-grid').locator('visible=true').first();
    if (!(await grid.count()) || !(await grid.locator('.ag-header-cell').count())) { test.info().annotations.push({ type: 'form-factor', description: 'no grid at this width' }); return; }
    await checkGrid(page, grid, 'frontdesk', [...FD_COMMON, { col: 'where', kind: 'text', sel: '.fd-flow__stage' }, ...FD_TAIL]);
    // Waiting desc: the 56-day order first ("56d 20h", never "1364h 20m").
    if (await header(grid, 'wait').isVisible().catch(() => false)) {
      await header(grid, 'wait').locator('.ag-header-cell-text').click();
      await header(grid, 'wait').locator('.ag-header-cell-text').click();
      const w = (await columnTexts(grid, 'wait', '.fd-flow__wait')).map(minutes).filter((x): x is number => x !== null);
      expect(w[0], 'Waiting desc: the longest wait first').toBe(Math.max(...w));
      await shot(page, 'frontdesk-wait-desc');
      // Number filter in MINUTES with a preset: "> 30 min" keeps only rows waiting over half an hour.
      await header(grid, 'wait').locator('.ag-header-cell-filter-button').click();
      await page.locator('.ag-popup .ag-filter-select').locator('visible=true').first().click();
      await page.locator('.ag-list-item, .ag-select-list-item').filter({ hasText: '> 30 min' }).locator('visible=true').first().click();
      await expect.poll(async () => (await columnTexts(grid, 'wait', '.fd-flow__wait')).every(t => (minutes(t) ?? 0) > 30)).toBe(true);
      expect((await columnTexts(grid, 'wait', '.fd-flow__wait')).length).toBeGreaterThan(0);
      await shot(page, 'frontdesk-wait-filter');
      await page.locator('.ag-popup button:has-text("Reset")').locator('visible=true').first().click();
      await page.keyboard.press('Escape');
    }
  });

  test('All split by service — each section\'s own columns sort on the real value', async ({ page }) => {
    await fdBackend(page, true);
    await openDesk(page);
    if (!(await page.locator('.fd-sec').locator('visible=true').count())) { test.info().annotations.push({ type: 'form-factor', description: 'no sections at this width' }); return; }
    const sec = (s: string) => page.locator(`.fd-sec[data-sec="${s}"] pf-fd-flow-grid`).first();
    const own = (id: string, kind: Kind): ColCheck => ({ col: id, kind, sel: '.fd-flow__txt' });
    await checkGrid(page, sec('lab'), 'section-lab', [...FD_COMMON, own('samples', 'ratio'), { col: 'where', kind: 'text', sel: '.fd-flow__stage' }, ...FD_TAIL]);
    await checkGrid(page, sec('opd'), 'section-opd', [...FD_COMMON, own('doctor', 'text'), own('vitals', 'none'), own('consult', 'none'), ...FD_TAIL]);
    await checkGrid(page, sec('ipd'), 'section-ipd', [...FD_COMMON, own('admitted', 'none'), own('doctor', 'text'), { col: 'where', kind: 'text', sel: '.fd-flow__stage' }, ...FD_TAIL]);
    // OPD Waiting desc: the 56-day visit reads "56d 20h" (the old "1364h 20m").
    const opd = sec('opd');
    if (await header(opd, 'wait').isVisible().catch(() => false)) {
      await header(opd, 'wait').locator('.ag-header-cell-text').click();
      await header(opd, 'wait').locator('.ag-header-cell-text').click();
      const texts = await columnTexts(opd, 'wait', '.fd-flow__txt');
      expect(texts[0], 'the 56-day visit reads in days ("56d 20h", the old "1364h 20m")').toBe('56d 20h');
    }
    await shot(page, 'frontdesk-sections');
  });
});
