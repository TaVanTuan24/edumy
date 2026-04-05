const express = require('express');
const router = express.Router();
const catchAsync = require('../utils/catchAsync');
const vrController = require('../controllers/vrController');
const ExpressError = require('../utils/ExpressError');

function requireApiAuth(req, res, next) {
  if (req.user && req.user._id) {
    return next();
  }

  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: 'Unauthorized'
  });
}

router.get('/courses', requireApiAuth, catchAsync(vrController.getVrCourses));
router.get('/courses/:courseId/lessons', requireApiAuth, catchAsync(vrController.getVrCourseLessons));

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