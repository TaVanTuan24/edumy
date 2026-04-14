const Course = require('../models/course');
const User = require('../models/user');
const { generateCourseDescription } = require('../utils/courseDescriptionGenerator');

module.exports.showExplore = async (req, res) => {
    const allCourses = await Course.find({}).populate('reviews');
    const user = await User.findById(req.user._id);
    const enrolledIdSet = user.getEnrolledCourseIdSet();

    const unjoinedCourses = allCourses.filter(course =>
        !enrolledIdSet.has(String(course._id))
    );

    unjoinedCourses.forEach(course => {
        if (course.reviews.length > 0) {
            const total = course.reviews.reduce((sum, r) => sum + r.rating, 0);
            course.avgRating = (total / course.reviews.length).toFixed(1);
            course.totalReviews = course.reviews.length;
        } else {
            course.avgRating = null;
            course.totalReviews = 0;
        }
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
    const generatedDescription = await generateCourseDescription(course);
    res.render('courses/preview-modern', { course, generatedDescription });
};

module.exports.enrollCourse = async (req, res) => {
    const course = await Course.findById(req.params.id);
    const user = await User.findById(req.user._id);

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
