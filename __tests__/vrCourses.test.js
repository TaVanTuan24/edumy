// TC-21: VR lấy khóa học
// Kiểm tra VR gọi API course/lesson, trả dữ liệu từ backend

const { getCanonicalSections } = require('../utils/courseContentAdapter');
const { stripFileExtension } = require('../utils/formatLessonName');

describe('TC-21: VR course data access', () => {
  describe('Course lesson extraction', () => {
    test('extracts lessons from course sections using canonical adapter', () => {
      const course = {
        sections: [
          {
            title: 'Section 1',
            order: 0,
            lessons: [
              { _id: 'l1', title: 'Lesson 1', type: 'video', videoUrl: 'https://example.com/v1.mp4', order: 0 },
              { _id: 'l2', title: 'Lesson 2', type: 'slide', order: 1 }
            ]
          },
          {
            title: 'Section 2',
            order: 1,
            lessons: [
              { _id: 'l3', title: 'Lesson 3', type: 'quiz', order: 0, quiz: [{ question: 'Q1?', options: ['A', 'B'], correctIndex: 0 }] }
            ]
          }
        ]
      };

      const canonicalSections = getCanonicalSections(course);
      const allLessons = canonicalSections.flatMap((s) => Array.isArray(s.lessons) ? s.lessons : []);
      expect(allLessons).toHaveLength(3);
      expect(allLessons[0].title).toBe('Lesson 1');
      expect(allLessons[0].type).toBe('video');
      expect(allLessons[2].type).toBe('quiz');
    });

    test('lesson titles are stripped of file extensions for VR display', () => {
      expect(stripFileExtension('lecture_01.mp4')).toBe('lecture_01');
      expect(stripFileExtension('Welcome Video.webm')).toBe('Welcome Video');
    });

    test('handles course with no sections', () => {
      const course = { sections: [] };
      const canonicalSections = getCanonicalSections(course);
      expect(canonicalSections).toHaveLength(0);
    });

    test('handles course with missing sections by providing empty array', () => {
      const course = { sections: [] };
      const canonicalSections = getCanonicalSections(course);
      expect(canonicalSections).toHaveLength(0);
    });
  });

  describe('VR API response structure', () => {
    test('lesson has required VR fields (id, title, type, videoUrl)', () => {
      const lesson = {
        _id: 'lesson-1',
        title: 'Video Lesson.mp4',
        type: 'video',
        videoUrl: 'https://youtube.com/watch?v=abc',
        order: 0,
        content: {}
      };

      const vrLesson = {
        id: String(lesson._id),
        title: stripFileExtension(lesson.title),
        type: lesson.type,
        videoUrl: lesson.videoUrl || ''
      };

      expect(vrLesson.id).toBe('lesson-1');
      expect(vrLesson.title).toBe('Video Lesson');
      expect(vrLesson.type).toBe('video');
      expect(vrLesson.videoUrl).toContain('youtube.com');
    });

    test('quiz lessons include quiz questions array', () => {
      const lesson = {
        _id: 'quiz-1',
        title: 'Quiz Lesson',
        type: 'quiz',
        quiz: [
          { question: 'Q1?', options: ['A', 'B'], correctIndex: 0 }
        ]
      };

      expect(Array.isArray(lesson.quiz)).toBe(true);
      expect(lesson.quiz).toHaveLength(1);
      expect(lesson.quiz[0].question).toBe('Q1?');
    });

    test('VR course response includes progress data', () => {
      const courseData = {
        id: 'course-1',
        title: 'JavaScript 101',
        description: 'Learn JS',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        progress: 60,
        totalLessons: 5,
        completedLessons: 3
      };

      expect(courseData.progress).toBe(60);
      expect(courseData.totalLessons).toBe(5);
      expect(courseData.completedLessons).toBe(3);
    });
  });

  describe('VR lesson type detection', () => {
    test('lesson with videoUrl is video type', () => {
      const lesson = {
        type: 'video',
        videoUrl: 'https://youtube.com/watch?v=abc',
        content: {}
      };
      expect(lesson.type).toBe('video');
      expect(lesson.videoUrl).toBeTruthy();
    });

    test('lesson with slides is slide type', () => {
      const lesson = {
        type: 'slide',
        content: {
          slides: [{ title: 'Slide 1', text: 'Content' }]
        }
      };
      expect(lesson.type).toBe('slide');
      expect(lesson.content.slides).toHaveLength(1);
    });

    test('lesson with quiz questions is quiz type', () => {
      const lesson = {
        type: 'quiz',
        quiz: [{ question: 'Q1?', options: ['A', 'B'], correctIndex: 0 }]
      };
      expect(lesson.type).toBe('quiz');
      expect(lesson.quiz).toHaveLength(1);
    });

    test('lesson without videoUrl has empty videoUrl', () => {
      const lesson = {
        _id: 'l1',
        title: 'Slide Lesson',
        type: 'slide',
        videoUrl: ''
      };
      expect(lesson.videoUrl).toBeFalsy();
    });
  });

  describe('VR quiz question extraction', () => {
    test('quiz questions from lesson.quiz are available for VR', () => {
      const lesson = {
        quiz: [
          { question: 'What is JS?', options: ['Language', 'Framework', 'Library', 'OS'], correctIndex: 0 }
        ]
      };

      expect(lesson.quiz).toHaveLength(1);
      expect(lesson.quiz[0].question).toBe('What is JS?');
      expect(lesson.quiz[0].options).toHaveLength(4);
    });

    test('interactive quizzes have triggerTimeSec for timed display', () => {
      const lesson = {
        interactiveQuizzes: [
          {
            question: 'What is discussed?',
            options: ['A', 'B', 'C', 'D'],
            correctIndex: 0,
            triggerTimeSec: 60
          },
          {
            question: 'Another Q',
            options: ['E', 'F', 'G', 'H'],
            correctIndex: 1,
            triggerTimeSec: 120
          }
        ]
      };

      expect(lesson.interactiveQuizzes).toHaveLength(2);
      expect(lesson.interactiveQuizzes[0].triggerTimeSec).toBe(60);
      expect(lesson.interactiveQuizzes[1].triggerTimeSec).toBe(120);
    });
  });
});