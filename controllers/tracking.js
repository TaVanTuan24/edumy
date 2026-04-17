const UserCourseProgress = require('../models/userCourseProgress');
const User = require('../models/user');
const Course = require('../models/course');
const { awardGamification } = require('../utils/gamification');
const { getCanonicalSections } = require('../utils/courseContentAdapter');

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

async function getOrCreateProgress(userId, courseId) {
  return UserCourseProgress.findOneAndUpdate(
    { user: userId, course: courseId },
    { $setOnInsert: { user: userId, course: courseId } },
    { new: true, upsert: true }
  );
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
  try {
    const { courseId, lessonId, lessonType, eventType, position } = req.body;
    if (!courseId || !lessonId || !eventType) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const progressDoc = await getOrCreateProgress(req.user._id, courseId);
    const entry = normalizeLessonTracking(progressDoc, lessonId, lessonType);

    if (['play', 'pause', 'seek'].includes(eventType)) {
      entry.interactions[eventType] = Number(entry.interactions[eventType] || 0) + 1;
    }

    if (eventType === 'completed') {
      entry.completed = true;
    }

    if (Number.isFinite(Number(position))) {
      entry.lastPosition = Number(position);
    }

    progressDoc.lastAccessed = new Date();
    await progressDoc.save();

    res.json({ success: true });
  } catch (err) {
    console.error('[Track Event Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.trackWatchTime = async (req, res) => {
  try {
    const { courseId, lessonId, lessonType, watchTime } = req.body;
    if (!courseId || !lessonId || !Number.isFinite(Number(watchTime))) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const progressDoc = await getOrCreateProgress(req.user._id, courseId);
    const entry = normalizeLessonTracking(progressDoc, lessonId, lessonType);

    const delta = Math.max(0, Number(watchTime));
    entry.watchTime = Number(entry.watchTime || 0) + delta;
    progressDoc.totalWatchTime = Number(progressDoc.totalWatchTime || 0) + delta;
    progressDoc.watchTime = Number(progressDoc.watchTime || 0) + delta;
    progressDoc.lastAccessed = new Date();

    await progressDoc.save();
    res.json({ success: true });
  } catch (err) {
    console.error('[Track WatchTime Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.trackSlide = async (req, res) => {
  try {
    const { courseId, lessonId, lessonType, slideIndex } = req.body;
    if (!courseId || !lessonId) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const progressDoc = await getOrCreateProgress(req.user._id, courseId);
    const entry = normalizeLessonTracking(progressDoc, lessonId, lessonType || 'slide');

    entry.slidesViewed = Number(entry.slidesViewed || 0) + 1;
    if (Number.isFinite(Number(slideIndex))) {
      entry.lastPosition = Number(slideIndex);
    }

    progressDoc.lastAccessed = new Date();
    await progressDoc.save();

    res.json({ success: true });
  } catch (err) {
    console.error('[Track Slide Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.trackQuiz = async (req, res) => {
  try {
    const { courseId, lessonId, lessonType, score, total, attempts } = req.body;
    if (!courseId || !lessonId) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const progressDoc = await getOrCreateProgress(req.user._id, courseId);
    const entry = normalizeLessonTracking(progressDoc, lessonId, lessonType || 'quiz');

    const course = await Course.findById(courseId).select('sections driveStructure').lean();
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
      const quizKey = String(lessonId);
      const existingIndex = progressDoc.quizResults.findIndex((item) => String(item.quizId) === quizKey);
      if (existingIndex >= 0) {
        hadPreviousResult = true;
        progressDoc.quizResults[existingIndex].score = scoreValue;
        progressDoc.quizResults[existingIndex].total = totalValue;
      } else {
        progressDoc.quizResults.push({ quizId: quizKey, score: scoreValue, total: totalValue });
      }
    }

    progressDoc.lastAccessed = new Date();
    await progressDoc.save();

    const user = await User.findById(req.user._id);
    if (user) {
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
  } catch (err) {
    console.error('[Track Quiz Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
