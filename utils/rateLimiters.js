const rateLimit = require('express-rate-limit');
const { wantsJson } = require('./requestHelpers');

function createLimiter(options = {}) {
  const {
    windowMs,
    max,
    message,
    jsonMessage,
    redirectTo = '/',
    code = 'RATE_LIMITED',
    skipSuccessfulRequests = false
  } = options;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (req, res) => {
      const safeMessage = message || 'Too many requests. Please try again later.';

      if (wantsJson(req)) {
        return res.status(429).json({
          success: false,
          error: jsonMessage || safeMessage,
          code
        });
      }

      req.flash('error', safeMessage);
      return res.redirect(redirectTo || req.get('Referrer') || '/');
    }
  });
}

const authLoginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Too many login attempts. Please wait a few minutes and try again.',
  redirectTo: '/login'
});

const authRegisterLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: 'Too many registration attempts. Please try again later.',
  redirectTo: '/register'
});

const aiChatLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: 'Too many AI requests. Please slow down and try again shortly.'
});

const aiStreamLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: 'Too many streaming AI requests. Please wait and try again shortly.'
});

const aiSettingsLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many AI settings changes. Please wait and try again.'
});

const adminApiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 180,
  message: 'Too many admin API requests. Please wait and try again.'
});

const adminActionLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: 'Too many admin actions. Please wait and try again.'
});

const uploadLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many uploads. Please wait and try again.'
});

module.exports = {
  createLimiter,
  authLoginLimiter,
  authRegisterLimiter,
  aiChatLimiter,
  aiStreamLimiter,
  aiSettingsLimiter,
  adminApiLimiter,
  adminActionLimiter,
  uploadLimiter
};
