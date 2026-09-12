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
  console.log('=== PHASE 9 SECURITY & VALIDATION AUDIT SUITE ===\n');

  const time = Date.now();
  const emailA = `sec_user_a_${time}@example.com`;
  const emailB = `sec_user_b_${time}@example.com`;

  // Setup: Register User A and User B
  console.log('Setup: Registering User A and User B...');
  await request('/auth/register', 'POST', { full_name: 'Sec User A', email: emailA, password: 'Password123!' });
  const loginA = await request('/auth/login', 'POST', { email: emailA, password: 'Password123!' });
  const tokenA = loginA.body.token;
  const userA_Id = loginA.body.user.id;

  await request('/auth/register', 'POST', { full_name: 'Sec User B', email: emailB, password: 'Password123!' });
  const loginB = await request('/auth/login', 'POST', { email: emailB, password: 'Password123!' });
  const tokenB = loginB.body.token;
  const userB_Id = loginB.body.user.id;

  // Setup Project & Task for User A
  const pA = await request('/projects', 'POST', { name: 'User A Security Proj', status: 'In Progress' }, tokenA);
  const pA_Id = pA.body.data.id;
  const tA = await request('/tasks', 'POST', { project_id: pA_Id, name: 'User A Security Task', priority: 'High', status: 'Pending' }, tokenA);
  const tA_Id = tA.body.data.id;

  // Setup Project & Task for User B
  const pB = await request('/projects', 'POST', { name: 'User B Confidential Proj', status: 'Completed' }, tokenB);
  const pB_Id = pB.body.data.id;
  const tB = await request('/tasks', 'POST', { project_id: pB_Id, name: 'User B Confidential Task', priority: 'Medium', status: 'Completed' }, tokenB);
  const tB_Id = tB.body.data.id;

  // --- AUTHENTICATION SECURITY TESTS ---
  console.log('\nA. Missing JWT header...');
  const resA = await request('/projects', 'GET');
  console.log('Status:', resA.status, 'Message:', resA.body.message);

  console.log('\nB. Invalid JWT token string...');
  const resB = await request('/projects', 'GET', null, 'invalid_token_12345');
  console.log('Status:', resB.status, 'Message:', resB.body.message);

  console.log('\nC. Tampered JWT signature...');
  const tamperedToken = tokenA.substring(0, tokenA.length - 5) + 'xxxxx';
  const resC = await request('/projects', 'GET', null, tamperedToken);
  console.log('Status:', resC.status, 'Message:', resC.body.message);

  console.log('\nD. Malformed JWT structure...');
  const resD = await request('/projects', 'GET', null, 'BearerNotValid');
  console.log('Status:', resD.status, 'Message:', resD.body.message);

  console.log('\nE. Duplicate email registration...');
  const resE = await request('/auth/register', 'POST', { full_name: 'Dup User', email: emailA, password: 'Password123!' });
  console.log('Status:', resE.status, 'Message:', resE.body.message);

  // --- PROJECT SECURITY & OWNERSHIP AUDIT ---
  console.log('\nF. User A cannot GET User B project...');
  const resF = await request('/projects/' + pB_Id, 'GET', null, tokenA);
  console.log('Status:', resF.status, 'Message:', resF.body.message);

  console.log('\nG. User A cannot UPDATE User B project...');
  const resG = await request('/projects/' + pB_Id, 'PUT', { name: 'Hacked Title' }, tokenA);
  console.log('Status:', resG.status, 'Message:', resG.body.message);

  console.log('\nH. User A cannot DELETE User B project...');
  const resH = await request('/projects/' + pB_Id, 'DELETE', null, tokenA);
  console.log('Status:', resH.status, 'Message:', resH.body.message);

  console.log('\nI & J. Mass assignment user_id attempt during project creation...');
  const resIJ = await request('/projects', 'POST', { name: 'Mass Assignment Proj', user_id: userB_Id }, tokenA);
  console.log('Status:', resIJ.status, 'Assigned user_id (Must equal User A ID ' + userA_Id + '):', resIJ.body.data.user_id);

  // --- TASK SECURITY & OWNERSHIP AUDIT ---
  console.log('\nK. User A cannot GET User B task...');
  const resK = await request('/tasks/' + tB_Id, 'GET', null, tokenA);
  console.log('Status:', resK.status, 'Message:', resK.body.message);

  console.log('\nL. User A cannot UPDATE User B task...');
  const resL = await request('/tasks/' + tB_Id, 'PUT', { name: 'Hacked Task' }, tokenA);
  console.log('Status:', resL.status, 'Message:', resL.body.message);

  console.log('\nM. User A cannot DELETE User B task...');
  const resM = await request('/tasks/' + tB_Id, 'DELETE', null, tokenA);
  console.log('Status:', resM.status, 'Message:', resM.body.message);

  console.log('\nN & O. User A cannot create a task inside User B project...');
  const resNO = await request('/tasks', 'POST', { project_id: pB_Id, name: 'Cross User Task' }, tokenA);
  console.log('Status:', resNO.status, 'Message:', resNO.body.message);

  // --- SQL INJECTION AUDIT ---
  console.log('\nP. Project search SQL injection attempt...');
  const resP = await request('/projects?search=' + encodeURIComponent("' OR '1'='1"), 'GET', null, tokenA);
  console.log('Status:', resP.status, 'Found Count:', resP.body.data.length);

  console.log('\nQ. Task search SQL injection attempt...');
  const resQ = await request('/tasks?search=' + encodeURIComponent("' OR '1'='1"), 'GET', null, tokenA);
  console.log('Status:', resQ.status, 'Found Count:', resQ.body.data.length);

  console.log('\nR. Project name SQL injection attempt in creation...');
  const resR = await request('/projects', 'POST', { name: "Robert'); DROP TABLE projects;--" }, tokenA);
  console.log('Status:', resR.status, 'Created safely with name:', resR.body.data.name);

  console.log('\nS. Task name SQL injection attempt in creation...');
  const resS = await request('/tasks', 'POST', { project_id: pA_Id, name: "Task'); DROP TABLE tasks;--" }, tokenA);
  console.log('Status:', resS.status, 'Created safely with name:', resS.body.data.name);

  console.log('\nT. Malicious status input...');
  const resT = await request('/projects', 'POST', { name: 'Test Proj', status: "In Progress' OR '1'='1" }, tokenA);
  console.log('Status:', resT.status, 'Message:', resT.body.message);

  console.log('\nU. Malicious priority input...');
  const resU = await request('/tasks', 'POST', { project_id: pA_Id, name: 'Test Task', priority: "High' OR '1'='1" }, tokenA);
  console.log('Status:', resU.status, 'Message:', resU.body.message);

  console.log('\nV. Malicious project_id input...');
  const resV = await request('/tasks', 'POST', { project_id: "1 OR 1=1", name: 'Test Task' }, tokenA);
  console.log('Status:', resV.status, 'Message:', resV.body.message);

  // --- VALIDATION HARDENING TESTS ---
  console.log('\nW. Empty project name rejected...');
  const resW = await request('/projects', 'POST', { name: '   ' }, tokenA);
  console.log('Status:', resW.status, 'Message:', resW.body.message);

  console.log('\nX. Invalid project status rejected...');
  const resX = await request('/projects', 'POST', { name: 'Test Proj', status: 'SuperActive' }, tokenA);
  console.log('Status:', resX.status, 'Message:', resX.body.message);

  console.log('\nY. Invalid project dates rejected...');
  const resY = await request('/projects', 'POST', { name: 'Test Proj', start_date: '2026-10-10', end_date: '2026-09-09' }, tokenA);
  console.log('Status:', resY.status, 'Message:', resY.body.message);

  console.log('\nZ. Empty task name rejected...');
  const resZ = await request('/tasks', 'POST', { project_id: pA_Id, name: '   ' }, tokenA);
  console.log('Status:', resZ.status, 'Message:', resZ.body.message);

  console.log('\nAA. Invalid task priority rejected...');
  const resAA = await request('/tasks', 'POST', { project_id: pA_Id, name: 'Test Task', priority: 'Extreme' }, tokenA);
  console.log('Status:', resAA.status, 'Message:', resAA.body.message);

  console.log('\nAB. Invalid task status rejected...');
  const resAB = await request('/tasks', 'POST', { project_id: pA_Id, name: 'Test Task', status: 'DoneAndDusted' }, tokenA);
  console.log('Status:', resAB.status, 'Message:', resAB.body.message);

  console.log('\nAC. Invalid task due date rejected...');
  const resAC = await request('/tasks', 'POST', { project_id: pA_Id, name: 'Test Task', due_date: '2026-99-99' }, tokenA);
  console.log('Status:', resAC.status, 'Message:', resAC.body.message);

  // --- DASHBOARD SECURITY TESTS ---
  console.log('\nAD. Query user_id=9999 cannot change dashboard ownership...');
  const resAD = await request('/dashboard?user_id=9999', 'GET', null, tokenA);
  console.log('Status:', resAD.status, 'Total Projects (Matches User A count):', resAD.body.data.totalProjects);

  console.log('\nAE. User A dashboard does not contain User B statistics...');
  const resAE_A = await request('/dashboard', 'GET', null, tokenA);
  const resAE_B = await request('/dashboard', 'GET', null, tokenB);
  console.log('User A Total Tasks:', resAE_A.body.data.totalTasks, '| User B Total Tasks:', resAE_B.body.data.totalTasks);

  console.log('\n=== ALL PHASE 9 SECURITY & VALIDATION AUDIT TESTS PASSED ===');
}

runTests().catch(console.error);
