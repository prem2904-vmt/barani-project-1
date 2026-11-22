import * as os from 'node:os';
import * as path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, isPhone, projectName, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';
import { DOCTORS, HOSPITALS } from './support/referring';

/**
 * EVERY GRID SORTS AND FILTERS (owner 2026-11-21: "Wherever a grid is used, filter and sort must be there"). For each
 * grid in the app that the mocked backend can open: every non-action header has a sort affordance AND a filter icon;
 * a click on a header LABEL sorts asc → desc → none and the rows then read in order of the value; the filter icon
 * opens the filter and never sorts. (The work grids — Frontdesk, My Work, Pathologist, Results, Culture — are covered
 * by grid-sort.screens.spec.ts; OPD / pharmacy grids sit behind pf.opd() and are covered by unit tests.)
 * API mocked, fake data only. Screenshots: SHOTS_DIR/<project>/ag-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/settings-grids2');
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

// ── fixtures (fake) ───────────────────────────────────────────────────────────────────────────────────────────
const DEPTS = [
  { id: 'd1', name: 'Haematology', code: 'HEM', isActive: true, catalogKey: 'hem' },
  { id: 'd2', name: 'Biochemistry', code: 'BIO', isActive: true, catalogKey: 'bio' },
  { id: 'd3', name: 'Microbiology', code: 'MIC', isActive: true, catalogKey: 'mic' },
  { id: 'd4', name: 'Serology', code: 'SER', isActive: false, catalogKey: 'ser' },
];
const TEST = (i: number, name: string, code: string, dept: string, price: number, active = true) => ({
  id: `t${i}`, tenantId: 'tn', name, testCode: code, type: 'individual', flow: 'direct', taxSlab: 0, price, discount: 0,
  isActive: active, isEnabled: active, isOffered: true, department: dept, departmentId: DEPTS.find(d => d.name === dept)?.id,
  sampleType: 'Blood', tubeColor: 'lavender', unit: '', tatHours: [24, 4, 48, 6, 12, 2][i % 6], origin: 'master',
});
const TESTS = [
  TEST(1, 'Complete Blood Count', 'CBC', 'Haematology', 350), TEST(2, 'Haemoglobin', 'HB', 'Haematology', 120),
  TEST(3, 'ESR', 'ESR', 'Haematology', 100), TEST(4, 'Glucose Fasting', 'FBS', 'Biochemistry', 80),
  TEST(5, 'Lipid Profile', 'LIPID', 'Biochemistry', 600), TEST(6, 'Creatinine', 'CREAT', 'Biochemistry', 1150),
];
const BRIDGES = [
  { id: 'br1', name: 'Haematology Bridge', serialShort: 'PFB-7A21', version: '1.4.2', latestVersion: '1.4.2', status: 'online', branchId: 'b1', branchName: 'Main', lastSeenAt: ago(1), lastMessageAt: ago(3), queueTotal: 0, quarantineTotal: 0, network: { ssid: 'LabWiFi', signal: 78 }, analyzers: [] },
  { id: 'br2', name: 'Biochem Bridge', serialShort: 'PFB-BEEF', version: '1.4.0', latestVersion: '1.4.2', status: 'offline', branchId: 'b1', branchName: 'Main', lastSeenAt: ago(95), lastMessageAt: ago(120), queueTotal: 12, quarantineTotal: 1, network: { ssid: 'Hospital-Staff' }, analyzers: [] },
  { id: 'br3', name: 'Annex Bridge', serialShort: 'PFB-0C11', version: '1.3.9', status: 'online', branchId: 'b1', branchName: 'Main', lastSeenAt: ago(2), lastMessageAt: ago(9000), queueTotal: 3, quarantineTotal: 0, network: { ssid: 'Annex' }, analyzers: [] },
];
const INSTRUMENTS = [
  { id: 'i1', name: 'Sysmex XN-350', make: 'Sysmex', model: 'XN-350', transport: 'tcp', config: { connection: { kind: 'tcp', role: 'server', port: 5600 }, protocol: { kind: 'astm' } }, isActive: true, status: 'online', unmatchedCount: 2, hasDeviceKey: true, lastRxAt: ago(2) },
  { id: 'i2', name: 'Erba EM 200', make: 'Erba', model: 'EM 200', transport: 'serial', config: { connection: { kind: 'serial', port: 'COM3', baud: 9600 }, protocol: { kind: 'astm' } }, isActive: true, status: 'offline', unmatchedCount: 11, hasDeviceKey: true },
  { id: 'i3', name: 'Snibe Maglumi 800', make: 'Snibe', model: 'Maglumi 800', transport: 'tcp', config: { connection: { kind: 'tcp', role: 'server', port: 5599 }, protocol: { kind: 'hl7' } }, isActive: true, status: 'error', errorDetail: 'Port 5599 in use', unmatchedCount: 0, hasDeviceKey: false },
];
const VENDORS = [
  { id: 'v1', name: 'Apollo Diagnostics', code: 'APD', contactName: 'Ravi', contactPhone: '9876543210', isActive: true, totalCredit: 0, usedCredit: 300, balance: 0, outstanding: 300, createdAt: '2026-01-01' },
  { id: 'v2', name: 'Kauvery Clinic', code: 'KAUV', contactName: 'Anand', isActive: true, totalCredit: 20000, usedCredit: 52300, balance: 0, outstanding: 32300, notifyThreshold: 25000, createdAt: '2026-01-01' },
  { id: 'v3', name: 'Old Partner', code: 'OLD', isActive: false, totalCredit: 5000, usedCredit: 5000, balance: 0, outstanding: 0, createdAt: '2026-01-01' },
];
const REF_LABS = [
  { id: 'rl1', name: 'Neuberg Ehrlich', code: 'NEU', contactName: 'Priya', contactPhone: '9840099999', isActive: true, departmentCodesJson: '["BIO"]' },
  { id: 'rl2', name: 'Apollo Diagnostics', code: 'APOLLO', contactName: 'Suresh', contactPhone: '9840012345', isActive: true, departmentCodesJson: '["MIC","SER"]' },
  { id: 'rl3', name: 'Metropolis', code: 'METRO', isActive: false, departmentCodesJson: null },
];
const USERS = Array.from({ length: 9 }, (_, i) => ({
  id: `u${i + 1}`, tenantId: 'tn', firstName: ['Asha', 'Ravi', 'Meena', 'Karthik', 'Priya'][i % 5], fathersName: `Kumar ${i + 1}`,
  displayName: `${['Asha', 'Ravi', 'Meena', 'Karthik', 'Priya'][i % 5]} Kumar ${i + 1}`, email: '', username: `user${i + 1}`,
  phone: '+91 98400' + String(10000 + i), isActive: i % 4 !== 3, createdAt: '2026-01-01', authId: `a${i + 1}`,
}));
const AGENTS = [
  { id: 'a1', userId: 'u1', branchId: 'b1', areaMode: 'pincode', pincodesJson: '["600040","600041"]', weightage: 2, isActive: true, user: { id: 'u1', name: 'Karthik Raman', email: 'karthik@demolab.example' } },
  { id: 'a2', userId: 'u2', branchId: 'b1', areaMode: 'radius', centerLat: 13.08, centerLng: 80.27, radiusKm: 5, weightage: 1, isActive: true, user: { id: 'u2', name: 'Lakshmi N', email: 'lakshmi@demolab.example' } },
  { id: 'a3', userId: 'u3', branchId: 'b1', areaMode: 'pincode', pincodesJson: '[]', weightage: 3, isActive: false, user: { id: 'u3', name: 'Suresh P', email: 'suresh@demolab.example' } },
];
const ITEMS = [
  { id: 'it1', sku: 'EDTA-3', name: 'EDTA tube 3 ml', category: 'consumable', uom: 'pcs', reorderLevel: 200, nearExpiryDays: 30, isActive: true, onHand: 140, lowStock: true },
  { id: 'it2', sku: 'GLV-M', name: 'Gloves (M)', category: 'ppe', uom: 'box', reorderLevel: 10, nearExpiryDays: 30, isActive: true, onHand: 42, lowStock: false },
  { id: 'it3', sku: 'RGT-GLU', name: 'Glucose reagent', category: 'reagent', uom: 'kit', reorderLevel: 2, nearExpiryDays: 30, isActive: true, onHand: 0, lowStock: true },
];
const MESSAGES = [
  { id: 'm1', instrumentId: 'i1', instrumentName: 'Sysmex XN-350', sampleId: '0126001', state: 'unmatched', isQc: false, receivedAt: ago(5), resultCount: 22, mappedCount: 20, preview: [{ code: 'WBC', value: '7.2' }] },
  { id: 'm2', instrumentId: 'i2', instrumentName: 'Erba EM 200', sampleId: null, state: 'unmatched', isQc: false, receivedAt: ago(300), resultCount: 3, mappedCount: 3, preview: [{ code: 'GLU', value: '102' }] },
  { id: 'm3', instrumentId: 'i1', instrumentName: 'Sysmex XN-350', sampleId: '0126044', state: 'unmatched', isQc: false, receivedAt: ago(3000), resultCount: 9, mappedCount: 1, preview: [] },
];

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(180_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    switch (r.path) {
      case '/api/referring-network/hospitals': return ok(HOSPITALS);
      case '/api/referring-network/doctors': return ok(DOCTORS);
      case '/api/tests/': case '/api/tests': return ok(TESTS);
      case '/api/tenants/departments': return ok(DEPTS);
      case '/api/tenants/branches': return ok([{ id: 'b1', name: 'Main', code: 'MAIN', city: 'Chennai', state: 'Tamil Nadu', isActive: true }, { id: 'b2', name: 'Anna Nagar', code: 'ANN', city: 'Chennai', state: 'Tamil Nadu', isActive: true }, { id: 'b3', name: 'Salem', code: 'SLM', city: 'Salem', state: 'Tamil Nadu', isActive: false }]);
      case '/api/config/gst': return ok([{ branchId: 'b1', gstin: '33AAAAA0000A1Z5' }]);
      case '/api/bridges': return ok(BRIDGES);
      case '/api/instruments': return ok(INSTRUMENTS);
      case '/api/instruments/messages': return ok({ items: MESSAGES, total: MESSAGES.length });
      case '/api/vendors': return ok(VENDORS);
      case '/api/referral-labs': return ok(REF_LABS);
      case '/api/users/': case '/api/users': return ok(USERS);
      case '/api/roles/': case '/api/roles': return ok([{ id: 'r1', name: 'Receptionist', isPreSeeded: true, scope: 'tenant' }, { id: 'r2', name: 'Night Shift Desk', isPreSeeded: false, scope: 'tenant' }, { id: 'r3', name: 'Auditor', isPreSeeded: false, scope: 'tenant' }]);
      case '/api/home-collection/agents': return ok(AGENTS);
      case '/api/inventory/items': return ok(ITEMS);
      case '/api/inventory/alerts': return ok({ lowStock: [], expiring: [] });
      case '/api/tenants/lab-spaces': return ok([]);
      case '/api/tenants/department-space-links': return ok([]);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
});

// ── the generic check ─────────────────────────────────────────────────────────────────────────────────────────
/** Action / icon-only columns are exempt (no value to sort or filter). */
const EXEMPT = /^(actions|act|next|open)$/;
const ariaSort = async (h: Locator) => (await h.getAttribute('aria-sort')) ?? 'none';
const popupOpen = (page: Page) => page.locator('.ag-popup .ag-filter, .ag-popup pf-work-set-filter, .ag-popup .ag-filter-wrapper').locator('visible=true').count();

