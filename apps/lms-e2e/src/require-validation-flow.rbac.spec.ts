import { test, expect, request as pwRequest, type APIRequestContext, type Browser } from '@playwright/test';
import { loginWith } from './support/auth';
import { registerPatient, createOrder, collectSample, enterResult } from './support/flows';

/**
 * INTEGRATION (behavioral): the "Require validation for all results" admin
 * setting actually changes the OPERATIONAL flow.
 *
 * Enforcement (ResultService): a direct-flow test's result lands 'entered'
 * (must go through the validation queue) when requireValidationForAllResults is
 * ON, but auto-'validated' on submit when OFF. Isolated to E2E Branch B (the
 * setting is per-branch). Two full clinical flows (register→order→collect→
 * dispatch→receive→enter) on the orderable "E2E Flow Test" (Flow=direct),
 * flipping the setting between them and asserting the resulting status. The
 * payment gate is forced to 'none' so dispatch isn't blocked. Both settings
 * restored in afterAll.
 */

const ORG = 'Micro World';
const API = 'http://localhost:5270';
const BRANCH_B = '8ec51282-a076-48f0-90a4-2ede457dbad0';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };
const BRANCHB_USER = { username: 'branchbuser', password: 'E2ePass1234' };
const TEST_CODE = 'E2EFLOW';
const TEST_NAME = 'E2E Flow Test';

test.describe.configure({ mode: 'serial' });

let adminToken = '';
let originalReq = false;
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
async function readConfig(): Promise<{ req: boolean; gate: string }> {
  const c = await ctxFor(adminToken);
  const r = await c.get(`${API}/api/tenants/branch-lab-config`);
  const d = (await r.json())?.data ?? {};
  await c.dispose();
  return { req: d.requireValidationForAllResults === true, gate: d.paymentGateStage ?? 'none' };
}
async function patchConfig(body: Record<string, unknown>): Promise<boolean> {
  const c = await ctxFor(adminToken);
  const r = await c.patch(`${API}/api/tenants/branch-lab-config`, { data: body });
  await c.dispose();
  return r.ok();
}

/** One full clinical flow as the branch-B user; returns the result status. */
async function runFlowAndGetStatus(browser: Browser): Promise<string> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginWith(page, { org: ORG, username: BRANCHB_USER.username, password: BRANCHB_USER.password });
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient, TEST_CODE, TEST_NAME);
    const sample = await collectSample(page, order.orderId);
    const result = await enterResult(page, order, sample, TEST_CODE, TEST_NAME, '85');
    return result.status;
  } finally {
    await ctx.close();
  }
}

test.beforeAll(async () => {
  adminToken = await login(ADMIN.username, ADMIN.password);
  expect(adminToken, 'admin token').toBeTruthy();
  const cur = await readConfig();
  originalReq = cur.req;
  originalGate = cur.gate;
  // Dispatch must be unblocked so the flow can reach result entry.
  expect(await patchConfig({ paymentGateStage: 'none' }), 'gate=none for the flow').toBe(true);
});

test.afterAll(async () => {
  if (adminToken) await patchConfig({ requireValidationForAllResults: originalReq, paymentGateStage: originalGate });
});

test('require-validation ON → a direct-flow result stays "entered" (must be validated)', async ({ browser }) => {
  test.setTimeout(180_000);
  expect(await patchConfig({ requireValidationForAllResults: true }), 'set require=true').toBe(true);
  const status = await runFlowAndGetStatus(browser);
  expect(status, 'result must await validation, not auto-release').toBe('entered');
});

test('require-validation OFF → the same direct-flow result auto-"validated" on submit', async ({ browser }) => {
  test.setTimeout(180_000);
  expect(await patchConfig({ requireValidationForAllResults: false }), 'set require=false').toBe(true);
  const status = await runFlowAndGetStatus(browser);
  expect(status, 'direct-flow result should auto-validate when the gate is off').toBe('validated');
});
