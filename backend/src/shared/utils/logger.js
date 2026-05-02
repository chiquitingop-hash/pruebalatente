/**
 * @module shared/utils/logger
 * @description Winston-based structured logger with daily rotation.
 * Outputs JSON in production, colorized text in development.
 */

const winston = require('winston');
require('winston-daily-rotate-file');
const { env } = require('../../config/env');

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// ─── Formatters ───────────────────────────────────────────────────────────────

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}] ${message}${metaStr}`;
  })
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ─── Transports ───────────────────────────────────────────────────────────────

const transports = [
  new winston.transports.Console({
    format: env.isDev ? devFormat : prodFormat,
  }),
];

if (env.isProd) {
  transports.push(
    new winston.transports.DailyRotateFile({
      filename: `${env.LOG_DIR}/error-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
      maxSize: '20m',
      format: prodFormat,
    }),
    new winston.transports.DailyRotateFile({
      filename: `${env.LOG_DIR}/combined-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      maxSize: '50m',
      format: prodFormat,
    })
  );
}

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  transports,
  exitOnError: false,
});

module.exports = logger;

