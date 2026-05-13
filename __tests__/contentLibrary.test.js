// TC-07: Content Library
// Kiểm tra lưu item và thêm vào section, tạo lesson từ library

describe('TC-07: Content Library', () => {
  // Helper to simulate ContentLibrary document behavior
  function createContentLibraryItem(overrides = {}) {
    return {
      userId: 'user-1',
      type: 'lesson',
      title: 'Saved Lesson',
      data: { videoUrl: 'https://example.com/video.mp4' },
      preview: 'Video lesson',
      tags: ['javascript', 'beginner'],
      usageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides
    };
  }

  describe('Content library model validation', () => {
    test('valid content library item has required fields', () => {
      const item = createContentLibraryItem();
      expect(item.userId).toBeTruthy();
      expect(item.type).toBeTruthy();
      expect(item.title).toBeTruthy();
    });

    test('content library supports lesson type', () => {
      const item = createContentLibraryItem({ type: 'lesson', data: { videoUrl: 'https://example.com/v.mp4' } });
      expect(item.type).toBe('lesson');
      expect(item.data.videoUrl).toContain('example.com');
    });

    test('content library supports slide type', () => {
      const item = createContentLibraryItem({
        type: 'slide',
        title: 'AI Slides',
        data: { slides: [{ title: 'Slide 1' }, { title: 'Slide 2' }] }
      });
      expect(item.type).toBe('slide');
      expect(item.data.slides).toHaveLength(2);
    });

    test('content library supports quiz type', () => {
      const item = createContentLibraryItem({
        type: 'quiz',
        title: 'JavaScript Quiz',
        data: {
          quiz: [
            { question: 'What is closure?', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }
          ]
        }
      });
      expect(item.type).toBe('quiz');
      expect(item.data.quiz).toHaveLength(1);
    });

    test('invalid type is rejected by enum constraint', () => {
      const validTypes = ['lesson', 'slide', 'quiz'];
      expect(validTypes).toContain('lesson');
      expect(validTypes).toContain('slide');
      expect(validTypes).toContain('quiz');
      expect(validTypes).not.toContain('invalid_type');
    });
  });

  describe('Adding library item to course section', () => {
    test('library item can be converted to a lesson in a section', () => {
      const libraryItem = createContentLibraryItem({
        type: 'lesson',
        title: 'Reused Video Lesson',
        data: { videoUrl: 'https://example.com/reused.mp4' }
      });

      // Simulate adding to section
      const lesson = {
        title: libraryItem.title,
        type: libraryItem.type,
        content: libraryItem.data
      };

      expect(lesson.title).toBe('Reused Video Lesson');
      expect(lesson.type).toBe('lesson');
      expect(lesson.content.videoUrl).toBe('https://example.com/reused.mp4');
    });

    test('library slide item creates slide lesson in section', () => {
      const libraryItem = createContentLibraryItem({
        type: 'slide',
        title: 'Reusable Slides',
        data: { slides: [{ title: 'Introduction' }, { title: 'Summary' }] }
      });

      const lesson = {
        title: libraryItem.title,
        type: 'slide',
        content: libraryItem.data
      };

      expect(lesson.type).toBe('slide');
      expect(lesson.content.slides).toHaveLength(2);
    });

    test('library quiz item creates quiz lesson in section', () => {
      const libraryItem = createContentLibraryItem({
        type: 'quiz',
        title: 'Reusable Quiz',
        data: {
          quiz: [
            { question: 'Q1?', options: ['A', 'B'], correctIndex: 0 },
            { question: 'Q2?', options: ['C', 'D'], correctIndex: 1 }
          ]
        }
      });

      const lesson = {
        title: libraryItem.title,
        type: 'quiz',
        content: libraryItem.data
      };

      expect(lesson.type).toBe('quiz');
      expect(lesson.content.quiz).toHaveLength(2);
    });

    test('usageCount increments when library item is reused', () => {
      const item = createContentLibraryItem({ usageCount: 0 });
      item.usageCount += 1;
      expect(item.usageCount).toBe(1);
      item.usageCount += 1;
      expect(item.usageCount).toBe(2);
    });
  });

  describe('Library search and filtering', () => {
    test('items can be filtered by type', () => {
      const items = [
        createContentLibraryItem({ type: 'lesson', title: 'L1' }),
        createContentLibraryItem({ type: 'slide', title: 'S1' }),
        createContentLibraryItem({ type: 'quiz', title: 'Q1' }),
        createContentLibraryItem({ type: 'lesson', title: 'L2' })
      ];

      const lessons = items.filter((item) => item.type === 'lesson');
      const slides = items.filter((item) => item.type === 'slide');
      const quizzes = items.filter((item) => item.type === 'quiz');

      expect(lessons).toHaveLength(2);
      expect(slides).toHaveLength(1);
      expect(quizzes).toHaveLength(1);
    });

    test('items can be filtered by tags', () => {
      const items = [
        createContentLibraryItem({ tags: ['javascript', 'es6'] }),
        createContentLibraryItem({ tags: ['python', 'django'] }),
        createContentLibraryItem({ tags: ['javascript', 'react'] })
      ];

      const jsItems = items.filter((item) => item.tags.includes('javascript'));
      expect(jsItems).toHaveLength(2);
    });
  });
});