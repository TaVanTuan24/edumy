const storeReturnTo = (req, res, next) => {
  res.locals.returnTo = req.session.returnTo || req.get('Referrer') || '/';
  next();
};

function wantsJson(req) {
  const acceptHeader = String(req.get('Accept') || '').toLowerCase();
  return req.xhr || acceptHeader.includes('application/json');
}

const isLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
    if (wantsJson(req)) {
      return res.status(401).json({ success: false, message: 'You must be signed in!' });
    }

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

const isAdmin = (req, res, next) => {
  const rawAdminEmails = String(process.env.ADMIN_EMAILS || '').trim();
  const configuredAdmins = rawAdminEmails
    ? rawAdminEmails.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
    : [];

  // Backward-compatible default: if no admin list is configured, keep current behavior.
  if (!configuredAdmins.length) {
    return next();
  }

  const userEmail = String(req.user && req.user.email || '').trim().toLowerCase();
  if (userEmail && configuredAdmins.includes(userEmail)) {
    return next();
  }

  if (wantsJson(req)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to access this resource.' });
  }

  req.flash('error', 'You do not have permission to access this resource.');
  return res.redirect('/courses');
};

module.exports = { 
  storeReturnTo, 
  isLoggedIn,
  isAuthor,
  isAdmin
};
