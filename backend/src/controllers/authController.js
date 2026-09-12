import { registerUser, loginUser } from '../services/authService.js';

/**
 * Controller to handle POST /api/auth/register
 */
export const register = async (req, res, next) => {
  try {
    const user = await registerUser(req.body);
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to handle POST /api/auth/login
 */
export const login = async (req, res, next) => {
  try {
    const authData = await loginUser(req.body);
    res.status(200).json({
      success: true,
      message: 'Login successful',
      token: authData.token,
      user: authData.user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to handle POST /api/auth/logout
 * Protected route requiring valid JWT token
 */
export const logout = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};
