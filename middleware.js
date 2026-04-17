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

function getConfiguredAdminEmails() {
  const rawAdminEmails = String(process.env.ADMIN_EMAILS || '').trim();
  return rawAdminEmails
    ? rawAdminEmails.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
    : [];
}

function getConfiguredAdminIds() {
  const rawAdminIds = String(process.env.ADMIN_USER_IDS || '').trim();
  const configuredAdminIds = rawAdminIds
    ? rawAdminIds.split(',').map((id) => id.trim()).filter(Boolean)
    : [];

  return new Set([
    ...DEFAULT_ADMIN_USER_IDS,
    ...configuredAdminIds
  ]);
}

function isAdminUser(user) {
  const allowedAdminIds = getConfiguredAdminIds();
  const configuredAdmins = getConfiguredAdminEmails();
  const userId = String((user && user._id) || '').trim();
  const userEmail = String((user && user.email) || '').trim().toLowerCase();

  if (userId && allowedAdminIds.has(userId)) {
    return true;
  }

  return Boolean(userEmail && configuredAdmins.includes(userEmail));
}

function getEnrolledCourseIdSet(user) {
  if (!user) return new Set();

  if (typeof user.getEnrolledCourseIdSet === 'function') {
    return user.getEnrolledCourseIdSet();
  }

  const enrolledIds = Array.isArray(user.enrolledCourses)
    ? user.enrolledCourses.map((entry) => {
      if (!entry) return null;
      if (entry.courseId) return String(entry.courseId);
      if (entry._bsontype === 'ObjectId' || typeof entry === 'string') return String(entry);
      return null;
    }).filter(Boolean)
    : [];

  return new Set(enrolledIds);
}

function userCanManageCourse(user, course) {
  if (!user || !course) return false;
  if (isAdminUser(user)) return true;

  return Boolean(course.author && String(course.author) === String(user._id));
}

function userCanAccessCourse(user, course) {
  if (!user || !course) return false;
  if (userCanManageCourse(user, course)) return true;

  return getEnrolledCourseIdSet(user).has(String(course._id));
}

function getCourseIdFromRequest(req) {
  const candidates = [
    req.params && req.params.id,
    req.params && req.params.courseId,
    req.body && req.body.courseId,
    req.body && req.body.course && req.body.course._id
  ];

  return candidates.find((value) => String(value || '').trim()) || null;
}

async function loadCourseForRequest(req) {
  const Course = require('./models/course');
  const courseId = getCourseIdFromRequest(req);
  if (!courseId) {
    return { error: 'Course id is required.', statusCode: 400 };
  }

  const course = await Course.findById(courseId).select('author');
  if (!course) {
    return { error: 'Course not found.', statusCode: 404 };
  }

  return { course };
}

function denyCourseAccess(req, res, statusCode, message) {
  if (wantsJson(req)) {
    return res.status(statusCode).json({ success: false, message });
  }

  req.flash('error', message);
  return res.redirect('/courses');
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
  const configuredAdmins = getConfiguredAdminEmails();
  const allowedAdminIds = getConfiguredAdminIds();

  if (!configuredAdmins.length && !allowedAdminIds.size) {
    const message = 'Admin access is not configured. Set ADMIN_EMAILS or ADMIN_USER_IDS to allow access.';

    if (wantsJson(req)) {
      return res.status(503).json({ success: false, message });
    }

    req.flash('error', message);
    return res.redirect('/courses');
  }

  if (isAdminUser(req.user)) {
    return next();
  }

  if (wantsJson(req)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to access this resource.' });
  }

  req.flash('error', 'You do not have permission to access this resource.');
  return res.redirect('/courses');
};

const requireCourseAccess = async (req, res, next) => {
  const result = await loadCourseForRequest(req);
  if (!result.course) {
    return denyCourseAccess(req, res, result.statusCode, result.error);
  }

  if (!userCanAccessCourse(req.user, result.course)) {
    return denyCourseAccess(req, res, 403, 'You do not have access to this course.');
  }

  req.course = result.course;
  next();
};

const requireCourseManagement = async (req, res, next) => {
  const result = await loadCourseForRequest(req);
  if (!result.course) {
    return denyCourseAccess(req, res, result.statusCode, result.error);
  }

  if (!userCanManageCourse(req.user, result.course)) {
    return denyCourseAccess(req, res, 403, 'You do not have permission to manage this course.');
  }

  req.course = result.course;
  next();
};

module.exports = { 
  sanitizeReturnTo,
  storeReturnTo, 
  isLoggedIn,
  isAuthor,
  isAdmin,
  isAdminUser,
  userCanAccessCourse,
  userCanManageCourse,
  requireCourseAccess,
  requireCourseManagement
};
