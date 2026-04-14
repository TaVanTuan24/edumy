const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const { buildGamificationViewModel, awardGamification } = require('../utils/gamification');
// const Participant = require('../models/participant');

async function getLeaderboardSnapshot(limit, currentUserId) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

    const topUsers = await User.find({})
        .select('username gamification.totalXP gamification.currentLevel')
        .sort({ 'gamification.totalXP': -1, username: 1 })
        .limit(safeLimit)
        .lean();

    const formattedTopUsers = topUsers.map((entry, index) => ({
        rank: index + 1,
        userId: String(entry._id),
        username: entry.username || 'User',
        totalXP: Number(entry.gamification && entry.gamification.totalXP || 0),
        level: Number(entry.gamification && entry.gamification.currentLevel || 1),
        isCurrentUser: String(entry._id) === String(currentUserId)
    }));

    const currentUser = await User.findById(currentUserId)
        .select('username gamification.totalXP gamification.currentLevel')
        .lean();

    let currentUserEntry = null;
    if (currentUser) {
        const currentUserXP = Number(currentUser.gamification && currentUser.gamification.totalXP || 0);
        const higherCount = await User.countDocuments({ 'gamification.totalXP': { $gt: currentUserXP } });

        currentUserEntry = {
            rank: higherCount + 1,
            userId: String(currentUser._id),
            username: currentUser.username || 'You',
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

module.exports.renderRegister = (req, res) => {
    res.render('users/register');
}

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
        res.redirect('/courses');
    } catch (e) {
        req.flash('error', e.message);
        res.redirect('/register');
    }
}

module.exports.renderLogin = (req, res) => {
    res.render('users/login')
}

module.exports.login = (req, res) => {
    req.flash('success', 'Welcome back!');
    const redirectUrl = res.locals.returnTo || '/courses'; // update this line to use res.locals.returnTo now
    res.redirect(redirectUrl);
}

module.exports.logout = (req, res, next) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        req.flash('success', 'Goodbye!');
        res.redirect('/courses');
    });
}

module.exports.renderProfile = async (req, res) => {
    const user = await User.findById(req.user._id);
    if (!user) {
        req.flash('error', 'User not found.');
        return res.redirect('/courses');
    }

    const progressDocs = await UserCourseProgress.find({ user: req.user._id }).select('completedLessons').lean();
    const totalCompletedLessons = progressDocs.reduce((sum, doc) => {
        const count = Array.isArray(doc.completedLessons) ? doc.completedLessons.length : 0;
        return sum + count;
    }, 0);

    if (!user.gamification) {
        user.gamification = {};
    }
    if (!user.gamification.stats) {
        user.gamification.stats = {};
    }
    user.gamification.stats.completedLessonsCount = totalCompletedLessons;
    if ((Number(user.gamification.stats.lessonsCompleted) || 0) < totalCompletedLessons) {
        user.gamification.stats.lessonsCompleted = totalCompletedLessons;
    }
    await user.save();

    const gamification = buildGamificationViewModel(user);
    const leaderboard = await getLeaderboardSnapshot(5, req.user._id);

    res.render('users/profile', {
        profileUser: user,
        gamification,
        leaderboard
    });
};

module.exports.getGamificationProfile = async (req, res) => {
    const user = await User.findById(req.user._id);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    const progressDocs = await UserCourseProgress.find({ user: req.user._id }).select('completedLessons').lean();
    const totalCompletedLessons = progressDocs.reduce((sum, doc) => {
        const count = Array.isArray(doc.completedLessons) ? doc.completedLessons.length : 0;
        return sum + count;
    }, 0);

    if (!user.gamification) {
        user.gamification = {};
    }
    if (!user.gamification.stats) {
        user.gamification.stats = {};
    }
    user.gamification.stats.completedLessonsCount = totalCompletedLessons;
    if ((Number(user.gamification.stats.lessonsCompleted) || 0) < totalCompletedLessons) {
        user.gamification.stats.lessonsCompleted = totalCompletedLessons;
    }
    await user.save();

    const gamification = buildGamificationViewModel(user);

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
                lastSeenUpdatedAt: now,
                enrolledAt: now
            };
        }

        return entry;
    });

    await user.save();

    return res.json({
        success: true,
        updatedCount
    });
};

module.exports.awardGamificationAction = async (req, res) => {
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
// module.exports.renderJoin = (req, res) => {
//     res.render('users/join');
// }
