import pool from '../config/db.js';

/**
 * Calculates aggregated dashboard statistics for the authenticated user.
 * @param {number} userId - Authenticated user ID
 * @returns {Promise<Object>} Dashboard metrics
 */
export const getDashboardStats = async (userId) => {
  // 1. Total Projects for user
  const [totalProjectsRows] = await pool.execute(
    'SELECT COUNT(*) AS count FROM projects WHERE user_id = ?',
    [userId]
  );
  const totalProjects = Number(totalProjectsRows[0]?.count || 0);

  // 2. Projects In Progress for user
  const [inProgressProjectsRows] = await pool.execute(
    "SELECT COUNT(*) AS count FROM projects WHERE user_id = ? AND status = 'In Progress'",
    [userId]
  );
  const projectsInProgress = Number(inProgressProjectsRows[0]?.count || 0);

  // 3. Total Tasks for user's projects
  const [totalTasksRows] = await pool.execute(
    `SELECT COUNT(t.id) AS count
     FROM tasks t
     JOIN projects p ON t.project_id = p.id
     WHERE p.user_id = ?`,
    [userId]
  );
  const totalTasks = Number(totalTasksRows[0]?.count || 0);

  // 4. Completed Tasks for user's projects
  const [completedTasksRows] = await pool.execute(
    `SELECT COUNT(t.id) AS count
     FROM tasks t
     JOIN projects p ON t.project_id = p.id
     WHERE p.user_id = ? AND t.status = 'Completed'`,
    [userId]
  );
  const completedTasks = Number(completedTasksRows[0]?.count || 0);

  // 5. Pending Tasks for user's projects
  const [pendingTasksRows] = await pool.execute(
    `SELECT COUNT(t.id) AS count
     FROM tasks t
     JOIN projects p ON t.project_id = p.id
     WHERE p.user_id = ? AND t.status = 'Pending'`,
    [userId]
  );
  const pendingTasks = Number(pendingTasksRows[0]?.count || 0);

  return {
    totalProjects,
    totalTasks,
    completedTasks,
    pendingTasks,
    projectsInProgress,
  };
};
