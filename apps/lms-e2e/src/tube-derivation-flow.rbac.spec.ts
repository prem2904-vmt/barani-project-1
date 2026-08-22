import { test, expect, request as pwRequest, type APIRequestContext, type Browser } from '@playwright/test';
import { loginWith } from './support/auth';
import { registerPatient, createOrder } from './support/flows';

/**
 * INTEGRATION (behavioral): "are the tubes coming correct?" — the collected
 * vial's tube COLOUR derives from the TEST's configuration (TubeColor, falling
 * back to the department's ContainerColor), and changing that config flows
 * through to new orders' samples.
 *
 * Honest note on SPACES: spaces do NOT determine a sample's tube colour — that
 * comes from the test/department. Spaces only affect vial MERGE/COUNT and the
 * sample-ID prefix, and only under LabStructure='auto' when a single order has
 * 2+ tests in different departments sharing the same tube colour. So the
 * meaningful "tubes correct" behavior is colour-derivation, tested here on
 * E2E Branch B's "E2E Flow Test" (E2EFLOW, TubeColor=red).
 */

const ORG = 'Micro World';
const API = 'http://localhost:5270';
const BRANCH_B = '8ec51282-a076-48f0-90a4-2ede457dbad0';
const E2EFLOW_ID = 'be12e4e4-4dfb-4e0a-ab7f-9a2d0beee7a9';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };
const BRANCHB_USER = { username: 'branchbuser', password: 'E2ePass1234' };
const TEST_CODE = 'E2EFLOW';
const TEST_NAME = 'E2E Flow Test';

test.describe.configure({ mode: 'serial' });

let adminToken = '';
let userToken = '';
let originalTube = 'red';
let originalGate = 'none';

async function ctxFor(token: string): Promise<APIRequestContext> {
  return pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}`, 'X-Active-Branch': BRANCH_B } });
}
async function login(u: string, p: string): Promise<string> {
  const c = await pwRequest.newContext();
  const r = await c.post(`${API}/api/auth/login`, { data: { org: ORG, username: u, password: p } });
  const j = await r.json();
  await c.dispose();
  return (j?.data ?? j)?.accessToken ?? '';
}
async function getJson(token: string, path: string): Promise<Record<string, unknown>> {
  const c = await ctxFor(token);
  const r = await c.get(`${API}${path}`);
  const j = await r.json().catch(() => ({}));
  await c.dispose();
  return ((j as { data?: unknown })?.data ?? j) as Record<string, unknown>;
}
async function setTube(color: string): Promise<boolean> {
  const c = await ctxFor(adminToken);
  const r = await c.patch(`${API}/api/tests/${E2EFLOW_ID}`, { data: { TubeColor: color } });
  await c.dispose();
  return r.ok();
}
async function setGate(stage: string): Promise<void> {
  const c = await ctxFor(adminToken);
  await c.patch(`${API}/api/tenants/branch-lab-config`, { data: { paymentGateStage: stage } });
  await c.dispose();
}

/** Place an order for E2EFLOW in Branch B and return its sample's tube colour. */
async function orderedTubeColour(browser: Browser): Promise<string> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let orderId = '';
  try {
    await loginWith(page, { org: ORG, username: BRANCHB_USER.username, password: BRANCHB_USER.password });
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient, TEST_CODE, TEST_NAME);
    orderId = order.orderId;
  } finally {
    await ctx.close();
  }
  const detail = (await getJson(userToken, `/api/orders/${orderId}`)) as { samples?: Array<{ tubeColor?: string }> };
  return detail?.samples?.[0]?.tubeColor ?? 'unknown';
}

test.beforeAll(async () => {
  adminToken = await login(ADMIN.username, ADMIN.password);
  userToken = await login(BRANCHB_USER.username, BRANCHB_USER.password);
  expect(adminToken && userToken).toBeTruthy();
  originalTube = ((await getJson(adminToken, `/api/tests/${E2EFLOW_ID}`)).tubeColor as string) ?? 'red';
  originalGate = ((await getJson(adminToken, '/api/tenants/branch-lab-config')).paymentGateStage as string) ?? 'none';
  await setGate('none'); // don't let the payment gate interfere with ordering
});

test.afterAll(async () => {
  if (adminToken) {
    await setTube(originalTube);
    await setGate(originalGate);
  }
});

test('the collected sample\'s tube colour matches the test\'s configured colour', async ({ browser }) => {
  test.setTimeout(120_000);
  expect(await setTube('red'), 'set E2EFLOW tube=red').toBe(true);
  expect(await orderedTubeColour(browser)).toBe('red');
});

test('changing the test\'s tube colour config flows through to new orders (tubes come correct)', async ({ browser }) => {
  test.setTimeout(120_000);
  expect(await setTube('lavender'), 'set E2EFLOW tube=lavender').toBe(true);
  expect(await orderedTubeColour(browser)).toBe('lavender');
});
