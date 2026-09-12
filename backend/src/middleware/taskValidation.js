import { ApiError } from './errorHandler.js';

const ALLOWED_PRIORITIES = ['Low', 'Medium', 'High'];
const ALLOWED_STATUSES = ['Pending', 'In Progress', 'Completed'];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isValidDateString = (dateStr) => {
  if (typeof dateStr !== 'string') return false;
  if (!DATE_REGEX.test(dateStr)) return false;
  const timestamp = Date.parse(dateStr);
  return !isNaN(timestamp);
};

export const validateTaskInput = (req, res, next) => {
  const { project_id, name, priority, status, due_date } = req.body;

  // 1. Validate project_id for POST
  if (req.method === 'POST') {
    if (project_id === undefined || project_id === null || isNaN(parseInt(project_id, 10)) || parseInt(project_id, 10) <= 0) {
      return next(new ApiError(400, 'Valid numeric project_id is required'));
    }
  }

  // 2. Validate Name
  if (req.method === 'POST') {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return next(new ApiError(400, 'Task name is required'));
    }
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '') {
      return next(new ApiError(400, 'Task name cannot be empty'));
    }
    if (name.trim().length > 255) {
      return next(new ApiError(400, 'Task name must not exceed 255 characters'));
    }
  }

  // 3. Validate Priority if provided
  if (priority !== undefined && priority !== null) {
    if (!ALLOWED_PRIORITIES.includes(priority)) {
      return next(
        new ApiError(
          400,
          `Invalid priority value. Allowed values are: ${ALLOWED_PRIORITIES.join(', ')}`
        )
      );
    }
  }

  // 4. Validate Status if provided
  if (status !== undefined && status !== null) {
    if (!ALLOWED_STATUSES.includes(status)) {
      return next(
        new ApiError(
          400,
          `Invalid status value. Allowed values are: ${ALLOWED_STATUSES.join(', ')}`
        )
      );
    }
  }

  // 5. Validate Due Date if provided
  if (due_date !== undefined && due_date !== null && due_date !== '') {
    if (!isValidDateString(due_date)) {
      return next(new ApiError(400, 'Invalid due_date format. Expected YYYY-MM-DD'));
    }
  }

  // Normalize input strings
  if (name) req.body.name = name.trim();
  if (req.body.description && typeof req.body.description === 'string') {
    req.body.description = req.body.description.trim();
  }

  next();
};
