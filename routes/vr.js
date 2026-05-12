const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const catchAsync = require('../utils/catchAsync');
const vrController = require('../controllers/vrController');
const ExpressError = require('../utils/ExpressError');
const { isVRAuthenticated, createVRToken } = require('../middleware/isVRAuthenticated');
const validateStreamRequest = require('../middleware/validateStreamRequest');

const streamResolveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Math.max(1, Number(process.env.VR_STREAM_RESOLVE_RATE_LIMIT_MAX) || 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many stream resolve requests. Please retry later.'
    }
  })
});

const streamProxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Math.max(1, Number(process.env.VR_STREAM_PROXY_RATE_LIMIT_MAX) || 120),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many proxy stream requests. Please retry later.'
    }
  })
});

function requireSessionForToken(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user._id) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: 'Unauthorized'
  });
}

router.get('/get-token', requireSessionForToken, catchAsync(async (req, res) => {
  if (!req.user || !req.user._id) {
    throw new ExpressError('Unauthorized', 401);
  }

  const token = createVRToken(req.user);

  return res.json({
    success: true,
    data: {
      token,
      tokenType: 'Bearer',
      expiresIn: '30d',
      userId: String(req.user._id)
    }
  });
}));

router.get('/courses', isVRAuthenticated, catchAsync(vrController.getVrCourses));
router.get('/courses/:courseId/lessons', isVRAuthenticated, catchAsync(vrController.getVrCourseLessons));
router.post('/courses/:courseId/progress', isVRAuthenticated, catchAsync(vrController.updateVrCourseProgress));
router.post('/courses/:courseId/quiz-results', isVRAuthenticated, catchAsync(vrController.saveVrQuizResult));
router.post('/stream/resolve', streamResolveLimiter, isVRAuthenticated, validateStreamRequest, catchAsync(vrController.resolveVrStream));
router.get('/stream/proxy', streamProxyLimiter, catchAsync(vrController.proxyVrStream));

router.use((err, req, res, _next) => {
  const statusCode = err instanceof ExpressError
    ? err.statusCode
    : (err.statusCode || 500);

  if (req.path.startsWith('/stream/')) {
    return res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 401 ? 'UNAUTHORIZED' : 'RESOLVE_FAILED',
        message: err.message || 'Internal Server Error'
      }
    });
  }

  return res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

module.exports = router;
