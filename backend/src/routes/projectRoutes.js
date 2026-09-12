import { Router } from 'express';
import {
  getProjects,
  getProject,
  create,
  update,
  remove,
} from '../controllers/projectController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { validateProjectInput } from '../middleware/projectValidation.js';

const router = Router();

// Enforce JWT authentication on ALL project endpoints
router.use(authenticateToken);

router.get('/', getProjects);
router.get('/:id', getProject);
router.post('/', validateProjectInput, create);
router.put('/:id', validateProjectInput, update);
router.delete('/:id', remove);

export default router;
