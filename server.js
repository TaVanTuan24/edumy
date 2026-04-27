if (process.env.NODE_ENV !== "production") {
  require('dotenv').config();
}

const express = require('express');
const path = require('path');
const os = require('os');
const ejsMate = require('ejs-mate');
const session = require('express-session');
const flash = require('connect-flash');
const ExpressError = require('./utils/ExpressError');
const methodOverride = require('method-override');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cors = require('cors');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
const mongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const { connectDB, closeDB } = require('./config/database');
const passport = require('./config/passport');
const { isAdminUser, sanitizeReturnTo } = require('./middleware');
const serializeJsonForHtml = require('./utils/serializeJsonForHtml');
const catchAsync = require('./utils/catchAsync');
const homeController = require('./controllers/home');
const { stripFileExtension } = require('./utils/formatLessonName');

const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');
const reviewRoutes = require('./routes/reviews');
const exploreRoutes = require('./routes/explore');
const adminRoutes = require('./routes/admin');
const apiAdminRoutes = require('./routes/api/admin');
const libraryRoutes = require('./routes/library');
const aiRoutes = require('./routes/ai');
const videoModelsRoutes = require('./routes/videoModels');
const videoRoutes = require('./routes/videos');
const trackRoutes = require('./routes/track');
const discussionRoutes = require('./routes/discussions');
const vrRoutes = require('./routes/vr');
const vrAuthRoutes = require('./routes/vrAuth');

const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = String(process.env.SESSION_SECRET || '').trim() || 'dev-session-secret-change-me';
const mongoUri = String(process.env.MONGO_URI || '').trim();

if (isProduction && sessionSecret === 'dev-session-secret-change-me') {
  throw new Error('SESSION_SECRET must be set in production');
}

if (!isProduction && sessionSecret === 'dev-session-secret-change-me') {
  console.warn('[session] SESSION_SECRET is not set. Using the development fallback secret.');
}

if (!mongoUri) {
  throw new Error('MONGO_URI is required. Please set it in .env or Render environment variables.');
}

const app = express();
const csrfProtection = csrf();

app.set('trust proxy', 1);

function requestWantsJson(req) {
  const acceptHeader = String(req.get('Accept') || '').toLowerCase();
  const contentType = String(req.get('Content-Type') || '').toLowerCase();
  return Boolean(
    req.xhr
    || acceptHeader.includes('application/json')
    || contentType.includes('application/json')
    || req.path.startsWith('/api/')
  );
}

function shouldSkipCsrf(req) {
  const path = String(req.path || '');

  if (path === '/api/vr-auth/request-code') {
    return true;
  }

  if (path.startsWith('/api/vr/')) {
    return true;
  }

  return false;
}

app.engine('ejs', ejsMate)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'))

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')))

app.use(morgan('combined'));
app.use(compression());

