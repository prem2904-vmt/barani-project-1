# System Test Suite & Quality Verification

This document details the automated testing architecture, test scenarios, coverage metrics, and verification results for the **Project Management System**.

---

## Executive Summary

| Test Suite | Module | Test Count | Pass Rate | Status |
| :--- | :--- | :---: | :---: | :---: |
| `test_auth.js` | Authentication & JWT | 10 | 100% | **PASSED** |
| `test_projects.js` | Project Management (CRUD & Isolation) | 17 | 100% | **PASSED** |
| `test_tasks.js` | Task Management (CRUD & Cascade) | 22 | 100% | **PASSED** |
| `test_dashboard.js` | Dashboard Aggregation Metrics | 14 | 100% | **PASSED** |
| `test_search_filters.js` | Search & Multi-Criteria Filtering | 29 | 100% | **PASSED** |
| `test_security.js` | Security, Validation & Payload Audit | 31 | 100% | **PASSED** |
| **Total Automated Backend Tests** | **Full System** | **123** | **100%** | **PASSED** |

---

## Detailed Test Suite Breakdowns

### 1. Authentication Test Suite (`test_auth.js`)
* **Registration**: Validates input presence (`full_name`, `email`, `password`), email format validation, email normalization, and unique email duplicate rejection (`HTTP 409`).
* **Password Security**: Verifies `bcryptjs` password hashing (salt 10). Password hashes are never stored plain-text, logged, or returned in API responses.
* **JWT Handling**: Verifies signed JWT generation upon successful authentication, Bearer header extraction, and rejection of unauthenticated (`401`), malformed, or missing tokens.
* **Rate Limiting**: Verifies `authRateLimiter` enforces HTTP `429 Too Many Requests` when authentication endpoints exceed request bounds.

### 2. Project Management Test Suite (`test_projects.js`)
* **CRUD Verification**: Validates project creation (`201`), retrieval (`200`), updating (`200`), and deletion (`200`).
* **Input Validation**: Rejects empty project names (`400`), invalid status values (`400`), malformed dates (`400`), and inverted date ranges (`end_date < start_date` $\rightarrow$ `400`).
* **Ownership Isolation**: Verifies User A cannot GET, PUT, or DELETE User B's project (`HTTP 404 Not Found`).

### 3. Task Management Test Suite (`test_tasks.js`)
* **CRUD & Relationship Verification**: Validates task creation (`201`) under owned projects, retrieval (`200`), updating (`200`), and deletion (`200`).
* **Input Validation**: Rejects empty task names (`400`), invalid priority values (`Low`, `Medium`, `High` $\rightarrow$ `400`), invalid status values (`Pending`, `In Progress`, `Completed` $\rightarrow$ `400`), and malformed due dates (`400`).
* **Multi-Table Ownership**: Verifies User A cannot create, update, or delete tasks under User B's projects (`HTTP 404 Not Found`).
* **Cascade Deletion**: Confirms deleting a project automatically cascade-deletes all associated tasks.

### 4. Dashboard Test Suite (`test_dashboard.js`)
* **Aggregated Statistics**: Validates accuracy of `totalProjects`, `totalTasks`, `completedTasks`, `pendingTasks`, and `projectsInProgress`.
* **Zero & Edge Cases**: Tests metrics for users with 0 projects, users with projects but 0 tasks, and user metric isolation.
* **Ownership Tampering**: Verifies query manipulation (e.g., `?user_id=9999`) does not alter metrics.

### 5. Search & Filtering Test Suite (`test_search_filters.js`)
* **Project Search & Filter**: Tests full/partial name search (`LIKE ?`) and status filtering (`Not Started`, `In Progress`, `Completed`).
* **Task Search & Filter**: Tests multi-criteria search by name, status filtering, priority filtering (`Low`, `Medium`, `High`), and `project_id` filtering.
* **Cross-User Search Isolation**: Verifies searches strictly yield records owned by `req.user.id`.

### 6. Security & Validation Audit Suite (`test_security.js`)
* **JWT Tampering Tests (A-D)**: Rejects missing, invalid, tampered, or malformed JWT headers (`HTTP 401`).
* **Mass Assignment Protection (I-J)**: Injected `user_id` or `id` in POST/PUT request bodies are safely ignored and overridden by `req.user.id`.
* **Cross-User Project/Task Creation (N-O)**: Prevents cross-user resource manipulation (`HTTP 404 Not Found`).
* **SQL Injection Vectors (P-S)**: Parameterized queries (`pool.execute`) cleanly escape SQL injection payloads (e.g., `' OR '1'='1`, `Robert'); DROP TABLE projects;--`).
* **Validation Bounds (T-AC)**: String length bounds (`<= 255`) and whitespace sanitization verified.

---

## How to Execute Automated Tests

### Running Backend Automated Tests
Ensure the backend server or Docker container stack is running (`http://localhost:5000` or `http://localhost:3000`), then execute:

```bash
cd backend
node test_auth.js
node test_projects.js
node test_tasks.js
node test_dashboard.js
node test_search_filters.js
node test_security.js
```

### Running Frontend Production Build Verification
To verify the Vite React production compilation:

```bash
cd frontend
npm run build
```
*Expected Result*: Output bundle generated in `dist/` with 0 build errors.
