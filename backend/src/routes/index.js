import { Router } from 'express';
import { checkDbConnection } from '../config/db.js';
import authRoutes from './authRoutes.js';
import projectRoutes from './projectRoutes.js';
import taskRoutes from './taskRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';

const router = Router();

// Health Check Endpoint
router.get('/health', async (req, res) => {
  const dbConnected = await checkDbConnection();
  
  res.status(200).json({
    success: true,
    message: 'Project Management System API is running',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected'
  });
});

// Feature Route Modules
router.use('/auth', authRoutes);
router.use('/projects', projectRoutes);
router.use('/tasks', taskRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
