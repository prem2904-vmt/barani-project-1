import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

/**
 * INTEGRATION: report COLUMN editions — the "3-column report / 4-column report"
 * department config AND the per-test CUSTOM override that overrides the default
 * department columns (+ revert-to-department). Persistence round-trips on the
 * report-layout endpoints; column resolution (override→dept→defaults) is
 * separately covered by mw unit tests. On E2E Branch B (dept E2EFD, test E2EFLOW).
 *
 * Related: the report-columns EDITOR bug (rename/reorder silently discarded on
 * save) was root-caused + fixed (untracked seed effect); this asserts the
 * server contract those edits land on.
 */

const ORG = 'Micro World';
const API = 'http://localhost:5270';
const B = '8ec51282-a076-48f0-90a4-2ede457dbad0';
const DEPT = '07871286-9056-4983-8e24-2b21b17054e8';
const TST = 'be12e4e4-4dfb-4e0a-ab7f-9a2d0beee7a9';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };

const COLS_4 = [
  { name: 'investigation', label: 'Investigation', type: 'name', width: 40, order: 0 },
  { name: 'result', label: 'Result', type: 'result', width: 20, order: 1 },
  { name: 'unit', label: 'Unit', type: 'unit', width: 15, order: 2 },
  { name: 'range', label: 'Reference Range', type: 'range', width: 25, order: 3 },
];
const COLS_3 = [
  { name: 'investigation', label: 'Investigation', type: 'name', width: 55, order: 0 },
  { name: 'result', label: 'Result', type: 'result', width: 20, order: 1 },
  { name: 'range', label: 'Reference Range', type: 'range', width: 25, order: 2 },
];

test.describe.configure({ mode: 'serial' });

let token = '';
let originalDept: unknown[] = COLS_4;

async function ctx(): Promise<APIRequestContext> {
  return pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}`, 'X-Active-Branch': B } });
}
const unwrap = (j: unknown) => (j as { data?: unknown })?.data ?? j;

async function getDeptCols(): Promise<unknown[]> {
  const c = await ctx();
  const d = unwrap(await (await c.get(`${API}/api/report-layout/department/${DEPT}`)).json()) as { columns?: unknown[] };
  await c.dispose();
  return d?.columns ?? [];
}
async function setDeptCols(cols: unknown[]): Promise<number> {
  const c = await ctx();
  const r = await c.post(`${API}/api/report-layout/department/${DEPT}`, { data: { columns: cols } });
  await c.dispose();
  return r.status();
}
async function getTestOverride(): Promise<{ configured: boolean; count: number }> {
  const c = await ctx();
  const d = unwrap(await (await c.get(`${API}/api/report-layout/test/${TST}/columns`)).json()) as { configured?: boolean; columns?: unknown[] };
  await c.dispose();
  return { configured: d?.configured === true, count: d?.columns?.length ?? 0 };
}
async function setTestOverride(cols: unknown[] | null): Promise<number> {
  const c = await ctx();
  const r = await c.post(`${API}/api/report-layout/test/${TST}/columns`, { data: { columns: cols } });
  await c.dispose();
  return r.status();
}

test.beforeAll(async () => {
  const lc = await pwRequest.newContext();
  const lr = await lc.post(`${API}/api/auth/login`, { data: { org: ORG, username: ADMIN.username, password: ADMIN.password } });
  token = (unwrap(await lr.json()) as { accessToken?: string })?.accessToken ?? '';
  await lc.dispose();
  expect(token).toBeTruthy();
  const cur = await getDeptCols();
  if (cur.length) originalDept = cur;
  await setTestOverride(null); // start clean
});

test.afterAll(async () => {
  await setTestOverride(null);
  await setDeptCols(originalDept);
});

test('department report: a 4-column layout persists', async () => {
  expect(await setDeptCols(COLS_4)).toBe(200);
  expect((await getDeptCols()).length).toBe(4);
});

test('department report: switch to a 3-column layout (drop Unit) persists', async () => {
  expect(await setDeptCols(COLS_3)).toBe(200);
  expect((await getDeptCols()).length).toBe(3);
});

test('per-test CUSTOM override: a 3-column set overrides the department columns', async () => {
  await setDeptCols(COLS_4); // dept back to 4-col
  expect(await setTestOverride(COLS_3)).toBe(200);
  const o = await getTestOverride();
  expect(o.configured, 'test now has its own column override').toBe(true);
  expect(o.count).toBe(3);
});

test('revert-to-department clears the per-test override', async () => {
  expect(await setTestOverride(null)).toBe(200);
  expect((await getTestOverride()).configured, 'override cleared → inherits department').toBe(false);
});
