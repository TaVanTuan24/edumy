if (process.env.NODE_ENV !== "production") {
    require('dotenv').config();
}
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const ejsMate = require('ejs-mate');
const session = require('express-session');
const flash = require('connect-flash');
const ExpressError = require('./utils/ExpressError');
const methodOverride = require('method-override');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const User = require('./models/user');
const helmet = require('helmet');
const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');
const reviewRoutes = require('./routes/reviews');
const exploreRoutes = require('./routes/explore');
const dashboardRoutes = require("./routes/dashboard");
const adminRoutes = require('./routes/admin');
const apiAdminRoutes = require('./routes/api/admin');
const aiRoutes = require('./routes/ai');
const videoModelsRoutes = require('./routes/videoModels');
const Course = require('./models/course');
const { content } = require('googleapis/build/src/apis/content');
const mongoStore = require('connect-mongo');

mongoose.connect('mongodb://localhost:27017/edumy', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
    console.log("Database connected");
});

const app = express();

app.engine('ejs', ejsMate)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'))

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')))

const store = mongoStore.create({
    mongoUrl: 'mongodb://localhost:27017/edumy',
    secret: 'mysceret',
    touchAfter: 24 * 3600, // time in seconds 
});
store.on("error", function (e) {
    console.log("SESSION STORE ERROR", e);
});

const sessionConfig = {
    store: store,
    name: 'session',
    secret: 'mysceret',
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
const scriptSrcUrls = [
    "https://stackpath.bootstrapcdn.com/",
    "https://kit.fontawesome.com/",
    "https://cdnjs.cloudflare.com/",
    "https://cdn.jsdelivr.net",
];
const styleSrcUrls = [
    "https://kit-free.fontawesome.com/",
    "https://stackpath.bootstrapcdn.com/",
    "https://fonts.googleapis.com/",
    "https://use.fontawesome.com/",
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
];
const connectSrcUrls = [];
const fontSrcUrls = [];
app.use(
    helmet.contentSecurityPolicy({
        directives: {
            defaultSrc: ["'self'", "https://drive.google.com/"],
            connectSrc: ["'self'", ...connectSrcUrls],
            scriptSrc: ["'self'", "'unsafe-inline'", ...scriptSrcUrls],
            scriptSrcAttr: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", ...styleSrcUrls],
            workerSrc: ["'self'", "blob:"],
            objectSrc: [],
            imgSrc: [
                "'self'",
                "blob:",
                "data:",
                "https://res.cloudinary.com/dwxy9oepm/",
                "https://images.unsplash.com/",
            ],
            fontSrc: ["'self'", ...fontSrcUrls],
        },
    })
);
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

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
    } catch (error) {
        console.error('[Notification Middleware Error]', error.message);
    }

    next();
});

app.use('/', userRoutes)
// app.use('/', participantRoutes)
app.use('/courses', courseRoutes)
app.use('/explore', exploreRoutes)
app.use('/courses/:id/reviews', reviewRoutes)
app.use("/dashboard", dashboardRoutes);
app.use('/admin', adminRoutes);
app.use('/api/admin', apiAdminRoutes);
app.use('/ai', aiRoutes);
app.use('/video-models', videoModelsRoutes);

app.get('/', (req, res) => {
    res.render('home')
})

app.all('*', (req, res, next) => {
    next(new ExpressError('Page Not Found', 404))
})

app.use((err, req, res, next) => {
    const { statusCode = 500 } = err;
    if (!err.message) err.message = 'Something went wrong!';
    res.status(statusCode).render('error', { err });
})

app.listen(3000, () => {
    console.log('Serving on port 3000')
})