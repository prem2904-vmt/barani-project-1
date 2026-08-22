// Make E2E Branch B orderable under BranchIsolationEnabled=true: it needs its
// OWN active, department-bearing test (tests are stamped with the creating
// user's branch; a fresh branch sees none). Idempotent. Target Branch B by
// sending X-Active-Branch on every write (admin holds manage_tenant/*).
const BASE = 'http://localhost:5270';
const ORG = 'Micro World';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };
const BRANCH_B_CODE = 'E2E-B';
const DEPT = { Name: 'E2E Flow Dept', Code: 'E2EFD', ContainerColor: 'red', ContainerLabel: 'E2E' };
const TEST = {
  Name: 'E2E Flow Test', Type: 'individual', Flow: 'direct',
  Price: 100, TaxSlab: 0, TatHours: 24, TestCode: 'E2EFLOW',
  SampleType: 'Serum', TubeColor: 'red', ResultType: 'numeric', Unit: 'U/L',
  ParametersJson: JSON.stringify([{ name: 'value', label: 'Value', type: 'numeric', unit: 'U/L' }]),
};

const data = (j) => (j && j.data !== undefined ? j.data : j);
async function login(u, p) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org: ORG, username: u, password: p }) });
  return data(await r.json())?.accessToken ?? '';
}
async function api(method, path, token, branch, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(branch ? { 'X-Active-Branch': branch } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

(async () => {
  const token = await login(ADMIN.username, ADMIN.password);
  if (!token) { console.log('ADMIN LOGIN FAILED'); process.exit(1); }

  const branches = data((await api('GET', '/api/tenants/branches', token)).j) || [];
  const branchB = branches.find((b) => b.code === BRANCH_B_CODE);
  if (!branchB) { console.log('Branch B missing — run branch-scope-fixture.mjs first'); process.exit(1); }
  const B = branchB.id;

  // Department in Branch B (idempotent by code).
  let depts = data((await api('GET', '/api/tenants/departments', token, B)).j) || [];
  let dept = depts.find((d) => d.code === DEPT.Code);
  if (!dept) {
    const res = await api('POST', '/api/tenants/departments', token, B, { ...DEPT, BranchId: B });
    console.log('create dept:', res.status);
    depts = data((await api('GET', '/api/tenants/departments', token, B)).j) || [];
    dept = depts.find((d) => d.code === DEPT.Code);
  }
  if (!dept) { console.log('DEPT CREATE FAILED'); process.exit(1); }

  // Orderable test stamped to Branch B (idempotent by code).
  let tests = data((await api('GET', '/api/tests/?activeOnly=true', token, B)).j) || [];
  let t = tests.find((x) => x.testCode === TEST.TestCode);
  if (!t) {
    const res = await api('POST', '/api/tests', token, B, { ...TEST, DepartmentId: dept.id });
    console.log('create test:', res.status, JSON.stringify(data(res.j))?.slice(0, 140));
    tests = data((await api('GET', '/api/tests/?activeOnly=true', token, B)).j) || [];
    t = tests.find((x) => x.testCode === TEST.TestCode);
  }

  console.log('\n=== BRANCH B FIXTURE ===');
  console.log('BRANCH_B_ID=' + B);
  console.log('DEPT_ID=' + dept.id);
  console.log('TEST_ID=' + (t?.id ?? 'MISSING'));
  console.log('orderable tests in Branch B now:', tests.length);
  console.log('E2EFLOW present =', !!t);
})();
