const DAY_MS = 24 * 60 * 60 * 1000;
const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || 'UTC';
const activityDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const ACTION_XP = {
  lessonComplete: 120,
  quizAttempt: 40,
  quizPassed: 90,
  quizExcellent: 140,
  aiTutor: 15,
  aiQuizGenerate: 25,
  aiSlideGenerate: 30,
  courseComplete: 260
};

const LEVELS = [
  { level: 1, minXp: 0, maxXp: 500 },
  { level: 2, minXp: 501, maxXp: 1500 },
  { level: 3, minXp: 1501, maxXp: 3000 },
  { level: 4, minXp: 3001, maxXp: 5000 },
  { level: 5, minXp: 5001, maxXp: 8000 },
  { level: 6, minXp: 8001, maxXp: 12000 },
  { level: 7, minXp: 12001, maxXp: 17000 },
  { level: 8, minXp: 17001, maxXp: Infinity }
];

function readGamificationMetric(gamification, metricPath) {
  if (!gamification) return 0;
  const value = String(metricPath)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), gamification);
  return Number(value || 0);
}

// Each badge unlocks when a single gamification metric reaches its threshold.
// `metric` is a dot-path relative to user.gamification (e.g. 'stats.lessonsCompleted').
const BADGE_DEFINITIONS = [
  { id: 'first_lesson', name: 'First Lesson', description: 'Complete your first lesson.', icon: 'fa-graduation-cap', metric: 'stats.lessonsCompleted', threshold: 1 },
  { id: 'learning_starter', name: 'Learning Starter', description: 'Complete 10 lessons.', icon: 'fa-book-open', metric: 'stats.lessonsCompleted', threshold: 10 },
  { id: 'lesson_sprinter', name: 'Lesson Sprinter', description: 'Complete 25 lessons.', icon: 'fa-person-running', metric: 'stats.lessonsCompleted', threshold: 25 },
  { id: 'lesson_marathoner', name: 'Lesson Marathoner', description: 'Complete 50 lessons.', icon: 'fa-route', metric: 'stats.lessonsCompleted', threshold: 50 },
  { id: 'quiz_rookie', name: 'Quiz Rookie', description: 'Finish your first quiz.', icon: 'fa-circle-question', metric: 'stats.quizzesCompleted', threshold: 1 },
  { id: 'quiz_contender', name: 'Quiz Contender', description: 'Complete 10 quizzes.', icon: 'fa-list-check', metric: 'stats.quizzesCompleted', threshold: 10 },
  { id: 'quiz_master', name: 'Quiz Master', description: 'Score 80%+ in 5 quizzes.', icon: 'fa-brain', metric: 'stats.highQuizScores', threshold: 5 },
  { id: 'streak_3', name: '3-Day Flame', description: 'Keep a 3-day learning streak.', icon: 'fa-fire', metric: 'currentStreak', threshold: 3 },
  { id: 'streak_7', name: '7-Day Flame', description: 'Keep a 7-day learning streak.', icon: 'fa-fire-flame-curved', metric: 'currentStreak', threshold: 7 },
  { id: 'streak_30', name: 'Streak Legend', description: 'Keep a 30-day learning streak.', icon: 'fa-bolt', metric: 'currentStreak', threshold: 30 },
  { id: 'ai_explorer', name: 'AI Explorer', description: 'Use an AI feature for the first time.', icon: 'fa-robot', metric: 'stats.aiInteractions', threshold: 1 },
  { id: 'ai_collaborator', name: 'AI Collaborator', description: 'Use AI tools 10 times.', icon: 'fa-wand-magic-sparkles', metric: 'stats.aiInteractions', threshold: 10 },
  { id: 'ai_power_user', name: 'AI Power User', description: 'Use AI tools 25 times.', icon: 'fa-microchip', metric: 'stats.aiInteractions', threshold: 25 },
  { id: 'xp_1000', name: 'XP Collector', description: 'Reach 1,000 XP.', icon: 'fa-star', metric: 'totalXP', threshold: 1000 },
  { id: 'xp_3000', name: 'XP Vanguard', description: 'Reach 3,000 XP.', icon: 'fa-shield-halved', metric: 'totalXP', threshold: 3000 },
  { id: 'xp_5000', name: 'XP Champion', description: 'Reach 5,000 XP.', icon: 'fa-trophy', metric: 'totalXP', threshold: 5000 },
  { id: 'level_5', name: 'Level Breaker', description: 'Reach level 5.', icon: 'fa-mountain-sun', metric: 'currentLevel', threshold: 5 },
  { id: 'course_completer', name: 'Course Completer', description: 'Fully complete one course.', icon: 'fa-award', metric: 'stats.coursesCompleted', threshold: 1 },
  { id: 'course_finisher', name: 'Course Finisher', description: 'Fully complete three courses.', icon: 'fa-medal', metric: 'stats.coursesCompleted', threshold: 3 }
];

// Preserve the { ..., check(user) } shape other modules/tests rely on.
const BADGES = BADGE_DEFINITIONS.map((badge) => ({
  ...badge,
  check: (user) => readGamificationMetric(user && user.gamification, badge.metric) >= badge.threshold
}));

