import {
  getUserProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
} from '../services/projectService.js';

/**
 * GET /api/projects
 */
export const getProjects = async (req, res, next) => {
  try {
    const { search, status } = req.query;
    const projects = await getUserProjects(req.user.id, { search, status });
    res.status(200).json({
      success: true,
      data: projects,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/projects/:id
 */
export const getProject = async (req, res, next) => {
  try {
    const project = await getProjectById(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/projects
 */
export const create = async (req, res, next) => {
  try {
    const project = await createProject(req.user.id, req.body);
    res.status(201).json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/projects/:id
 */
export const update = async (req, res, next) => {
  try {
    const project = await updateProject(req.user.id, req.params.id, req.body);
    res.status(200).json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/projects/:id
 */
export const remove = async (req, res, next) => {
  try {
    await deleteProject(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
