import { getDashboardStats } from '../services/dashboardService.js';

/**
 * GET /api/dashboard
 * Returns aggregated statistics for the authenticated user.
 */
export const getDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const stats = await getDashboardStats(userId);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};
