// TC-04: Xuất bản khóa học
// Kiểm tra chuyển trạng thái published và hiển thị ở Explore

const {
  getEffectiveCourseStatus,
  isCourseCatalogVisible,
  computeCourseReadiness,
  setCourseStatus,
  buildCourseStatusBadge
} = require('../utils/courseLifecycle');

function createCourseDoc(overrides = {}) {
  return {
    title: 'Test Course',
    description: 'A test course description',
    topic: 'Software',
    status: 'draft',
    images: [{ url: 'https://example.com/thumb.jpg', filename: 'thumb.jpg' }],
    sections: [
      {
        title: 'Section 1',
        lessons: [
          { title: 'Lesson 1', type: 'video', videoUrl: 'https://example.com/video.mp4' }
        ]
      }
    ],
    publishedAt: null,
    archivedAt: null,
    unpublishedReason: '',
    ...overrides
  };
}

describe('TC-04: Course publish lifecycle', () => {
  test('getEffectiveCourseStatus returns published for a published course', () => {
    const course = createCourseDoc({ status: 'published' });
    expect(getEffectiveCourseStatus(course)).toBe('published');
  });

  test('getEffectiveCourseStatus returns draft for a draft course', () => {
    const course = createCourseDoc({ status: 'draft' });
    expect(getEffectiveCourseStatus(course)).toBe('draft');
  });

  test('getEffectiveCourseStatus defaults to published for invalid status', () => {
    const course = createCourseDoc({ status: '' });
    expect(getEffectiveCourseStatus(course)).toBe('published');
  });

  test('isCourseCatalogVisible returns true only for published courses', () => {
    expect(isCourseCatalogVisible(createCourseDoc({ status: 'published' }))).toBe(true);
    expect(isCourseCatalogVisible(createCourseDoc({ status: 'draft' }))).toBe(false);
    expect(isCourseCatalogVisible(createCourseDoc({ status: 'archived' }))).toBe(false);
  });

  test('setCourseStatus transitions to published and sets publishedAt', () => {
    const course = createCourseDoc({ status: 'draft' });
    setCourseStatus(course, 'published');

    expect(course.status).toBe('published');
    expect(course.publishedAt).toBeInstanceOf(Date);
    expect(course.archivedAt).toBeNull();
    expect(course.unpublishedReason).toBe('');
  });

  test('setCourseStatus transitions to draft and captures reason', () => {
    const course = createCourseDoc({ status: 'published' });
    setCourseStatus(course, 'draft', { unpublishedReason: 'Content needs review' });

    expect(course.status).toBe('draft');
    expect(course.unpublishedReason).toBe('Content needs review');
    expect(course.archivedAt).toBeNull();
  });

  test('setCourseStatus transitions to archived', () => {
    const course = createCourseDoc({ status: 'published' });
    setCourseStatus(course, 'archived');

    expect(course.status).toBe('archived');
    expect(course.archivedAt).toBeInstanceOf(Date);
  });

  test('computeCourseReadiness marks a complete course as publish-ready', () => {
    const course = createCourseDoc();
    const readiness = computeCourseReadiness(course);

    expect(readiness.isPublishReady).toBe(true);
    expect(readiness.totalSections).toBe(1);
    expect(readiness.totalLessons).toBe(1);
  });

  test('computeCourseReadiness flags missing critical fields', () => {
    const course = createCourseDoc({ title: '', images: [] });
    const readiness = computeCourseReadiness(course);

    expect(readiness.isPublishReady).toBe(false);
    const titleItem = readiness.items.find((item) => item.key === 'title');
    expect(titleItem.ok).toBe(false);
    const thumbItem = readiness.items.find((item) => item.key === 'thumbnail');
    expect(thumbItem.ok).toBe(false);
  });

  test('computeCourseReadiness requires all lessons to have titles', () => {
    const course = createCourseDoc();
    course.sections[0].lessons[0].title = '';
    const readiness = computeCourseReadiness(course);

    expect(readiness.isPublishReady).toBe(false);
    const lessonTitlesItem = readiness.items.find((item) => item.key === 'lessonTitles');
    expect(lessonTitlesItem.ok).toBe(false);
  });

  test('buildCourseStatusBadge returns correct badge info', () => {
    const publishedBadge = buildCourseStatusBadge(createCourseDoc({ status: 'published' }));
    expect(publishedBadge).toEqual({ status: 'published', label: 'Published' });

    const draftBadge = buildCourseStatusBadge(createCourseDoc({ status: 'draft' }));
    expect(draftBadge).toEqual({ status: 'draft', label: 'Draft' });
  });

  test('published course is visible in catalog (Explore page scenario)', () => {
    const courses = [
      createCourseDoc({ _id: 'c1', status: 'published', title: 'Course A' }),
      createCourseDoc({ _id: 'c2', status: 'draft', title: 'Course B' }),
      createCourseDoc({ _id: 'c3', status: 'archived', title: 'Course C' })
    ];

    const visibleCourses = courses.filter(isCourseCatalogVisible);
    expect(visibleCourses).toHaveLength(1);
    expect(visibleCourses[0].title).toBe('Course A');
  });
});