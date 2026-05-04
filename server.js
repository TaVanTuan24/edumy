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
const { csrfProtection, csrfTokenOnly } = require('./middleware/csrf');
const { cspNonce } = require('./middleware/cspNonce');
const rateLimit = require('express-rate-limit');
const mongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const { connectDB, closeDB } = require('./config/database');
const passport = require('./config/passport');
const { isAdminUser } = require('./middleware');
const { wantsJson } = require('./utils/requestHelpers');
const logger = require('./utils/logger');
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
const videoRoutes = require('./routes/videos');
const trackRoutes = require('./routes/track');
const discussionRoutes = require('./routes/discussions');
const vrRoutes = require('./routes/vr');
const vrAuthRoutes = require('./routes/vrAuth');

const isProduction = process.env.NODE_ENV === 'production';
const appVersion = require('./package.json').version || 'unknown';
const sessionSecret = String(process.env.SESSION_SECRET || '').trim() || 'dev-session-secret-change-me';
const mongoUri = String(process.env.MONGO_URI || '').trim();

if (isProduction && sessionSecret === 'dev-session-secret-change-me') {
  throw new Error('SESSION_SECRET must be set in production');
}

if (!isProduction && sessionSecret === 'dev-session-secret-change-me') {
  logger.warn('[session] SESSION_SECRET is not set. Using the development fallback secret.');
}

if (!mongoUri) {
  throw new Error('MONGO_URI is required. Please set it in .env or Render environment variables.');
}

const app = express();

app.set('trust proxy', 1);


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
  logger.error({ err: e }, '[session] store error');
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
    return csrfTokenOnly(req, res, next);
  }

  return csrfProtection(req, res, next);
});

app.use(cspNonce);

// Helmet CSP with per-request nonce
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
// CSP with per-request nonce — middleware uses function to access res.locals.cspNonce
app.use((req, res, next) => {
  const nonce = res.locals.cspNonce || '';
  helmet.contentSecurityPolicy({
    directives: {
      upgradeInsecureRequests: null,
      defaultSrc: ["'self'", "https://drive.google.com/"],
      connectSrc: ["'self'", ...connectSrcUrls],
      // Nonce takes precedence; 'unsafe-inline' kept as fallback for older browsers that ignore nonce
      scriptSrc: ["'self'", `'nonce-${nonce}'`, "'unsafe-inline'", ...scriptSrcUrls],
      scriptSrcAttr: ["'unsafe-inline'"],
      // 'unsafe-inline' required for styleSrc due to Bootstrap inline styles and CDN component styles
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
  })(req, res, next);
});

app.use(passport.initialize());
app.use(passport.session());

const NOTIFICATION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function normalizeCourseNotification(input) {
  if (!input) return null;

  const courseId = String(input.courseId || input._id || '').trim();
  const title = String(input.title || input.courseTitle || '').trim();
  const updatedAtValue = input.updatedAt ? new Date(input.updatedAt) : null;
  const updatedAt = updatedAtValue && !Number.isNaN(updatedAtValue.getTime())
    ? updatedAtValue
    : null;

  if (!courseId || !title) return null;

  return {
    courseId,
    title,
    courseTitle: title,
    updatedAt,
    updatedAtIso: updatedAt ? updatedAt.toISOString() : '',
    url: `/courses/${courseId}`
  };
}

function setCourseNotificationLocals(res, notifications) {
  const normalized = (Array.isArray(notifications) ? notifications : [])
    .map(normalizeCourseNotification)
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a.updatedAt ? a.updatedAt.getTime() : 0;
      const bTime = b.updatedAt ? b.updatedAt.getTime() : 0;
      return bTime - aTime;
    });

  res.locals.courseNotifications = normalized;
  res.locals.notifications = normalized;
  res.locals.updatedCourses = normalized;
  res.locals.courseNotificationCount = normalized.length;
  res.locals.notificationCount = normalized.length;
}

