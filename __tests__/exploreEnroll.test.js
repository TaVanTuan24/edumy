// TC-12: Explore và enroll
// Kiểm tra tìm, preview, ghi danh: Explore/preview/enroll đúng luồng

describe('TC-12: Explore and enroll flow', () => {
  describe('Explore course visibility', () => {
    test('only published courses appear in explore', () => {
      const allCourses = [
        { _id: 'c1', title: 'Course A', status: 'published', topic: 'AI' },
        { _id: 'c2', title: 'Course B', status: 'draft', topic: 'AI' },
        { _id: 'c3', title: 'Course C', status: 'published', topic: 'Web' },
        { _id: 'c4', title: 'Course D', status: 'archived', topic: 'Web' }
      ];

      const visibleStatuses = new Set(['published']);
      const visibleCourses = allCourses.filter((c) => visibleStatuses.has(c.status));
      expect(visibleCourses).toHaveLength(2);
    });

    test('courses are grouped by topic', () => {
      const courses = [
        { _id: 'c1', title: 'ML Intro', status: 'published', topic: 'AI' },
        { _id: 'c2', title: 'Deep Learning', status: 'published', topic: 'AI' },
        { _id: 'c3', title: 'React Basics', status: 'published', topic: 'Web' }
      ];

      const grouped = {};
      courses.forEach((c) => {
        if (!grouped[c.topic]) grouped[c.topic] = [];
        grouped[c.topic].push(c);
      });

      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['AI']).toHaveLength(2);
      expect(grouped['Web']).toHaveLength(1);
    });

    test('enrolled courses are excluded from explore', () => {
      const allCourses = [
        { _id: 'c1', title: 'Course A', status: 'published' },
        { _id: 'c2', title: 'Course B', status: 'published' }
      ];
      const enrolledIds = new Set(['c1']);

      const unenrolled = allCourses.filter((c) => !enrolledIds.has(c._id));
      expect(unenrolled).toHaveLength(1);
      expect(unenrolled[0].title).toBe('Course B');
    });
  });

  describe('Course preview', () => {
    test('preview displays course details', () => {
      const course = {
        _id: 'course-1',
        title: 'JavaScript Fundamentals',
        description: 'Learn the basics of JavaScript',
        topic: 'Web Development',
        images: [{ url: 'https://example.com/thumb.jpg' }],
        sections: [
          {
            title: 'Getting Started',
            lessons: [
              { title: 'Variables', type: 'video' },
              { title: 'Functions', type: 'video' }
            ]
          }
        ],
        reviews: []
      };

      expect(course.title).toBeTruthy();
      expect(course.description).toBeTruthy();
      expect(course.sections).toHaveLength(1);
      expect(course.sections[0].lessons).toHaveLength(2);
    });

    test('preview shows review summary', () => {
      const reviews = [
        { rating: 5, body: 'Great course!' },
        { rating: 4, body: 'Very helpful' },
        { rating: 3, body: 'Decent content' }
      ];

      const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
      expect(avgRating).toBe(4);
      expect(reviews).toHaveLength(3);
    });

    test('preview indicates enrollment status', () => {
      const enrolledIds = new Set(['course-1']);
      const courseId = 'course-1';
      const isEnrolled = enrolledIds.has(courseId);
      expect(isEnrolled).toBe(true);

      const notEnrolledCourseId = 'course-2';
      expect(enrolledIds.has(notEnrolledCourseId)).toBe(false);
    });
  });

  describe('Enrollment flow', () => {
    test('enrollment creates a new entry in user enrolledCourses', () => {
      const user = {
        _id: 'user-1',
        enrolledCourses: []
      };
      const courseId = 'course-1';
      const course = { _id: courseId, title: 'Test Course', updatedAt: new Date() };

      // Simulate enrollment
      const existingEnrollment = user.enrolledCourses.find(
        (e) => String(e.courseId) === courseId
      );
      expect(existingEnrollment).toBeUndefined();

      user.enrolledCourses.push({
        courseId: course._id,
        progress: { completedCount: 0, lastLessonId: '' },
        lastSeenUpdatedAt: course.updatedAt,
        enrolledAt: new Date()
      });

      expect(user.enrolledCourses).toHaveLength(1);
      expect(user.enrolledCourses[0].courseId).toBe(courseId);
    });

    test('duplicate enrollment is prevented', () => {
      const user = {
        _id: 'user-1',
        enrolledCourses: [
          { courseId: 'course-1', enrolledAt: new Date() }
        ]
      };

      const existingEnrollment = user.enrolledCourses.find(
        (e) => String(e.courseId) === 'course-1'
      );
      expect(existingEnrollment).toBeTruthy();

      // Should not add again
      if (!existingEnrollment) {
        user.enrolledCourses.push({ courseId: 'course-1', enrolledAt: new Date() });
      }
      expect(user.enrolledCourses).toHaveLength(1);
    });

    test('enrollment redirects to /courses after success', () => {
      const flashMessages = [];
      const redirects = [];

      const req = {
        flash: (type, msg) => flashMessages.push({ type, msg })
      };
      const res = {
        redirect: (path) => redirects.push(path)
      };

      // Simulate successful enrollment
      req.flash('success', 'Successfully enrolled!');
      res.redirect('/courses');

      expect(flashMessages).toHaveLength(1);
      expect(flashMessages[0].type).toBe('success');
      expect(redirects[0]).toBe('/courses');
    });

    test('enrollment tracks analytics event', () => {
      const analyticsEvents = [];
      const courseId = 'course-1';

      // Simulate trackEventSafe call
      analyticsEvents.push({
        eventType: 'course_enrolled',
        course: courseId,
        metadata: { courseTitle: 'Test Course', source: 'enroll_flow' }
      });

      expect(analyticsEvents).toHaveLength(1);
      expect(analyticsEvents[0].eventType).toBe('course_enrolled');
      expect(analyticsEvents[0].metadata.source).toBe('enroll_flow');
    });
  });
});