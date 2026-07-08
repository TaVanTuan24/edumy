const User = require('../models/user');
const Course = require('../models/course');
const Reflection = require('../models/Reflection');
const { awardGamification, recordLearningActivity } = require('../utils/gamification');
const { getCanonicalSections } = require('../utils/courseContentAdapter');
const {
  getOrCreateProgress,
  appendRecentActivity,
  setResumeMetadata,
  upsertQuizResult,
  markUserLearningActivity
} = require('../utils/progressActivity');

function normalizeLessonTracking(doc, lessonId, lessonType) {
  if (!doc.lessonTracking) doc.lessonTracking = [];

  const key = String(lessonId || '');
  let entry = doc.lessonTracking.find((item) => String(item.lessonId) === key);

  if (!entry) {
    entry = {
      lessonId: key,
      type: lessonType || '',
      watchTime: 0,
      lastPosition: 0,
      interactions: { play: 0, pause: 0, seek: 0 },
      completed: false,
      slidesViewed: 0,
      quizAttempts: 0,
      quizScore: 0
    };
    doc.lessonTracking.push(entry);
  }

  if (lessonType && !entry.type) {
    entry.type = lessonType;
  }

  if (!entry.interactions) {
    entry.interactions = { play: 0, pause: 0, seek: 0 };
  }

  return entry;
}

function getQuizQuestionCount(course, lessonId) {
  const targetLessonId = String(lessonId || '').trim();
  if (!course || !targetLessonId) return 0;

  const sections = getCanonicalSections(course);
  for (const section of sections) {
    const lessons = Array.isArray(section && section.lessons) ? section.lessons : [];
    for (const lesson of lessons) {
      if (String(lesson && lesson._id || '') !== targetLessonId) continue;
      if (Array.isArray(lesson && lesson.quiz)) return lesson.quiz.length;
      if (Array.isArray(lesson && lesson.content && lesson.content.questions)) return lesson.content.questions.length;
      return 0;
    }
  }

  return 0;
}

module.exports.trackEvent = async (req, res) => {
  const { courseId, lessonId, lessonType, eventType, position, lessonName, sectionIndex, lessonIndex } = req.body;
  if (!courseId || !lessonId || !eventType) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const progressDoc = await getOrCreateProgress(req.user._id, courseId);
  const entry = normalizeLessonTracking(progressDoc, lessonId, lessonType);
  const course = await Course.findById(courseId).select('sections');

  if (['play', 'pause', 'seek'].includes(eventType)) {
    entry.interactions[eventType] = Number(entry.interactions[eventType] || 0) + 1;
  }

  // Server-side reflection guard: block completion if required reflection is missing
  if (eventType === 'completed' && course) {
    const sections = getCanonicalSections(course);
    let lessonReflection = null;

    for (const section of sections) {
      const lessons = Array.isArray(section && section.lessons) ? section.lessons : [];
      for (const lesson of lessons) {
        if (String(lesson && lesson._id || '') === String(lessonId)) {
          lessonReflection = lesson.reflection || null;
          break;
        }
      }
      if (lessonReflection) break;
    }

    if (lessonReflection && lessonReflection.enabled && lessonReflection.required) {
      const existingSubmission = await Reflection.findOne({
        user: req.user._id,
        course: courseId,
        lessonId: String(lessonId)
      });

      if (!existingSubmission || !existingSubmission.answer) {
        return res.status(403).json({
          success: false,
          error: 'Reflection is required before completing this lesson.',
          code: 'REFLECTION_REQUIRED'
        });
      }
    }
  }

  if (eventType === 'completed') {
    entry.completed = true;
  }

  if (Number.isFinite(Number(position))) {
    entry.lastPosition = Number(position);
  }

  progressDoc.lastAccessed = new Date();
  setResumeMetadata(progressDoc, course, { lessonId, lessonType, lessonName, sectionIndex, lessonIndex });
  appendRecentActivity(progressDoc, {
    type: eventType === 'open' ? 'lesson-open' : `lesson-${eventType}`,
    label: eventType === 'completed'
      ? `Completed ${progressDoc.lastLessonName || 'lesson'}`
      : eventType === 'open'
        ? `Opened ${progressDoc.lastLessonName || 'lesson'}`
        : `${eventType.charAt(0).toUpperCase() + eventType.slice(1)} ${progressDoc.lastLessonName || 'lesson'}`,
    lessonId,
    lessonName: progressDoc.lastLessonName,
    lessonType: progressDoc.lastLessonType,
    sectionIndex: progressDoc.lastSectionIndex,
    lessonIndex: progressDoc.lastLessonIndex,
    createdAt: progressDoc.lastAccessed
  });
  await progressDoc.save();
  await markUserLearningActivity(req.user._id, progressDoc.lastAccessed);

  res.json({ success: true });
};

