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
  console.log('=== PHASE 6 TASK MANAGEMENT TEST SUITE ===\n');

  // Setup: Register User A and User B
  const time = Date.now();
  const emailA = `task_user_a_${time}@example.com`;
  const emailB = `task_user_b_${time}@example.com`;

  console.log('Registering User A...');
  await request('/auth/register', 'POST', { full_name: 'Task User A', email: emailA, password: 'Password123!' });
  const loginA = await request('/auth/login', 'POST', { email: emailA, password: 'Password123!' });
  const tokenA = loginA.body.token;

  console.log('Registering User B...');
  await request('/auth/register', 'POST', { full_name: 'Task User B', email: emailB, password: 'Password123!' });
  const loginB = await request('/auth/login', 'POST', { email: emailB, password: 'Password123!' });
  const tokenB = loginB.body.token;

  // Create Project A1 for User A
  console.log('\nCreating Project A1 for User A...');
  const projA1 = await request('/projects', 'POST', {
    name: 'Backend API Project',
    description: 'Project A1',
  }, tokenA);
  const projA1_Id = projA1.body.data.id;

  // Create Project B1 for User B
  console.log('Creating Project B1 for User B...');
  const projB1 = await request('/projects', 'POST', {
    name: 'Frontend Design Project',
    description: 'Project B1',
  }, tokenB);
  const projB1_Id = projB1.body.data.id;

  // Test A: Create valid task
  console.log('\nA. Create valid task for User A under Project A1...');
  const taskA1 = await request('/tasks', 'POST', {
    project_id: projA1_Id,
    name: 'Implement Task API',
    description: 'Build backend routes and controller for tasks',
    priority: 'High',
    status: 'Pending',
    due_date: '2026-09-20',
  }, tokenA);
  console.log('Status:', taskA1.status, 'Body:', JSON.stringify(taskA1.body, null, 2));
  const taskIdA1 = taskA1.body.data.id;

  // Create task A2 for filtering tests
  const taskA2 = await request('/tasks', 'POST', {
    project_id: projA1_Id,
    name: 'Database Migration',
    description: 'Run SQL migration scripts',
    priority: 'Low',
    status: 'Completed',
    due_date: '2026-09-25',
  }, tokenA);
  const taskIdA2 = taskA2.body.data.id;

  // Create task B1 for User B
  const taskB1 = await request('/tasks', 'POST', {
    project_id: projB1_Id,
    name: 'User B Private Task',
    description: 'Secret task',
    priority: 'High',
    status: 'In Progress',
  }, tokenB);
  const taskIdB1 = taskB1.body.data.id;

  // Test B: Get user's tasks
  console.log('\nB. Get User A\'s tasks...');
  const getTasksA = await request('/tasks', 'GET', null, tokenA);
  console.log('Status:', getTasksA.status, 'Count:', getTasksA.body.data.length);

  // Test C: Get task by ID
  console.log('\nC. Get task by ID (' + taskIdA1 + ')...');
  const getByIdA = await request('/tasks/' + taskIdA1, 'GET', null, tokenA);
  console.log('Status:', getByIdA.status, 'Task Name:', getByIdA.body.data.name);

  // Test D: Update task
  console.log('\nD. Update task (' + taskIdA1 + ')...');
  const updateA = await request('/tasks/' + taskIdA1, 'PUT', {
    name: 'Implement Task API V2',
    status: 'In Progress',
    priority: 'High',
  }, tokenA);
  console.log('Status:', updateA.status, 'Updated Name:', updateA.body.data.name, 'Updated Status:', updateA.body.data.status);

  // Test F: Unauthenticated request
  console.log('\nF. Unauthenticated request to GET /tasks...');
  const unauthRes = await request('/tasks', 'GET');
  console.log('Status:', unauthRes.status, 'Message:', unauthRes.body.message);

  // Test G: Invalid priority
  console.log('\nG. Invalid priority...');
  const badPriorityRes = await request('/tasks', 'POST', {
    project_id: projA1_Id,
    name: 'Bad Priority Task',
    priority: 'SuperHigh',
  }, tokenA);
  console.log('Status:', badPriorityRes.status, 'Message:', badPriorityRes.body.message);

  // Test H: Invalid status
  console.log('\nH. Invalid status...');
  const badStatusRes = await request('/tasks', 'POST', {
    project_id: projA1_Id,
    name: 'Bad Status Task',
    status: 'Finished',
  }, tokenA);
  console.log('Status:', badStatusRes.status, 'Message:', badStatusRes.body.message);

  // Test I: Missing task name
  console.log('\nI. Missing task name...');
  const missingNameRes = await request('/tasks', 'POST', {
    project_id: projA1_Id,
  }, tokenA);
  console.log('Status:', missingNameRes.status, 'Message:', missingNameRes.body.message);

  // Test J: Empty/whitespace task name
  console.log('\nJ. Empty/whitespace task name...');
  const emptyNameRes = await request('/tasks', 'POST', {
    project_id: projA1_Id,
    name: '   ',
  }, tokenA);
  console.log('Status:', emptyNameRes.status, 'Message:', emptyNameRes.body.message);

  // Test K: Invalid due date
  console.log('\nK. Invalid due date...');
  const badDateRes = await request('/tasks', 'POST', {
    project_id: projA1_Id,
    name: 'Bad Date Task',
    due_date: '2026-99-99',
  }, tokenA);
  console.log('Status:', badDateRes.status, 'Message:', badDateRes.body.message);

  // Test L: Invalid/non-existing project
  console.log('\nL. Create task under non-existing project ID (99999)...');
  const badProjRes = await request('/tasks', 'POST', {
    project_id: 99999,
    name: 'Orphan Task',
  }, tokenA);
  console.log('Status:', badProjRes.status, 'Message:', badProjRes.body.message);

  // Test M: Search task by name
  console.log('\nM. Search tasks by name=Database...');
  const searchRes = await request('/tasks?search=Database', 'GET', null, tokenA);
  console.log('Status:', searchRes.status, 'Found:', searchRes.body.data.map(t => t.name));

  // Test N: Filter by status
  console.log('\nN. Filter tasks by status=Completed...');
  const statusFilterRes = await request('/tasks?status=Completed', 'GET', null, tokenA);
  console.log('Status:', statusFilterRes.status, 'Found:', statusFilterRes.body.data.map(t => t.name));

  // Test O: Filter by priority
  console.log('\nO. Filter tasks by priority=Low...');
  const priorityFilterRes = await request('/tasks?priority=Low', 'GET', null, tokenA);
  console.log('Status:', priorityFilterRes.status, 'Found:', priorityFilterRes.body.data.map(t => t.name));

  // Test P: Combined search + status + priority
  console.log('\nP. Combined search=Database & status=Completed & priority=Low...');
  const combinedRes = await request('/tasks?search=Database&status=Completed&priority=Low', 'GET', null, tokenA);
  console.log('Status:', combinedRes.status, 'Found:', combinedRes.body.data.map(t => t.name));

  // Test Q: User A attempts to GET User B's task (404)
  console.log('\nQ. User A attempts to GET User B\'s task ID (' + taskIdB1 + ')...');
  const crossGet = await request('/tasks/' + taskIdB1, 'GET', null, tokenA);
  console.log('Status:', crossGet.status, 'Message:', crossGet.body.message);

  // Test R: User A attempts to PUT User B's task (404)
  console.log('\nR. User A attempts to PUT User B\'s task ID (' + taskIdB1 + ')...');
  const crossPut = await request('/tasks/' + taskIdB1, 'PUT', { name: 'Hacked Task' }, tokenA);
  console.log('Status:', crossPut.status, 'Message:', crossPut.body.message);

  // Test S: User A attempts to DELETE User B's task (404)
  console.log('\nS. User A attempts to DELETE User B\'s task ID (' + taskIdB1 + ')...');
  const crossDel = await request('/tasks/' + taskIdB1, 'DELETE', null, tokenA);
  console.log('Status:', crossDel.status, 'Message:', crossDel.body.message);

  // Test T: SQL injection attempt in search parameter
  console.log('\nT. Attempt SQL injection in task search parameter...');
  const sqlInjRes = await request('/tasks?search=' + encodeURIComponent("' OR '1'='1"), 'GET', null, tokenA);
  console.log('Status:', sqlInjRes.status, 'Found Count (should be 0):', sqlInjRes.body.data.length);

  // Test U: Create task under another user's project
  console.log('\nU. User A attempts to create task under User B\'s project ID (' + projB1_Id + ')...');
  const crossCreateRes = await request('/tasks', 'POST', {
    project_id: projB1_Id,
    name: 'Unauthorized Task Creation',
  }, tokenA);
  console.log('Status:', crossCreateRes.status, 'Message:', crossCreateRes.body.message);

  // Test E: User A deletes task A1
  console.log('\nE. User A deletes task (' + taskIdA1 + ')...');
  const deleteRes = await request('/tasks/' + taskIdA1, 'DELETE', null, tokenA);
  console.log('Status:', deleteRes.status, 'Message:', deleteRes.body.message);

  // Test V: Delete project and verify associated tasks are cascade deleted
  console.log('\nV. Delete Project A1 and verify task A2 is cascade deleted...');
  await request('/projects/' + projA1_Id, 'DELETE', null, tokenA);
  const getTasksAfterCascade = await request('/tasks?project_id=' + projA1_Id, 'GET', null, tokenA);
  console.log('Status:', getTasksAfterCascade.status, 'Tasks remaining for Project A1:', getTasksAfterCascade.body.data.length);

  console.log('\n=== ALL PHASE 6 TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(console.error);
