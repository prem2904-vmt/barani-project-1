import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, projectName, expectLayout, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * SETTINGS LIST GRIDS (owner 2026-11-17: "our AG-Grid style, the same as Test Master") on EVERY form factor,
 * light + dark. API mocked, demo data only; pages, bands, side cards and grids are the real app. Each page is
 * shot next to Test Master (tm-*.png) for comparison. Screenshots: SHOTS_DIR/<form factor>/sg-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/settings-grids');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
/** Page errors that are the mock backend's, not the page's (WebKit reports a refused CORS fetch as a page error). */
const ownErrors = (errors: string[]) => errors.filter(e => !/access control checks/i.test(e));
/** Distinct grid rows under a card (pinned columns repeat a row in their own container). */
const rowCount = (page: Page, card: string) => page.locator(`${card} .ag-row[row-index]`).evaluateAll(els => new Set(els.map(e => e.getAttribute('row-index'))).size);

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
export const DEPTS = [
  { id: 'd1', name: 'Haematology', code: 'HEM', isActive: true, catalogKey: 'hem' },
  { id: 'd2', name: 'Biochemistry', code: 'BIO', isActive: true, catalogKey: 'bio' },
  { id: 'd3', name: 'Microbiology', code: 'MIC', isActive: true, catalogKey: 'mic' },
  { id: 'd4', name: 'Serology', code: 'SER', isActive: false, catalogKey: 'ser' },
  { id: 'd5', name: 'Cytogenetics', code: 'CYTO', isActive: true, catalogKey: null, metadata: '{"labMade":true}' },
];
const TEST = (i: number, name: string, code: string, dept: string, price: number, active = true) => ({
  id: `t${i}`, tenantId: 'tn', name, testCode: code, type: 'individual', flow: 'direct', taxSlab: 0, price, discount: 0,
  isActive: active, isEnabled: active, isOffered: true, department: dept, departmentId: DEPTS.find(d => d.name === dept)?.id,
  sampleType: 'Blood', tubeColor: 'lavender', unit: '', tatHours: 24, origin: 'master',
});
const TESTS = [
  TEST(1, 'Complete Blood Count', 'CBC', 'Haematology', 350), TEST(2, 'Haemoglobin', 'HB', 'Haematology', 120),
  TEST(3, 'ESR', 'ESR', 'Haematology', 100), TEST(4, 'Glucose Fasting', 'FBS', 'Biochemistry', 80),
  TEST(5, 'Lipid Profile', 'LIPID', 'Biochemistry', 600), TEST(6, 'Creatinine', 'CREAT', 'Biochemistry', 150),
  TEST(7, 'Urine Culture', 'UCS', 'Microbiology', 700), TEST(8, 'Widal', 'WID', 'Serology', 250, false),
];
const BRIDGES = [
  { id: 'br1', name: 'Haematology Bridge', serialShort: 'PFB-7A21', version: '1.4.2', latestVersion: '1.4.2', status: 'online', branchId: 'b1', branchName: 'Main', lastSeenAt: ago(1), lastMessageAt: ago(3), queueTotal: 0, quarantineTotal: 0, network: { ssid: 'LabWiFi', signal: 78 }, analyzers: [{ id: 'i1', name: 'Sysmex XN-350' }] },
  { id: 'br2', name: 'Biochem Bridge', serialShort: 'PFB-BEEF', version: '1.4.0', latestVersion: '1.4.2', status: 'offline', branchId: 'b1', branchName: 'Main', lastSeenAt: ago(95), lastMessageAt: ago(120), queueTotal: 12, quarantineTotal: 1, network: { ssid: 'Hospital-Staff' }, analyzers: [{ id: 'i2', name: 'Erba EM 200' }, { id: 'i3', name: 'Snibe Maglumi' }] },
  { id: 'br3', name: 'Spare Bridge', serialShort: 'PFB-0C11', version: null, status: 'never', branchId: 'b1', branchName: 'Main', analyzers: [] },
];
const INSTRUMENTS = [
  { id: 'i1', name: 'Sysmex XN-350', make: 'Sysmex', model: 'XN-350', transport: 'tcp', config: { connection: { kind: 'tcp', role: 'server', port: 5600 }, protocol: { kind: 'astm' } }, isActive: true, status: 'online', unmatchedCount: 2, hasDeviceKey: true, bridgeId: 'br1', bridgeName: 'Haematology Bridge', lastRxAt: ago(2) },
  { id: 'i2', name: 'Erba EM 200', make: 'Erba', model: 'EM 200', transport: 'serial', config: { connection: { kind: 'serial', port: 'COM3', baud: 9600 }, protocol: { kind: 'astm' } }, isActive: true, status: 'offline', unmatchedCount: 0, hasDeviceKey: true },
  { id: 'i3', name: 'Snibe Maglumi 800', make: 'Snibe', model: 'Maglumi 800', transport: 'tcp', config: { connection: { kind: 'tcp', role: 'server', port: 5599 }, protocol: { kind: 'hl7' } }, isActive: true, status: 'error', errorDetail: 'Port 5599 in use', unmatchedCount: 0, hasDeviceKey: false },
];
const PERM_CODES: Array<[string, string]> = [
  ['register_patient', 'frontdesk'], ['edit_patient', 'frontdesk'], ['view_patient', 'frontdesk'], ['create_order', 'orders'], ['view_order', 'orders'],
  ['cancel_order', 'orders'], ['create_bill', 'billing'], ['collect_payment', 'billing'], ['give_discount', 'billing'], ['override_discount', 'billing'],
  ['process_refund', 'billing'], ['collect_sample', 'collection'], ['print_barcode', 'collection'], ['enter_result', 'bench'], ['edit_result', 'bench'],
  ['validate_result', 'signout'], ['view_report', 'reports'], ['deliver_report', 'reports'], ['view_dashboard', 'oversight'], ['view_audit_log', 'oversight'],
  ['manage_tests', 'testmaster'], ['manage_users', 'setup'], ['manage_roles', 'setup'], ['manage_lab_settings', 'setup'],
];
const PERMS = PERM_CODES.map(([code], i) => ({ id: `p${i + 1}`, code, name: code.replace(/_/g, ' '), description: '' }));
const VENDORS = [
  { id: 'v1', name: 'Apollo D', code: 'APD1', contactName: 'Ravi', contactPhone: '9876543210', isActive: true, totalCredit: 0, usedCredit: 3, balance: 0, outstanding: 3, notifyThreshold: null, createdAt: '2026-01-01' },
  { id: 'v2', name: 'Apollo D', code: 'APD2', contactName: 'Meena', contactPhone: '9876500000', isActive: true, totalCredit: 471888, usedCredit: 3, balance: 0, outstanding: -471885, createdAt: '2026-01-01' },
  { id: 'v3', name: 'Kauvery Clinic', code: 'KAUV', contactName: 'Anand', isActive: true, totalCredit: 20000, usedCredit: 52300, balance: 0, outstanding: 32300, notifyThreshold: 25000, createdAt: '2026-01-01' },
  { id: 'v4', name: 'Old Partner', code: 'OLD', isActive: false, totalCredit: 5000, usedCredit: 5000, balance: 0, outstanding: 0, createdAt: '2026-01-01' },
];
const AGENTS = [
  { id: 'a1', userId: 'u1', branchId: 'b1', areaMode: 'pincode', pincodesJson: '["600040","600041","600001-600050"]', weightage: 2, isActive: true, user: { id: 'u1', name: 'Karthik Raman', email: 'karthik@demolab.example' } },
  { id: 'a2', userId: 'u2', branchId: 'b1', areaMode: 'radius', centerLat: 13.08, centerLng: 80.27, radiusKm: 5, weightage: 1, isActive: true, user: { id: 'u2', name: 'Lakshmi N', email: 'lakshmi@demolab.example' } },
  { id: 'a3', userId: 'u3', branchId: 'b1', areaMode: 'pincode', pincodesJson: '[]', weightage: 1, isActive: true, user: { id: 'u3', name: 'Suresh P', email: 'suresh@demolab.example' } },
];
const REF_LABS = [
  { id: 'rl1', name: 'Apollo Diagnostics', code: 'APOLLO', contactName: 'Suresh', contactPhone: '9840012345', contactEmail: 'ops@apollo.example', address: 'Greams Road, Chennai', isActive: true, departmentCodesJson: '["MIC","SER"]' },
  { id: 'rl2', name: 'Neuberg Ehrlich', code: 'NEU', contactName: 'Priya', contactPhone: '9840099999', isActive: true, departmentCodesJson: '["BIO"]' },
  { id: 'rl3', name: 'Metropolis', code: 'METRO', isActive: false, departmentCodesJson: null },
];
const USERS = Array.from({ length: 23 }, (_, i) => ({
  id: `u${i + 1}`, tenantId: 'tn', firstName: ['Asha', 'Ravi', 'Meena', 'Karthik', 'Priya'][i % 5], fathersName: `Kumar ${i + 1}`,
  displayName: `${['Asha', 'Ravi', 'Meena', 'Karthik', 'Priya'][i % 5]} Kumar ${i + 1}`, email: '', username: `user${i + 1}`,
  phone: '+91 98400' + String(10000 + i), isActive: i % 7 !== 3, createdAt: '2026-01-01', authId: `a${i + 1}`,
}));
const ROLES = [
  { id: 'r1', name: 'Receptionist', isPreSeeded: true, scope: 'tenant' },
  { id: 'r2', name: 'Night Shift Desk', isPreSeeded: false, scope: 'tenant' },
];

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/tests/') return ok(TESTS);
    if (r.path === '/api/kpis/assignments') return ok([
      { id: 'a1', branchId: null, kpiId: 'k1', screen: 'frontdesk_landing', enabled: true, sortOrder: 0 },
      { id: 'a2', branchId: null, kpiId: 'k3', screen: 'frontdesk_landing', enabled: false, sortOrder: 1 },
      { id: 'a3', branchId: null, kpiId: 'k2', screen: 'frontdesk_landing', enabled: true, sortOrder: 2 },
    ]);
    if (r.path === '/api/roles/r1/permissions') return ok(['p1', 'p2', 'p3', 'p4', 'p5', 'p7', 'p8', 'p9', 'p17', 'p18']);
    if (r.path === '/api/roles/r2/permissions') return ok(['p1', 'p4']);
    switch (r.path) {
      case '/api/tenants/departments': return ok(DEPTS);
      case '/api/tenants/branches': return ok([{ id: 'b1', name: 'Main', code: 'MAIN', city: 'Chennai', state: 'Tamil Nadu', defaultLabCode: 'LAB', isActive: true }, { id: 'b2', name: 'Anna Nagar', code: 'ANN', city: 'Chennai', state: 'Tamil Nadu', defaultLabCode: 'ANN', isActive: true }, { id: 'b3', name: 'Salem', code: 'SLM', city: 'Salem', state: 'Tamil Nadu', isActive: false }]);
      case '/api/config/gst': return ok([{ branchId: 'b1', gstin: '33AAAAA0000A1Z5' }]);
      case '/api/tenants/lab-spaces': return ok([{ id: 's1', branchId: 'b1', name: 'Microbiology', code: 'MIC', order: 1 }, { id: 's2', branchId: 'b1', name: 'Biochemistry', code: 'BIO', order: 2 }, { id: 's3', branchId: 'b2', name: 'Pathology', code: 'PAT', order: 1 }]);
      case '/api/tenants/department-space-links': return ok([{ branchId: 'b1', departmentId: 'd3', spaceId: 's1' }, { branchId: 'b1', departmentId: 'd2', spaceId: 's2' }]);
      case '/api/bridges': return ok(BRIDGES);
      case '/api/bridges/nearby': return ok([{ announcementId: 'a1', serialShort: 'PFB-91D0', model: 'Pi 5', version: '1.4.2', lastSeenAt: ago(1) }]);
      case '/api/instruments': return ok(INSTRUMENTS);
      case '/api/permissions': return ok(PERMS);
      case '/api/vendors': return ok(VENDORS);
      case '/api/kpis': return ok([
        { id: 'k1', code: 'CASH_IN', name: 'Cash in', description: 'Collections today', category: 'financial', valueType: 'money', defaultLabel: 'Cash in' },
        { id: 'k2', code: 'TAT_BREACH', name: 'TAT breaches', description: 'Tests past their TAT', category: 'tat', valueType: 'count', defaultLabel: 'TAT breaches' },
        { id: 'k3', code: 'PENDING', name: 'Pending samples', description: 'Collected, not yet received', category: 'operational', valueType: 'count', defaultLabel: 'Pending samples' },
        { id: 'k4', code: 'DUE', name: 'Balance due', description: 'Unpaid today', category: 'financial', valueType: 'money', defaultLabel: 'Balance due' },
      ]);
      case '/api/home-collection/agents': return ok(AGENTS);
      case '/api/appointments/config': return ok({ branchId: 'b1', queueMode: 'token_queue', slotMinutes: 30, maxConcurrentSlots: 2, open24h: false });
      case '/api/referral-labs': return ok(REF_LABS);
      case '/api/vendors/v3/transactions': return ok([{ id: 'x1', vendorId: 'v3', type: 'charge', amount: -2300, reason: 'Bill B-1042', createdAt: ago(60) }, { id: 'x2', vendorId: 'v3', type: 'payment', amount: 20000, reason: 'NEFT', createdAt: ago(3000) }]);
      case '/api/roles/': case '/api/roles': return ok(ROLES);
      case '/api/users/': case '/api/users': return ok(USERS);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
});

