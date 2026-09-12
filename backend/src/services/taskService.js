import pool from '../config/db.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Creates a new task under a project owned by userId.
 */
export const createTask = async (userId, { project_id, name, description, priority, status, due_date }) => {
  // 1. Verify project exists and belongs to authenticated user
  const [projects] = await pool.execute(
    'SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1',
    [project_id, userId]
  );

  if (projects.length === 0) {
    throw new ApiError(404, 'Project not found');
  }

  const taskPriority = priority || 'Medium';
  const taskStatus = status || 'Pending';
  const taskDesc = description !== undefined ? description : null;
  const dueDateVal = due_date || null;

  // 2. Insert task into database
  const [result] = await pool.execute(
    'INSERT INTO tasks (project_id, name, description, priority, status, due_date) VALUES (?, ?, ?, ?, ?, ?)',
    [project_id, name, taskDesc, taskPriority, taskStatus, dueDateVal]
  );

  // 3. Return newly created task
  return await getTaskById(userId, result.insertId);
};

/**
 * Retrieves all tasks belonging to projects owned by userId with optional filters.
 */
export const getTasks = async (userId, { search, status, priority, project_id }) => {
  let query = `
    SELECT t.id, t.project_id, t.name, t.description, t.priority, t.status, t.due_date, t.created_at, t.updated_at, p.name AS project_name
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE p.user_id = ?
  `;
  const params = [userId];

  if (project_id) {
    query += ' AND t.project_id = ?';
    params.push(project_id);
  }

  if (search && search.trim() !== '') {
    query += ' AND t.name LIKE ?';
    params.push(`%${search.trim()}%`);
  }

  if (status && status.trim() !== '') {
    query += ' AND t.status = ?';
    params.push(status.trim());
  }

  if (priority && priority.trim() !== '') {
    query += ' AND t.priority = ?';
    params.push(priority.trim());
  }

  query += ' ORDER BY t.created_at DESC';

  const [rows] = await pool.execute(query, params);
  return rows;
};

/**
 * Retrieves a single task by ID ensuring project ownership by userId.
 */
export const getTaskById = async (userId, taskId) => {
  const [rows] = await pool.execute(
    `SELECT t.id, t.project_id, t.name, t.description, t.priority, t.status, t.due_date, t.created_at, t.updated_at, p.name AS project_name
     FROM tasks t
     JOIN projects p ON t.project_id = p.id
     WHERE t.id = ? AND p.user_id = ?
     LIMIT 1`,
    [taskId, userId]
  );

  if (rows.length === 0) {
    throw new ApiError(404, 'Task not found');
  }

  return rows[0];
};

/**
 * Updates an existing task owned by userId.
 */
export const updateTask = async (userId, taskId, updateData) => {
  // 1. Verify task exists and belongs to project owned by user
  const currentTask = await getTaskById(userId, taskId);

  const newName = updateData.name !== undefined ? updateData.name : currentTask.name;
  const newDesc = updateData.description !== undefined ? updateData.description : currentTask.description;
  const newPriority = updateData.priority !== undefined ? updateData.priority : currentTask.priority;
  const newStatus = updateData.status !== undefined ? updateData.status : currentTask.status;
  const newDueDate = updateData.due_date !== undefined ? updateData.due_date : currentTask.due_date;

  // 2. Perform parameterized update with JOIN verification
  await pool.execute(
    `UPDATE tasks t
     JOIN projects p ON t.project_id = p.id
     SET t.name = ?, t.description = ?, t.priority = ?, t.status = ?, t.due_date = ?
     WHERE t.id = ? AND p.user_id = ?`,
    [newName, newDesc, newPriority, newStatus, newDueDate, taskId, userId]
  );

  return await getTaskById(userId, taskId);
};

/**
 * Deletes a task owned by userId.
 */
export const deleteTask = async (userId, taskId) => {
  const [result] = await pool.execute(
    `DELETE t FROM tasks t
     JOIN projects p ON t.project_id = p.id
     WHERE t.id = ? AND p.user_id = ?`,
    [taskId, userId]
  );

  if (result.affectedRows === 0) {
    throw new ApiError(404, 'Task not found');
  }

  return true;
};
