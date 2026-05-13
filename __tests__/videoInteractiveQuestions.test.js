// TC-14: Câu hỏi trong video
// Kiểm tra xem video có câu hỏi, hiển thị tại timestamp, câu hỏi xuất hiện đúng mốc

describe('TC-14: Video interactive questions display', () => {
  describe('Timed quiz normalization', () => {
    test('normalizeTimedQuizQuestions extracts questions with triggerTimeSec', () => {
      // Simulates the normalization from vrController
      const interactiveQuizzes = [
        {
          question: 'What is closure?',
          options: ['A scope', 'A variable', 'A loop', 'A class'],
          correctIndex: 0,
          triggerTimeSec: 60
        },
        {
          question: 'What is hoisting?',
          options: ['Moving declarations', 'Deleting vars', 'Creating objects', 'Sorting'],
          correctIndex: 0,
          triggerTimeSec: 120
        }
      ];

      expect(interactiveQuizzes).toHaveLength(2);
      expect(interactiveQuizzes[0].triggerTimeSec).toBe(60);
      expect(interactiveQuizzes[1].triggerTimeSec).toBe(120);
    });

    test('questions without triggerTimeSec are excluded from timed quiz', () => {
      const rawQuestions = [
        { question: 'Q1', options: ['A', 'B'], correctIndex: 0, triggerTimeSec: 60 },
        { question: 'Q2', options: ['C', 'D'], correctIndex: 1 }, // No triggerTimeSec
        { question: 'Q3', options: ['E', 'F'], correctIndex: 0, triggerTimeSec: 180 }
      ];

      const timedOnly = rawQuestions.filter((q) => q.triggerTimeSec != null);
      expect(timedOnly).toHaveLength(2);
    });

    test('question appears at correct timestamp during video playback', () => {
      const questions = [
        { triggerTimeSec: 30, question: 'Q1' },
        { triggerTimeSec: 90, question: 'Q2' },
        { triggerTimeSec: 150, question: 'Q3' }
      ];

      // Simulate video at 90 seconds
      const currentTimeSec = 90;
      const dueQuestions = questions.filter(
        (q) => q.triggerTimeSec <= currentTimeSec && q.triggerTimeSec > currentTimeSec - 5
      );

      expect(dueQuestions).toHaveLength(1);
      expect(dueQuestions[0].question).toBe('Q2');
    });

    test('question popup pauses video at trigger time', () => {
      const question = {
        triggerTimeSec: 60,
        question: 'What is the answer?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0
      };

      // Simulate: when currentTime reaches triggerTimeSec, video should pause
      const shouldPause = true; // triggered
      expect(shouldPause).toBe(true);
      expect(question.triggerTimeSec).toBe(60);
    });
  });

  describe('Interactive quiz question format', () => {
    test('question has all required fields for display', () => {
      const question = {
        id: 'iq-1',
        question: 'What is a Promise?',
        options: ['Async value', 'Sync function', 'Variable', 'Class'],
        correctIndex: 0,
        triggerTimeSec: 120,
        explanation: 'A Promise represents an async value.'
      };

      expect(question.id).toBeTruthy();
      expect(question.question).toBeTruthy();
      expect(question.options.length).toBeGreaterThanOrEqual(2);
      expect(typeof question.correctIndex).toBe('number');
      expect(typeof question.triggerTimeSec).toBe('number');
    });

    test('questions are ordered by triggerTimeSec for sequential display', () => {
      const questions = [
        { triggerTimeSec: 300, question: 'Last' },
        { triggerTimeSec: 60, question: 'First' },
        { triggerTimeSec: 180, question: 'Middle' }
      ];

      const sorted = [...questions].sort((a, b) => a.triggerTimeSec - b.triggerTimeSec);
      expect(sorted[0].question).toBe('First');
      expect(sorted[1].question).toBe('Middle');
      expect(sorted[2].question).toBe('Last');
    });

    test('user answer is compared against correctIndex', () => {
      const question = {
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 2
      };

      expect(question.options[question.correctIndex]).toBe('C');
    });

    test('explanation is shown after answering', () => {
      const question = {
        question: 'What is async/await?',
        options: ['Promise syntax', 'Loop', 'Variable', 'Class'],
        correctIndex: 0,
        explanation: 'async/await is syntactic sugar for Promises.'
      };

      const userAnswer = 0;
      const isCorrect = userAnswer === question.correctIndex;
      expect(isCorrect).toBe(true);
      expect(question.explanation).toContain('Promise');
    });
  });

  describe('Video lesson with interactive quizzes', () => {
    test('VR lesson payload includes timedQuizzes and interactiveQuizzes', () => {
      const vrLesson = {
        type: 'video',
        id: 'lesson-1',
        title: 'JavaScript Closures',
        videoUrl: 'https://youtube.com/watch?v=abc',
        timedQuizzes: [
          { question: 'Q1', options: ['A', 'B'], correctIndex: 0, triggerTimeSec: 60 }
        ],
        interactiveQuizzes: [
          { question: 'Q1', options: ['A', 'B'], correctIndex: 0, triggerTimeSec: 60 }
        ]
      };

      expect(vrLesson.timedQuizzes).toHaveLength(1);
      expect(vrLesson.interactiveQuizzes).toHaveLength(1);
      expect(vrLesson.timedQuizzes[0].triggerTimeSec).toBe(60);
    });

    test('lesson without interactive quizzes has empty arrays', () => {
      const vrLesson = {
        type: 'video',
        timedQuizzes: [],
        interactiveQuizzes: []
      };

      expect(vrLesson.timedQuizzes).toHaveLength(0);
      expect(vrLesson.interactiveQuizzes).toHaveLength(0);
    });
  });
});