function getValidDate(dateValue) {
  const fallback = new Date();
  if (!dateValue) return fallback;

  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function getActivityDayParts(dateValue) {
  const date = getValidDate(dateValue);
  const parts = activityDayFormatter.formatToParts(date);

  return parts.reduce((acc, part) => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      acc[part.type] = Number(part.value);
    }
    return acc;
  }, {});
}

function getActivityDay(dateValue) {
  const parts = getActivityDayParts(dateValue);
  const year = Number(parts.year || 0);
  const month = Number(parts.month || 1);
  const day = Number(parts.day || 1);
  const utcTime = Date.UTC(year, month - 1, day);

  return {
    key: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    index: Math.floor(utcTime / DAY_MS),
    date: new Date(utcTime)
  };
}

function getDayDifference(leftDate, rightDate) {
  return getActivityDay(leftDate).index - getActivityDay(rightDate).index;
}

function getDailyStreakXp(streakState) {
  if (!streakState || !streakState.isNewActivityDay) return 0;
  if (Number(streakState.currentStreak || 0) <= 1) return 10;

  return Math.min(20 + (Number(streakState.currentStreak || 0) * 5), 120);
}

function recordLearningActivity(user, activityDate, options = {}) {
  ensureGamificationState(user);

  const save = Boolean(options.save);
  const today = getActivityDay(activityDate);
  const hasLastActivity = Boolean(user.gamification.lastActivityDate);
  const previous = hasLastActivity ? getActivityDay(user.gamification.lastActivityDate) : null;
  const previousStoredTime = hasLastActivity ? getValidDate(user.gamification.lastActivityDate).getTime() : null;
  const needsCanonicalDate = previous ? previousStoredTime !== previous.date.getTime() : false;

  let isNewActivityDay = false;

  if (!previous) {
    user.gamification.currentStreak = 1;
    isNewActivityDay = true;
  } else {
    const diffDays = today.index - previous.index;

    if (diffDays === 1) {
      user.gamification.currentStreak = Math.max(1, Number(user.gamification.currentStreak || 0)) + 1;
      isNewActivityDay = true;
    } else if (diffDays > 1) {
      user.gamification.currentStreak = 1;
      isNewActivityDay = true;
    }
  }

  if (isNewActivityDay || needsCanonicalDate) {
    user.gamification.lastActivityDate = today.date;
  }

  if (isNewActivityDay) {
    user.gamification.longestStreak = Math.max(
      Number(user.gamification.longestStreak || 0),
      Number(user.gamification.currentStreak || 0)
    );
  }

  if (save && (isNewActivityDay || needsCanonicalDate)) {
    return user.save().then(() => ({
      isNewActivityDay,
      currentStreak: Number(user.gamification.currentStreak || 0),
      longestStreak: Number(user.gamification.longestStreak || 0),
      lastActivityDate: user.gamification.lastActivityDate
    }));
  }

  return {
    isNewActivityDay,
    currentStreak: Number(user.gamification.currentStreak || 0),
    longestStreak: Number(user.gamification.longestStreak || 0),
    lastActivityDate: user.gamification.lastActivityDate
  };
}

function getCurrentStreakValue(user, referenceDate) {
  ensureGamificationState(user);

  if (!user.gamification.lastActivityDate) {
    return 0;
  }

  const diffDays = getDayDifference(referenceDate || new Date(), user.gamification.lastActivityDate);
  if (diffDays > 1) {
    return 0;
  }

  return Number(user.gamification.currentStreak || 0);
}

function getLevelInfo(totalXP) {
  const xp = Math.max(0, Number(totalXP) || 0);
  const current = LEVELS.find((item) => xp >= item.minXp && xp <= item.maxXp) || LEVELS[LEVELS.length - 1];
  const next = LEVELS.find((item) => item.level === current.level + 1) || null;
  const span = (current.maxXp === Infinity ? (next ? next.minXp - current.minXp : 1) : current.maxXp - current.minXp + 1);
  const intoLevel = xp - current.minXp;
  const progressPercent = current.maxXp === Infinity ? 100 : Math.max(0, Math.min(100, Math.round((intoLevel / Math.max(1, span)) * 100)));

  return {
    level: current.level,
    minXp: current.minXp,
    maxXp: current.maxXp,
    nextLevel: next ? next.level : null,
    xpToNextLevel: next ? Math.max(0, next.minXp - xp) : 0,
    progressPercent
  };
}

function ensureGamificationState(user) {
  if (!user.gamification) {
    user.gamification = {};
  }

  user.gamification.totalXP = Number(user.gamification.totalXP || 0);
  user.gamification.currentLevel = Number(user.gamification.currentLevel || 1);
  user.gamification.currentStreak = Number(user.gamification.currentStreak || 0);
  user.gamification.longestStreak = Number(user.gamification.longestStreak || 0);
  user.gamification.earnedBadges = Array.isArray(user.gamification.earnedBadges) ? user.gamification.earnedBadges : [];
  user.gamification.stats = user.gamification.stats || {};

  const stats = user.gamification.stats;
  stats.lessonsCompleted = Number(stats.lessonsCompleted || 0);
  stats.quizzesCompleted = Number(stats.quizzesCompleted || 0);
  stats.highQuizScores = Number(stats.highQuizScores || 0);
  stats.aiInteractions = Number(stats.aiInteractions || 0);
  stats.coursesCompleted = Number(stats.coursesCompleted || 0);
  stats.completedLessonsCount = Number(stats.completedLessonsCount || stats.lessonsCompleted || 0);
  user.gamification.stats = stats;
}

