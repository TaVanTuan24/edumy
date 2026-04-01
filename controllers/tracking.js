const UserCourseProgress = require('../models/userCourseProgress');
const User = require('../models/user');
const { awardGamification } = require('../utils/gamification');

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

    const scoreValue = Number(score) || 0;
    const totalValue = Number(total) || 0;
    const percent = totalValue > 0 ? Math.round((scoreValue / totalValue) * 100) : 0;
    const previousPercent = Number(entry.quizScore || 0);

    entry.quizAttempts = Number(entry.quizAttempts || 0) + (Number(attempts) || 1);
    entry.quizScore = percent;

    if (lessonId) {
      const quizKey = String(lessonId);
      const existingIndex = progressDoc.quizResults.findIndex((item) => String(item.quizId) === quizKey);
      if (existingIndex >= 0) {
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
      await awardGamification(user, {
        action: 'quizResult',
        meta: {
          percent,
          isHighScoreFirstTime: previousPercent < 80 && percent >= 80
        }
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Track Quiz Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
