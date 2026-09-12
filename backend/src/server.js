import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool, { checkDbConnection } from './config/db.js';
import apiRoutes from './routes/index.js';
import requestLogger from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxy (Railway / Nginx) for rate limiting & client IP identification
app.set('trust proxy', 1);

// Core Middleware
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// API Routes
app.use('/api', apiRoutes);

// Error Handling Middleware
app.use(notFoundHandler);
app.use(errorHandler);

let server;

// Start Server and verify DB connection
const startServer = async () => {
  const dbConnected = await checkDbConnection();
  if (dbConnected) {
    logger.info('Database connected successfully to project_management_db');
  } else {
    logger.warn('Database connection failed. Please check MySQL server and environment variables.');
  }

  if (process.env.NODE_ENV !== 'test') {
    server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
  }
};

// Graceful Shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  
  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed.');
      try {
        await pool.end();
        logger.info('MySQL connection pool closed.');
        process.exit(0);
      } catch (err) {
        logger.error('Error closing MySQL pool', { error: err.message });
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();

export default app;
