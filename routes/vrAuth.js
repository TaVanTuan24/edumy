const express = require('express');
const rateLimit = require('express-rate-limit');
const catchAsync = require('../utils/catchAsync');
const ExpressError = require('../utils/ExpressError');
const vrAuth = require('../controllers/vrAuth');
const { isLoggedIn } = require('../middleware');

const router = express.Router();

function buildJsonLimiter(max, message) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({
      success: false,
      message
    })
  });
}

const requestCodeLimiter = buildJsonLimiter(12, 'Too many code requests. Please retry in a minute.');
const approveLimiter = buildJsonLimiter(30, 'Too many approval attempts. Please retry in a minute.');
const pollLimiter = buildJsonLimiter(120, 'Too many polling requests. Please retry in a minute.');

router.post('/request-code', requestCodeLimiter, catchAsync(vrAuth.requestCode));
router.post('/approve', approveLimiter, isLoggedIn, catchAsync(vrAuth.approveCode));
router.get('/poll/:code', pollLimiter, catchAsync(vrAuth.pollCode));

router.use((err, _req, res, _next) => {
  const statusCode = err instanceof ExpressError
    ? err.statusCode
    : (err.statusCode || 500);

  return res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

module.exports = router;
