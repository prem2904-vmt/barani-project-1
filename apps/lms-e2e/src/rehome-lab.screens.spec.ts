import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, expectLayout, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * LAB settings, merged pages (Settings re-home) on EVERY form factor, light + dark. API mocked, demo data only;
 * the pages, bands and cards are the real app. Screenshots: SHOTS_DIR/<form factor>/lab-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/rehome-lab');
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

const DEPTS = [
  { id: 'd1', name: 'Haematology', code: 'HEM', isActive: true },
  { id: 'd2', name: 'Biochemistry', code: 'BIO', isActive: true },
  { id: 'd3', name: 'Microbiology', code: 'MIC', isActive: true },
];
const APPT = {
  branchId: 'b1', queueMode: 'token_queue', slotMinutes: 30, maxConcurrentSlots: 2, open24h: false,
  weeklyScheduleJson: JSON.stringify({ mon: [{ from: '08:00', to: '18:00' }] }),
  queueOptions: { baseAppointment: 100, baseWalkin: 50, baseFollowup: 80, waitWeight: 1, appointmentGraceMinutes: 10, latePenalty: 50, noShowThresholdMinutes: 30, avgCollectionMinutes: 5, urgentOverrideScore: 1000 },
};
const ALERTS = [
  { key: 'order_cancelled', module: 'frontdesk', label: 'Order cancelled', firesWhen: 'A booked order is cancelled.', recipients: 'Front desk', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false },
  { key: 'balance_overdue', module: 'billing', label: 'Balance overdue', firesWhen: 'A bill stays unpaid.', recipients: 'Billing', kind: 'overdue', enabled: true, thresholdMinutes: 1440, thresholdConfigurable: true },
  { key: 'critical_value', module: 'results', label: 'Critical value', firesWhen: 'A result is critical.', recipients: 'Pathologist', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false, critical: true },
  { key: 'report_ready', module: 'reports', label: 'Report ready', firesWhen: 'A report is final.', recipients: 'Front desk', kind: 'instant', enabled: false, thresholdMinutes: null, thresholdConfigurable: false },
];
const KPIS = [{ id: 'k1', code: 'orders_today', name: 'Orders today', description: 'Orders booked today', category: 'operational', unit: '', isActive: true }];

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    switch (r.path) {
      case '/api/tenants/branch-lab-config': return ok({ labStructure: 'auto', labelCodeMode: 'barcode', queueFocusMode: 'auto', effectiveQueueFocus: 'patient', autoAssignEnabled: true, autoAssignValidatorsEnabled: true, techReportNotes: true, requireValidationForAllResults: false, inventoryEnabled: true });
      case '/api/tenants/departments': return ok(DEPTS);
      case '/api/tenants/branches': return ok([{ id: 'b1', name: 'Main', defaultLabCode: 'LAB', isActive: true }, { id: 'b2', name: 'Anna Nagar', defaultLabCode: 'ANN', isActive: true }]);
      case '/api/tenants/lab-spaces': return ok([{ id: 's1', branchId: 'b1', name: 'Microbiology', code: 'MIC', order: 1 }, { id: 's2', branchId: 'b1', name: 'Biochemistry', code: 'BIO', order: 2 }, { id: 's3', branchId: 'b2', name: 'Pathology', code: 'PAT', order: 1 }]);
      case '/api/users/picker': return ok([{ id: 'u1', displayName: 'Asha Menon', isActive: true }, { id: 'u2', displayName: 'Ravi Kumar', isActive: true }]);
      case '/api/roles/picker': return ok([{ id: 'r1', name: 'Technician' }, { id: 'r2', name: 'Pathologist' }]);
      case '/api/tenants/auto-assign-configs': return ok([{ departmentId: 'd1', assigneeUserIdsJson: '["u1"]', autoAssignRoleIdsJson: '[]', validatorUserIdsJson: '["u2"]', validatorRoleIdsJson: '[]' }]);
      case '/api/config/sample-id': return ok({ enabled: true, datePrefix: 'yymm', separator: '-', padding: 5, serialMode: 'numeric', letterCount: 2 });
      case '/api/appointments/config': return ok(APPT);
      case '/api/config/notifications/catalog': return ok(ALERTS);
      case '/api/config/notifications/master': return ok({ enabled: true });
      case '/api/microbiology/settings': return ok({ lockTimeoutMinutes: 60, allowSupervisorTakeover: true, stageTats: [{ stageKey: 'gram', tatHours: 6 }, { stageKey: 'growth', tatHours: 24 }, { stageKey: 'identification', tatHours: 48 }, { stageKey: 'ast', tatHours: 72 }] });
      case '/api/kpis/catalog': return ok(KPIS);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
});

