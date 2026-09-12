import pool from '../config/db.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Fetches all projects belonging to the specified user with optional search and status filters.
 */
export const getUserProjects = async (userId, { search, status }) => {
  let query = 'SELECT id, user_id, name, description, status, start_date, end_date, created_at, updated_at FROM projects WHERE user_id = ?';
  const params = [userId];

  if (search && search.trim() !== '') {
    query += ' AND name LIKE ?';
    params.push(`%${search.trim()}%`);
  }

  if (status && status.trim() !== '') {
    query += ' AND status = ?';
    params.push(status.trim());
  }

  query += ' ORDER BY created_at DESC';

  const [rows] = await pool.execute(query, params);
  return rows;
};

/**
 * Fetches a single project by ID ensuring ownership by userId.
 */
export const getProjectById = async (userId, projectId) => {
  const [rows] = await pool.execute(
    'SELECT id, user_id, name, description, status, start_date, end_date, created_at, updated_at FROM projects WHERE id = ? AND user_id = ? LIMIT 1',
    [projectId, userId]
  );

  if (rows.length === 0) {
    throw new ApiError(404, 'Project not found');
  }

  return rows[0];
};

/**
 * Creates a new project owned by userId.
 */
export const createProject = async (userId, { name, description, status, start_date, end_date }) => {
  const projectStatus = status || 'Not Started';
  const projectDescription = description !== undefined ? description : null;
  const startDateVal = start_date || null;
  const endDateVal = end_date || null;

  const [result] = await pool.execute(
    'INSERT INTO projects (user_id, name, description, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, name, projectDescription, projectStatus, startDateVal, endDateVal]
  );

  return await getProjectById(userId, result.insertId);
};

/**
 * Updates an existing project owned by userId.
 */
export const updateProject = async (userId, projectId, updateData) => {
  // Ensure project exists and belongs to user
  const currentProject = await getProjectById(userId, projectId);

  const newName = updateData.name !== undefined ? updateData.name : currentProject.name;
  const newDesc = updateData.description !== undefined ? updateData.description : currentProject.description;
  const newStatus = updateData.status !== undefined ? updateData.status : currentProject.status;
  const newStartDate = updateData.start_date !== undefined ? updateData.start_date : currentProject.start_date;
  const newEndDate = updateData.end_date !== undefined ? updateData.end_date : currentProject.end_date;

  await pool.execute(
    'UPDATE projects SET name = ?, description = ?, status = ?, start_date = ?, end_date = ? WHERE id = ? AND user_id = ?',
    [newName, newDesc, newStatus, newStartDate, newEndDate, projectId, userId]
  );

  return await getProjectById(userId, projectId);
};

/**
 * Deletes a project owned by userId.
 */
export const deleteProject = async (userId, projectId) => {
  const [result] = await pool.execute(
    'DELETE FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  );

  if (result.affectedRows === 0) {
    throw new ApiError(404, 'Project not found');
  }

  return true;
};
