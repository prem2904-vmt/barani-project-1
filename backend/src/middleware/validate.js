import { ApiError } from './errorHandler.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates registration request body.
 */
export const validateRegister = (req, res, next) => {
  const { full_name, email, password } = req.body;

  if (!full_name || typeof full_name !== 'string' || full_name.trim() === '') {
    return next(new ApiError(400, 'Full name is required'));
  }

  if (!email || typeof email !== 'string' || email.trim() === '') {
    return next(new ApiError(400, 'Email address is required'));
  }

  if (!EMAIL_REGEX.test(email.trim())) {
    return next(new ApiError(400, 'Invalid email address format'));
  }

  if (!password || typeof password !== 'string' || password.trim() === '') {
    return next(new ApiError(400, 'Password is required'));
  }

  if (password.length < 6) {
    return next(new ApiError(400, 'Password must be at least 6 characters long'));
  }

  // Normalize email
  req.body.full_name = full_name.trim();
  req.body.email = email.trim().toLowerCase();
  next();
};

/**
 * Validates login request body.
 */
export const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || typeof email !== 'string' || email.trim() === '') {
    return next(new ApiError(400, 'Email address is required'));
  }

  if (!EMAIL_REGEX.test(email.trim())) {
    return next(new ApiError(400, 'Invalid email address format'));
  }

  if (!password || typeof password !== 'string' || password.trim() === '') {
    return next(new ApiError(400, 'Password is required'));
  }

  // Normalize email
  req.body.email = email.trim().toLowerCase();
  next();
};
