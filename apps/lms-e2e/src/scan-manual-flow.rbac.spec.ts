import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * INTEGRATION (behavioral): the scan-vs-manual admin setting changes the
 * COLLECTION screen. ScanService.manualEntry = tenant.scanMode === 'manual'
 * drives the collect search bar: scan mode renders a camera-scanner button and
 * "Find patient or scan"; manual mode hides the camera and shows "Find patient
 * or enter sample number".
 *
 * scanMode is TENANT-WIDE (PATCH /api/tenants/current) — not isolatable to a
 * branch — so it's flipped and restored to the original value in afterAll. The
 * collect search bar renders without any order, so no seeding is needed.
 */

const ORG = 'Micro World';
const API = 'http://localhost:5270';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };

test.describe.configure({ mode: 'serial' });

let adminToken = '';
let originalMode = 'scan';

async function ctxFor(token: string): Promise<APIRequestContext> {
  return pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}
async function login(u: string, p: string): Promise<string> {
  const c = await pwRequest.newContext();
  const r = await c.post(`${API}/api/auth/login`, { data: { org: ORG, username: u, password: p } });
  const j = await r.json();
  await c.dispose();
  return (j?.data ?? j)?.accessToken ?? '';
}
async function getScanMode(): Promise<string> {
  const c = await ctxFor(adminToken);
  const r = await c.get(`${API}/api/tenants/current`);
  const d = (await r.json())?.data ?? {};
  await c.dispose();
  return d.scanMode ?? 'scan';
}
async function setScanMode(mode: string): Promise<boolean> {
  const c = await ctxFor(adminToken);
  const r = await c.patch(`${API}/api/tenants/current`, { data: { scanMode: mode } });
  await c.dispose();
  return r.ok();
}

const cameraBtn = (page: Page) => page.getByRole('button', { name: /open camera scanner/i });
const scanLabel = (page: Page) => page.locator('.pf-scan__label');

async function openCollectAs(page: Page) {
  await loginAs(page, 'admin');
  await page.goto('/lab/collect');
  await expect(scanLabel(page)).toBeVisible({ timeout: 30_000 });
}

test.beforeAll(async () => {
  adminToken = await login(ADMIN.username, ADMIN.password);
  expect(adminToken).toBeTruthy();
  originalMode = await getScanMode();
});

test.afterAll(async () => {
  if (adminToken) await setScanMode(originalMode);
});

test('scan mode → the collect screen shows a camera scanner + "…or scan"', async ({ page }) => {
  expect(await setScanMode('scan'), 'set scanMode=scan').toBe(true);
  await openCollectAs(page);
  await expect(cameraBtn(page)).toBeVisible();
  await expect(scanLabel(page)).toHaveText(/find patient or scan/i);
});

test('manual mode → the collect screen hides the camera + shows "…enter sample number"', async ({ page }) => {
  expect(await setScanMode('manual'), 'set scanMode=manual').toBe(true);
  await openCollectAs(page);
  await expect(cameraBtn(page)).toHaveCount(0);
  await expect(scanLabel(page)).toHaveText(/find patient or enter sample number/i);
});
