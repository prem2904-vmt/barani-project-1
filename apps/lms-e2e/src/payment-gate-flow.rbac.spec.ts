import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { loginWith } from './support/auth';
import { registerPatient, createOrder, collectSample } from './support/flows';

/**
 * INTEGRATION (behavioral): the payment-gate ADMIN setting actually changes the
 * OPERATIONAL flow — not just that it persists.
 *
 * paymentGateStage='dispatch' → OrderService.EnsureBillClearedForDispatchAsync
 * throws on an unpaid order at dispatch (backend guard is authoritative). With
 * 'none' the same unpaid order dispatches. Isolated to E2E Branch B (the setting
 * is per-branch): create+collect an unpaid order there as the branch-B user,
 * then flip the gate and assert dispatch is blocked vs allowed. Original gate
 * restored in afterAll.
 *
 * Fixtures (run once): branch-scope-fixture.mjs (Branch B + branchbuser pinned
 * to it) + configure-branch-b.mjs (a department + the orderable "E2E Flow Test"
 * / E2EFLOW, required because the tenant has BranchIsolationEnabled=true).
 */

const ORG = 'Micro World';
const API = 'http://localhost:5270';
const BRANCH_B = '8ec51282-a076-48f0-90a4-2ede457dbad0';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };
const BRANCHB_USER = { username: 'branchbuser', password: 'E2ePass1234' };
const TEST_CODE = 'E2EFLOW';
const TEST_NAME = 'E2E Flow Test';

test.describe.configure({ mode: 'serial' });

let orderId = '';
let adminToken = '';
let userToken = '';
let originalGate = 'none';

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
async function getGate(token: string): Promise<string> {
  const c = await ctxFor(token);
  const r = await c.get(`${API}/api/tenants/branch-lab-config`, { headers: { 'X-Active-Branch': BRANCH_B } });
  const j = await r.json();
  await c.dispose();
  return (j?.data ?? j)?.paymentGateStage ?? 'none';
}
async function setGate(token: string, stage: string): Promise<boolean> {
  const c = await ctxFor(token);
  const r = await c.patch(`${API}/api/tenants/branch-lab-config`, { headers: { 'X-Active-Branch': BRANCH_B }, data: { paymentGateStage: stage } });
  await c.dispose();
  return r.ok();
}
async function dispatchOrder(token: string, id: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const c = await ctxFor(token);
  const r = await c.patch(`${API}/api/orders/${id}/dispatch`);
  const body = await r.json().catch(() => ({}));
  await c.dispose();
  return { ok: r.ok(), status: r.status(), body };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  adminToken = await login(ADMIN.username, ADMIN.password);
  userToken = await login(BRANCHB_USER.username, BRANCHB_USER.password);
  expect(adminToken && userToken, 'admin + branchbuser tokens').toBeTruthy();
  originalGate = await getGate(adminToken);

  expect(await setGate(adminToken, 'dispatch'), 'set Branch-B gate=dispatch').toBe(true);

  // Create + collect an UNPAID order in Branch B, as the branch-B user.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginWith(page, { org: ORG, username: BRANCHB_USER.username, password: BRANCHB_USER.password });
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient, TEST_CODE, TEST_NAME);
    await collectSample(page, order.orderId);
    orderId = order.orderId;
  } finally {
    await ctx.close();
  }
});

test.afterAll(async () => {
  if (adminToken) await setGate(adminToken, originalGate);
});

test('fixture: an unpaid, collected order exists in Branch B and the gate is set to dispatch', async () => {
  expect(orderId, 'order created + collected in Branch B').toBeTruthy();
  expect(await getGate(adminToken)).toBe('dispatch');
});

test('payment gate = dispatch BLOCKS dispatch of the unpaid order (backend guard)', async () => {
  const res = await dispatchOrder(userToken, orderId);
  expect(res.ok, `dispatch must be blocked while unpaid; got ${res.status} ${JSON.stringify(res.body)}`).toBe(false);
  expect(JSON.stringify(res.body).toLowerCase()).toMatch(/bill|outstanding|paid/);
});

test('with gate = none the SAME unpaid order dispatches successfully (behavior reverts)', async () => {
  expect(await setGate(adminToken, 'none'), 'set Branch-B gate=none').toBe(true);
  const res = await dispatchOrder(userToken, orderId);
  expect(res.ok, `dispatch should succeed with gate=none; got ${res.status} ${JSON.stringify(res.body)}`).toBe(true);
});
