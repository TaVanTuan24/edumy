const Course = require('../models/course');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const { getEffectiveCourseStatus } = require('../utils/courseLifecycle');
const { findLessonContext } = require('../utils/lessonLocator');
const { stripFileExtension } = require('../utils/formatLessonName');
const { getLessonContentMode } = require('../utils/lessonContentMode');

function formatRelativeDate(input) {
  if (!input) return 'No activity yet';

  const value = new Date(input);
  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return value.toLocaleDateString();
}

function buildLessonResumeUrl(courseId, progressDoc) {
  if (!courseId) return '/courses';
  const params = new URLSearchParams();
  if (progressDoc && progressDoc.lastLessonId) {
    params.set('lesson', String(progressDoc.lastLessonId));
  }
  if (progressDoc && progressDoc.lastSectionIndex != null) {
    params.set('section', String(progressDoc.lastSectionIndex));
  }
  if (progressDoc && progressDoc.lastLessonIndex != null) {
    params.set('item', String(progressDoc.lastLessonIndex));
  }
  const query = params.toString();
  return `/courses/${courseId}${query ? `?${query}` : ''}`;
}

function formatSlideModeLabel(lesson) {
  const mode = getLessonContentMode(lesson);
  if (mode === 'hybrid') return 'Slides + PDF lesson';
  if (mode === 'pdf') return 'PDF lesson';
  if (mode === 'slides') return 'Slides lesson';
  return 'Slide lesson';
}

function formatLessonTypeLabel(value, lesson) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'video' || type === 'lecture') return 'Video lesson';
  if (type === 'slide') return formatSlideModeLabel(lesson);
  if (type === 'quiz') return 'Quiz lesson';
  return 'Lesson';
}

function summarizeRecentActivity(progressDoc, courseMap) {
  const course = courseMap.get(String(progressDoc.course));
  const items = Array.isArray(progressDoc.recentActivity) ? progressDoc.recentActivity : [];

  return items.slice(-8).reverse().map((entry) => ({
    courseId: String(progressDoc.course),
    courseTitle: course ? course.title : 'Course',
    type: entry.type || 'activity',
    label: formatActivityLabel(entry.label, entry.lessonName || progressDoc.lastLessonName || ''),
    lessonName: stripFileExtension(entry.lessonName || progressDoc.lastLessonName || ''),
    createdAt: entry.createdAt || progressDoc.lastAccessed || progressDoc.updatedAt,
    createdAtLabel: formatRelativeDate(entry.createdAt || progressDoc.lastAccessed || progressDoc.updatedAt)
  }));
}

function formatActivityLabel(label, lessonName) {
  const rawLabel = String(label || '').trim();
  const rawLessonName = String(lessonName || '').trim();
  if (!rawLabel) return 'Learning activity';
  if (!rawLessonName) return rawLabel;

  return rawLabel.replace(rawLessonName, stripFileExtension(rawLessonName));
}

function buildWeakSpots(progressDocs, courseMap) {
  const weak = [];
  progressDocs.forEach((doc) => {
    const course = courseMap.get(String(doc.course));
    (Array.isArray(doc.quizResults) ? doc.quizResults : []).forEach((result) => {
      const total = Number(result && result.total) || 0;
      if (!total) return;
      const score = Number(result && result.score) || 0;
      const percent = Math.round((score / total) * 100);
      weak.push({
        courseId: String(doc.course),
        courseTitle: course ? course.title : 'Course',
        quizId: String(result.quizId || ''),
        percent,
        reviewUrl: buildLessonResumeUrl(String(doc.course), {
          lastLessonId: result.quizId
        })
      });
    });
  });

  return weak.sort((a, b) => a.percent - b.percent).slice(0, 5);
}

