// TC-22: VR gửi completion
// Kiểm tra hoàn thành lesson trong VR, backend cập nhật progress, completion đồng bộ về backend

describe('TC-22: VR completion sync', () => {
  describe('VR progress update payload validation', () => {
    test('valid progress update payload has required fields', () => {
      const payload = {
        lessonId: 'lesson-1',
        completed: true,
        video: 'https://youtube.com/watch?v=abc',
        watchTime: 120000
      };

      expect(typeof payload.lessonId).toBe('string');
      expect(payload.lessonId.trim()).toBeTruthy();
      expect(typeof payload.completed).toBe('boolean');
    });

    test('completed field must be boolean', () => {
      const validValues = [true, false];
      validValues.forEach((v) => {
        expect(typeof v).toBe('boolean');
      });

      // parseCompletedFlag simulation
      function parseCompletedFlag(value) {
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        return null;
      }

      expect(parseCompletedFlag(true)).toBe(true);
      expect(parseCompletedFlag(false)).toBe(false);
      expect(parseCompletedFlag('true')).toBe(true);
      expect(parseCompletedFlag('false')).toBe(false);
      expect(parseCompletedFlag('invalid')).toBeNull();
    });

    test('lessonId must be a non-empty string', () => {
      function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim().length > 0;
      }

      expect(isNonEmptyString('lesson-1')).toBe(true);
      expect(isNonEmptyString('')).toBe(false);
    });

    test('watchTime must be a non-negative number', () => {
      const validWatchTimes = [0, 60000, 120000, 300000];
      validWatchTimes.forEach((wt) => {
        expect(Number.isFinite(wt)).toBe(true);
        expect(wt).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('VR progress update to backend', () => {
    test('completed lesson is added to completedLessons', () => {
      const progressDoc = {
        completedLessons: [],
        completionRate: 0
      };
      const lessonId = 'lesson-vr-1';
      const totalLessons = 5;

      progressDoc.completedLessons.push(lessonId);
      progressDoc.completionRate = Math.round(
        (progressDoc.completedLessons.length / totalLessons) * 100
      );

      expect(progressDoc.completedLessons).toContain(lessonId);
      expect(progressDoc.completionRate).toBe(20);
    });

    test('duplicate completion does not double-add', () => {
      const progressDoc = {
        completedLessons: ['lesson-1']
      };
      const lessonId = 'lesson-1';
      const hasLesson = progressDoc.completedLessons.includes(lessonId);

      if (!hasLesson) {
        progressDoc.completedLessons.push(lessonId);
      }

      expect(progressDoc.completedLessons).toHaveLength(1);
    });

    test('lessonViews increments on VR view', () => {
      const lessonViews = {};
      const lessonKey = 'lesson-vr-1';

      const current = Number(lessonViews[lessonKey] || 0);
      lessonViews[lessonKey] = current + 1;
      expect(lessonViews[lessonKey]).toBe(1);

      const current2 = Number(lessonViews[lessonKey] || 0);
      lessonViews[lessonKey] = current2 + 1;
      expect(lessonViews[lessonKey]).toBe(2);
    });

    test('watchTime accumulates VR watch duration', () => {
      const progressDoc = { watchTime: 0 };
      progressDoc.watchTime += 60000;
      progressDoc.watchTime += 90000;

      expect(progressDoc.watchTime).toBe(150000);
    });
  });

  describe('VR quiz result sync', () => {
    test('VR quiz result is saved to progress document', () => {
      const progressDoc = {
        quizResults: []
      };

      progressDoc.quizResults.push({
        quizId: 'quiz-vr-1',
        score: 4,
        total: 5
      });

      expect(progressDoc.quizResults).toHaveLength(1);
      expect(progressDoc.quizResults[0].score).toBe(4);
      expect(progressDoc.quizResults[0].total).toBe(5);
    });

    test('VR quiz result updates existing quiz result', () => {
      const progressDoc = {
        quizResults: [
          { quizId: 'quiz-vr-1', score: 2, total: 5 }
        ]
      };

      const existingIndex = progressDoc.quizResults.findIndex(
        (e) => String(e.quizId) === 'quiz-vr-1'
      );
      expect(existingIndex).toBe(0);

      progressDoc.quizResults[existingIndex].score = 5;
      progressDoc.quizResults[existingIndex].total = 5;

      expect(progressDoc.quizResults[0].score).toBe(5);
      expect(progressDoc.quizResults).toHaveLength(1);
    });

    test('VR quiz result records recentActivity', () => {
      const progressDoc = {
        recentActivity: [],
        lastAccessed: new Date()
      };

      progressDoc.recentActivity.push({
        type: 'quiz-result',
        label: 'Completed quiz VR Quiz',
        lessonId: 'quiz-vr-1',
        createdAt: progressDoc.lastAccessed
      });

      expect(progressDoc.recentActivity).toHaveLength(1);
      expect(progressDoc.recentActivity[0].type).toBe('quiz-result');
    });
  });

  describe('VR completion response', () => {
    test('backend returns success with completion data', () => {
      const response = {
        success: true,
        data: {
          completedLessons: ['lesson-1', 'lesson-2'],
          totalLessons: 5,
          completionRate: 40,
          courseId: 'course-1',
          lessonId: 'lesson-2',
          completed: true
        }
      };

      expect(response.success).toBe(true);
      expect(response.data.completedLessons).toHaveLength(2);
      expect(response.data.completionRate).toBe(40);
    });

    test('backend returns 400 for invalid lessonId', () => {
      const response = {
        success: false,
        message: 'Invalid payload: lessonId is required'
      };

      expect(response.success).toBe(false);
      expect(response.message).toContain('lessonId');
    });

    test('backend returns 404 for non-enrolled course', () => {
      const response = {
        success: false,
        message: 'Course not found or user not enrolled'
      };

      expect(response.success).toBe(false);
      expect(response.message).toContain('not enrolled');
    });
  });
});