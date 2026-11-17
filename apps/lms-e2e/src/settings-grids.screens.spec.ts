import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, expectLayout, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * SETTINGS LIST GRIDS (owner 2026-11-17: "our AG-Grid style, the same as Test Master") on EVERY form factor,
 * light + dark. API mocked, demo data only; pages, bands, side cards and grids are the real app. Each page is
 * shot next to Test Master (tm-*.png) for comparison. Screenshots: SHOTS_DIR/<form factor>/sg-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/settings-grids');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();

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
    if (r.path === '/api/roles/r1/permissions') return ok(['p1', 'p2', 'p3', 'p4', 'p5', 'p7', 'p8', 'p9', 'p17', 'p18']);
    if (r.path === '/api/roles/r2/permissions') return ok(['p1', 'p4']);
    switch (r.path) {
      case '/api/tenants/departments': return ok(DEPTS);
      case '/api/tenants/branches': return ok([{ id: 'b1', name: 'Main', defaultLabCode: 'LAB', isActive: true }]);
      case '/api/bridges': return ok(BRIDGES);
      case '/api/bridges/nearby': return ok([{ announcementId: 'a1', serialShort: 'PFB-91D0', model: 'Pi 5', version: '1.4.2', lastSeenAt: ago(1) }]);
      case '/api/instruments': return ok(INSTRUMENTS);
      case '/api/permissions': return ok(PERMS);
      case '/api/vendors': return ok(VENDORS);
      case '/api/home-collection/agents': return ok(AGENTS);
      case '/api/appointments/config': return ok({ branchId: 'b1', queueMode: 'token_queue', slotMinutes: 30, maxConcurrentSlots: 2, open24h: false });
      case '/api/referral-labs': return ok(REF_LABS);
      case '/api/vendors/v3/transactions': return ok([{ id: 'x1', vendorId: 'v3', type: 'charge', amount: -2300, reason: 'Bill B-1042', createdAt: ago(60) }, { id: 'x2', vendorId: 'v3', type: 'payment', amount: 20000, reason: 'NEFT', createdAt: ago(3000) }]);
      case '/api/roles/': case '/api/roles': return ok(ROLES);
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
    const radius = await vis(page, '.pf-brl__side, .pf-brl__main .pf-sg-main__body').evaluate(el => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(radius)).toBeGreaterThan(4);
    await expect(vis(page, 'pf-hero-band .pf-hb-btn--primary')).toContainText('Add Bridge');
    await expectSymmetric(page, '.pf-brl__side', '.pf-brl__main');
    await expectLayout(page, 'bridges');
    await shot(page, 'sg-bridges');
    expect(errors, 'no uncaught errors').toEqual([]);
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
    await expect(vis(page, 'pf-hero-band .pf-hb-btn--primary')).toContainText('Add instrument');
    await expectSymmetric(page, '.pf-inl__side', '.pf-inl__main');
    await expectLayout(page, 'analyzers');
    await shot(page, 'sg-analyzers');
    // The band switch opens Bridges.
    if (await vis(page, 'pf-hero-band pf-segmented').isVisible()) {
      await vis(page, 'pf-hero-band pf-segmented').getByText('Bridges').click();
      await expect(page).toHaveURL(/\/admin\/bridges/);
    }
    expect(errors, 'no uncaught errors').toEqual([]);
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
    await expect(page.locator('.re-main .ag-row')).toHaveCount(1);
    await vis(page, '.re-main .ag-row .pf-sg-switch').click();
    await vis(page, 'pf-hero-band .pf-hb-btn--primary').click();
    await expect.poll(() => neg.calls.find(c => c.path === '/api/roles/r2/permissions')?.body)
      .toEqual({ permissionIds: ['p1', 'p4', 'p11'] });
    expect(errors, 'no uncaught errors').toEqual([]);
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
    await expect(page.locator('.pf-vn-main .ag-row')).toHaveCount(4);
    await expect(vis(page, '.pf-vn-main .pf-sg-tone--credit')).toContainText('in credit');
    await expect(vis(page, 'pf-hero-band .pf-hb-btn--primary')).toContainText('Add vendor');
    await expectLayout(page, 'credit accounts');
    await shot(page, 'sg-credit-setup');
    await vis(page, '.pf-vn-main .ag-row .pf-rowact[aria-label="Edit Kauvery Clinic"]').dispatchEvent('click');
    await expect(vis(page, '.pf-vn-side')).toContainText('Edit vendor');
    await expectSymmetric(page, '.pf-vn-side', '.pf-vn-main');
    await shot(page, 'sg-credit-setup-edit');
    await vis(page, '.pf-vn-side .pf-btn--primary').dispatchEvent('click');
    await expect.poll(() => neg.calls.find(c => c.path === '/api/vendors/v3' && c.method === 'PUT')?.body)
      .toEqual({ name: 'Kauvery Clinic', code: 'KAUV', contactName: 'Anand', contactPhone: null, contactEmail: null, gstin: null, address: null, isActive: true });
    expect(errors, 'no uncaught errors').toEqual([]);
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
    expect(errors, 'no uncaught errors').toEqual([]);
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
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('Referral labs: grid, departments chips, status pill; Edit opens the side card', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/referral-labs');
    await expect(vis(page, '.pf-rl-main .ag-row')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.pf-rl-main .ag-row')).toHaveCount(3);
    await expectLayout(page, 'referral labs');
    await shot(page, 'sg-referral-labs');
    await vis(page, '.pf-rl-main .pf-rowact[aria-label="Edit Neuberg Ehrlich"]').dispatchEvent('click');
    await expect(vis(page, '.pf-rl-form')).toContainText('Edit referral lab');
    await shot(page, 'sg-referral-labs-edit');
    await vis(page, '.pf-rl-form .pf-btn--primary').dispatchEvent('click');
    await expect.poll(() => neg.calls.find(c => c.path === '/api/referral-labs/rl2' && c.method === 'PUT')?.body)
      .toEqual({ name: 'Neuberg Ehrlich', code: 'NEU', contactName: 'Priya', contactPhone: '9840099999', contactEmail: null, address: null, departmentCodesJson: '["BIO"]' });
    expect(errors, 'no uncaught errors').toEqual([]);
  });
});
