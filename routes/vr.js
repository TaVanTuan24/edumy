const express = require('express');
const router = express.Router();
const catchAsync = require('../utils/catchAsync');
const vrController = require('../controllers/vrController');
const ExpressError = require('../utils/ExpressError');
const { isVRAuthenticated, createVRToken } = require('../middleware/isVRAuthenticated');

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

router.use((err, req, res, next) => {
  const statusCode = err instanceof ExpressError
    ? err.statusCode
    : (err.statusCode || 500);

  return res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

module.exports = router;