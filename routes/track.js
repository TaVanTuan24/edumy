const express = require('express');
const router = express.Router();
const { isLoggedIn, requireCourseAccess } = require('../middleware');
const catchAsync = require('../utils/catchAsync');
const tracking = require('../controllers/tracking');

router.post('/event', isLoggedIn, requireCourseAccess, catchAsync(tracking.trackEvent));
router.post('/watch-time', isLoggedIn, requireCourseAccess, catchAsync(tracking.trackWatchTime));
router.post('/slide', isLoggedIn, requireCourseAccess, catchAsync(tracking.trackSlide));
router.post('/quiz', isLoggedIn, requireCourseAccess, catchAsync(tracking.trackQuiz));

module.exports = router;