/** Line 1 of each row's cell, in displayed order (status words: line 1; two-line cells: the main line). */
async function columnTexts(grid: Locator, col: string): Promise<string[]> {
  await expect.poll(() => grid.locator('.ag-row.ag-opacity-zero, .ag-row.ag-row-removed').count(), { timeout: 5000 }).toBe(0).catch(() => undefined);
  return grid.locator('.ag-center-cols-container .ag-row[row-index], .ag-pinned-left-cols-container .ag-row[row-index]').evaluateAll((rows, c) => {
    const out = new Map<number, string>();
    for (const r of rows) {
      const cell = r.querySelector<HTMLElement>(`.ag-cell[col-id="${c}"]`);
      if (!cell) continue;
      const main = cell.querySelector<HTMLElement>('.pf-sg-cell__main, .pf-sw__now, .pf-tm-clamp2') ?? cell;
      out.set(Number(r.getAttribute('row-index')), (main.textContent ?? '').replace(/\s+/g, ' ').trim());
    }
    return [...out.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }, col);
}
const blank = (t: string) => !t || t === '—';
/** Rows read in order of the value: numbers when every value is a number (₹1,150 / 12 / 4h), else text. */
function expectOrdered(label: string, texts: string[], dir: 'asc' | 'desc') {
  const firstBlank = texts.findIndex(blank);
  if (firstBlank >= 0) expect(texts.slice(firstBlank).every(blank), `${label}: blanks last (${dir}) ${JSON.stringify(texts)}`).toBe(true);
  const real = texts.filter(t => !blank(t));
  const nums = real.map(t => { const m = /^[₹\s]*(-?[\d,]+(?:\.\d+)?)\b/.exec(t); return m ? Number(m[1].replace(/,/g, '')) : NaN; });
  const numeric = nums.every(n => Number.isFinite(n));
  for (let i = 1; i < real.length; i++) {
    const d = numeric ? nums[i - 1] - nums[i] : real[i - 1].localeCompare(real[i], 'en', { sensitivity: 'base', numeric: true });
    expect(dir === 'asc' ? d <= 0 : d >= 0, `${label}: ${dir} at ${i} ${JSON.stringify(texts)}`).toBe(true);
  }
}

/** Every visible non-action header sorts + filters; `sortCols` are clicked asc → desc → none and read in order. */
async function checkGrid(page: Page, grid: Locator, name: string, sortCols: string[]) {
  await expect(grid.locator('.ag-row').first(), `${name}: rows`).toBeVisible({ timeout: 30_000 });
  const heads = await grid.locator('.ag-header-cell[col-id]').evaluateAll(hs => hs
    .filter(h => (h as HTMLElement).getBoundingClientRect().width > 0)
    .map(h => ({ id: h.getAttribute('col-id') ?? '', text: (h.querySelector('.ag-header-cell-text')?.textContent ?? '').trim() })));
  const data = heads.filter(h => !EXEMPT.test(h.id) && !/^ag-Grid-/.test(h.id));
  expect(data.length, `${name}: data columns at ${projectName()}`).toBeGreaterThan(0);
  for (const h of data) {
    const el = grid.locator(`.ag-header-cell[col-id="${h.id}"]`).first();
    await expect(el, `${name}/${h.id} (${h.text}) has a sort`).toHaveClass(/ag-header-cell-sortable/);
    await expect(el.locator('.ag-header-cell-filter-button'), `${name}/${h.id} (${h.text}) has a filter icon`).toHaveCount(1);
  }
  const checked: string[] = [];
  for (const col of sortCols) {
    if (!data.some(h => h.id === col)) continue;
    const el = grid.locator(`.ag-header-cell[col-id="${col}"]`).first();
    const label = el.locator('.ag-header-cell-text');
    // A column may start sorted (the list's default order): click until it reads ascending.
    for (let i = 0; i < 3 && (await ariaSort(el)) !== 'ascending'; i++) await label.click();
    await expect.poll(() => ariaSort(el), { message: `${name}/${col} asc` }).toBe('ascending');
    const asc = await columnTexts(grid, col);
    expectOrdered(`${name}/${col}`, asc, 'asc');
    await label.click();
    await expect.poll(() => ariaSort(el), { message: `${name}/${col} desc` }).toBe('descending');
    expect(await popupOpen(page), `${name}/${col}: sorting never opens the filter`).toBe(0);
    const desc = await columnTexts(grid, col);
    expectOrdered(`${name}/${col}`, desc, 'desc');
    if (new Set(asc.filter(t => !blank(t))).size > 1) expect(desc, `${name}/${col}: the click reorders the rows`).not.toEqual(asc);
    await label.click();
    await expect.poll(() => ariaSort(el), { message: `${name}/${col} none` }).toBe('none');
    // The filter icon opens the filter and does not sort.
    await el.locator('.ag-header-cell-filter-button').click();
    await expect.poll(() => popupOpen(page), { message: `${name}/${col} filter opens` }).toBeGreaterThan(0);
    expect(await ariaSort(el), `${name}/${col}: the filter icon never sorts`).toBe('none');
    await page.keyboard.press('Escape');
    if (!(await expect.poll(() => popupOpen(page), { timeout: 1500 }).toBe(0).then(() => true, () => false))) await page.mouse.click(2, 2);
    checked.push(col);
  }
  expect(checked.length, `${name}: sorted columns at ${projectName()} (${data.map(h => h.id).join(',')})`).toBeGreaterThan(0);
  test.info().annotations.push({ type: 'grid', description: `${projectName()} ${name}: ${data.map(h => h.id).join(', ')} · sorted ${checked.join(', ')}` });
}

async function shot(page: Page, name: string) {
  const dir = shotsDir(OUT_BASE);
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/ag-${name}-${dark ? 'dark' : 'light'}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { const r = document.documentElement; r.classList.remove('dark'); r.classList.add('light'); r.setAttribute('data-theme', 'light'); });
}

