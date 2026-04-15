const express = require('express');
const router = express.Router();
const passport = require('passport');
const multer = require('multer');
const catchAsync = require('../utils/catchAsync');
const users = require('../controllers/users');
const { storage } = require('../config/cloudinary');
const { storeReturnTo, isLoggedIn } = require('../middleware');

const upload = multer({ storage });

router.route('/register')
    .get(users.renderRegister)
    .post(catchAsync(users.register));

router.route('/login')
    .get(users.renderLogin)
    .post(
        storeReturnTo,
        passport.authenticate('local', { failureFlash: true, failureRedirect: '/login' }),
        users.login
    );

router.get('/logout', users.logout);
router.get('/profile', isLoggedIn, catchAsync(users.renderProfile));
router.post('/profile/avatar', isLoggedIn, upload.single('avatar'), catchAsync(users.updateAvatar));
router.get('/leaderboard', isLoggedIn, catchAsync(users.renderLeaderboard));
router.get('/api/gamification', isLoggedIn, catchAsync(users.getGamificationProfile));
router.get('/api/gamification/leaderboard', isLoggedIn, catchAsync(users.getLeaderboard));
router.post('/api/notifications/read', isLoggedIn, catchAsync(users.markCourseNotificationsRead));
router.post('/api/gamification/award', isLoggedIn, catchAsync(users.awardGamificationAction));

module.exports = router;
