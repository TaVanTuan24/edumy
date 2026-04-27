const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const { cloudinary } = require('../config/cloudinary');
const { buildGamificationViewModel, awardGamification } = require('../utils/gamification');
const { isAdminUser, sanitizeReturnTo } = require('../middleware');
const { isGoogleAuthConfigured } = require('../services/googleAuthService');

const AUTH_RETURN_TO_EXCLUDES = new Set([
    '/login',
    '/register',
    '/auth/google',
    '/auth/google/callback'
]);

function getSafeAuthReturnTo(input, req) {
    const safePath = sanitizeReturnTo(input, req);
    if (!safePath) return null;

    const [pathname] = safePath.split('?');
    if (AUTH_RETURN_TO_EXCLUDES.has(pathname)) {
        return null;
    }

    return safePath;
}

function getPostAuthRedirect(req, fallbackPath = '/courses') {
    const sessionReturnTo = getSafeAuthReturnTo(req.session && req.session.returnTo, req);

    if (req.session) {
        delete req.session.returnTo;
    }

    return sessionReturnTo || fallbackPath;
}

async function getLeaderboardSnapshot(limit, currentUserId) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

    const topUsers = await User.find({})
        .select('username avatar gamification.totalXP gamification.currentLevel')
        .sort({ 'gamification.totalXP': -1, username: 1 })
        .limit(safeLimit)
        .lean();

    const formattedTopUsers = topUsers.map((entry, index) => ({
        rank: index + 1,
        userId: String(entry._id),
        username: entry.username || 'User',
        avatarUrl: entry.avatar && entry.avatar.url ? entry.avatar.url : '',
        totalXP: Number(entry.gamification && entry.gamification.totalXP || 0),
        level: Number(entry.gamification && entry.gamification.currentLevel || 1),
        isCurrentUser: String(entry._id) === String(currentUserId)
    }));

    const currentUser = await User.findById(currentUserId)
        .select('username avatar gamification.totalXP gamification.currentLevel')
        .lean();

    let currentUserEntry = null;
    if (currentUser) {
        const currentUserXP = Number(currentUser.gamification && currentUser.gamification.totalXP || 0);
        const higherCount = await User.countDocuments({ 'gamification.totalXP': { $gt: currentUserXP } });

        currentUserEntry = {
            rank: higherCount + 1,
            userId: String(currentUser._id),
            username: currentUser.username || 'You',
            avatarUrl: currentUser.avatar && currentUser.avatar.url ? currentUser.avatar.url : '',
            totalXP: currentUserXP,
            level: Number(currentUser.gamification && currentUser.gamification.currentLevel || 1),
            isCurrentUser: true
        };
    }

    return {
        limit: safeLimit,
        topUsers: formattedTopUsers,
        currentUserEntry
    };
}

async function getCompletedLessonCount(userId) {
    const result = await UserCourseProgress.aggregate([
        { $match: { user: userId } },
        {
            $project: {
                completedCount: {
                    $size: {
                        $ifNull: ['$completedLessons', []]
                    }
                }
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: '$completedCount' }
            }
        }
    ]);

    return Number(result[0] && result[0].total || 0);
}

async function syncCompletedLessonsStat(user) {
    const totalCompletedLessons = await getCompletedLessonCount(user._id);
    if (!user.gamification) user.gamification = {};
    if (!user.gamification.stats) user.gamification.stats = {};

    user.gamification.stats.completedLessonsCount = totalCompletedLessons;
    if ((Number(user.gamification.stats.lessonsCompleted) || 0) < totalCompletedLessons) {
        user.gamification.stats.lessonsCompleted = totalCompletedLessons;
    }

    return totalCompletedLessons;
}

module.exports.renderRegister = (req, res) => {
    res.render('users/register');
};

module.exports.register = async (req, res) => {
    try {
        const { email, username, password } = req.body;
        const user = new User({ email, username });
        const registeredUser = await User.register(user, password);
        await new Promise((resolve, reject) => {
            req.login(registeredUser, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });

        req.flash('success', 'Welcome to Edumy!');
        res.redirect(getPostAuthRedirect(req));
    } catch (e) {
        req.flash('error', e.message);
        res.redirect('/register');
    }
};

module.exports.renderLogin = (req, res) => {
    res.render('users/login');
};

module.exports.ensureGoogleAuthConfigured = (req, res, next) => {
    if (isGoogleAuthConfigured()) {
        return next();
    }

    if (process.env.NODE_ENV !== 'production') {
        console.warn('[google-auth] Attempted to use Google OAuth without full configuration.');
    }

    req.flash('error', 'Google login is not configured right now. Please use email and password.');
    return res.redirect('/login');
};

module.exports.prepareGoogleAuth = (req, res, next) => {
    if (req.session) {
        req.session.googleAuthIntent = req.user && req.user._id ? 'link' : 'login';
    }

    next();
};

module.exports.login = (req, res) => {
    req.flash('success', 'Welcome back!');
    res.redirect(getPostAuthRedirect(req));
};

module.exports.redirectLogout = (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        req.flash('error', 'Please use the logout button to sign out safely.');
    }

    res.redirect('/');
};

