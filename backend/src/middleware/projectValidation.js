import { ApiError } from './errorHandler.js';

const ALLOWED_STATUSES = ['Not Started', 'In Progress', 'Completed'];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a date string in YYYY-MM-DD format.
 */
const isValidDateString = (dateStr) => {
  if (typeof dateStr !== 'string') return false;
  if (!DATE_REGEX.test(dateStr)) return false;
  const timestamp = Date.parse(dateStr);
  return !isNaN(timestamp);
};

/**
 * Validation middleware for POST /api/projects and PUT /api/projects/:id
 */
export const validateProjectInput = (req, res, next) => {
  const { name, description, status, start_date, end_date } = req.body;

  // 1. Validate Name (required for POST; if present in PUT, cannot be empty)
  if (req.method === 'POST') {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return next(new ApiError(400, 'Project name is required'));
    }
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '') {
      return next(new ApiError(400, 'Project name cannot be empty'));
    }
    if (name.trim().length > 255) {
      return next(new ApiError(400, 'Project name must not exceed 255 characters'));
    }
  }

  // 2. Validate Status if provided
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

  // 3. Validate Start Date if provided
  if (start_date !== undefined && start_date !== null && start_date !== '') {
    if (!isValidDateString(start_date)) {
      return next(new ApiError(400, 'Invalid start_date format. Expected YYYY-MM-DD'));
    }
  }

  // 4. Validate End Date if provided
  if (end_date !== undefined && end_date !== null && end_date !== '') {
    if (!isValidDateString(end_date)) {
      return next(new ApiError(400, 'Invalid end_date format. Expected YYYY-MM-DD'));
    }
  }

  // 5. Validate Date Ordering (end_date >= start_date)
  if (start_date && end_date && start_date !== '' && end_date !== '') {
    const startDateObj = new Date(start_date);
    const endDateObj = new Date(end_date);
    if (endDateObj < startDateObj) {
      return next(new ApiError(400, 'End date cannot be before start date'));
    }
  }

  // Normalize inputs
  if (name) req.body.name = name.trim();
  if (description !== undefined && description !== null) {
    req.body.description = typeof description === 'string' ? description.trim() : description;
  }

  next();
};