/** Side card and main card share the same top and bottom edges (owner: "symmetrical"). */
async function expectSymmetric(page: Page, side: string, main: string) {
  if (isPhone()) return;
  const sideEl = page.locator(side).locator('visible=true').first();
  if (!(await sideEl.count()) || await sideEl.evaluate(el => el.classList.contains('pf-sg-side--sheet'))) return; // narrow: a sheet
  const s = await sideEl.boundingBox();
  const m = await vis(page, main).boundingBox();
  if (!s || !m) return; // narrow widths: the side card is a sheet
  expect(Math.abs(s.y - m.y), 'side + main card tops align').toBeLessThan(2);
  expect(Math.abs((s.y + s.height) - (m.y + m.height)), 'side + main card bottoms align').toBeLessThan(2);
  expect(s.x, 'side card on the LEFT').toBeLessThan(m.x);
}

test.describe('settings list grids', () => {
  test('Test Master (reference)', async ({ page }) => {
    test.skip(isPhone(), 'phone opens the Settings category list first (shell-owned)');
    await go(page, '/admin/tests');
    await expect(vis(page, '.pf-tm')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1200);
    await expectLayout(page, 'test master');
    await shot(page, 'tm-test-master');
  });

  test('Bridges: styled, Test Master frame, overview LEFT, grid card', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/bridges');
    await expect(vis(page, '.pf-brl__main .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Haematology Bridge').locator('visible=true').first()).toBeVisible();
    // Kit styles apply: the main card has a real border radius + background (was raw unstyled text).
    const radius = await vis(page, '.pf-brl__main').evaluate(el => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(radius)).toBeGreaterThan(4);
    // No band buttons in Settings: Add Bridge is a secondary in the card head.
    await expect(page.locator('pf-hero-band .pf-hb__actions button').locator('visible=true')).toHaveCount(0);
    await expect(vis(page, '.pf-brl__main .pf-sg-act:has-text("Add Bridge")')).toBeVisible();
    await expectSymmetric(page, '.pf-brl__side', '.pf-brl__main');
    await expectLayout(page, 'bridges');
    await shot(page, 'sg-bridges');
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  test('Bridges: empty list is a small empty state (no giant icon)', async ({ page }) => {
    const prev = neg.hook!;
    neg.hook = r => (r.method === 'GET' && r.path === '/api/bridges' ? { status: 200, body: { success: true, data: [] } } : prev(r));
    await go(page, '/admin/bridges');
    await expect(vis(page, '.pf-sg-empty')).toBeVisible({ timeout: 60_000 });
    const box = await vis(page, '.pf-sg-empty').boundingBox();
    expect(box!.height).toBeLessThan(200);
    await shot(page, 'sg-bridges-empty');
  });

  test('Analyzers: Connect side card LEFT, same height as the grid; quiet row action', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/instruments');
    await expect(vis(page, '.pf-inl__main .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('pf-hero-band .pf-hb__actions button').locator('visible=true')).toHaveCount(0);
    await expect(vis(page, '.pf-inl__main .pf-sg-act:has-text("Add instrument")')).toBeVisible();
    await expectSymmetric(page, '.pf-inl__side', '.pf-inl__main');
    await expectLayout(page, 'analyzers');
    await shot(page, 'sg-analyzers');
    // The band switch opens Bridges.
    if (await vis(page, 'pf-hero-band pf-segmented').isVisible()) {
      await vis(page, 'pf-hero-band pf-segmented').getByText('Bridges').click();
      await expect(page).toHaveURL(/\/admin\/bridges/);
    }
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  test('Role editor: summary strip, groups LEFT, permissions grid; switch grants; Save sends the same payload', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/roles/r2/edit');
    await expect(vis(page, '.re-main .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect(vis(page, '.re-strip')).toContainText('Night Shift Desk');
    await expectSymmetric(page, '.re-side', '.re-main');
    await expectLayout(page, 'role editor');
    await shot(page, 'sg-role-editor');
    if (await page.locator('.re-side:not(.pf-sg-side--sheet)').count()) {
      await vis(page, '.re-side .re-g__btn:has-text("Billing")').click();
      await expect(vis(page, '.re-main .pf-card__label')).toContainText('Billing');
      await shot(page, 'sg-role-editor-group');
    }
    // Band search finds a permission across all groups.
    await vis(page, 'pf-hero-band input').fill('refund');
    await expect.poll(() => rowCount(page, '.re-main')).toBe(1);
    await vis(page, '.re-main .ag-row .pf-sg-switch').dispatchEvent('click');
    // Save lives in the band's top-right corner (owner 2026-11-17), enabled once something changed.
    await expect(vis(page, 'pf-hero-band [data-testid="role-save"]')).toBeEnabled();
    await shot(page, 'sg-role-editor-dirty');
    await vis(page, 'pf-hero-band [data-testid="role-save"]').click();
    await expect.poll(() => neg.calls.find(c => c.path === '/api/roles/r2/permissions')?.body)
      .toEqual({ permissionIds: ['p1', 'p4', 'p11'] });
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  test('People and access: Back from the role editor = ONE press to the overview page, same tab (never the old page)', async ({ page }) => {
    await go(page, '/admin?section=people&tab=roles');
    await expect(vis(page, '[data-testid="ov-inline"] .pf-ua-main .ag-row')).toBeVisible({ timeout: 60_000 });
    const before = await page.evaluate(() => history.length);
    await vis(page, '[data-testid="ov-inline"] .pf-ua-main .ag-row').click();
    await expect(page).toHaveURL(/\/admin\/roles\/[^/]+\/edit/, { timeout: 30_000 });
    await expect(vis(page, '.re-main')).toBeVisible({ timeout: 30_000 });
    await vis(page, 'pf-hero-band .pf-hb__back').click();
    await expect(page).toHaveURL(/\/admin\?(.*&)?section=people/, { timeout: 30_000 });
    expect(page.url()).toContain('tab=roles');
    await expect(vis(page, '[data-testid="ov-inline"] .pf-ua-main')).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => history.length), 'back popped history (no new entry)').toBe(before + 1);
    // The old standalone path never renders a second copy: it lands on the overview section, query kept.
    await go(page, '/admin/users?tab=roles');
    await expect(page).toHaveURL(/\/admin\?(.*&)?section=people/, { timeout: 30_000 });
    expect(page.url()).toContain('tab=roles');
    await expect(vis(page, '[data-testid="ov-inline"] .pf-ua-main')).toBeVisible({ timeout: 30_000 });
    // A deep link to the editor climbs to the overview page too.
    await go(page, '/admin/roles/r2/edit');
    await expect(vis(page, '.re-main')).toBeVisible({ timeout: 60_000 });
    await vis(page, 'pf-hero-band .pf-hb__back').click();
    await expect(page).toHaveURL(/\/admin\?(.*&)?section=people/, { timeout: 30_000 });
  });

  test('Role editor: system role keeps the locked-name wording', async ({ page }) => {
    await go(page, '/admin/roles/r1/edit');
    await expect(vis(page, '.re-strip')).toContainText('Editing the permissions saves a copy for your organisation only.', { timeout: 60_000 });
    await shot(page, 'sg-role-editor-system');
  });

  test('Role editor: new role', async ({ page }) => {
    await go(page, '/admin/roles/new');
    await expect(vis(page, '.re-strip input.pf-re-name')).toBeVisible({ timeout: 60_000 });
    await shot(page, 'sg-role-editor-new');
  });

  test('Credit accounts (setup): grid, status pill, outstanding tones, Edit opens the side card LEFT', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/billing?tab=credit');
    await expect(vis(page, '.pf-vn-main .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => rowCount(page, '.pf-vn-main')).toBe(4);
    await expect(vis(page, '.pf-vn-main .pf-sg-tone--credit')).toContainText('in credit');
    // The page's action sits in the pane (no band-corner primary in Settings).
    await expect(page.getByRole('button', { name: /Add vendor/ }).locator('visible=true').first()).toBeVisible();
    await expectLayout(page, 'credit accounts');
    await shot(page, 'sg-credit-setup');
    await vis(page, '.pf-vn-main .ag-row .pf-rowact[aria-label="Edit Kauvery Clinic"]').dispatchEvent('click');
    await expect(vis(page, '.pf-vn-side')).toContainText('Edit vendor');
    await expectSymmetric(page, '.pf-vn-side', '.pf-vn-main');
    await shot(page, 'sg-credit-setup-edit');
    await vis(page, '.pf-vn-side .pf-btn--primary').dispatchEvent('click');
    await expect.poll(() => neg.calls.find(c => c.path === '/api/vendors/v3' && c.method === 'PUT')?.body)
      .toEqual({ name: 'Kauvery Clinic', code: 'KAUV', contactName: 'Anand', contactPhone: null, contactEmail: null, gstin: null, address: null, isActive: true });
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  test('Credit accounts (finance): money row actions open the side panel', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/finance/credit-accounts');
    await expect(vis(page, '.pf-vn-main .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('pf-hero-band .pf-hb-btn--primary')).toHaveCount(0);
    await shot(page, 'sg-credit-money');
    await vis(page, '.pf-vn-main .ag-row .pf-rowact[aria-label="View history of Kauvery Clinic"]').dispatchEvent('click');
    await expect(vis(page, '.pf-vn-side')).toContainText('Bill B-1042');
    await shot(page, 'sg-credit-money-history');
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  test('Home collection agents: switch strip above a full-width agents grid', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/lab/home-collection?tab=agents');
    await expect(vis(page, '.pf-hc-main .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect(vis(page, '[data-testid="hc-switch-card"]')).toContainText('This branch');
    await expect(vis(page, '.pf-hc-main')).toContainText('None set');
    // The strip spans the grid's width (not a half-width card).
    if (!isPhone()) {
      const a = await vis(page, '[data-testid="hc-switch-card"]').boundingBox();
      const b = await vis(page, '.pf-hc-main').boundingBox();
      expect(Math.abs(a!.width - b!.width)).toBeLessThan(40);
    }
    await expectLayout(page, 'home collection agents');
    await shot(page, 'sg-home-collection');
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  test('Referral labs: grid, departments chips, status pill; Edit opens the side card', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/referral-labs');
    await expect(vis(page, '.pf-rl-main .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => rowCount(page, '.pf-rl-main')).toBe(3);
    await expectLayout(page, 'referral labs');
    await shot(page, 'sg-referral-labs');
    await vis(page, '.pf-rl-main .pf-rowact[aria-label="Edit Neuberg Ehrlich"]').dispatchEvent('click');
    await expect(vis(page, '.pf-rl-form')).toContainText('Edit referral lab');
    await shot(page, 'sg-referral-labs-edit');
    await vis(page, '.pf-rl-form .pf-btn--primary').dispatchEvent('click');
    await expect.poll(() => neg.calls.find(c => c.path === '/api/referral-labs/rl2' && c.method === 'PUT')?.body)
      .toEqual({ name: 'Neuberg Ehrlich', code: 'NEU', contactName: 'Priya', contactPhone: '9840099999', contactEmail: null, address: null, departmentCodesJson: '["BIO"]' });
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  test('People and access INLINE in the Settings overview: the users grid has rows (never a 0-height grid)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin?section=people');
    const grid = vis(page, '.pf-ua-main ag-grid-angular');
    await expect(grid).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.pf-ua-main .ag-row').first()).toBeVisible({ timeout: 30_000 });
    const box = await grid.boundingBox();
    expect(box!.height, 'grid has height').toBeGreaterThan(150);
    // Real width, not a pixel count: on a tablet the 340px side card + the Settings nav leave the grid ~400px, which is by design
    // (same two-panel frame everywhere); it only has to be clearly usable.
    expect(box!.width, 'grid has width').toBeGreaterThan(isPhone() ? 200 : projectName().startsWith('tablet') ? 340 : 400);
    expect(await rowCount(page, '.pf-ua-main')).toBeGreaterThan(0);
    await page.screenshot({ path: `${out()}/sg-people-inline-raw.png` });
    await page.waitForTimeout(1500);
    const box2 = await grid.boundingBox();
    expect(box2!.height, 'grid keeps its height').toBeGreaterThan(150);
    await shot(page, 'sg-people-inline');
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  test('Departments and lab spaces: tree LEFT, departments grid; a branch shows only its board', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/lab/departments?tab=departments');
    // In the Settings shell: never stuck on the skeleton (the shell's frame must not re-create the page).
    await expect(vis(page, '.ld-main .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => rowCount(page, '.ld-main')).toBe(5);
    await page.waitForTimeout(1500);
    expect(await rowCount(page, '.ld-main')).toBe(5);
    await expectLayout(page, 'lab departments');
    await shot(page, 'sg-lab-departments');
    await go(page, '/admin/lab/departments?tab=spaces-b2');
    // In the shell the frame's head names the branch (the page's own head is bare); the board is that branch's only.
    await expect(vis(page, '.ld-spaces .pf-lane-name-input')).toHaveValue('Pathology', { timeout: 60_000 });
    await expect(page.locator('.ld-spaces .pf-lane:visible')).toHaveCount(2);
    await shot(page, 'sg-lab-spaces-branch');
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  // Grids fill their card (no dead band below) on a wide and an ultra-wide screen.
  for (const [w, h] of [[1440, 900], [3440, 1440]] as const) {
    test(`grids fill the card to the bottom at ${w}×${h}`, async ({ page }) => {
      test.skip(isPhone(), 'desktop widths only');
      await page.setViewportSize({ width: w, height: h });
      for (const [url, card] of [
        ['/admin/lab/departments?tab=departments', '.ld-main'],
        ['/admin/billing?tab=credit', '.pf-vn-main'],
        ['/admin?section=people', '.pf-ua-main'],
        ['/admin/referral-labs', '.pf-rl-main'],
        ['/admin/branches', '.pf-br-main'],
        ['/admin/lab/numbers', '.pf-kpi-main'],
      ] as const) {
        await go(page, url);
        const grid = vis(page, `${card} ag-grid-angular`);
        await expect(grid).toBeVisible({ timeout: 60_000 });
        await expect(page.locator(`${card} .ag-row`).first()).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(400);
        const g = (await grid.boundingBox())!;
        const body = (await page.locator('.pf-band-body').locator('visible=true').first().boundingBox())!;
        expect(g.width, `${url} grid width`).toBeGreaterThan(w * 0.4);
        // Hosted in the shell / overview: the grid is FLUSH in the frame's card (Test Master's fill — no inset box).
        const flush = await grid.evaluate((el) => {
          const card = el.closest('.pf-tp__panel, .pf-ss__card') as HTMLElement | null;
          if (!card) return null;
          const c = card.getBoundingClientRect(); const r = el.getBoundingClientRect();
          return { left: Math.abs(r.left - c.left), right: Math.abs(r.right - c.right) };
        });
        if (flush) {
          expect(flush.left, `${url}: grid flush to the card's left edge`).toBeLessThan(3);
          expect(flush.right, `${url}: grid flush to the card's right edge`).toBeLessThan(3);
        }
        // The inline overview page sizes itself after its lazy load settles (slow on a loaded gate box): poll the gap.
        await expect.poll(async () => {
          const gg = (await grid.boundingBox())!;
          const bb = (await page.locator('.pf-band-body').locator('visible=true').first().boundingBox())!;
          return Math.round(bb.y + bb.height - (gg.y + gg.height));
        }, { message: `${url}: grid reaches the bottom`, timeout: 15_000 }).toBeLessThan(60);
        await page.screenshot({ path: `${out()}/sg-fill-${w}-${card.replace(/[^a-z]/g, '')}.png` });
      }
      // Test Master at the same size, for the side-by-side.
      await go(page, '/admin/tests');
      await expect(vis(page, '.pf-tm')).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out()}/sg-fill-${w}-testmaster.png` });
    });
  }

  test('Numbers on lab screens: screens as categories, the screen\'s cards as a grid; Add KPI; same save payload', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, isPhone() ? '/admin/lab/numbers?tab=frontdesk_landing' : '/admin/lab/numbers');
    await expect(vis(page, '.pf-kpi-main pf-data-grid .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => rowCount(page, '.pf-kpi-main')).toBe(3);
    await expectLayout(page, 'kpi numbers');
    await shot(page, 'sg-kpi-numbers');
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });

  test('Branches: Test Master grid, GSTIN read-only, status filter; Add branch opens the side card', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/branches');
    await expect(vis(page, '.pf-br-main pf-data-grid .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => rowCount(page, '.pf-br-main')).toBe(3);
    await expectLayout(page, 'branches');
    await shot(page, 'sg-branches');
    await vis(page, '.pf-sg-act').dispatchEvent('click');   // inline in the overview: the action rides its card head
    await expect(vis(page, '.pf-br-new')).toContainText('New branch');
    await shot(page, 'sg-branches-new');
    expect(ownErrors(errors), 'no uncaught errors').toEqual([]);
  });
});
