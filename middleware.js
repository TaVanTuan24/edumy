const DEFAULT_ADMIN_USER_IDS = new Set([
  '68a69b0a055071b7e4410b8f'
]);

function sanitizeReturnTo(input, req) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw;
  }

  try {
    const host = String(req.get('host') || '').trim().toLowerCase();
    if (!host) return null;

    const protocol = req.protocol || 'http';
    const parsed = new URL(raw, `${protocol}://${host}`);
    if (parsed.host.toLowerCase() !== host) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

const storeReturnTo = (req, res, next) => {
  const sessionReturnTo = sanitizeReturnTo(req.session && req.session.returnTo, req);
  const referrerReturnTo = sanitizeReturnTo(req.get('Referrer'), req);

  if (req.session) {
    delete req.session.returnTo;
  }

  res.locals.returnTo = sessionReturnTo || referrerReturnTo || '/';
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
    return res.redirect('/login');
  }
  next();
};

const isAuthor = async (req, res, next) => {
  const Review = require('./models/review');
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
  const rawAdminIds = String(process.env.ADMIN_USER_IDS || '').trim();
  const configuredAdmins = rawAdminEmails
    ? rawAdminEmails.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
    : [];
  const configuredAdminIds = rawAdminIds
    ? rawAdminIds.split(',').map((id) => id.trim()).filter(Boolean)
    : [];
  const allowedAdminIds = new Set([
    ...DEFAULT_ADMIN_USER_IDS,
    ...configuredAdminIds
  ]);

  if (!configuredAdmins.length && !allowedAdminIds.size) {
    const message = 'Admin access is not configured. Set ADMIN_EMAILS or ADMIN_USER_IDS to allow access.';

    if (wantsJson(req)) {
      return res.status(503).json({ success: false, message });
    }

    req.flash('error', message);
    return res.redirect('/courses');
  }

  const userId = String((req.user && req.user._id) || '').trim();
  if (userId && allowedAdminIds.has(userId)) {
    return next();
  }

  const userEmail = String((req.user && req.user.email) || '').trim().toLowerCase();
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
  sanitizeReturnTo,
  storeReturnTo, 
  isLoggedIn,
  isAuthor,
  isAdmin
};
