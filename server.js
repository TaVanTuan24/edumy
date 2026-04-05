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
const rateLimit = require('express-rate-limit');
const mongoStore = require('connect-mongo');
const { connectDB, closeDB } = require('./config/database');
const passport = require('./config/passport');
const { cloudinary } = require('./config/cloudinary');

const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');
const reviewRoutes = require('./routes/reviews');
const exploreRoutes = require('./routes/explore');
const dashboardRoutes = require("./routes/dashboard");
const adminRoutes = require('./routes/admin');
const apiAdminRoutes = require('./routes/api/admin');
const libraryRoutes = require('./routes/library');
const aiRoutes = require('./routes/ai');
const videoModelsRoutes = require('./routes/videoModels');
const trackRoutes = require('./routes/track');
const discussionRoutes = require('./routes/discussions');
const vrRoutes = require('./routes/vr');

// Connect DB
connectDB();

const app = express();

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
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.CORS_ORIGIN || process.env.BASE_URL || false)
    : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

const vrCorsOptions = {
  origin: process.env.NODE_ENV === 'production'
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
  mongoUrl: process.env.MONGODB_URL || 'mongodb://localhost:27017/edumy',
  secret: process.env.SESSION_SECRET || 'mysceret',
  touchAfter: 24 * 3600
});
store.on("error", function (e) {
  console.log("SESSION STORE ERROR", e);
});

const sessionConfig = {
  store,
  name: 'session',
  secret: process.env.SESSION_SECRET || 'mysceret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}
app.use(session(sessionConfig))
app.use(flash())

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
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
];
const connectSrcUrls = [
  "https://cdn.jsdelivr.net",
  "https://stackpath.bootstrapcdn.com",
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com"
];
const fontSrcUrls = [];
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
      "https://www.youtube-nocookie.com"
    ],
    objectSrc: [],
    imgSrc: [
      "'self'",
      "blob:",
      "data:",
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
  res.locals.currentUser = req.user;
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
    const user = await User.findById(req.user._id);

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
app.use('/dashboard', dashboardRoutes);
app.use('/admin', adminRoutes);
app.use('/api/admin', apiAdminRoutes);
app.use('/', libraryRoutes);
app.use('/ai', aiRoutes);
app.use('/video-models', videoModelsRoutes);
app.use('/track', trackRoutes);
app.use('/courses/:courseId/discussions', discussionRoutes);
app.use('/api/vr', cors(vrCorsOptions), vrRoutes);

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'images', 'picture.png'));
});

app.get('/', (req, res) => {
  res.render('home');
});

// Catch-all 404 handler
app.all('*', (req, res, next) => {
  next(new ExpressError('Page Not Found', 404));
});

// Production error handler
app.use((err, req, res, next) => {
  const { statusCode = 500 } = err;
  if (!err.message) err.message = 'Oh No, Something Went Wrong!';
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

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running at http://localhost:${PORT}`);

  const lanAddresses = getLanAddresses();
  if (lanAddresses.length > 0) {
    lanAddresses.forEach((ip) => {
      console.log(`LAN URL: http://${ip}:${PORT}`);
    });
  } else {
    console.log('LAN URL: Unable to detect LAN IP automatically.');
  }

  console.log('You can now access Edumy from phone, Unity VR, or other devices on the same network.');
});
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    closeDB();
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    closeDB();
  });
});
