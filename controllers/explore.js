const Course = require('../models/course');
const User = require('../models/user');
const { generateCourseDescription } = require('../utils/courseDescriptionGenerator');
const { syncCourseContent } = require('../utils/courseContentAdapter');
const { buildStoredCourseStats } = require('../utils/courseStats');
const { summarizeCourseReviews } = require('../utils/courseReviews');

module.exports.showExplore = async (req, res) => {
    const allCourses = await Course.find({}).populate('reviews');
    const user = await User.findById(req.user._id);
    const enrolledIdSet = user.getEnrolledCourseIdSet();

    const unjoinedCourses = allCourses.filter(course =>
        !enrolledIdSet.has(String(course._id))
    );

    unjoinedCourses.forEach(course => {
        const reviewSummary = summarizeCourseReviews(course);
        course.avgRating = reviewSummary.averageRating !== null
            ? reviewSummary.averageRating.toFixed(1)
            : null;
        course.totalReviews = reviewSummary.reviewCount;
    });

    const groupedCourses = {};
    unjoinedCourses.forEach(course => {
        if (!groupedCourses[course.topic]) groupedCourses[course.topic] = [];
        groupedCourses[course.topic].push(course);
    });

    res.render('courses/explore', { groupedCourses });
};

module.exports.previewCourse = async (req, res) => {
    const course = await Course.findById(req.params.id)
        .populate({
            path: 'reviews',
            populate: { path: 'author' }
        });
    if (!course) return res.redirect('/explore');
    syncCourseContent(course);
    const previewStats = buildStoredCourseStats(course);
    const reviewSummary = summarizeCourseReviews(course);

    const user = await User.findById(req.user._id).select('enrolledCourses enrolledCourseIds');
    const generatedDescription = await generateCourseDescription(course);
    const isEnrolled = !!(user && typeof user.findEnrollment === 'function' && user.findEnrollment(course._id));
    res.render('courses/preview-modern', { course, generatedDescription, isEnrolled, previewStats, reviewSummary });
};

module.exports.enrollCourse = async (req, res) => {
    const course = await Course.findById(req.params.id);
    const user = await User.findById(req.user._id);

    if (!course) {
        req.flash('error', 'Course not found.');
        return res.redirect('/explore');
    }

    if (!user) {
        req.flash('error', 'User not found.');
        return res.redirect('/login');
    }

    const existingEnrollment = user.findEnrollment(course._id);
    if (!existingEnrollment) {
        user.enrolledCourses.push({
            courseId: course._id,
            progress: {
                completedCount: 0,
                lastLessonId: ''
            },
            lastSeenUpdatedAt: course.updatedAt || new Date(),
            enrolledAt: new Date()
        });
        await user.save();
    }

    req.flash('success', 'Successfully enrolled!');
    res.redirect('/courses');
};