async function buildLearnerDashboard(userId) {
  const user = await User.findById(userId).select('enrolledCourses enrolledCourseIds gamification');
  if (!user) {
    return {
      continueLearning: null,
      myCourses: [],
      recentActivity: [],
      stats: {
        currentStreak: 0,
        coursesInProgress: 0,
        completedCourses: 0,
        averageQuizScore: 0,
        totalLearningMinutes: 0
      },
      weakSpots: []
    };
  }

  const enrolledIds = Array.from(user.getEnrolledCourseIdSet ? user.getEnrolledCourseIdSet() : []);
  const courses = await Course.find({ _id: { $in: enrolledIds } })
    .select('title description images topic sections totalLessonCount updatedAt status')
    .lean();

  const courseMap = new Map(courses.map((course) => [String(course._id), course]));
  const progressDocs = await UserCourseProgress.find({ user: userId, course: { $in: enrolledIds } }).lean();
  const progressMap = new Map(progressDocs.map((doc) => [String(doc.course), doc]));

  const myCourses = courses.map((course) => {
    const progressDoc = progressMap.get(String(course._id));
    const completedLessons = Array.isArray(progressDoc && progressDoc.completedLessons) ? progressDoc.completedLessons.length : 0;
    const totalLessons = Number(course.totalLessonCount || 0) || 0;
    const completionRate = progressDoc && progressDoc.completionRate != null
      ? Number(progressDoc.completionRate)
      : (totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0);
    const status = getEffectiveCourseStatus(course);
    const lessonContext = progressDoc ? findLessonContext(course, {
      lessonId: progressDoc.lastLessonId,
      sectionIndex: progressDoc.lastSectionIndex,
      lessonIndex: progressDoc.lastLessonIndex
    }) : null;

    return {
      courseId: String(course._id),
      title: course.title,
      thumbnailUrl: Array.isArray(course.images) && course.images[0] ? course.images[0].url : '/default.png',
      progressPercent: completionRate,
      completedLessons,
      totalLessons,
      lastAccessed: progressDoc && (progressDoc.lastAccessed || progressDoc.updatedAt),
      lastAccessedLabel: formatRelativeDate(progressDoc && (progressDoc.lastAccessed || progressDoc.updatedAt)),
      lastLessonName: stripFileExtension(progressDoc && progressDoc.lastLessonName ? progressDoc.lastLessonName : (lessonContext && lessonContext.lesson ? lessonContext.lesson.title : '')),
      lastLessonType: progressDoc && progressDoc.lastLessonType ? progressDoc.lastLessonType : (lessonContext && lessonContext.lesson ? lessonContext.lesson.type : ''),
      lastLessonTypeLabel: formatLessonTypeLabel(
        progressDoc && progressDoc.lastLessonType ? progressDoc.lastLessonType : (lessonContext && lessonContext.lesson ? lessonContext.lesson.type : ''),
        lessonContext && lessonContext.lesson
      ),
      continueUrl: buildLessonResumeUrl(String(course._id), progressDoc),
      status,
      statusLabel: status.charAt(0).toUpperCase() + status.slice(1),
      isCompleted: completionRate >= 100,
      isInProgress: completionRate > 0 && completionRate < 100,
      cardCtaLabel: completionRate >= 100 ? 'Review' : completionRate > 0 ? 'Continue' : 'Start'
    };
  }).sort((a, b) => new Date(b.lastAccessed || 0) - new Date(a.lastAccessed || 0));

  const continueLearning = myCourses.find((course) => course.progressPercent > 0 && course.progressPercent < 100)
    || myCourses[0]
    || null;

  const totalLearningMinutes = Math.round(progressDocs.reduce((sum, doc) => sum + (Number(doc.watchTime || 0) / 60000), 0));
  const quizResults = progressDocs.flatMap((doc) => Array.isArray(doc.quizResults) ? doc.quizResults : []);
  const averageQuizScore = quizResults.length
    ? Math.round(quizResults.reduce((sum, result) => {
      const total = Number(result.total) || 0;
      const score = Number(result.score) || 0;
      return sum + (total ? (score / total) * 100 : 0);
    }, 0) / quizResults.length)
    : 0;

  const recentActivity = progressDocs
    .sort((a, b) => new Date(b.lastAccessed || b.updatedAt || 0) - new Date(a.lastAccessed || a.updatedAt || 0))
    .flatMap((doc) => summarizeRecentActivity(doc, courseMap))
    .slice(0, 10);

  const completedCourses = myCourses.filter((course) => course.progressPercent >= 100).length;
  const coursesInProgress = myCourses.filter((course) => course.progressPercent > 0 && course.progressPercent < 100).length;

  return {
    continueLearning,
    myCourses,
    recentActivity,
    stats: {
      currentStreak: Number(user.gamification && user.gamification.currentStreak || 0),
      coursesInProgress,
      completedCourses,
      averageQuizScore,
      totalLearningMinutes
    },
    weakSpots: buildWeakSpots(progressDocs, courseMap)
  };
}

module.exports = {
  buildLearnerDashboard,
  buildLessonResumeUrl
};
