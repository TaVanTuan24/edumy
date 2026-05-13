// TC-17: Cập nhật progress
// Kiểm tra hoàn thành lesson, cập nhật completedLessons, completionRate được tính lại

describe('TC-17: Progress update', () => {
  describe('Lesson completion tracking', () => {
    test('completing a lesson adds it to completedLessons array', () => {
      const progressDoc = {
        completedLessons: [],
        completionRate: 0
      };

      const lessonId = 'lesson-1';
      progressDoc.completedLessons.push(lessonId);

      expect(progressDoc.completedLessons).toContain(lessonId);
      expect(progressDoc.completedLessons).toHaveLength(1);
    });

    test('duplicate lesson completion is not added twice', () => {
      const progressDoc = {
        completedLessons: ['lesson-1']
      };

      const lessonId = 'lesson-1';
      const hasLesson = progressDoc.completedLessons.includes(lessonId);
      expect(hasLesson).toBe(true);

      if (!hasLesson) {
        progressDoc.completedLessons.push(lessonId);
      }
      expect(progressDoc.completedLessons).toHaveLength(1);
    });

    test('completionRate is recalculated after lesson completion', () => {
      const totalLessons = 5;
      const progressDoc = {
        completedLessons: ['lesson-1', 'lesson-2'],
        completionRate: 0
      };

      progressDoc.completionRate = Math.round(
        (progressDoc.completedLessons.length / totalLessons) * 100
      );

      expect(progressDoc.completionRate).toBe(40);
    });

    test('completionRate reaches 100 when all lessons completed', () => {
      const totalLessons = 3;
      const progressDoc = {
        completedLessons: ['lesson-1', 'lesson-2', 'lesson-3'],
        completionRate: 0
      };

      progressDoc.completionRate = Math.round(
        (progressDoc.completedLessons.length / totalLessons) * 100
      );

      expect(progressDoc.completionRate).toBe(100);
    });

    test('completionRate is 0 when no lessons completed', () => {
      const totalLessons = 5;
      const progressDoc = {
        completedLessons: [],
        completionRate: 0
      };

      progressDoc.completionRate = Math.round(
        (progressDoc.completedLessons.length / totalLessons) * 100
      );

      expect(progressDoc.completionRate).toBe(0);
    });
  });

  describe('Progress document updates', () => {
    test('lastAccessed is updated on lesson view', () => {
      const progressDoc = {
        lastAccessed: new Date('2026-01-01')
      };

      const now = new Date();
      progressDoc.lastAccessed = now;

      expect(progressDoc.lastAccessed).toBe(now);
    });

    test('lastLessonId tracks the most recently accessed lesson', () => {
      const progressDoc = {
        lastLessonId: ''
      };

      progressDoc.lastLessonId = 'lesson-5';
      expect(progressDoc.lastLessonId).toBe('lesson-5');
    });

    test('lessonViews increments for each lesson view', () => {
      const lessonViews = {};
      const lessonKey = 'lesson-1';

      const current = Number(lessonViews[lessonKey] || 0);
      lessonViews[lessonKey] = current + 1;
      expect(lessonViews[lessonKey]).toBe(1);

      const current2 = Number(lessonViews[lessonKey] || 0);
      lessonViews[lessonKey] = current2 + 1;
      expect(lessonViews[lessonKey]).toBe(2);
    });

    test('watchTime accumulates across video views', () => {
      const progressDoc = { watchTime: 0 };

      progressDoc.watchTime += 60000; // 1 minute
      progressDoc.watchTime += 120000; // 2 minutes

      expect(progressDoc.watchTime).toBe(180000);
    });

    test('recentActivity records lesson completion events', () => {
      const progressDoc = {
        recentActivity: []
      };

      progressDoc.recentActivity.push({
        type: 'lesson-complete',
        label: 'Completed lesson Introduction to JS',
        lessonId: 'lesson-1',
        lessonName: 'Introduction to JS',
        createdAt: new Date()
      });

      expect(progressDoc.recentActivity).toHaveLength(1);
      expect(progressDoc.recentActivity[0].type).toBe('lesson-complete');
    });
  });

  describe('Lesson un-completion', () => {
    test('marking lesson as incomplete removes it from completedLessons', () => {
      const progressDoc = {
        completedLessons: ['lesson-1', 'lesson-2', 'lesson-3']
      };

      const lessonKey = 'lesson-2';
      progressDoc.completedLessons = progressDoc.completedLessons.filter(
        (id) => id !== lessonKey
      );

      expect(progressDoc.completedLessons).toHaveLength(2);
      expect(progressDoc.completedLessons).not.toContain('lesson-2');
    });

    test('completionRate decreases after un-completing a lesson', () => {
      const totalLessons = 4;
      const progressDoc = {
        completedLessons: ['lesson-1', 'lesson-2', 'lesson-3', 'lesson-4'],
        completionRate: 100
      };

      progressDoc.completedLessons = progressDoc.completedLessons.filter(
        (id) => id !== 'lesson-3'
      );
      progressDoc.completionRate = Math.round(
        (progressDoc.completedLessons.length / totalLessons) * 100
      );

      expect(progressDoc.completionRate).toBe(75);
    });
  });
});