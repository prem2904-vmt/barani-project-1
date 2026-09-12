import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
  port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '3306', 10),
  user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'project_management_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Checks MySQL database connectivity.
 * @returns {Promise<boolean>}
 */
export const checkDbConnection = async () => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch (error) {
    logger.error('MySQL database connection failed', { error: error.message });
    return false;
  }
};

export default pool;
