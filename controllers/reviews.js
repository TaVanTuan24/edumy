const Course = require('../models/course');
const Review = require('../models/review');

module.exports.createReview = async (req, res) => {
    const course = await Course.findById(req.params.id).populate({
        path: 'reviews',
        populate: { path: 'author' }
    });

    if (!course) {
        req.flash('error', 'Course not found.');
        return res.redirect('/explore');
    }

    const rawReview = req.body && req.body.review && typeof req.body.review === 'object'
        ? req.body.review
        : {};
    const rating = Number(rawReview.rating);
    const body = String(rawReview.body || '').trim().slice(0, 2000);

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        req.flash('error', 'Rating must be between 1 and 5.');
        return res.redirect(`/explore/${course._id}/preview`);
    }

    const review = new Review({
        rating,
        body,
        author: req.user._id
    });

    await review.save();
    course.reviews.push(review);
    await course.save();
    res.redirect(`/explore/${course._id}/preview`);
};

module.exports.deleteReview = async (req, res) => {
    const { id, reviewId } = req.params;
    await Course.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
    await Review.findByIdAndDelete(reviewId);
    res.redirect(`/explore/${id}/preview`);
};
