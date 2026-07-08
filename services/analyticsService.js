const mongoose = require('mongoose');
const Course = require('../models/course');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const { getCanonicalSections } = require('../utils/courseContentAdapter');

function countTotalLessons(course) {
    const sections = getCanonicalSections(course);
    return sections.reduce((total, section) => {
        const items = Array.isArray(section && section.lessons) ? section.lessons : [];
        return total + items.length;
    }, 0);
}

function buildLessonTitleMap(course) {
    const map = new Map();
    const sections = getCanonicalSections(course);
    sections.forEach((section) => {
        const items = Array.isArray(section && section.lessons) ? section.lessons : [];
        items.forEach((item) => {
            if (!item || !item._id) return;
            map.set(String(item._id), item.title || 'Lesson');
        });
    });
    return map;
}

function getDateFromRange(range) {
    const now = new Date();
    if (range === 'today') return new Date(now.setHours(0,0,0,0));
    if (range === '7d') return new Date(now.setDate(now.getDate() - 7));
    if (range === '30d') return new Date(now.setDate(now.getDate() - 30));
    if (range === '90d') return new Date(now.setDate(now.getDate() - 90));
    return new Date(0); // all time
}

async function getCourseAnalytics(courseId, timeRange = 'all') {
    const course = await Course.findById(courseId);
    if (!course) return null;

    const startDate = getDateFromRange(timeRange);
    const cId = new mongoose.Types.ObjectId(courseId);

    // 1. Get Enrolled Users
    // Users that have courseId in enrolledCourseIds or enrolledCourses
    const users = await User.find({
        $or: [
            { enrolledCourseIds: cId },
            { enrolledCourses: cId },
            { enrolledCourses: String(cId) },
            { enrolledCourses: { $elemMatch: { courseId: cId } } },
            { enrolledCourses: { $elemMatch: { courseId: String(cId) } } }
        ]
    });

    const enrolledUserIds = users.map(u => u._id);
    const totalEnrolled = enrolledUserIds.length;

    // Filter enrollments within time range based on user's enrolledCourses array
    let newLearnersCount = 0;
    users.forEach(u => {
        const enrollment = (u.enrolledCourses || []).find(e => 
           (e && e.courseId && String(e.courseId) === String(courseId)) || String(e) === String(courseId)
        );
        if (enrollment && enrollment.enrolledAt) {
            if (new Date(enrollment.enrolledAt) >= startDate) newLearnersCount++;
        } else {
            const joinedDate = u.createdAt || u._id.getTimestamp();
            if (joinedDate >= startDate) newLearnersCount++;
        }
    });

    // 2. Fetch UserCourseProgress
    // We only fetch progress updated after startDate if we want strict range, 
    // but for overview stats like completion rate we need ALL time progress.
    // For Activity trend we can filter by lastAccessed locally.
    const allProgressDocs = await UserCourseProgress.find({ course: cId }).lean();

    const totalLessons = countTotalLessons(course);
    
    // Overview metrics
    let completedLearners = 0;
    let totalWatchTime = 0;
    let activeLearners = 0;
    let totalQuizScore = 0;
    let totalQuizPossible = 0;
    let totalLessonViews = 0;
    let totalQuizAttempts = 0;
    
    const progressBuckets = [0, 0, 0, 0, 0]; // 0-10%, 11-25%, 26-50%, 51-75%, 76-100%
    const lessonEngagementMap = new Map();
    const quizStatsMap = new Map();

    const progressByUser = new Map(allProgressDocs.map(doc => [String(doc.user), doc]));
    
    // Enrollment Trend (Mocked via grouping enrollment dates, simplified here)
    const enrollmentTrend = {};
    const activityTrend = {};

    users.forEach(u => {
        // Build enrollment trend
        const enrollment = (u.enrolledCourses || []).find(e => 
           (e && e.courseId && String(e.courseId) === String(courseId)) || String(e) === String(courseId)
        );
        const eDate = enrollment && enrollment.enrolledAt ? new Date(enrollment.enrolledAt) : new Date(u.createdAt || u._id.getTimestamp());
        if (eDate >= startDate) {
            const dateStr = eDate.toISOString().split('T')[0];
            enrollmentTrend[dateStr] = (enrollmentTrend[dateStr] || 0) + 1;
        }

        // Completion status
        const progress = progressByUser.get(String(u._id));
        const completed = progress && Array.isArray(progress.completedLessons) ? progress.completedLessons.length : 0;
        const rate = totalLessons ? Math.round((completed / totalLessons) * 100) : 0;
        
        if (rate >= 100) completedLearners++;
        
        if (rate <= 10) progressBuckets[0]++;
        else if (rate <= 25) progressBuckets[1]++;
        else if (rate <= 50) progressBuckets[2]++;
        else if (rate <= 75) progressBuckets[3]++;
        else progressBuckets[4]++;
    });

    // Populate active learners and stats from allProgressDocs
    allProgressDocs.forEach(doc => {
        if (new Date(doc.lastAccessed || doc.updatedAt) >= startDate) {
            activeLearners++;
            const dateStr = new Date(doc.lastAccessed || doc.updatedAt).toISOString().split('T')[0];
            activityTrend[dateStr] = (activityTrend[dateStr] || 0) + 1;
        }

        totalWatchTime += (doc.watchTime || 0);

        // Lesson views
        if (doc.lessonViews) {
            const entries = doc.lessonViews instanceof Map ? Array.from(doc.lessonViews.entries()) : Object.entries(doc.lessonViews);
            entries.forEach(([lessonId, count]) => {
                const current = Number(lessonEngagementMap.get(lessonId) || 0);
                lessonEngagementMap.set(lessonId, current + Number(count || 0));
                totalLessonViews += Number(count || 0);
            });
        }
        
        // Quiz results
        if (Array.isArray(doc.quizResults)) {
            doc.quizResults.forEach(entry => {
                const score = Number(entry.score) || 0;
                const total = Number(entry.total) || 0;
                const quizId = String(entry.quizId || '');
                totalQuizAttempts++;

                if (total > 0) {
                    totalQuizScore += score;
                    totalQuizPossible += total;
                }

                if (quizId && total > 0) {
                    const current = quizStatsMap.get(quizId) || { totalScore: 0, totalPossible: 0, attempts: 0 };
                    current.totalScore += score;
                    current.totalPossible += total;
                    current.attempts++;
                    quizStatsMap.set(quizId, current);
                }
            });
        }
    });

    const completionRate = totalEnrolled ? Math.round((completedLearners / totalEnrolled) * 100) : 0;
    const avgQuizScore = totalQuizPossible ? Math.round((totalQuizScore / totalQuizPossible) * 100) : 0;
    
    // Reviews
    const reviews = Array.isArray(course.reviewEntries) ? course.reviewEntries : [];
    const totalReviews = reviews.length;
    const avgRating = totalReviews ? (reviews.reduce((acc, r) => acc + (r.rating || 0), 0) / totalReviews).toFixed(1) : 0;
    
    const reviewDistribution = {1:0, 2:0, 3:0, 4:0, 5:0};
    reviews.forEach(r => {
        if (r.rating >= 1 && r.rating <= 5) reviewDistribution[r.rating]++;
    });

    // Format top lessons
    const lessonTitleMap = buildLessonTitleMap(course);
    const topLessons = Array.from(lessonEngagementMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([lessonId, count]) => ({
            lessonId,
            title: lessonTitleMap.get(String(lessonId)) || 'Unknown Lesson',
            views: count
        }));

    // Format quiz stats
    const formattedQuizStats = Array.from(quizStatsMap.entries()).map(([quizId, stat]) => ({
        quizId,
        avgScore: stat.totalPossible ? Math.round((stat.totalScore / stat.totalPossible)*100) : 0,
        attempts: stat.attempts
    })).sort((a,b) => b.attempts - a.attempts).slice(0, 5);

    // Funnel Data
    const funnel = [
        { stage: 'Enrolled', count: totalEnrolled },
        { stage: 'Started', count: totalEnrolled - progressBuckets[0] }, // > 10%
        { stage: 'Halfway', count: progressBuckets[3] + progressBuckets[4] }, // > 50%
        { stage: 'Completed', count: completedLearners }
    ];

    // Format Trend Chart Data
    const sortDates = obj => Object.keys(obj).sort().map(k => ({ x: k, y: obj[k] }));
    const enrollmentData = sortDates(enrollmentTrend);
    const activityData = sortDates(activityTrend);

    // Student Rows for Table
    const studentRows = users.map(u => {
        const progress = progressByUser.get(String(u._id));
        const completed = progress && Array.isArray(progress.completedLessons) ? progress.completedLessons.length : 0;
        const rate = totalLessons ? Math.round((completed / totalLessons) * 100) : 0;
        
        let quizScoreAvg = 0;
        let quizAttemptCount = 0;
        if (progress && Array.isArray(progress.quizResults) && progress.quizResults.length) {
            let userTS = 0, userTP = 0;
            progress.quizResults.forEach(q => {
               userTS += (Number(q.score) || 0);
               userTP += (Number(q.total) || 0);
               quizAttemptCount++;
            });
            if (userTP > 0) quizScoreAvg = Math.round((userTS / userTP) * 100);
        }

        const userReview = reviews.find(r => String(r.user) === String(u._id));

        return {
            id: String(u._id),
            name: u.username || u.email || 'Unknown User',
            email: u.email || 'N/A',
            joinDate: u.createdAt || u._id.getTimestamp(),
            lastActive: progress ? progress.lastAccessed : null,
            progress: rate,
            completedLessonsCount: completed,
            totalLessons,
            quizAttempts: quizAttemptCount,
            quizScoreAvg,
            rating: userReview ? userReview.rating : null,
            status: rate === 100 ? 'Completed' : (rate > 0 ? 'In Progress' : 'Not Started')
        }
    });

    return {
        overview: {
            totalEnrolled,
            activeLearners,
            completedLearners,
            completionRate,
            totalLessonViews,
            totalQuizAttempts,
            avgQuizScore,
            avgRating,
            totalReviews,
            totalWatchTime: Math.round(totalWatchTime / 60000), // ms to minutes
            newLearnersCount
        },
        charts: {
            progressBuckets,
            enrollmentData,
            activityData,
            funnel,
            reviewDistribution
        },
        topLessons,
        quizStats: formattedQuizStats,
        studentRows
    };
}

