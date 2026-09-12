import { Router } from 'express';
import { register, login, logout } from '../controllers/authController.js';
import { validateRegister, validateLogin } from '../middleware/validate.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { authRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Public Authentication Endpoints (Rate limited)
router.post('/register', authRateLimiter, validateRegister, register);
router.post('/login', authRateLimiter, validateLogin, login);

// Protected Authentication Endpoints
router.post('/logout', authenticateToken, logout);

export default router;
