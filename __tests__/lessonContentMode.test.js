const {
  getLessonContentMode,
  hasCustomSlides,
  hasPdfContent
} = require('../utils/lessonContentMode');

describe('lessonContentMode', () => {
  test('detects custom slides only', () => {
    const lesson = { type: 'slide', content: { slides: [{ title: 'One' }] } };
    expect(hasCustomSlides(lesson)).toBe(true);
    expect(hasPdfContent(lesson)).toBe(false);
    expect(getLessonContentMode(lesson)).toBe('slides');
  });

  test('detects PDF only', () => {
    const lesson = { type: 'slide', content: { slides: [], pdf: { url: 'https://cdn.example.com/file.pdf' } } };
    expect(hasCustomSlides(lesson)).toBe(false);
    expect(hasPdfContent(lesson)).toBe(true);
    expect(getLessonContentMode(lesson)).toBe('pdf');
  });

  test('detects hybrid content', () => {
    const lesson = {
      type: 'slide',
      content: {
        slides: [{ title: 'One' }],
        pdf: { url: 'https://cdn.example.com/file.pdf' }
      }
    };
    expect(getLessonContentMode(lesson)).toBe('hybrid');
  });

  test('supports legacy root slides and PDF URL string', () => {
    const lesson = {
      type: 'slide',
      slides: [{ title: 'Legacy' }],
      pdf: 'https://cdn.example.com/legacy.pdf'
    };
    expect(getLessonContentMode(lesson)).toBe('hybrid');
  });

  test('handles malformed or empty content', () => {
    expect(getLessonContentMode({ type: 'slide', content: { slides: 'bad', pdf: {} } })).toBe('empty');
    expect(getLessonContentMode(null)).toBe('empty');
  });
});
