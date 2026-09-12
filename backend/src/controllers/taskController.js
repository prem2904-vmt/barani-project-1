import {
  createTask as createService,
  getTasks as getTasksService,
  getTaskById as getTaskByIdService,
  updateTask as updateService,
  deleteTask as deleteService,
} from '../services/taskService.js';

/**
 * POST /api/tasks
 */
export const create = async (req, res, next) => {
  try {
    const task = await createService(req.user.id, req.body);
    res.status(201).json({
      success: true,
      data: task,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/tasks
 */
export const getTasks = async (req, res, next) => {
  try {
    const { search, status, priority, project_id } = req.query;
    const tasks = await getTasksService(req.user.id, { search, status, priority, project_id });
    res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/tasks/:id
 */
export const getTask = async (req, res, next) => {
  try {
    const task = await getTaskByIdService(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      data: task,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/tasks/:id
 */
export const update = async (req, res, next) => {
  try {
    const task = await updateService(req.user.id, req.params.id, req.body);
    res.status(200).json({
      success: true,
      data: task,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/tasks/:id
 */
export const remove = async (req, res, next) => {
  try {
    await deleteService(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