module.exports.logout = (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
        req.flash('error', 'You are already signed out.');
        return res.redirect('/');
    }

    req.logout(function(err) {
        if (err) {
            return next(err);
        }
        req.flash('success', 'Goodbye!');
        res.redirect('/');
    });
};

module.exports.googleAuthSuccess = (req, res) => {
    const intent = req.session && req.session.googleAuthIntent === 'link' ? 'link' : 'login';

    if (req.session) {
        delete req.session.googleAuthIntent;
    }

    req.flash('success', intent === 'link' ? 'Google account linked successfully.' : 'Welcome back!');
    res.redirect(getPostAuthRedirect(req));
};

module.exports.renderProfile = async (req, res) => {
    const user = await User.findById(req.user._id).populate('enrolledCourseIds');
    if (!user) {
        req.flash('error', 'User not found.');
        return res.redirect('/courses');
    }

    await syncCompletedLessonsStat(user);
    await user.save();

    const gamification = buildGamificationViewModel(user);
    const leaderboard = await getLeaderboardSnapshot(5, req.user._id);

    const progressDocs = await UserCourseProgress.find({ user: req.user._id }).lean();
    const progressByCourse = {};
    progressDocs.forEach((doc) => {
        progressByCourse[String(doc.course)] = doc;
    });

    res.set('Cache-Control', 'no-store');
    res.render('users/profile', {
        user,
        gamification,
        leaderboard,
        progressByCourse
    });
};

module.exports.updateAvatar = async (req, res) => {
    const user = await User.findById(req.user._id);
    if (!user) {
        req.flash('error', 'User not found.');
        return res.redirect('/profile');
    }

    if (!req.file) {
        req.flash('error', 'Please choose an image to upload.');
        return res.redirect('/profile');
    }

    const previousFilename = user.avatar && user.avatar.filename ? user.avatar.filename : '';
    user.avatar = {
        url: req.file.path,
        filename: req.file.filename
    };
    await user.save();

    if (previousFilename && previousFilename !== req.file.filename) {
        try {
            await cloudinary.uploader.destroy(previousFilename);
        } catch (err) {
            console.error('Failed to remove previous avatar from Cloudinary:', err);
        }
    }

    req.flash('success', 'Avatar updated successfully.');
    res.redirect('/profile');
};

module.exports.getGamificationProfile = async (req, res) => {
    const user = await User.findById(req.user._id);

    if (!user) {
        return res.status(404).json({
            success: false,
            error: 'User not found'
        });
    }

    await syncCompletedLessonsStat(user);
    await user.save();

    const gamification = buildGamificationViewModel(user);

    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        gamification
    });
};

module.exports.renderLeaderboard = async (req, res) => {
    const limit = Number(req.query.limit) || 20;
    const leaderboard = await getLeaderboardSnapshot(limit, req.user._id);

    res.render('users/leaderboard', {
        leaderboard
    });
};

module.exports.getLeaderboard = async (req, res) => {
    const limit = Number(req.query.limit) || 20;
    const leaderboard = await getLeaderboardSnapshot(limit, req.user._id);

    res.json({
        success: true,
        leaderboard
    });
};

module.exports.markCourseNotificationsRead = async (req, res) => {
    const user = await User.findById(req.user._id);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!Array.isArray(user.enrolledCourses) || user.enrolledCourses.length === 0) {
        return res.json({ success: true, updatedCount: 0 });
    }

    const now = new Date();
    let updatedCount = 0;

    user.enrolledCourses = user.enrolledCourses.map((entry) => {
        if (!entry) return entry;

        if (entry.courseId) {
            updatedCount += 1;
            return {
                ...entry,
                lastSeenUpdatedAt: now
            };
        }

        if (entry._bsontype === 'ObjectId' || typeof entry === 'string') {
            updatedCount += 1;
            return {
                courseId: entry,
                progress: {
                    completedCount: 0,
                    lastLessonId: ''
                },
                lastSeenUpdatedAt: now
            };
        }

        return entry;
    });

    await user.save();
    res.json({ success: true, updatedCount });
};

module.exports.awardGamificationAction = async (req, res) => {
    if (!isAdminUser(req.user)) {
        return res.status(403).json({ success: false, error: 'This endpoint is restricted.' });
    }

    const allowed = new Set(['lessonComplete', 'quizResult', 'aiTutor', 'aiQuizGenerate', 'aiSlideGenerate', 'courseComplete']);
    const action = String(req.body && req.body.action || '').trim();
    const meta = req.body && req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {};

    if (!allowed.has(action)) {
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    const result = await awardGamification(user, { action, meta });

    res.json({
        success: true,
        gainedXp: result.gainedXp,
        streakXp: result.streakXp,
        unlockedBadges: result.unlockedBadges,
        gamification: result.profile
    });
};
