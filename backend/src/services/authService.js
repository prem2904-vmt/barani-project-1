import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { generateToken } from '../utils/jwt.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Registers a new user.
 * @param {Object} userData - { full_name, email, password }
 * @returns {Promise<Object>} Created user details without password
 */
export const registerUser = async ({ full_name, email, password }) => {
  // 1. Check if email already exists
  const [existingUsers] = await pool.execute(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [email]
  );

  if (existingUsers.length > 0) {
    throw new ApiError(409, 'Email address is already registered');
  }

  // 2. Hash password with bcrypt (salt rounds = 10)
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  // 3. Insert new user into database
  const [result] = await pool.execute(
    'INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)',
    [full_name, email, hashedPassword]
  );

  const userId = result.insertId;

  // 4. Return created user info (excluding password hash)
  return {
    id: userId,
    full_name,
    email,
  };
};

/**
 * Authenticates a user and issues a JWT token.
 * @param {Object} credentials - { email, password }
 * @returns {Promise<Object>} { token, user }
 */
export const loginUser = async ({ email, password }) => {
  // 1. Query user by email
  const [users] = await pool.execute(
    'SELECT id, full_name, email, password FROM users WHERE email = ? LIMIT 1',
    [email]
  );

  if (users.length === 0) {
    // Safe generic message (do not expose email existence)
    throw new ApiError(401, 'Invalid email or password');
  }

  const user = users[0];

  // 2. Verify password with bcrypt
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new ApiError(401, 'Invalid email or password');
  }

  // 3. Issue JWT token containing minimal payload
  const tokenPayload = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
  };

  const token = generateToken(tokenPayload);

  // 4. Return token and user profile (excluding password)
  return {
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
    },
  };
};
