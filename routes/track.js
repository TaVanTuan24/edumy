const express = require('express');
const router = express.Router();
const { isLoggedIn } = require('../middleware');
const catchAsync = require('../utils/catchAsync');
const tracking = require('../controllers/tracking');

router.post('/event', isLoggedIn, catchAsync(tracking.trackEvent));
router.post('/watch-time', isLoggedIn, catchAsync(tracking.trackWatchTime));
router.post('/slide', isLoggedIn, catchAsync(tracking.trackSlide));
router.post('/quiz', isLoggedIn, catchAsync(tracking.trackQuiz));

module.exports = router;
