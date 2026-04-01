const storeReturnTo = (req, res, next) => {
  res.locals.returnTo = req.session.returnTo || req.get('Referrer') || '/';
  next();
};

const isLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl;
    req.flash('error', 'You must be signed in!');
    return res.redirect('/users/login');
  }
  next();
};

const isAuthor = async (req, res, next) => {
  const Review = require('../models/review');
  const { reviewId } = req.params;
  const review = await Review.findById(reviewId);
  if (!review || !review.author.equals(req.user._id)) {
    req.flash('error', 'You do not have permission to do that!');
    return res.redirect(`/courses/${req.params.id}`);
  }
  res.locals.review = review;
  next();
};

module.exports = { 
  storeReturnTo, 
  isLoggedIn,
  isAuthor 
};
