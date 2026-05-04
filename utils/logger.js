/**
 * Structured logger using pino.
 *
 * Usage:
 *   const logger = require('./utils/logger');
 *   logger.info('Server started');
 *   logger.error({ err }, 'Something failed');
 *
 * Security: Never log passwords, tokens, API keys, cookies, or session content.
 * The redact config below covers common sensitive fields automatically.
 */

const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'apiKey',
      'secret',
      'session',
      'SESSION_SECRET',
      'CSRF_SECRET',
      'AI_API_KEY'
    ],
    remove: true
  },
  // In development, use human-friendly output
  ...(isProduction ? {} : {
    transport: {
      target: 'pino/file',
      options: { destination: 1 } // stdout
    }
  })
});

module.exports = logger;