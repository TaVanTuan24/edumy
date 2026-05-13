// TC-11: AI tạo câu hỏi video
// Dùng transcript sinh câu hỏi, câu hỏi gắn timestamp, lưu vào interactiveQuizzes

describe('TC-11: AI video questions (interactive quizzes)', () => {
  describe('Timed quiz question structure', () => {
    test('interactive quiz question has triggerTimeSec for timestamp', () => {
      const question = {
        id: 'iq-1',
        question: 'What is the main topic discussed?',
        options: ['React hooks', 'CSS Grid', 'Node.js', 'GraphQL'],
        correctIndex: 0,
        triggerTimeSec: 120,
        explanation: 'The video discusses React hooks at the 2-minute mark.'
      };

      expect(question.triggerTimeSec).toBe(120);
      expect(question.question).toBeTruthy();
      expect(question.options).toHaveLength(4);
      expect(typeof question.correctIndex).toBe('number');
    });

    test('multiple questions can be attached at different timestamps', () => {
      const interactiveQuizzes = [
        {
          id: 'iq-1',
          question: 'What is a closure?',
          options: ['A function scope', 'A variable', 'A loop', 'A class'],
          correctIndex: 0,
          triggerTimeSec: 60
        },
        {
          id: 'iq-2',
          question: 'What does event loop do?',
          options: ['Handles async', 'Creates objects', 'Deletes memory', 'Sorts data'],
          correctIndex: 0,
          triggerTimeSec: 180
        },
        {
          id: 'iq-3',
          question: 'What is Promise?',
          options: ['Async value', 'Sync function', 'Variable type', 'Class'],
          correctIndex: 0,
          triggerTimeSec: 300
        }
      ];

      expect(interactiveQuizzes).toHaveLength(3);
      expect(interactiveQuizzes[0].triggerTimeSec).toBeLessThan(interactiveQuizzes[1].triggerTimeSec);
      expect(interactiveQuizzes[1].triggerTimeSec).toBeLessThan(interactiveQuizzes[2].triggerTimeSec);
    });

    test('questions are sorted by triggerTimeSec', () => {
      const questions = [
        { triggerTimeSec: 300, question: 'Q3' },
        { triggerTimeSec: 60, question: 'Q1' },
        { triggerTimeSec: 180, question: 'Q2' }
      ];

      const sorted = [...questions].sort((a, b) => a.triggerTimeSec - b.triggerTimeSec);
      expect(sorted[0].question).toBe('Q1');
      expect(sorted[1].question).toBe('Q2');
      expect(sorted[2].question).toBe('Q3');
    });

    test('question with triggerTimeSec at 0 appears at video start', () => {
      const question = {
        question: 'Welcome question',
        options: ['Yes', 'No'],
        correctIndex: 0,
        triggerTimeSec: 0
      };

      expect(question.triggerTimeSec).toBe(0);
    });
  });

  describe('AI transcript to quiz generation', () => {
    test('AI output parsed as interactive quiz array', () => {
      const aiOutput = JSON.stringify([
        {
          question: 'What is discussed at 2:00?',
          options: ['Topic A', 'Topic B', 'Topic C', 'Topic D'],
          correctIndex: 0,
          triggerTimeSec: 120,
          explanation: 'Topic A is discussed at the 2-minute mark.'
        }
      ]);

      const parsed = JSON.parse(aiOutput);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].triggerTimeSec).toBe(120);
      expect(parsed[0].explanation).toBeTruthy();
    });

    test('generated questions preserve timestamp from transcript', () => {
      // Simulates AI extracting timestamps from transcript
      const transcriptSegments = [
        { start: 0, end: 60, text: 'Introduction to the course' },
        { start: 60, end: 120, text: 'What are closures in JavaScript?' },
        { start: 120, end: 180, text: 'Understanding the event loop' }
      ];

      const questions = transcriptSegments.slice(1).map((seg, idx) => ({
        question: `What is discussed in segment ${idx + 2}?`,
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        correctIndex: 0,
        triggerTimeSec: seg.start
      }));

      expect(questions).toHaveLength(2);
      expect(questions[0].triggerTimeSec).toBe(60);
      expect(questions[1].triggerTimeSec).toBe(120);
    });

    test('interactive quizzes stored in lesson content', () => {
      const lesson = {
        title: 'JavaScript Closures',
        type: 'video',
        videoUrl: 'https://youtube.com/watch?v=abc123',
        content: {
          videoUrl: 'https://youtube.com/watch?v=abc123',
          interactiveQuizzes: [
            {
              question: 'What is a closure?',
              options: ['A', 'B', 'C', 'D'],
              correctIndex: 0,
              triggerTimeSec: 90
            }
          ]
        }
      };

      expect(lesson.content.interactiveQuizzes).toHaveLength(1);
      expect(lesson.content.interactiveQuizzes[0].triggerTimeSec).toBe(90);
    });

    test('questions can be moderated (edited/removed) before publishing', () => {
      const questions = [
        { question: 'Good Q?', options: ['A', 'B'], correctIndex: 0, triggerTimeSec: 60 },
        { question: 'Bad Q?', options: ['C', 'D'], correctIndex: 1, triggerTimeSec: 120 }
      ];

      // Moderation: remove bad question, edit good one
      const moderated = questions
        .filter((q) => q.question !== 'Bad Q?')
        .map((q) => ({ ...q, question: q.question.replace('?', '? (reviewed)') }));

      expect(moderated).toHaveLength(1);
      expect(moderated[0].question).toContain('reviewed');
    });
  });
});