const firstGrid = (page: Page) => page.locator('pf-data-grid, ag-grid-angular').locator('visible=true').first();
/** Name, route, the columns to click (several, so a phone's trimmed column set still has one). */
const GRIDS: Array<{ name: string; route: string; sort: string[]; before?: (p: Page) => Promise<void> }> = [
  { name: 'referring-doctors', route: '/admin/referring-network', sort: ['name', 'department', 'phone', 'hospitals'] },
  { name: 'referring-hospitals', route: '/admin/referring-network', sort: ['name', 'doctors'],
    before: async p => {
      // Wide head: the Doctors | Hospitals pill; a tight head (phone / tablet) collapses it to a selected-pill menu.
      const radio = p.locator('pf-segmented [role="radio"]:has-text("Hospitals")').locator('visible=true').first();
      await p.locator('pf-segmented [role="radio"], pf-segmented [data-seg-compact]').locator('visible=true').first().waitFor();
      if (await radio.count()) await radio.click();
      else {
        await p.locator('pf-segmented [data-seg-compact]').locator('visible=true').first().click();
        await p.getByRole('menuitemradio', { name: /^Hospitals/ }).locator('visible=true').first().click();
      }
      await expect(p.locator('.ag-header-cell[col-id="doctors"], .ag-header-cell[col-id="name"]:has-text("Hospital")').locator('visible=true').first()).toBeVisible();
    } },
  { name: 'test-master', route: '/admin/tests', sort: ['name', 'price', 'tatHours', 'testCode'] },
  { name: 'branches', route: '/admin/branches', sort: ['name', 'place', 'code'] },
  { name: 'bridges', route: '/admin/bridges', sort: ['name', 'queue', 'lastMessage'] },
  { name: 'instruments', route: '/admin/instruments', sort: ['name', 'unmatched'] },
  { name: 'referral-labs', route: '/admin/referral-labs', sort: ['name', 'code'] },
  { name: 'vendors', route: '/admin/vendors', sort: ['name', 'outstanding', 'charged'] },
  { name: 'users', route: '/admin/users', sort: ['displayName', 'phone'] },
  { name: 'home-collection-agents', route: '/admin/lab/home-collection?tab=agents', sort: ['agent', 'weight'] },
  { name: 'inventory', route: '/admin/inventory', sort: ['item', 'onHand', 'reorder'] },
  { name: 'analyzer-results', route: '/lab/analyzer-results', sort: ['receivedAt', 'results', 'sampleId'] },
];

test.describe('every grid: sort + filter on every data column', () => {
  for (const g of GRIDS) {
    test(g.name, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await go(page, g.route);
      if (g.before) await g.before(page);
      const grid = firstGrid(page);
      await checkGrid(page, grid, g.name, g.sort);
      if (!isPhone() || g.name.startsWith('referring')) await shot(page, g.name);
      expect(errors.filter(e => !/access control checks/i.test(e)), `${g.name}: page errors`).toEqual([]);
    });
  }
});
