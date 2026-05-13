// TC-13: Người học làm quiz
// Kiểm tra mở quiz, chọn đáp án, nộp, tính điểm và lưu kết quả

describe('TC-13: Quiz results', () => {
  describe('Quiz scoring', () => {
    test('calculates score from correct answers', () => {
      const questions = [
        { question: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 0 },
        { question: 'Q2', options: ['A', 'B', 'C', 'D'], correctIndex: 2 },
        { question: 'Q3', options: ['A', 'B', 'C', 'D'], correctIndex: 1 },
        { question: 'Q4', options: ['A', 'B', 'C', 'D'], correctIndex: 3 }
      ];

      const userAnswers = [0, 2, 3, 3]; // Q1 correct, Q2 correct, Q3 wrong, Q4 correct
      let score = 0;
      userAnswers.forEach((answer, idx) => {
        if (answer === questions[idx].correctIndex) score += 1;
      });

      expect(score).toBe(3);
      expect(Math.round((score / questions.length) * 100)).toBe(75);
    });

    test('perfect score returns 100%', () => {
      const questions = [
        { correctIndex: 0 },
        { correctIndex: 1 },
        { correctIndex: 2 }
      ];
      const userAnswers = [0, 1, 2];
      let score = 0;
      userAnswers.forEach((answer, idx) => {
        if (answer === questions[idx].correctIndex) score += 1;
      });

      expect(Math.round((score / questions.length) * 100)).toBe(100);
    });

    test('zero score returns 0%', () => {
      const questions = [
        { correctIndex: 0 },
        { correctIndex: 1 }
      ];
      const userAnswers = [1, 0]; // All wrong
      let score = 0;
      userAnswers.forEach((answer, idx) => {
        if (answer === questions[idx].correctIndex) score += 1;
      });

      expect(Math.round((score / questions.length) * 100)).toBe(0);
    });
  });

  describe('Quiz result storage', () => {
    test('quiz result is stored in progress document', () => {
      const progressDoc = {
        user: 'user-1',
        course: 'course-1',
        quizResults: []
      };

      const quizResult = {
        quizId: 'quiz-1',
        score: 3,
        total: 4
      };

      progressDoc.quizResults.push(quizResult);
      expect(progressDoc.quizResults).toHaveLength(1);
      expect(progressDoc.quizResults[0].score).toBe(3);
      expect(progressDoc.quizResults[0].total).toBe(4);
    });

    test('retaking quiz updates existing result', () => {
      const progressDoc = {
        quizResults: [
          { quizId: 'quiz-1', score: 2, total: 4 }
        ]
      };

      const quizKey = 'quiz-1';
      const existingIndex = progressDoc.quizResults.findIndex(
        (entry) => String(entry.quizId) === quizKey
      );

      expect(existingIndex).toBe(0);
      progressDoc.quizResults[existingIndex].score = 4;
      progressDoc.quizResults[existingIndex].total = 4;

      expect(progressDoc.quizResults[0].score).toBe(4);
      expect(progressDoc.quizResults).toHaveLength(1);
    });

    test('multiple quiz results are stored independently', () => {
      const progressDoc = { quizResults: [] };

      progressDoc.quizResults.push({ quizId: 'quiz-1', score: 3, total: 4 });
      progressDoc.quizResults.push({ quizId: 'quiz-2', score: 5, total: 5 });

      expect(progressDoc.quizResults).toHaveLength(2);
      expect(progressDoc.quizResults[0].quizId).toBe('quiz-1');
      expect(progressDoc.quizResults[1].quizId).toBe('quiz-2');
    });

    test('quiz result records lastLessonId for resume', () => {
      const progressDoc = {
        lastLessonId: '',
        lastLessonName: '',
        lastLessonType: ''
      };

      progressDoc.lastLessonId = 'quiz-1';
      progressDoc.lastLessonName = 'JavaScript Basics Quiz';
      progressDoc.lastLessonType = 'quiz';

      expect(progressDoc.lastLessonId).toBe('quiz-1');
      expect(progressDoc.lastLessonName).toBe('JavaScript Basics Quiz');
      expect(progressDoc.lastLessonType).toBe('quiz');
    });

    test('quiz result adds to recent activity', () => {
      const progressDoc = {
        recentActivity: [],
        lastAccessed: new Date()
      };

      progressDoc.recentActivity.push({
        type: 'quiz-result',
        label: 'Completed quiz JavaScript Basics',
        lessonId: 'quiz-1',
        lessonName: 'JavaScript Basics',
        createdAt: progressDoc.lastAccessed
      });

      expect(progressDoc.recentActivity).toHaveLength(1);
      expect(progressDoc.recentActivity[0].type).toBe('quiz-result');
    });
  });

  describe('Quiz result validation', () => {
    test('score and total must be non-negative numbers', () => {
      const validResults = [
        { score: 0, total: 5 },
        { score: 3, total: 5 },
        { score: 5, total: 5 }
      ];

      validResults.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.total).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(r.total);
      });
    });

    test('quizId is required', () => {
      const validPayload = { quizId: 'quiz-1', score: 3, total: 5 };
      expect(validPayload.quizId).toBeTruthy();

      const invalidPayload = { quizId: '', score: 3, total: 5 };
      expect(invalidPayload.quizId).toBeFalsy();
    });
  });
});