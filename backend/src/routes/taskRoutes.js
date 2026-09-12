import { Router } from 'express';
import {
  create,
  getTasks,
  getTask,
  update,
  remove,
} from '../controllers/taskController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { validateTaskInput } from '../middleware/taskValidation.js';

const router = Router();

// Enforce JWT authentication on ALL task endpoints
router.use(authenticateToken);

router.get('/', getTasks);
router.get('/:id', getTask);
router.post('/', validateTaskInput, create);
router.put('/:id', validateTaskInput, update);
router.delete('/:id', remove);

export default router;
