import { verifyToken } from '../utils/jwt.js';
import { ApiError } from './errorHandler.js';

/**
 * Express middleware to protect routes with JWT authentication.
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return next(new ApiError(401, 'Access denied. Authorization header missing'));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return next(new ApiError(401, 'Access denied. Invalid authorization header format. Expected "Bearer <token>"'));
  }

  const token = parts[1];
  if (!token || token.trim() === '') {
    return next(new ApiError(401, 'Access denied. Token missing'));
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    next(err);
  }
};

export default authenticateToken;
