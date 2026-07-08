const Course = require('../models/course');
const UserCourseProgress = require('../models/userCourseProgress');
const { getCourseAnalytics, countTotalLessons, buildLessonTitleMap, getReflectionAnalytics } = require('../services/analyticsService');
const logger = require('../utils/logger');

module.exports.renderDashboard = async (req, res) => {
    try {
        const { courseId } = req.params;
        const timeRange = req.query.range || 'all'; // 'today', '7d', '30d', '90d', 'all'
        
        const course = await Course.findById(courseId);
        if (!course) {
            req.flash('error', 'Course not found');
            return res.redirect('/admin');
        }

        const analytics = await getCourseAnalytics(courseId, timeRange);
        analytics.reflections = await getReflectionAnalytics(courseId, timeRange);
        
        // Provide JSON if requested via AJAX, otherwise render View
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.json({ success: true, courseTitle: course.title, analytics });
        }

        res.render('admin/course-analytics', { 
            course, 
            analytics,
            timeRange
        });

    } catch (err) {
        logger.error({ err }, '[Admin Analytics] Dashboard Error');
        req.flash('error', 'Could not load analytics dashboard');
        res.redirect('/admin');
    }
};

module.exports.renderLearnerDetail = async (req, res) => {
    try {
        const { courseId, userId } = req.params;
        
        const course = await Course.findById(courseId);
        if (!course) {
            req.flash('error', 'Course not found');
            return res.redirect(`/admin/courses/${courseId}/analytics`);
        }

        const progress = await UserCourseProgress.findOne({ user: userId, course: courseId }).populate('user');
        const totalLessons = countTotalLessons(course);
        const lessonTitleMap = buildLessonTitleMap(course);
        
        const completed = progress && progress.completedLessons ? progress.completedLessons.length : 0;
        const percent = totalLessons > 0 ? Math.round((completed / totalLessons) * 100) : 0;

        let formattedQuizResults = [];
        if (progress && progress.quizResults) {
            formattedQuizResults = progress.quizResults.map(q => {
                const title = lessonTitleMap.get(String(q.quizId)) || `Quiz ${String(q.quizId).substring(0,6)}`;
                // handle mongoose documents by checking toObject
                const obj = typeof q.toObject === 'function' ? q.toObject() : q;
                return { ...obj, title };
            });
        }

        res.render('admin/user-progress', {
            course,
            progress,
            totalLessons,
            completed,
            percent,
            quizResults: formattedQuizResults
        });
    } catch (err) {
        logger.error({ err }, '[Admin Analytics] Learner Detail Error');
        req.flash('error', 'Could not load learner details');
        res.redirect(`/admin`);
    }
};
