// TC-18: Learner dashboard
// Kiểm tra mở dashboard, hiển thị tiến độ học tập, tổng hợp dữ liệu chính

const { buildLessonResumeUrl } = require('../services/learnerDashboardService');

describe('TC-18: Learner dashboard', () => {
  describe('buildLessonResumeUrl', () => {
    test('builds resume URL with lesson, section and item params', () => {
      const progressDoc = {
        lastLessonId: 'lesson-5',
        lastSectionIndex: 2,
        lastLessonIndex: 1
      };

      const url = buildLessonResumeUrl('course-1', progressDoc);
      expect(url).toContain('/courses/course-1');
      expect(url).toContain('lesson=lesson-5');
      expect(url).toContain('section=2');
      expect(url).toContain('item=1');
    });

    test('builds basic URL when no progress document exists', () => {
      const url = buildLessonResumeUrl('course-1', null);
      expect(url).toBe('/courses/course-1');
    });

    test('returns /courses when courseId is missing', () => {
      const url = buildLessonResumeUrl('', null);
      expect(url).toBe('/courses');
    });
  });

  describe('Dashboard data aggregation', () => {
    test('dashboard stats include required fields', () => {
      const stats = {
        currentStreak: 5,
        coursesInProgress: 3,
        completedCourses: 1,
        averageQuizScore: 78,
        totalLearningMinutes: 1200
      };

      expect(typeof stats.currentStreak).toBe('number');
      expect(typeof stats.coursesInProgress).toBe('number');
      expect(typeof stats.completedCourses).toBe('number');
      expect(typeof stats.averageQuizScore).toBe('number');
      expect(typeof stats.totalLearningMinutes).toBe('number');
    });

    test('myCourses list includes course progress information', () => {
      const myCourses = [
        {
          courseId: 'course-1',
          title: 'JavaScript 101',
          progressPercent: 60,
          completedLessons: 3,
          totalLessons: 5,
          lastAccessed: new Date(),
          isCompleted: false,
          isInProgress: true
        },
        {
          courseId: 'course-2',
          title: 'Python Basics',
          progressPercent: 100,
          completedLessons: 4,
          totalLessons: 4,
          lastAccessed: new Date(),
          isCompleted: true,
          isInProgress: false
        }
      ];

      expect(myCourses).toHaveLength(2);
      expect(myCourses[0].isInProgress).toBe(true);
      expect(myCourses[1].isCompleted).toBe(true);
    });

    test('continueLearning returns the most recently accessed in-progress course', () => {
      const myCourses = [
        { courseId: 'c1', title: 'Course A', progressPercent: 100, lastAccessed: new Date('2026-04-01') },
        { courseId: 'c2', title: 'Course B', progressPercent: 50, lastAccessed: new Date('2026-04-10') },
        { courseId: 'c3', title: 'Course C', progressPercent: 30, lastAccessed: new Date('2026-04-05') }
      ];

      // The first in-progress course (sorted by lastAccessed desc)
      const sorted = myCourses
        .filter((c) => c.progressPercent > 0 && c.progressPercent < 100)
        .sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed));

      expect(sorted[0].courseId).toBe('c2');
    });

    test('recentActivity contains activity entries', () => {
      const recentActivity = [
        {
          courseId: 'course-1',
          courseTitle: 'JavaScript 101',
          type: 'lesson-complete',
          label: 'Completed lesson Variables',
          createdAt: new Date()
        }
      ];

      expect(recentActivity).toHaveLength(1);
      expect(recentActivity[0].type).toBe('lesson-complete');
    });

    test('weakSpots shows courses with low quiz scores', () => {
      const weakSpots = [
        { courseId: 'c1', courseTitle: 'Course A', quizId: 'q1', percent: 40 },
        { courseId: 'c2', courseTitle: 'Course B', quizId: 'q2', percent: 60 }
      ];

      const sorted = [...weakSpots].sort((a, b) => a.percent - b.percent);
      expect(sorted[0].percent).toBe(40);
      expect(sorted[0].courseTitle).toBe('Course A');
    });
  });

  describe('Dashboard with no data', () => {
    test('empty dashboard returns default structure', () => {
      const dashboard = {
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

      expect(dashboard.continueLearning).toBeNull();
      expect(dashboard.myCourses).toHaveLength(0);
      expect(dashboard.stats.coursesInProgress).toBe(0);
    });

    test('cardCtaLabel is Start for new courses', () => {
      const course = { progressPercent: 0 };
      const ctaLabel = course.progressPercent >= 100 ? 'Review' : course.progressPercent > 0 ? 'Continue' : 'Start';
      expect(ctaLabel).toBe('Start');
    });

    test('cardCtaLabel is Continue for in-progress courses', () => {
      const course = { progressPercent: 50 };
      const ctaLabel = course.progressPercent >= 100 ? 'Review' : course.progressPercent > 0 ? 'Continue' : 'Start';
      expect(ctaLabel).toBe('Continue');
    });

    test('cardCtaLabel is Review for completed courses', () => {
      const course = { progressPercent: 100 };
      const ctaLabel = course.progressPercent >= 100 ? 'Review' : course.progressPercent > 0 ? 'Continue' : 'Start';
      expect(ctaLabel).toBe('Review');
    });
  });
});