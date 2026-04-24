function getReviewSource(course) {
  const embedded = Array.isArray(course && course.reviewEntries) ? course.reviewEntries : [];
  if (embedded.length > 0) {
    return embedded;
  }

  return Array.isArray(course && course.reviews) ? course.reviews : [];
}

function summarizeCourseReviews(course) {
  const reviews = getReviewSource(course);
  const reviewCount = reviews.length;

  if (!reviewCount) {
    return {
      reviewCount: 0,
      averageRating: null
    };
  }

  const total = reviews.reduce((sum, review) => sum + (Number(review && review.rating) || 0), 0);
  return {
    reviewCount,
    averageRating: total / reviewCount
  };
}

module.exports = {
  summarizeCourseReviews
};