const PAGES: Array<{ name: string; url: string; ready: string; text?: string }> = [
  { name: 'sample-numbers-format', url: '/admin/lab/sample-numbers?tab=format', ready: '[data-testid="sample-id-format"]', text: 'Sample ID format' },
  { name: 'sample-numbers-prefixes', url: '/admin/lab/sample-numbers?tab=prefixes', ready: '[data-testid="space-prefixes"]', text: 'Prefix per lab space' },
  { name: 'sample-numbers-structure', url: '/admin/lab/sample-numbers?tab=structure', ready: 'pf-lab-settings .pf-ls__card', text: 'Lab structure' },
  { name: 'sample-numbers-barcode', url: '/admin/lab/sample-numbers?tab=barcode', ready: 'pf-lab-settings .pf-ls__card', text: 'Specimen label code' },
  { name: 'sample-numbers-find', url: '/admin/lab/sample-numbers?tab=find', ready: 'pf-lab-settings .pf-ls__card', text: 'Pre-fill sample search' },
  { name: 'collection-queue', url: '/admin/lab/collection?tab=queue', ready: 'pf-lab-settings .pf-ls__card', text: 'Queue focus' },
  { name: 'collection-assign', url: '/admin/lab/collection?tab=assign', ready: '.pf-ls__dept', text: 'Validators' },
  { name: 'collection-noscan', url: '/admin/lab/collection?tab=noscan', ready: 'pf-lab-settings .pf-ls__card', text: 'no-scan' },
  { name: 'results-validation', url: '/admin/lab/results?tab=validation', ready: 'pf-lab-settings .pf-ls__card', text: 'Require validation' },
  { name: 'results-constants', url: '/admin/lab/results?tab=constants', ready: 'pf-lab-settings .pf-ls__card', text: 'Calculation constants' },
  { name: 'results-micro', url: '/admin/lab/results?tab=micro', ready: '[data-testid="culture-save"]', text: 'Turnaround' },
  { name: 'home-collection', url: '/admin/lab/home-collection?tab=switch', ready: '[data-testid="hc-switch-card"]', text: 'Home collection' },
  { name: 'home-collection-agents', url: '/admin/lab/home-collection?tab=agents', ready: 'pf-home-collection-agents', text: 'agent' },
  { name: 'front-desk', url: '/admin/lab/front-desk?tab=mode', ready: 'pf-appointments-config .pf-mode-btn', text: 'Walk-up' },
  { name: 'front-desk-referring', url: '/admin/lab/front-desk?tab=referring', ready: 'pf-referring-network' },
  { name: 'alerts', url: '/admin/lab/alerts', ready: '.pf-nc-card', text: 'Order cancelled' },
  { name: 'numbers', url: '/admin/lab/numbers', ready: 'pf-kpi-config' },
  { name: 'report-notes', url: '/admin/reports?tab=notes', ready: '[data-testid="ls-tech-notes"]', text: 'Technician notes on report' },
  { name: 'report-sending', url: '/admin/reports?tab=sending', ready: 'pf-report-sending-card', text: 'WhatsApp Auto' },
  { name: 'inventory', url: '/admin/inventory', ready: '[data-testid="inventory-enable"]', text: 'Enable inventory' },
];

test.describe('lab settings pages', () => {
  for (const pg of PAGES) {
    test(`${pg.name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await go(page, pg.url);
      await expect(vis(page, pg.ready)).toBeVisible({ timeout: 60_000 });
      if (pg.text) await expect(page.getByText(pg.text, { exact: false }).locator('visible=true').first()).toBeVisible();
      await expectLayout(page, pg.name);
      await shot(page, `lab-${pg.name}`);
      expect(errors, 'no uncaught errors').toEqual([]);
    });
  }

  test('sample numbers: tabs write ?tab=; the legacy Organization link lands here', async ({ page }) => {
    await go(page, '/admin/lab/sample-numbers?tab=format');
    await expect(vis(page, '[data-testid="sample-id-format"]')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('radio', { name: 'Barcode type' }).first().click().catch(() => undefined);
    await go(page, '/admin/organization?tab=sample');
    await expect(page).toHaveURL(/\/admin\/lab\/sample-numbers\?tab=format/, { timeout: 60_000 });
  });

  test('report options are tabs of Report design: the old link redirects, one band, no second page', async ({ page }) => {
    await go(page, '/admin/lab/report-options?tab=sending');
    await expect(page).toHaveURL(/\/admin\/reports\?tab=sending/, { timeout: 60_000 });
    await expect(vis(page, 'pf-report-sending-card')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="rt-report-options"]')).toHaveCount(0);
    await go(page, '/admin/lab/report-options');
    await expect(page).toHaveURL(/\/admin\/reports\?tab=notes/, { timeout: 60_000 });
    await expect(vis(page, '[data-testid="ls-tech-notes"]')).toBeVisible({ timeout: 60_000 });
  });

  test('sample ID format saves through the same API', async ({ page }) => {
    await go(page, '/admin/lab/sample-numbers?tab=format');
    await expect(vis(page, '[data-testid="sample-id-format"]')).toBeVisible({ timeout: 60_000 });
    await vis(page, '.pf-sf__save').click();
    await expect.poll(() => neg.calls.find(c => c.path === '/api/config/sample-id')?.body).toEqual({ enabled: true, datePrefix: 'yymm', separator: '-', padding: 5, serialMode: 'numeric', letterCount: 2 });
  });

  test('phone: the page tabs scroll, nothing overflows', async ({ page }) => {
    test.skip(!isPhone(), 'phone only');
    await go(page, '/admin/lab/sample-numbers?tab=format');
    await expect(vis(page, '[data-testid="sample-id-format"]')).toBeVisible({ timeout: 60_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