module.exports.trackWatchTime = async (req, res) => {
  const { courseId, lessonId, lessonType, watchTime, lessonName, sectionIndex, lessonIndex } = req.body;
  if (!courseId || !lessonId || !Number.isFinite(Number(watchTime))) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const progressDoc = await getOrCreateProgress(req.user._id, courseId);
  const entry = normalizeLessonTracking(progressDoc, lessonId, lessonType);
  const course = await Course.findById(courseId).select('sections');

  const delta = Math.max(0, Number(watchTime));
  entry.watchTime = Number(entry.watchTime || 0) + delta;
  progressDoc.totalWatchTime = Number(progressDoc.totalWatchTime || 0) + delta;
  progressDoc.watchTime = Number(progressDoc.watchTime || 0) + delta;
  progressDoc.lastAccessed = new Date();
  setResumeMetadata(progressDoc, course, { lessonId, lessonType, lessonName, sectionIndex, lessonIndex });

  await progressDoc.save();
  await markUserLearningActivity(req.user._id, progressDoc.lastAccessed);
  res.json({ success: true });
};

module.exports.trackSlide = async (req, res) => {
  const { courseId, lessonId, lessonType, slideIndex, lessonName, sectionIndex, lessonIndex } = req.body;
  if (!courseId || !lessonId) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const progressDoc = await getOrCreateProgress(req.user._id, courseId);
  const entry = normalizeLessonTracking(progressDoc, lessonId, lessonType || 'slide');
  const course = await Course.findById(courseId).select('sections');

  entry.slidesViewed = Number(entry.slidesViewed || 0) + 1;
  if (Number.isFinite(Number(slideIndex))) {
    entry.lastPosition = Number(slideIndex);
  }

  progressDoc.lastAccessed = new Date();
  setResumeMetadata(progressDoc, course, { lessonId, lessonType: lessonType || 'slide', lessonName, sectionIndex, lessonIndex });
  appendRecentActivity(progressDoc, {
    type: 'slide-view',
    label: `Viewed slide in ${progressDoc.lastLessonName || 'lesson'}`,
    lessonId,
    lessonName: progressDoc.lastLessonName,
    lessonType: progressDoc.lastLessonType || 'slide',
    sectionIndex: progressDoc.lastSectionIndex,
    lessonIndex: progressDoc.lastLessonIndex,
    createdAt: progressDoc.lastAccessed
  });
  await progressDoc.save();
  await markUserLearningActivity(req.user._id, progressDoc.lastAccessed);

  res.json({ success: true });
};

module.exports.trackQuiz = async (req, res) => {
  const { courseId, lessonId, lessonType, score, total, attempts, lessonName, sectionIndex, lessonIndex } = req.body;
  if (!courseId || !lessonId) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const progressDoc = await getOrCreateProgress(req.user._id, courseId);
  const entry = normalizeLessonTracking(progressDoc, lessonId, lessonType || 'quiz');

  const course = await Course.findById(courseId).select('sections').lean();
  setResumeMetadata(progressDoc, course, { lessonId, lessonType: lessonType || 'quiz', lessonName, sectionIndex, lessonIndex });
  const expectedTotal = getQuizQuestionCount(course, lessonId);
  const rawTotal = Math.max(0, Number(total) || 0);
  const totalValue = expectedTotal > 0 ? expectedTotal : rawTotal;
  const scoreValue = Math.min(Math.max(0, Number(score) || 0), totalValue || rawTotal || 0);
  const percent = totalValue > 0 ? Math.round((scoreValue / totalValue) * 100) : 0;
  const previousPercent = Number(entry.quizScore || 0);

  entry.quizAttempts = Number(entry.quizAttempts || 0) + Math.max(1, Math.min(Number(attempts) || 1, 1));
  entry.quizScore = percent;

  let hadPreviousResult = false;
  if (lessonId) {
    const result = upsertQuizResult(progressDoc, { quizId: lessonId, score: scoreValue, total: totalValue });
    hadPreviousResult = result.existed;
  }

  progressDoc.lastAccessed = new Date();
  appendRecentActivity(progressDoc, {
    type: 'quiz-attempt',
    label: `Scored ${percent}% on ${progressDoc.lastLessonName || 'quiz'}`,
    lessonId,
    lessonName: progressDoc.lastLessonName,
    lessonType: progressDoc.lastLessonType || 'quiz',
    sectionIndex: progressDoc.lastSectionIndex,
    lessonIndex: progressDoc.lastLessonIndex,
    createdAt: progressDoc.lastAccessed
  });
  await progressDoc.save();

  const user = await User.findById(req.user._id);
  if (user) {
    await recordLearningActivity(user, progressDoc.lastAccessed, { save: true });

    const isHighScoreFirstTime = previousPercent < 80 && percent >= 80;
    if (!hadPreviousResult || isHighScoreFirstTime) {
      await awardGamification(user, {
        action: 'quizResult',
        meta: {
          percent,
          isHighScoreFirstTime
        }
      });
    }
  }

  res.json({ success: true });
};
