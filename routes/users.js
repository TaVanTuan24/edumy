const express = require('express');
const router = express.Router();
const passport = require('passport');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/user');
const users = require('../controllers/users')
const { storeReturnTo, isLoggedIn } = require('../middleware');

router.route('/register')
    .get(users.renderRegister)
    .post(catchAsync(users.register))

router.route('/login')
    .get(users.renderLogin)
    .post(storeReturnTo,
        // passport.authenticate logs the user in and clears req.session
        passport.authenticate('local', { failureFlash: true, failureRedirect: '/login' }),
        // Now we can use res.locals.returnTo to redirect the user after login
        users.login)



// router.post('/login', passport.authenticate('local', { failureFlash: true, failureRedirect: '/login' }), (req, res) => {
//     req.flash('success', 'welcome back!');
//     res.redirect('/stages');
// })

router.get('/logout', users.logout);
router.get('/profile', isLoggedIn, catchAsync(users.renderProfile));
router.get('/api/gamification', isLoggedIn, catchAsync(users.getGamificationProfile));
router.post('/api/gamification/award', isLoggedIn, catchAsync(users.awardGamificationAction));

// router.get('/join', users.join)


module.exports = router