app.use(cors({
  origin: isProduction
    ? (process.env.CORS_ORIGIN || process.env.BASE_URL || false)
    : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

const vrCorsOptions = {
  origin: isProduction
    ? (process.env.VR_CORS_ORIGIN || process.env.VR_BASE_URL || process.env.BASE_URL || false)
    : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

const store = mongoStore.create({
  mongoUrl: mongoUri,
  secret: sessionSecret,
  touchAfter: 24 * 3600
});
store.on("error", function (e) {
  console.error('[session] store error:', e && e.message ? e.message : e);
});

const sessionConfig = {
  store,
  name: 'session',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    expires: new Date(Date.now() + (1000 * 60 * 60 * 24 * 7)),
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}
app.use(session(sessionConfig))
app.use(flash())
app.use((req, res, next) => {
  if (shouldSkipCsrf(req)) {
    return next();
  }

  return csrfProtection(req, res, next);
});

// Helmet CSP same as before
const scriptSrcUrls = [
  "https://stackpath.bootstrapcdn.com/",
  "https://kit.fontawesome.com/",
  "https://cdnjs.cloudflare.com/",
  "https://cdn.jsdelivr.net",
  "https://www.youtube.com"
];
const styleSrcUrls = [
  "https://kit-free.fontawesome.com/",
  "https://stackpath.bootstrapcdn.com/",
  "https://fonts.googleapis.com/",
  "https://use.fontawesome.com/",
  "https://cdnjs.cloudflare.com/",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
];
const connectSrcUrls = [
  "https://cdn.jsdelivr.net",
  "https://stackpath.bootstrapcdn.com",
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com"
];
const fontSrcUrls = ["https://cdnjs.cloudflare.com/", "https://fonts.gstatic.com/"];
app.use(helmet.contentSecurityPolicy({
  directives: {
    upgradeInsecureRequests: null,
    defaultSrc: ["'self'", "https://drive.google.com/"],
    connectSrc: ["'self'", ...connectSrcUrls],
    scriptSrc: ["'self'", "'unsafe-inline'", ...scriptSrcUrls],
    scriptSrcAttr: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", ...styleSrcUrls],
    workerSrc: ["'self'", "blob:"],
    frameSrc: [
      "'self'",
      "https://drive.google.com/",
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
      "https://res.cloudinary.com"
    ],
    objectSrc: [],
    imgSrc: [
      "'self'",
      "blob:",
      "data:",
      "https:",
      "https://res.cloudinary.com/dwxy9oepm/",
      "https://images.unsplash.com/",
      "https://i.ytimg.com",
      "https://*.ytimg.com",
    ],
    fontSrc: ["'self'", ...fontSrcUrls],
  },
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(async (req, res, next) => {
  let csrfToken = '';
  if (typeof req.csrfToken === 'function') {
    try {
      csrfToken = req.csrfToken();
    } catch (_error) {
      csrfToken = '';
    }
  }

  res.locals.currentUser = req.user;
  res.locals.isCurrentUserAdmin = isAdminUser(req.user);
  res.locals.serializeJson = serializeJsonForHtml;
  res.locals.stripFileExtension = stripFileExtension;
  res.locals.csrfToken = csrfToken;
  res.locals.currentPath = String(req.path || '');
  res.locals.currentUrl = String(req.originalUrl || req.path || '');
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.courseNotifications = [];
  res.locals.courseNotificationCount = 0;

  if (!req.user || !req.user._id) {
    return next();
  }

  try {
    const User = require('./models/user');
    const Course = require('./models/course');
    const user = await User.findById(req.user._id).select('enrolledCourses');

    if (!user || !Array.isArray(user.enrolledCourses)) {
      return next();
    }

    const enrolledEntries = user.enrolledCourses
      .map((entry) => {
        if (!entry) return null;

        if (entry.courseId) {
          return {
            courseId: String(entry.courseId),
            lastSeenUpdatedAt: entry.lastSeenUpdatedAt || null
          };
        }

        return {
          courseId: String(entry),
          lastSeenUpdatedAt: null
        };
      })
      .filter((entry) => entry && entry.courseId);

    if (!enrolledEntries.length) {
      return next();
    }

    const enrolledIds = enrolledEntries.map((entry) => entry.courseId);
    const courses = await Course.find({ _id: { $in: enrolledIds } }).select('title updatedAt');
    const courseMap = new Map(courses.map((course) => [String(course._id), course]));

    const notifications = enrolledEntries
      .map((entry) => {
        const course = courseMap.get(entry.courseId);
        if (!course) return null;

        const courseUpdatedAt = course.updatedAt ? new Date(course.updatedAt) : null;
        const lastSeen = entry.lastSeenUpdatedAt ? new Date(entry.lastSeenUpdatedAt) : null;

        if (!courseUpdatedAt) return null;
        if (lastSeen && courseUpdatedAt <= lastSeen) return null;

        return {
          courseId: course._id,
          courseTitle: course.title,
          updatedAt: courseUpdatedAt
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    res.locals.courseNotifications = notifications;
    res.locals.courseNotificationCount = notifications.length;
  } catch (err) {
    console.error('Error fetching course notifications:', err);
    res.locals.courseNotifications = [];
    res.locals.courseNotificationCount = 0;
  }
  next();
});

// Routes
app.use('/', userRoutes);
app.use('/courses', courseRoutes);
app.use('/courses/:id/reviews', reviewRoutes);
app.use('/explore', exploreRoutes);
app.use('/admin', adminRoutes);
app.use('/api/admin', apiAdminRoutes);
app.use('/', libraryRoutes);
app.use('/ai', aiRoutes);
app.use('/video-models', videoModelsRoutes);
app.use('/videos', videoRoutes);
app.use('/track', trackRoutes);
app.use('/courses/:courseId/discussions', discussionRoutes);
app.use('/api/vr', cors(vrCorsOptions), vrRoutes);
app.use('/api/vr-auth', cors(vrCorsOptions), vrAuthRoutes);

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'images', 'picture.png'));
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    mongoConnected: mongoose.connection.readyState === 1
  });
});

app.get('/', catchAsync(homeController.renderHome));

// Catch-all 404 handler
app.all('*', (req, res, next) => {
  next(new ExpressError('Page Not Found', 404));
});

app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    const message = 'Your form expired or the request could not be verified. Please try again.';

    if (!isProduction) {
      console.warn('[CSRF Failure]', {
        method: req.method,
        path: req.originalUrl || req.path,
        hasBodyToken: Boolean(req.body && req.body._csrf),
        hasHeaderToken: Boolean(req.get('CSRF-Token') || req.get('X-CSRF-Token')),
        hasRequestedWith: Boolean(req.get('X-Requested-With')),
        contentType: req.get('Content-Type') || ''
      });
    }

    if (requestWantsJson(req)) {
      return res.status(403).json({
        success: false,
        error: message,
        code: 'EBADCSRFTOKEN'
      });
    }

    req.flash('error', message);
    const returnTo = sanitizeReturnTo(req.get('Referrer'), req) || '/';
    return res.redirect(returnTo);
  }

  return next(err);
});

// Production error handler
app.use((err, req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  let statusCode = Number(err && err.statusCode) || 500;

  if (err && err.name === 'CastError') {
    statusCode = 400;
    err.message = 'Invalid request identifier.';
  } else if (err && err.name === 'ValidationError') {
    statusCode = 400;
    err.message = Object.values(err.errors || {})[0]?.message || 'Invalid request data.';
  } else if (err && err.name === 'MulterError') {
    statusCode = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      err.message = 'Uploaded image is too large.';
    } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      err.message = 'Too many files were uploaded.';
    } else {
      err.message = 'Invalid file upload.';
    }
  }

  if (!err.message) err.message = 'Oh No, Something Went Wrong!';

  if (requestWantsJson(req)) {
    return res.status(statusCode).json({
      success: false,
      error: err.message
    });
  }

  res.status(statusCode).render('error', { err });
});

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const interfaceName of Object.keys(interfaces)) {
    const iface = interfaces[interfaceName] || [];
    for (const net of iface) {
      if (net && net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  return Array.from(new Set(addresses));
}

// Start server
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

let server = null;

async function startServer() {
  await connectDB();

  server = app.listen(PORT, HOST, () => {
    console.log(`[server] Listening on port ${PORT}`);

    if (!isProduction) {
      const lanAddresses = getLanAddresses();
      if (lanAddresses.length > 0) {
        lanAddresses.forEach((ip) => {
          console.log(`[server] LAN URL: http://${ip}:${PORT}`);
        });
      } else {
        console.log('[server] LAN URL: Unable to detect LAN IP automatically.');
      }
    }
  });
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully`);

  if (server) {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  await closeDB();
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  shutdown('SIGINT').finally(() => process.exit(0));
});