function applyActionStats(user, action, meta) {
  const stats = user.gamification.stats;

  if (action === 'lessonComplete') {
    stats.lessonsCompleted += 1;
    stats.completedLessonsCount = stats.lessonsCompleted;
  }

  if (action === 'quizResult') {
    stats.quizzesCompleted += 1;
    if (meta && Number(meta.percent || 0) >= 80 && meta.isHighScoreFirstTime) {
      stats.highQuizScores += 1;
    }
  }

  if (action === 'courseComplete') {
    stats.coursesCompleted += 1;
  }

  if (action === 'aiTutor' || action === 'aiQuizGenerate' || action === 'aiSlideGenerate') {
    stats.aiInteractions += 1;
  }
}

function unlockBadges(user) {
  const earnedSet = new Set((user.gamification.earnedBadges || []).map((badge) => badge.id));
  const unlocked = [];

  BADGES.forEach((badge) => {
    if (earnedSet.has(badge.id)) return;
    if (!badge.check(user)) return;

    const unlockedBadge = {
      id: badge.id,
      name: badge.name,
      description: badge.description,
      icon: badge.icon,
      earnedAt: new Date()
    };

    user.gamification.earnedBadges.push(unlockedBadge);
    unlocked.push(unlockedBadge);
    earnedSet.add(badge.id);
  });

  return unlocked;
}

function getQuizXp(percent) {
  if (percent >= 90) return ACTION_XP.quizExcellent;
  if (percent >= 70) return ACTION_XP.quizPassed;
  return ACTION_XP.quizAttempt;
}

async function awardGamification(user, options = {}) {
  ensureGamificationState(user);

  const action = String(options.action || '').trim();
  const meta = options.meta || {};
  const activityDate = options.activityDate || new Date();

  let baseXp = 0;

  if (action === 'lessonComplete') baseXp = ACTION_XP.lessonComplete;
  if (action === 'courseComplete') baseXp = ACTION_XP.courseComplete;
  if (action === 'aiTutor') baseXp = ACTION_XP.aiTutor;
  if (action === 'aiQuizGenerate') baseXp = ACTION_XP.aiQuizGenerate;
  if (action === 'aiSlideGenerate') baseXp = ACTION_XP.aiSlideGenerate;
  if (action === 'quizResult') baseXp = getQuizXp(Number(meta.percent || 0));

  const streakState = recordLearningActivity(user, activityDate);
  const streakXp = getDailyStreakXp(streakState);
  applyActionStats(user, action, meta);

  const gainedXp = Math.max(0, baseXp + streakXp);
  user.gamification.totalXP += gainedXp;

  const levelInfo = getLevelInfo(user.gamification.totalXP);
  user.gamification.currentLevel = levelInfo.level;

  const unlockedBadges = unlockBadges(user);

  await user.save();

  return {
    gainedXp,
    streakXp,
    levelInfo,
    unlockedBadges,
    profile: buildGamificationViewModel(user)
  };
}

function buildGamificationViewModel(user) {
  ensureGamificationState(user);
  const levelInfo = getLevelInfo(user.gamification.totalXP);
  const earnedIds = new Set((user.gamification.earnedBadges || []).map((badge) => badge.id));
  const displayedCurrentStreak = getCurrentStreakValue(user, new Date());

  return {
    totalXP: Number(user.gamification.totalXP || 0),
    currentLevel: Number(user.gamification.currentLevel || 1),
    currentStreak: displayedCurrentStreak,
    longestStreak: Number(user.gamification.longestStreak || 0),
    lastActivityDate: user.gamification.lastActivityDate || null,
    activityTimezone: APP_TIMEZONE,
    completedLessonsCount: Number(user.gamification.stats.completedLessonsCount || user.gamification.stats.lessonsCompleted || 0),
    levelProgress: levelInfo,
    earnedBadges: (user.gamification.earnedBadges || []).sort((a, b) => new Date(a.earnedAt) - new Date(b.earnedAt)),
    badges: BADGES.map((badge) => {
      const earned = earnedIds.has(badge.id);
      const earnedMeta = earned
        ? (user.gamification.earnedBadges || []).find((entry) => entry.id === badge.id)
        : null;

      return {
        id: badge.id,
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        earned,
        earnedAt: earnedMeta ? earnedMeta.earnedAt : null
      };
    })
  };
}

module.exports = {
  ACTION_XP,
  BADGES,
  LEVELS,
  getLevelInfo,
  buildGamificationViewModel,
  awardGamification,
  recordLearningActivity,
  getCurrentStreakValue
};