async function getReflectionAnalytics(courseId, timeRange = 'all') {
    const course = await Course.findById(courseId).select('sections');
    if (!course) return { lessonsWithReflection: 0, totalSubmissions: 0, learnersSubmitted: 0, averageWordCount: 0, lessons: [] };

    const Reflection = require('../models/Reflection');
    const startDate = getDateFromRange(timeRange);

    // Find lessons with reflection enabled
    const sections = getCanonicalSections(course);
    const reflectionLessons = [];
    for (let si = 0; si < sections.length; si++) {
        const section = sections[si];
        const lessons = Array.isArray(section && section.lessons) ? section.lessons : [];
        for (let li = 0; li < lessons.length; li++) {
            const lesson = lessons[li];
            const ref = lesson && lesson.reflection;
            const enabled = ref && (
                ref.enabled === true ||
                ref.enabled === 'true' ||
                (ref.enabled === undefined && !!ref.prompt)
            );
            if (enabled) {
                reflectionLessons.push({
                    sectionIndex: si,
                    lessonIndex: li,
                    lessonId: String(lesson._id || ''),
                    sectionTitle: section.title || 'Untitled Section',
                    lessonTitle: lesson.title || 'Untitled Lesson',
                    prompt: ref.prompt || '',
                    required: Boolean(ref.required),
                    minLength: ref.minLength || 0
                });
            }
        }
    }

    if (!reflectionLessons.length) {
        return { lessonsWithReflection: 0, totalSubmissions: 0, learnersSubmitted: 0, averageWordCount: 0, lessons: [] };
    }

    // Fetch all reflections for this course
    const lessonIds = reflectionLessons.map(l => l.lessonId);
    const query = { course: courseId, lessonId: { $in: lessonIds } };
    if (timeRange !== 'all') {
        query.createdAt = { $gte: startDate };
    }

    const allSubmissions = await Reflection.find(query).lean();

    // Group submissions by lessonId
    const submissionsByLesson = {};
    for (const sub of allSubmissions) {
        const key = String(sub.lessonId);
        if (!submissionsByLesson[key]) submissionsByLesson[key] = [];
        submissionsByLesson[key].push(sub);
    }

    // Aggregate per-lesson stats
    let totalWordCount = 0;
    const uniqueLearners = new Set();
    const lessons = reflectionLessons.map(rl => {
        const subs = submissionsByLesson[rl.lessonId] || [];
        const learnerIds = new Set(subs.map(s => String(s.user)));
        const wordCountSum = subs.reduce((sum, s) => sum + (s.wordCount || 0), 0);
        const avgWc = subs.length > 0 ? Math.round(wordCountSum / subs.length) : 0;
        const latest = subs.length > 0 ? subs.reduce((max, s) => new Date(s.createdAt) > new Date(max) ? s.createdAt : max, subs[0].createdAt) : null;

        subs.forEach(s => uniqueLearners.add(String(s.user)));
        totalWordCount += wordCountSum;

        return {
            ...rl,
            submissionCount: subs.length,
            learnerCount: learnerIds.size,
            averageWordCount: avgWc,
            latestSubmissionAt: latest
        };
    });

    return {
        lessonsWithReflection: reflectionLessons.length,
        totalSubmissions: allSubmissions.length,
        learnersSubmitted: uniqueLearners.size,
        averageWordCount: allSubmissions.length > 0 ? Math.round(totalWordCount / allSubmissions.length) : 0,
        lessons
    };
}

module.exports = {
    getCourseAnalytics,
    countTotalLessons,
    buildLessonTitleMap,
    getReflectionAnalytics
};
