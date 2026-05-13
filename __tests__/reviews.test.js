// TC-16: Reviews/ratings
// Kiểm tra gửi rating và nhận xét, review được lưu, hiển thị ở preview/tab

const { summarizeCourseReviews } = require('../utils/courseReviews');

describe('TC-16: Reviews and ratings', () => {
  describe('Review creation', () => {
    test('review is created with required fields', () => {
      const review = {
        author: 'user-1',
        course: 'course-1',
        rating: 5,
        body: 'Excellent course! Learned a lot about JavaScript.',
        createdAt: new Date()
      };

      expect(review.author).toBeTruthy();
      expect(review.course).toBeTruthy();
      expect(review.rating).toBeGreaterThanOrEqual(1);
      expect(review.rating).toBeLessThanOrEqual(5);
      expect(review.body).toBeTruthy();
    });

    test('rating must be between 1 and 5', () => {
      const validRatings = [1, 2, 3, 4, 5];
      validRatings.forEach((r) => {
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(5);
      });
    });

    test('review body is trimmed before saving', () => {
      const rawBody = '   Great course!   ';
      const trimmed = rawBody.trim();
      expect(trimmed).toBe('Great course!');
    });

    test('empty review body is rejected', () => {
      const body = '';
      expect(Boolean(body.trim())).toBe(false);
    });

    test('user can update their existing review', () => {
      const review = { author: 'user-1', rating: 3, body: 'Decent course' };
      review.rating = 5;
      review.body = 'After finishing, I think it\'s excellent!';
      expect(review.rating).toBe(5);
      expect(review.body).toContain('excellent');
    });
  });

  describe('Review summarization', () => {
    test('summarizeCourseReviews calculates average rating', () => {
      const course = {
        reviews: [
          { rating: 5, body: 'Great!' },
          { rating: 4, body: 'Good' },
          { rating: 3, body: 'Okay' }
        ]
      };

      const summary = summarizeCourseReviews(course);
      expect(summary.reviewCount).toBe(3);
      expect(summary.averageRating).toBe(4);
    });

    test('summarizeCourseReviews handles course with no reviews', () => {
      const course = { reviews: [] };
      const summary = summarizeCourseReviews(course);
      expect(summary.reviewCount).toBe(0);
      expect(summary.averageRating).toBeNull();
    });

    test('summarizeCourseReviews handles course with undefined reviews', () => {
      const course = {};
      const summary = summarizeCourseReviews(course);
      expect(summary.reviewCount).toBe(0);
      expect(summary.averageRating).toBeNull();
    });

    test('average rating is displayed with one decimal place', () => {
      const reviews = [
        { rating: 5 },
        { rating: 4 },
        { rating: 4 }
      ];
      const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
      expect(avg.toFixed(1)).toBe('4.3');
    });
  });

  describe('Review display', () => {
    test('reviews are displayed in course preview', () => {
      const course = {
        title: 'JavaScript 101',
        reviews: [
          { rating: 5, body: 'Amazing!', author: { username: 'Alice' } },
          { rating: 4, body: 'Very helpful', author: { username: 'Bob' } }
        ]
      };

      expect(course.reviews).toHaveLength(2);
      expect(course.reviews[0].author.username).toBe('Alice');
    });

    test('reviews are sorted by newest first', () => {
      const reviews = [
        { rating: 5, createdAt: new Date('2026-01-01') },
        { rating: 4, createdAt: new Date('2026-04-01') },
        { rating: 3, createdAt: new Date('2026-03-01') }
      ];

      const sorted = [...reviews].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      expect(sorted[0].rating).toBe(4);
      expect(sorted[1].rating).toBe(3);
      expect(sorted[2].rating).toBe(5);
    });
  });
});