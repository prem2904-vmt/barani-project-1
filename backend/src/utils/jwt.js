import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { ApiError } from '../middleware/errorHandler.js';

dotenv.config();

/**
 * Generates a signed JWT token for a user.
 * @param {Object} payload - User identification payload (e.g., { id, email, full_name })
 * @returns {string} Signed JWT string
 */
export const generateToken = (payload) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new ApiError(500, 'JWT secret is not configured on the server');
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || '24h';
  return jwt.sign(payload, secret, { expiresIn });
};

/**
 * Verifies and decodes a JWT token.
 * @param {string} token - Bearer token string
 * @returns {Object} Decoded payload
 */
export const verifyToken = (token) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new ApiError(500, 'JWT secret is not configured on the server');
  }

  try {
    return jwt.verify(token, secret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Authentication token has expired');
    }
    throw new ApiError(401, 'Invalid authentication token');
  }
};
