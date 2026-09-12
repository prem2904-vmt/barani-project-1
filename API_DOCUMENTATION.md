# REST API Documentation — Project Management System

The Project Management System backend provides a RESTful API with JSON responses, Bearer token JWT authentication, input validation, and security rate-limiting.

---

## Base URL
* **Local Development**: `http://localhost:5000/api`
* **Docker Compose Proxy**: `http://localhost:3000/api`

---

## Authentication Header
Protected endpoints require an `Authorization` header containing a valid Bearer JWT token:

```http
Authorization: Bearer <your_jwt_token>
```

---

## Response Standard

### Success Response (`200 OK` / `201 Created`)
```json
{
  "success": true,
  "message": "Operation description",
  "data": { ... }
}
```

### Error Response (`400`, `401`, `404`, `409`, `500`)
```json
{
  "success": false,
  "message": "Error message description"
}
```

---

## 1. System Health

### GET `/api/health`
Checks API server status and MySQL database connectivity.
* **Access**: Public
* **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Project Management System API is running",
    "timestamp": "2026-09-11T23:55:00.000Z",
    "database": "connected"
  }
  ```

---

## 2. Authentication Endpoints

### POST `/api/auth/register`
Registers a new user account.
* **Access**: Public (Rate Limited)
* **Request Body**:
  ```json
  {
    "full_name": "John Doe",
    "email": "john@example.com",
    "password": "Password123!"
  }
  ```
* **Success Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com"
    }
  }
  ```
* **Errors**: `400` (Validation), `409` (Email already registered).

---

### POST `/api/auth/login`
Authenticates a user and issues a JWT token.
* **Access**: Public (Rate Limited)
* **Request Body**:
  ```json
  {
    "email": "john@example.com",
    "password": "Password123!"
  }
  ```
* **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Login successful",
    "token": "eyJhbGciOiJIUzI1Ni...",
    "user": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com"
    }
  }
  ```
* **Errors**: `400` (Validation), `401` (Invalid credentials).

---

### POST `/api/auth/logout`
Logs out the current session.
* **Access**: Protected (JWT Bearer Token required)
* **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Logged out successfully"
  }
  ```

---

## 3. Project Management Endpoints

### GET `/api/projects`
Lists all projects owned by the authenticated user.
* **Access**: Protected (JWT)
* **Query Parameters** (Optional):
  * `search`: Filter by project name (partial match).
  * `status`: Filter by status (`Not Started`, `In Progress`, `Completed`).
* **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 1,
        "user_id": 1,
        "name": "Website Redesign",
        "description": "Redesign corporate website",
        "status": "In Progress",
        "start_date": "2026-09-15T00:00:00.000Z",
        "end_date": "2026-10-15T00:00:00.000Z",
        "created_at": "2026-09-11T12:00:00.000Z",
        "updated_at": "2026-09-11T12:00:00.000Z"
      }
    ]
  }
  ```

---

### GET `/api/projects/:id`
Gets details of a specific owned project.
* **Access**: Protected (JWT)
* **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "id": 1, "name": "Website Redesign", ... }
  }
  ```
* **Errors**: `404` (Project not found or owned by another user).

---

### POST `/api/projects`
Creates a new project.
* **Access**: Protected (JWT)
* **Request Body**:
  ```json
  {
    "name": "New Mobile App",
    "description": "Cross-platform mobile application",
    "status": "Not Started",
    "start_date": "2026-09-20",
    "end_date": "2026-11-20"
  }
  ```
* **Success Response (`201 Created`)**

---

### PUT `/api/projects/:id`
Updates an existing project.
* **Access**: Protected (JWT)
* **Request Body**: Fields to update (`name`, `description`, `status`, `start_date`, `end_date`).

---

### DELETE `/api/projects/:id`
Deletes a project and all associated tasks (Cascade Delete).
* **Access**: Protected (JWT)
* **Success Response (`200 OK`)**

---

## 4. Task Management Endpoints

### GET `/api/tasks`
Lists all tasks under projects owned by the authenticated user.
* **Access**: Protected (JWT)
* **Query Parameters** (Optional):
  * `search`: Filter by task name.
  * `status`: Filter by status (`Pending`, `In Progress`, `Completed`).
  * `priority`: Filter by priority (`Low`, `Medium`, `High`).
  * `project_id`: Filter by specific project ID.

---

### GET `/api/tasks/:id`
Gets details of a specific task.
* **Access**: Protected (JWT)

---

### POST `/api/tasks`
Creates a new task under an owned project.
* **Access**: Protected (JWT)
* **Request Body**:
  ```json
  {
    "project_id": 1,
    "name": "Design Wireframes",
    "description": "Create UI wireframes in Figma",
    "priority": "High",
    "status": "Pending",
    "due_date": "2026-09-25"
  }
  ```

---

### PUT `/api/tasks/:id`
Updates a task.
* **Access**: Protected (JWT)

---

### DELETE `/api/tasks/:id`
Deletes a task.
* **Access**: Protected (JWT)

---

## 5. Dashboard Aggregation Endpoint

### GET `/api/dashboard`
Returns aggregated analytics metrics for the authenticated user.
* **Access**: Protected (JWT)
* **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "totalProjects": 5,
      "totalTasks": 12,
      "completedTasks": 4,
      "pendingTasks": 5,
      "projectsInProgress": 3
    }
  }
  ```
