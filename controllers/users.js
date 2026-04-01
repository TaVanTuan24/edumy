const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const { buildGamificationViewModel, awardGamification } = require('../utils/gamification');
// const Participant = require('../models/participant');

module.exports.renderRegister = (req, res) => {
    res.render('users/register');
}

module.exports.register = async (req, res) => {
    try {
        const { email, username, password } = req.body;
        const user = new User({ email, username });
        const registeredUser = await User.register(user, password);
        req.login(registeredUser, err => {
            if (err) return next(err);
            req.flash('success', 'Welcome to the edumy!');
            res.redirect('./courses')
        })
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

    res.render('users/profile', {
        profileUser: user,
        gamification
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