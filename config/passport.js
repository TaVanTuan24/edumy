const passport = require('passport');
const LocalStrategy = require('passport-local');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/user');
const { GoogleAuthError, isGoogleAuthConfigured, resolveGoogleUser } = require('../services/googleAuthService');

passport.use(new LocalStrategy(User.authenticate()));

if (isGoogleAuthConfigured()) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
        passReqToCallback: true
    }, async (req, _accessToken, _refreshToken, profile, done) => {
        try {
            const result = await resolveGoogleUser({
                profile,
                currentUserId: req.user && req.user._id ? req.user._id : null,
                UserModel: User,
                logger: console
            });

            return done(null, result.user);
        } catch (err) {
            if (err instanceof GoogleAuthError) {
                return done(null, false, { message: err.message });
            }

            if (process.env.NODE_ENV !== 'production') {
                console.error('[google-auth] unexpected strategy error', err);
            }

            return done(null, false, { message: 'Google login failed. Please try again.' });
        }
    }));
} else if (process.env.NODE_ENV !== 'production') {
    console.warn('[google-auth] Google OAuth is disabled because GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_CALLBACK_URL is missing.');
}

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

module.exports = passport;
