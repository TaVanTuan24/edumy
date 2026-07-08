/**
 * Shared helpers for manipulating UserCourseProgress documents.
 *
 * These were previously duplicated across controllers/courses.js, controllers/tracking.js and
 * controllers/vrController.js. Centralizing keeps the "recent activity", resume metadata,
 * lesson-view counters and quiz-result upsert logic consistent across web and VR clients.
 */

const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const { recordLearningActivity } = require('./gamification');
const { findLessonContext } = require('./lessonLocator');

// Find or create the per-user, per-course progress document.
function getOrCreateProgress(userId, courseId) {
  return UserCourseProgress.findOneAndUpdate(
    { user: userId, course: courseId },
    { $setOnInsert: { user: userId, course: courseId } },
    { new: true, upsert: true }
  );
}

// Push a normalized activity entry, keeping the most recent 20 (oldest -> newest).
function appendRecentActivity(progressDoc, activity) {
  const entry = {
    type: String(activity && activity.type || 'activity'),
    label: String(activity && activity.label || 'Learning activity'),
    lessonId: String(activity && activity.lessonId || ''),
    lessonName: String(activity && activity.lessonName || ''),
    lessonType: String(activity && activity.lessonType || ''),
    sectionIndex: Number.isInteger(Number(activity && activity.sectionIndex)) ? Number(activity.sectionIndex) : null,
    lessonIndex: Number.isInteger(Number(activity && activity.lessonIndex)) ? Number(activity.lessonIndex) : null,
    createdAt: activity && activity.createdAt ? new Date(activity.createdAt) : new Date()
  };

  progressDoc.recentActivity = Array.isArray(progressDoc.recentActivity) ? progressDoc.recentActivity : [];
  progressDoc.recentActivity.push(entry);
  progressDoc.recentActivity = progressDoc.recentActivity
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-20);
}

// Resolve and store "resume where you left off" metadata for a course.
function setResumeMetadata(progressDoc, course, payload = {}) {
  const sectionIndex = Number.isInteger(Number(payload.sectionIndex)) ? Number(payload.sectionIndex) : null;
  const lessonIndex = Number.isInteger(Number(payload.lessonIndex)) ? Number(payload.lessonIndex) : null;
  const lessonId = String(payload.lessonId || '').trim();
  const lessonName = String(payload.lessonName || '').trim();
  const lessonType = String(payload.lessonType || '').trim();

  const lessonContext = course
    ? findLessonContext(course, { lessonId, sectionIndex, lessonIndex })
    : null;

  progressDoc.lastLessonId = lessonId || String(lessonContext && lessonContext.lesson && lessonContext.lesson._id || progressDoc.lastLessonId || '');
  progressDoc.lastLessonName = lessonName || String(lessonContext && lessonContext.lesson && lessonContext.lesson.title || progressDoc.lastLessonName || '');
  progressDoc.lastLessonType = lessonType || String(lessonContext && lessonContext.lesson && lessonContext.lesson.type || progressDoc.lastLessonType || '');
  progressDoc.lastSectionIndex = sectionIndex !== null ? sectionIndex : (lessonContext ? lessonContext.sectionIndex : progressDoc.lastSectionIndex);
  progressDoc.lastLessonIndex = lessonIndex !== null ? lessonIndex : (lessonContext ? lessonContext.lessonIndex : progressDoc.lastLessonIndex);
}

// Increment the per-lesson view counter (works with a Mongoose Map or a plain object).
function incrementLessonView(progressDoc, lessonKey) {
  const key = String(lessonKey);
  if (progressDoc.lessonViews && typeof progressDoc.lessonViews.get === 'function') {
    const current = Number(progressDoc.lessonViews.get(key) || 0);
    progressDoc.lessonViews.set(key, current + 1);
  } else {
    progressDoc.lessonViews = progressDoc.lessonViews || {};
    const current = Number(progressDoc.lessonViews[key] || 0);
    progressDoc.lessonViews[key] = current + 1;
  }
}

// Insert or update a quiz result by quizId. Returns whether a prior result existed.
function upsertQuizResult(progressDoc, { quizId, score, total }) {
  const quizKey = String(quizId);
  progressDoc.quizResults = Array.isArray(progressDoc.quizResults) ? progressDoc.quizResults : [];
  const existingIndex = progressDoc.quizResults.findIndex((entry) => String(entry.quizId) === quizKey);

  if (existingIndex >= 0) {
    progressDoc.quizResults[existingIndex].score = score;
    progressDoc.quizResults[existingIndex].total = total;
    return { existed: true };
  }

  progressDoc.quizResults.push({ quizId: quizKey, score, total });
  return { existed: false };
}

// Record a daily learning-activity ping (for streaks) and return the loaded user (or null).
async function markUserLearningActivity(userId, activityDate) {
  const user = await User.findById(userId);
  if (!user) return null;

  await recordLearningActivity(user, activityDate, { save: true });
  return user;
}

module.exports = {
  getOrCreateProgress,
  appendRecentActivity,
  setResumeMetadata,
  incrementLessonView,
  upsertQuizResult,
  markUserLearningActivity
};
