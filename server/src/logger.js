// ─── Winston Structured Logger ────────────────────────────────────────────
// Outputs JSON in production, colorized text in development.
// Import `logger` anywhere in the server — never use console.log directly.

const { createLogger, format, transports } = require('winston');
const { combine, timestamp, errors, json, colorize, printf } = format;

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || 'info';

// Pretty format for development
const devFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${ts} [${level}] ${stack || message}${metaStr}`;
});

const logger = createLogger({
  level: logLevel,
  defaultMeta: { service: 'noirsync-server' },
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    isProduction ? json() : combine(colorize(), devFormat)
  ),
  transports: [
    new transports.Console(),
    // In production you could add file or cloud transports here:
    // new transports.File({ filename: 'logs/error.log', level: 'error' }),
    // new transports.File({ filename: 'logs/combined.log' }),
  ],
  // Don't crash the process on logger errors
  exitOnError: false,
});

module.exports = logger;
