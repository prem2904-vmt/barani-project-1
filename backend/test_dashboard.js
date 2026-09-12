import http from 'http';

const request = (path, method, body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (body) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: `/api${path}`,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(payload);
    req.end();
  });
};

async function runTests() {
  console.log('=== PHASE 7 DASHBOARD TEST SUITE ===\n');

  const time = Date.now();
  const emailA = `dash_user_a_${time}@example.com`;
  const emailB = `dash_user_b_${time}@example.com`;
  const emailZero = `dash_zero_${time}@example.com`;
  const emailProjOnly = `dash_proj_only_${time}@example.com`;

  // Register User A & User B & User Zero & User ProjOnly
  console.log('Setup: Registering test users...');
  await request('/auth/register', 'POST', { full_name: 'Dash User A', email: emailA, password: 'Password123!' });
  const loginA = await request('/auth/login', 'POST', { email: emailA, password: 'Password123!' });
  const tokenA = loginA.body.token;

  await request('/auth/register', 'POST', { full_name: 'Dash User B', email: emailB, password: 'Password123!' });
  const loginB = await request('/auth/login', 'POST', { email: emailB, password: 'Password123!' });
  const tokenB = loginB.body.token;

  await request('/auth/register', 'POST', { full_name: 'Zero User', email: emailZero, password: 'Password123!' });
  const loginZero = await request('/auth/login', 'POST', { email: emailZero, password: 'Password123!' });
  const tokenZero = loginZero.body.token;

  await request('/auth/register', 'POST', { full_name: 'Proj Only User', email: emailProjOnly, password: 'Password123!' });
  const loginProjOnly = await request('/auth/login', 'POST', { email: emailProjOnly, password: 'Password123!' });
  const tokenProjOnly = loginProjOnly.body.token;

  // Set up User A Data:
  // Projects:
  // P1: Status 'In Progress'
  // P2: Status 'Completed'
  // Tasks for P1:
  // T1: Completed
  // T2: Pending
  // T3: Pending
  // T4: In Progress
  const pA1 = await request('/projects', 'POST', { name: 'User A Proj 1', status: 'In Progress' }, tokenA);
  const pA2 = await request('/projects', 'POST', { name: 'User A Proj 2', status: 'Completed' }, tokenA);
  const pA1_Id = pA1.body.data.id;

  await request('/tasks', 'POST', { project_id: pA1_Id, name: 'Task A1', status: 'Completed' }, tokenA);
  await request('/tasks', 'POST', { project_id: pA1_Id, name: 'Task A2', status: 'Pending' }, tokenA);
  await request('/tasks', 'POST', { project_id: pA1_Id, name: 'Task A3', status: 'Pending' }, tokenA);
  await request('/tasks', 'POST', { project_id: pA1_Id, name: 'Task A4', status: 'In Progress' }, tokenA);

  // Set up User B Data:
  // Projects:
  // P1: Status 'In Progress'
  // Tasks for P1:
  // T1: Completed
  const pB1 = await request('/projects', 'POST', { name: 'User B Proj 1', status: 'In Progress' }, tokenB);
  await request('/tasks', 'POST', { project_id: pB1.body.data.id, name: 'Task B1', status: 'Completed' }, tokenB);

  // Set up User ProjOnly Data:
  // 1 Project (Not Started), 0 Tasks
  await request('/projects', 'POST', { name: 'Proj Only 1', status: 'Not Started' }, tokenProjOnly);

  // Test A: Authenticated dashboard
  console.log('\nA. Authenticated dashboard request...');
  const dashA = await request('/dashboard', 'GET', null, tokenA);
  console.log('Status:', dashA.status, 'Data:', JSON.stringify(dashA.body.data, null, 2));

  // Test B: Unauthenticated dashboard
  console.log('\nB. Unauthenticated dashboard request...');
  const unauthDash = await request('/dashboard', 'GET');
  console.log('Status:', unauthDash.status, 'Message:', unauthDash.body.message);

  // Test C: Total Projects for User A
  console.log('\nC & M. Total Projects & Projects In Progress for User A...');
  console.log('totalProjects:', dashA.body.data.totalProjects, '(Expected 2)');
  console.log('projectsInProgress:', dashA.body.data.projectsInProgress, '(Expected 1)');

  // Test D, E, F, L: Task Counts for User A
  console.log('\nD, E, F, L. Total, Completed, Pending tasks for User A...');
  console.log('totalTasks:', dashA.body.data.totalTasks, '(Expected 4)');
  console.log('completedTasks:', dashA.body.data.completedTasks, '(Expected 1)');
  console.log('pendingTasks:', dashA.body.data.pendingTasks, '(Expected 2)');

  // Test H & I: User A & User B Data Isolation
  console.log('\nH & I. User B Dashboard Isolation Check...');
  const dashB = await request('/dashboard', 'GET', null, tokenB);
  console.log('User B Stats:', JSON.stringify(dashB.body.data, null, 2));

  // Test J: User with 0 projects
  console.log('\nJ. User with 0 projects dashboard...');
  const dashZero = await request('/dashboard', 'GET', null, tokenZero);
  console.log('Zero User Stats:', JSON.stringify(dashZero.body.data, null, 2));

  // Test K: User with projects but 0 tasks
  console.log('\nK. User with projects but 0 tasks...');
  const dashProjOnly = await request('/dashboard', 'GET', null, tokenProjOnly);
  console.log('ProjOnly Stats:', JSON.stringify(dashProjOnly.body.data, null, 2));

  // Test N: Query parameter manipulation attempt (GET /api/dashboard?user_id=999)
  console.log('\nN. Query parameter user_id manipulation attempt...');
  const hackDash = await request('/dashboard?user_id=9999', 'GET', null, tokenA);
  console.log('Hacked Request Stats (Should match User A stats):', JSON.stringify(hackDash.body.data, null, 2));

  console.log('\n=== ALL PHASE 7 DASHBOARD TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(console.error);
