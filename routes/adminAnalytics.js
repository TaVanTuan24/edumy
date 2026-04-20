const express = require('express');
const router = express.Router({ mergeParams: true });
const { isLoggedIn, isAdmin } = require('../middleware');
const adminAnalyticsController = require('../controllers/adminAnalytics');

router.use(isLoggedIn, isAdmin);

// Base route is /admin/courses/:courseId/analytics
router.get('/', adminAnalyticsController.renderDashboard);
router.get('/learners/:userId', adminAnalyticsController.renderLearnerDetail);

module.exports = router;
