const crypto = require('crypto');

const CSRF_SECRET = process.env.CSRF_SECRET || process.env.SESSION_SECRET || 'csrf-dev-secret-change-me';
const TOKEN_NAME = '_csrf';
const COOKIE_NAME = 'XSRF-TOKEN';
const HEADER_NAME = 'x-csrf-token';

function generateCsrfToken(sessionId) {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString('hex');
  const payload = `${sessionId || 'anon'}:${timestamp}:${random}`;
  const hmac = crypto.createHmac('sha256', CSRF_SECRET).update(payload).digest('hex');
  return `${timestamp}.${random}.${hmac}`;
}

function verifyCsrfToken(token, sessionId) {
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [timestamp, random, hmac] = parts;
  const payload = `${sessionId || 'anon'}:${timestamp}:${random}`;
  const expectedHmac = crypto.createHmac('sha256', CSRF_SECRET).update(payload).digest('hex');

  const submittedBuffer = Buffer.from(hmac, 'hex');
  const expectedBuffer = Buffer.from(expectedHmac, 'hex');

  // timingSafeEqual throws when buffer lengths differ (e.g. a malformed/truncated token).
  // Guard the length first so a bad token yields a clean rejection instead of a 500.
  if (submittedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  if (!crypto.timingSafeEqual(submittedBuffer, expectedBuffer)) {
    return false;
  }

  const tokenAge = Date.now() - parseInt(timestamp, 36);
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  return tokenAge >= 0 && tokenAge < maxAge;
}

function extractToken(req) {
  // 1. Check header first (for AJAX/JSON requests)
  const headerToken = req.get(HEADER_NAME) || req.get('csrf-token') || req.get('xsrf-token');
  if (headerToken) return headerToken;

  // 2. Check request body (for form submissions)
  if (req.body && req.body[TOKEN_NAME]) return req.body[TOKEN_NAME];

  // Note: tokens are intentionally NOT read from the query string. URLs are logged by
  // servers/proxies and leak via the Referer header, so a token in the query is a disclosure risk.
  return null;
}

function csrfProtection(req, res, next) {
  const sessionId = req.sessionID || '';
  const token = generateCsrfToken(sessionId);

  // Set token on cookie for Double Submit Cookie pattern
  res.cookie(COOKIE_NAME, token, {
    httpOnly: false, // JavaScript needs to read it
    sameSite: 'strict',
    secure: req.secure || req.protocol === 'https',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });

  // Make token available to templates
  res.locals.csrfToken = token;
  req.csrfToken = () => token;

  // Validate on state-changing methods
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const submittedToken = extractToken(req);

    if (!submittedToken) {
      return res.status(403).json({
        success: false,
        error: 'CSRF token missing. Please refresh the page and try again.',
        code: 'EBADCSRFTOKEN'
      });
    }

    if (!verifyCsrfToken(submittedToken, sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Your form expired or the request could not be verified. Please try again.',
        code: 'EBADCSRFTOKEN'
      });
    }
  }

  next();
}

function csrfTokenOnly(req, res, next) {
  // Generate and set CSRF token without validating (for skipped routes)
  const sessionId = req.sessionID || '';
  const token = generateCsrfToken(sessionId);

  res.cookie(COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: req.secure || req.protocol === 'https',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000
  });

  res.locals.csrfToken = token;
  req.csrfToken = () => token;
  next();
}

module.exports = { csrfProtection, csrfTokenOnly, generateCsrfToken, verifyCsrfToken, TOKEN_NAME, COOKIE_NAME, HEADER_NAME };
