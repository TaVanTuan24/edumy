// TC-20: Gamification
// Kiểm tra hoàn thành lesson/làm quiz, cập nhật XP, level, badge

const {
  ACTION_XP,
  BADGES,
  LEVELS,
  getLevelInfo,
  buildGamificationViewModel,
  recordLearningActivity,
  getCurrentStreakValue
} = require('../utils/gamification');

function createMockUser(overrides = {}) {
  return {
    gamification: {
      totalXP: 0,
      currentLevel: 1,
      currentStreak: 0,
      longestStreak: 0,
      lastActivityDate: null,
      earnedBadges: [],
      stats: {
        lessonsCompleted: 0,
        quizzesCompleted: 0,
        highQuizScores: 0,
        aiInteractions: 0,
        coursesCompleted: 0,
        completedLessonsCount: 0
      },
      ...overrides
    },
    save: jest.fn()
  };
}

describe('TC-20: Gamification', () => {
  describe('XP calculation', () => {
    test('lessonComplete awards correct XP', () => {
      expect(ACTION_XP.lessonComplete).toBe(120);
    });

    test('quizAttempt awards correct XP', () => {
      expect(ACTION_XP.quizAttempt).toBe(40);
    });

    test('quizPassed awards correct XP', () => {
      expect(ACTION_XP.quizPassed).toBe(90);
    });

    test('quizExcellent awards correct XP', () => {
      expect(ACTION_XP.quizExcellent).toBe(140);
    });

    test('courseComplete awards correct XP', () => {
      expect(ACTION_XP.courseComplete).toBe(260);
    });

    test('AI interactions award XP', () => {
      expect(ACTION_XP.aiTutor).toBeGreaterThan(0);
      expect(ACTION_XP.aiQuizGenerate).toBeGreaterThan(0);
      expect(ACTION_XP.aiSlideGenerate).toBeGreaterThan(0);
    });
  });

  describe('Level calculation', () => {
    test('0 XP is level 1', () => {
      const info = getLevelInfo(0);
      expect(info.level).toBe(1);
    });

    test('500 XP is still level 1', () => {
      const info = getLevelInfo(500);
      expect(info.level).toBe(1);
    });

    test('501 XP is level 2', () => {
      const info = getLevelInfo(501);
      expect(info.level).toBe(2);
    });

    test('high XP reaches level 5+', () => {
      const info = getLevelInfo(8000);
      expect(info.level).toBeGreaterThanOrEqual(5);
    });

    test('getLevelInfo returns progressPercent', () => {
      const info = getLevelInfo(250);
      expect(info.progressPercent).toBeGreaterThanOrEqual(0);
      expect(info.progressPercent).toBeLessThanOrEqual(100);
    });

    test('getLevelInfo returns xpToNextLevel', () => {
      const info = getLevelInfo(100);
      expect(info.xpToNextLevel).toBeGreaterThan(0);
    });

    test('all levels are defined with valid ranges', () => {
      expect(LEVELS).toHaveLength(8);
      LEVELS.forEach((level) => {
        expect(level.level).toBeGreaterThan(0);
        expect(level.minXp).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Streak tracking', () => {
    test('first activity sets streak to 1', () => {
      const user = createMockUser();
      const result = recordLearningActivity(user, new Date());
      expect(result.isNewActivityDay).toBe(true);
      expect(result.currentStreak).toBe(1);
    });

    test('consecutive day activity increments streak', () => {
      const user = createMockUser({
        lastActivityDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        currentStreak: 3,
        longestStreak: 3
      });
      const result = recordLearningActivity(user, new Date());
      expect(result.currentStreak).toBe(4);
    });

    test('gap of more than 1 day resets streak to 1', () => {
      const user = createMockUser({
        lastActivityDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        currentStreak: 5,
        longestStreak: 5
      });
      const result = recordLearningActivity(user, new Date());
      expect(result.currentStreak).toBe(1);
    });

    test('same day activity does not increment streak', () => {
      const user = createMockUser({
        lastActivityDate: new Date(),
        currentStreak: 3,
        longestStreak: 3
      });
      const result = recordLearningActivity(user, new Date());
      expect(result.isNewActivityDay).toBe(false);
      expect(result.currentStreak).toBe(3);
    });

    test('longestStreak is updated when current exceeds it', () => {
      const user = createMockUser({
        lastActivityDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        currentStreak: 5,
        longestStreak: 5
      });
      const result = recordLearningActivity(user, new Date());
      expect(result.longestStreak).toBe(6);
    });
  });

  describe('Badge system', () => {
    test('first_lesson badge is defined', () => {
      const badge = BADGES.find((b) => b.id === 'first_lesson');
      expect(badge).toBeDefined();
      expect(badge.name).toBe('First Lesson');
    });

    test('first_lesson badge unlocks after 1 lesson', () => {
      const user = createMockUser();
      user.gamification.stats.lessonsCompleted = 1;
      const badge = BADGES.find((b) => b.id === 'first_lesson');
      expect(badge.check(user)).toBe(true);
    });

    test('quiz_rookie badge unlocks after 1 quiz', () => {
      const user = createMockUser();
      user.gamification.stats.quizzesCompleted = 1;
      const badge = BADGES.find((b) => b.id === 'quiz_rookie');
      expect(badge.check(user)).toBe(true);
    });

    test('streak_3 badge unlocks with 3-day streak', () => {
      const user = createMockUser();
      user.gamification.currentStreak = 3;
      const badge = BADGES.find((b) => b.id === 'streak_3');
      expect(badge.check(user)).toBe(true);
    });

    test('xp_1000 badge unlocks at 1000 XP', () => {
      const user = createMockUser();
      user.gamification.totalXP = 1000;
      const badge = BADGES.find((b) => b.id === 'xp_1000');
      expect(badge.check(user)).toBe(true);
    });

    test('badge does not unlock when requirement not met', () => {
      const user = createMockUser();
      user.gamification.stats.lessonsCompleted = 0;
      const badge = BADGES.find((b) => b.id === 'learning_starter');
      expect(badge.check(user)).toBe(false);
    });

    test('all badges have required fields', () => {
      BADGES.forEach((badge) => {
        expect(badge.id).toBeTruthy();
        expect(badge.name).toBeTruthy();
        expect(badge.description).toBeTruthy();
        expect(badge.icon).toBeTruthy();
        expect(typeof badge.check).toBe('function');
      });
    });
  });

  describe('Gamification view model', () => {
    test('buildGamificationViewModel returns complete view data', () => {
      const user = createMockUser({ totalXP: 500, currentLevel: 1 });
      const vm = buildGamificationViewModel(user);

      expect(vm.totalXP).toBe(500);
      expect(vm.currentLevel).toBe(1);
      expect(vm.currentStreak).toBeDefined();
      expect(vm.longestStreak).toBeDefined();
      expect(vm.levelProgress).toBeDefined();
      expect(Array.isArray(vm.earnedBadges)).toBe(true);
      expect(Array.isArray(vm.badges)).toBe(true);
    });

    test('view model includes all defined badges', () => {
      const user = createMockUser();
      const vm = buildGamificationViewModel(user);
      expect(vm.badges).toHaveLength(BADGES.length);
    });

    test('earned badges are marked as earned in view model', () => {
      const user = createMockUser();
      user.gamification.earnedBadges = [
        { id: 'first_lesson', name: 'First Lesson', earnedAt: new Date() }
      ];
      const vm = buildGamificationViewModel(user);
      const firstLessonBadge = vm.badges.find((b) => b.id === 'first_lesson');
      expect(firstLessonBadge.earned).toBe(true);
    });
  });
});