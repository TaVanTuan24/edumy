const {
  buildFallbackDescription,
  buildCurriculumOutline
} = require('../utils/courseDescriptionGenerator');

describe('courseDescriptionGenerator', () => {
  test('buildCurriculumOutline extracts section and lesson names from driveStructure', () => {
    const outline = buildCurriculumOutline({
      driveStructure: [
        {
          section: 'Getting Started',
          videos: [
            { type: 'video', name: 'Introduction to Unity UI' },
            { type: 'slide', name: 'UI Layout Principles' }
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

  test('buildCurriculumOutline prefers canonical sections.lessons when present', () => {
    const outline = buildCurriculumOutline({
      sections: [
        {
          title: 'Immersion Basics',
          lessons: [
            { type: 'video', title: 'Welcome to VR Learning' },
            { type: 'quiz', title: 'Comfort and Safety Check' }
          ]
        }
      ],
      driveStructure: [
        {
          section: 'Old Structure',
          videos: [
            { type: 'video', name: 'Legacy Lesson' }
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
      driveStructure: [
        {
          section: 'Foundations',
          videos: [
            { type: 'video', name: 'Canvas and Event System' },
            { type: 'quiz', name: 'UI Basics Checkpoint' }
          ]
        },
        {
          section: 'Layout Systems',
          videos: [
            { type: 'slide', name: 'Anchors and Responsive Layouts' }
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
