import { Router } from 'express';
import { getDashboard } from '../controllers/dashboardController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = Router();

// Enforce JWT authentication on Dashboard endpoint
router.use(authenticateToken);

router.get('/', getDashboard);

export default router;
