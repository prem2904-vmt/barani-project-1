/**
 * Simple logger utility with ISO timestamps and log levels.
 */

const formatMessage = (level, message, meta = '') => {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}]: ${message}${metaStr}`;
};

export const logger = {
  info: (message, meta) => {
    console.log(formatMessage('info', message, meta));
  },
  warn: (message, meta) => {
    console.warn(formatMessage('warn', message, meta));
  },
  error: (message, meta) => {
    console.error(formatMessage('error', message, meta));
  },
  http: (message, meta) => {
    console.log(formatMessage('http', message, meta));
  }
};

export default logger;
