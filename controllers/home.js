const Course = require('../models/course');
const User = require('../models/user');

function buildFallbackViewModel() {
  return {
    bodyClass: 'home-page-shell',
    mainClass: 'home-main',
    hideFooter: true,
    stats: {
      users: 0,
      courses: 0,
      lessons: 0
    },
    featuredCourses: []
  };
}

module.exports.renderHome = async (req, res) => {
  const fallback = buildFallbackViewModel();

  try {
    const [featuredCourses, totalUsers, courseStats] = await Promise.all([
      Course.find({})
        .select('title topic description images totalLessonCount updatedAt')
        .sort({ updatedAt: -1 })
        .limit(6)
        .lean(),
      User.countDocuments(),
      Course.aggregate([
        {
          $group: {
            _id: null,
            totalCourses: { $sum: 1 },
            totalLessons: { $sum: { $ifNull: ['$totalLessonCount', 0] } }
          }
        }
      ])
    ]);

    const aggregate = courseStats[0] || {};
    return res.render('home', {
      ...fallback,
      stats: {
        users: Number(totalUsers || 0),
        courses: Number(aggregate.totalCourses || 0),
        lessons: Number(aggregate.totalLessons || 0)
      },
      featuredCourses: featuredCourses.map((course) => ({
        ...course,
        imageUrl: Array.isArray(course.images) && course.images[0] && course.images[0].url
          ? course.images[0].url
          : '',
        shortDescription: String(course.description || '').trim().slice(0, 140)
      }))
    });
  } catch (error) {
    console.error('[Home] Failed to build home page data:', error.message);
    return res.render('home', fallback);
  }
};
