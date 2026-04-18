const {
  buildFallbackDescription,
  buildCurriculumOutline
} = require('../utils/courseDescriptionGenerator');

describe('courseDescriptionGenerator', () => {
  test('buildCurriculumOutline extracts section and lesson names from sections.lessons', () => {
    const outline = buildCurriculumOutline({
      sections: [
        {
          title: 'Getting Started',
          lessons: [
            { type: 'video', title: 'Introduction to Unity UI' },
            { type: 'slide', title: 'UI Layout Principles' }
          ]
        }
      ]
    });

    expect(outline).toEqual([
      {
        sectionTitle: 'Getting Started',
        lessons: [
          'video: Introduction to Unity UI',
          'slide: UI Layout Principles'
        ]
      }
    ]);
  });

  test('buildCurriculumOutline uses canonical sections.lessons', () => {
    const outline = buildCurriculumOutline({
      sections: [
        {
          title: 'Immersion Basics',
          lessons: [
            { type: 'video', title: 'Welcome to VR Learning' },
            { type: 'quiz', title: 'Comfort and Safety Check' }
          ]
        }
      ]
    });

    expect(outline).toEqual([
      {
        sectionTitle: 'Immersion Basics',
        lessons: [
          'video: Welcome to VR Learning',
          'quiz: Comfort and Safety Check'
        ]
      }
    ]);
  });

  test('buildFallbackDescription uses curriculum names to produce a meaningful summary', () => {
    const description = buildFallbackDescription({
      title: 'Unity UI Fundamentals',
      topic: 'Software',
      sections: [
        {
          title: 'Foundations',
          lessons: [
            { type: 'video', title: 'Canvas and Event System' },
            { type: 'quiz', title: 'UI Basics Checkpoint' }
          ]
        },
        {
          title: 'Layout Systems',
          lessons: [
            { type: 'slide', title: 'Anchors and Responsive Layouts' }
          ]
        }
      ]
    });

    expect(description).toContain('Unity UI Fundamentals');
    expect(description).toContain('Foundations');
    expect(description).toContain('Layout Systems');
    expect(description).toContain('Canvas and Event System');
  });
});