app.use(async (req, res, next) => {
  res.locals.currentUser = req.user;
  res.locals.isCurrentUserAdmin = isAdminUser(req.user);
  res.locals.serializeJson = serializeJsonForHtml;
  res.locals.stripFileExtension = stripFileExtension;
  if (!res.locals.csrfToken) {
    res.locals.csrfToken = '';
  }
  res.locals.currentPath = String(req.path || '');
  res.locals.currentUrl = String(req.originalUrl || req.path || '');
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  setCourseNotificationLocals(res, []);

  // Skip notification query for API requests, static assets, unauthenticated users, and non-GET methods
  const shouldFetchNotifications = req.user
    && req.user._id
    && req.method === 'GET'
    && !wantsJson(req)
    && !req.path.startsWith('/api/')
    && !req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/);

  if (!shouldFetchNotifications) {
    return next();
  }

  // Check session cache first
  if (req.session && req.session.notificationCache) {
    const cached = req.session.notificationCache;
    const cachedNotifications = Array.isArray(cached.notifications)
      ? cached.notifications.map(normalizeCourseNotification).filter(Boolean)
      : null;
    const cachedCount = Number(cached.count);
    const cacheIsFresh = Number(cached.generatedAt) && Date.now() - cached.generatedAt < NOTIFICATION_CACHE_TTL_MS;
    const cacheHasConsistentPayload = cachedNotifications && Number.isFinite(cachedCount) && cachedCount === cachedNotifications.length;

    if (cacheIsFresh && cacheHasConsistentPayload) {
      setCourseNotificationLocals(res, cachedNotifications);
      return next();
    }

    delete req.session.notificationCache;
  }

  try {
    const User = require('./models/user');
    const Course = require('./models/course');
    const user = await User.findById(req.user._id).select('enrolledCourses');

    if (!user || !Array.isArray(user.enrolledCourses)) {
      setCourseNotificationLocals(res, []);
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
      setCourseNotificationLocals(res, []);
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
        return normalizeCourseNotification({
          courseId: course._id,
          title: course.title,
          updatedAt: courseUpdatedAt
        });
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    setCourseNotificationLocals(res, notifications);

    // Cache in session
    if (req.session) {
      req.session.notificationCache = {
        generatedAt: Date.now(),
        notifications: res.locals.courseNotifications,
        count: res.locals.courseNotificationCount
      };
    }
  } catch (err) {
    logger.error({ err }, 'Error fetching course notifications');
    setCourseNotificationLocals(res, []);
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
app.use('/videos', videoRoutes);
app.use('/track', trackRoutes);
app.use('/courses/:courseId/discussions', discussionRoutes);
app.use('/api/vr', cors(vrCorsOptions), vrRoutes);
app.use('/api/vr-auth', cors(vrCorsOptions), vrAuthRoutes);

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'images', 'picture.png'));
});

app.get('/health', (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  const aiConfigured = String(process.env.ALLOW_GLOBAL_AI_FALLBACK || '').toLowerCase() === 'true'
    && Boolean(
      String(process.env.AI_API_KEY || '').trim()
      && String(process.env.AI_BASE_URL || '').trim()
      && String(process.env.AI_MODEL || '').trim()
    );

  const status = mongoReady ? 'ok' : 'degraded';
  const httpStatus = mongoReady ? 200 : 503;

  res.status(httpStatus).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.round(uptime),
    environment: isProduction ? 'production' : 'development',
    version: appVersion,
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed
    },
    dependencies: {
      mongodb: {
        status: mongoReady ? 'ok' : 'disconnected',
        readyState: mongoose.connection.readyState
      },
      ai: {
        status: aiConfigured ? 'configured' : 'not_configured'
      }
    }
  });
});

app.get('/', catchAsync(homeController.renderHome));

// Catch-all 404 handler
app.all('*', (req, res, next) => {
  next(new ExpressError('Page Not Found', 404));
});

// CSRF errors are now handled directly in the csrf middleware

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

  if (wantsJson(req)) {
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
    logger.info({ port: PORT }, '[server] Listening');

    if (!isProduction) {
      const lanAddresses = getLanAddresses();
      if (lanAddresses.length > 0) {
        lanAddresses.forEach((ip) => {
          logger.info(`[server] LAN URL: http://${ip}:${PORT}`);
        });
      } else {
        logger.warn('[server] LAN URL: Unable to detect LAN IP automatically.');
      }
    }
  });
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);

  if (server) {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  await closeDB();
}

startServer().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  shutdown('SIGINT').finally(() => process.exit(0));
});
