// P3 branch-scoping fixture: ensure a 2nd branch exists and two branch-pinned
// Lab Admin users (one per branch) so a UI test can prove the branch-scoped
// queues (orders/reports/samples/billing hard-filter by the caller's branch).
// Idempotent: skips branch/user creation on 409/exists. Run once as setup.
const BASE = 'http://localhost:5270';
const ORG = 'Micro World';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };
const PASSWORD = 'E2ePass1234';
const BRANCH_B = { name: 'E2E Branch B', code: 'E2E-B', type: 'collection_center' };

async function post(path, body, token) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
async function get(path, token) {
  const r = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
const data = (j) => (j && j.data !== undefined ? j.data : j);
async function login(username, password) {
  const { j } = await post('/api/auth/login', { org: ORG, username, password });
  const d = data(j);
  return d && d.accessToken ? d.accessToken : null;
}

(async () => {
  const token = await login(ADMIN.username, ADMIN.password);
  if (!token) { console.log('ADMIN LOGIN FAILED'); process.exit(1); }

  // 1. Branches: find branch A + ensure branch B.
  let branches = data(await get('/api/tenants/branches', token).then(r => r.j)) || [];
  const branchA = branches[0];
  let branchB = branches.find((b) => b.code === BRANCH_B.code);
  if (!branchB) {
    const res = await post('/api/tenants/branches', BRANCH_B, token);
    console.log('create branch B:', res.status, JSON.stringify(data(res.j))?.slice(0, 120));
    branches = data(await get('/api/tenants/branches', token).then(r => r.j)) || [];
    branchB = branches.find((b) => b.code === BRANCH_B.code);
  }
  console.log('branchA=', branchA?.id, branchA?.name, '| branchB=', branchB?.id, branchB?.name);
  if (!branchA || !branchB) { console.log('MISSING BRANCH'); process.exit(1); }

  // 2. Lab Admin role id.
  const roles = data(await get('/api/roles', token).then(r => r.j)) || [];
  const labAdminId = (roles.find((r) => r.name === 'Lab Admin') || {}).id;
  if (!labAdminId) { console.log('NO Lab Admin role'); process.exit(1); }

  // 3. Two branch-pinned users.
  const want = [
    { username: 'branchauser', branchId: branchA.id, first: 'E2E BranchA Admin' },
    { username: 'branchbuser', branchId: branchB.id, first: 'E2E BranchB Admin' },
  ];
  const results = [];
  for (const w of want) {
    const { j } = await post('/api/users', {
      username: w.username, password: PASSWORD, firstName: w.first,
      roleIds: [labAdminId], branchId: w.branchId,
    }, token);
    const d = data(j) || {};
    const code = j.code || d.code;
    const tok = await login(w.username, PASSWORD);
    results.push({ username: w.username, branchId: w.branchId, created: !!d.id, code: code || null, loginOK: !!tok });
  }
  console.log('\n=== FIXTURE ===');
  console.log('BRANCH_A_ID=' + branchA.id);
  console.log('BRANCH_B_ID=' + branchB.id);
  for (const r of results) console.log(JSON.stringify(r));
  console.log('ALL_LOGIN_OK=', results.every((r) => r.loginOK));
})();
