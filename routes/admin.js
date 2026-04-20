const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { isLoggedIn, isAdmin } = require('../middleware');
const Course = require('../models/course');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const Video = require('../models/video');
const adminAnalyticsRoutes = require('./adminAnalytics');
const {
    getCanonicalSections,
    syncCourseContent
} = require('../utils/courseContentAdapter');
const { prepareLessonForWrite, syncCourseAggregateFields } = require('../utils/courseStats');

router.use(isLoggedIn, isAdmin);
router.use('/courses/:courseId/analytics', adminAnalyticsRoutes);

async function loadEditableCourse(courseId) {
    const course = await Course.findById(courseId)
    if (!course) return null
    syncCourseContent(course)
    return course
}

async function saveEditableCourse(course) {
    console.log('[CourseEditor] canonical sections before save:', JSON.stringify(
        (course.sections || []).map((section) => ({
            id: String(section && section._id || ''),
            title: String(section && section.title || ''),
            lessons: Array.isArray(section && section.lessons)
                ? section.lessons.map((lesson) => ({
                    id: String(lesson && lesson._id || ''),
                    title: String(lesson && lesson.title || ''),
                    type: String(lesson && lesson.type || '')
                }))
                : []
        }))
    ))
    syncCourseContent(course)
    syncCourseAggregateFields(course)
    await course.save()
    console.log('[CourseEditor] canonical sections after save:', JSON.stringify(
        (course.sections || []).map((section) => ({
            id: String(section && section._id || ''),
            title: String(section && section.title || ''),
            lessons: Array.isArray(section && section.lessons)
                ? section.lessons.map((lesson) => ({
                    id: String(lesson && lesson._id || ''),
                    title: String(lesson && lesson.title || ''),
                    type: String(lesson && lesson.type || '')
                }))
                : []
        }))
    ))
    return course
}

function getCanonicalLesson(course, sectionIndex, lessonIndex) {
    return course?.sections?.[sectionIndex]?.lessons?.[lessonIndex] || null
}

function normalizeQuizAnswerPayload(question) {
    const rawAnswers = Array.isArray(question && question.answers) && question.answers.length
        ? question.answers
        : Array.isArray(question && question.options) && question.options.length
            ? question.options
            : Array.isArray(question && question.choices) && question.choices.length
                ? question.choices
                : []

    const normalized = rawAnswers
        .map((answer, index) => {
            if (typeof answer === 'string') {
                return {
                    id: `answer-${index + 1}`,
                    text: answer.trim(),
                    isCorrect: false
                }
            }

            return {
                id: String(answer && (answer.id || answer._id) || `answer-${index + 1}`),
                text: String(answer && (answer.text || answer.answer || answer.value) || '').trim(),
                isCorrect: Boolean(answer && (answer.isCorrect || answer.correct))
            }
        })
        .filter((answer) => answer.text)

    let correctIndex = normalized.findIndex((answer) => answer.isCorrect)
    if (correctIndex < 0) {
        const numericCorrectIndex = Number(
            question && (
                question.correctIndex
                ?? question.correctOptionIndex
                ?? question.correctAnswerIndex
            )
        )
        if (Number.isInteger(numericCorrectIndex) && numericCorrectIndex >= 0 && numericCorrectIndex < normalized.length) {
            correctIndex = numericCorrectIndex
        }
    }

    if (correctIndex < 0) {
        const correctAnswer = String(question && question.correctAnswer || '').trim().toLowerCase()
        if (correctAnswer) {
            const letterIndex = ['a', 'b', 'c', 'd'].indexOf(correctAnswer)
            if (letterIndex >= 0 && letterIndex < normalized.length) {
                correctIndex = letterIndex
            } else {
                correctIndex = normalized.findIndex((answer) => answer.text.trim().toLowerCase() === correctAnswer)
            }
        }
    }

    if (correctIndex >= 0) {
        normalized.forEach((answer, index) => {
            answer.isCorrect = index === correctIndex
        })
    }

    if (!normalized.length) {
        const fallbackCorrectAnswer = String(question && question.correctAnswer || '').trim()
        normalized.push({
            id: 'answer-1',
            text: fallbackCorrectAnswer || 'Option 1',
            isCorrect: true
        })
    }

    while (normalized.length < 2) {
        normalized.push({
            id: `answer-${normalized.length + 1}`,
            text: `Option ${normalized.length + 1}`,
            isCorrect: false
        })
    }

    if (!normalized.some((answer) => answer.isCorrect) && normalized[0]) {
        normalized[0].isCorrect = true
    }

    return normalized
}

function getQuizOptionPayloadSource({ answers = [], options = [], choices = [] } = {}) {
    if (Array.isArray(answers) && answers.length) return answers
    if (Array.isArray(options) && options.length) return options
    if (Array.isArray(choices) && choices.length) return choices
    return []
}

function buildCanonicalQuizQuestion(questionText, optionObjects, correctIndex) {
    const normalizedOptions = Array.isArray(optionObjects)
        ? optionObjects.map((opt) => String(opt && opt.text || opt || '').trim()).filter(Boolean)
        : []
    const safeCorrectIndex = Number.isInteger(correctIndex) ? correctIndex : 0
    const normalizedQuestionText = String(questionText || '').trim() || 'Untitled question'

    return {
        question: normalizedQuestionText,
        options: normalizedOptions,
        correctAnswer: normalizedOptions[safeCorrectIndex] || normalizedOptions[0] || ''
    }
}

function buildEditorQuizQuestionResponse(question) {
    const answers = normalizeQuizAnswerPayload(question)
    const correctAnswerObject = answers.find((answer) => answer.isCorrect)
    const correctAnswer = String(
        (question && question.correctAnswer)
        || (correctAnswerObject && correctAnswerObject.text)
        || ''
    ).trim()

    return {
        ...(question && question._id ? { _id: question._id } : {}),
        question: String(question && question.question || '').trim(),
        answers: answers.map((answer, index) => ({
            id: answer.id || `answer-${index + 1}`,
            text: answer.text,
            isCorrect: Boolean(answer.isCorrect)
        })),
        options: answers.map((answer) => ({
            text: answer.text,
            correct: Boolean(answer.isCorrect)
        })),
        correctAnswer
    }
}

function reindexCanonicalSections(course) {
    const sections = Array.isArray(course && course.sections) ? course.sections : []
    sections.forEach((section, sectionIndex) => {
        section.order = sectionIndex
        const lessons = Array.isArray(section && section.lessons) ? section.lessons : []
        lessons.forEach((lesson, lessonIndex) => {
            lesson.order = lessonIndex
        })
    })
}

function extractYouTubeId(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';

    const idPattern = /^[a-zA-Z0-9_-]{11}$/;
    if (idPattern.test(raw)) return raw;

    try {
        const parsed = new URL(raw);
        const host = String(parsed.hostname || '').toLowerCase();
        const path = String(parsed.pathname || '');

        if (host.includes('youtu.be')) {
            const token = path.replace(/^\//, '').split('/')[0];
            return token || '';
        }

        if (host.includes('youtube.com')) {
            const fromQuery = parsed.searchParams.get('v') || parsed.searchParams.get('vi');
            if (fromQuery) return fromQuery;

            const embedMatch = path.match(/^\/embed\/([^/?#]+)/i);
            if (embedMatch) return embedMatch[1];

            const shortsMatch = path.match(/^\/shorts\/([^/?#]+)/i);
            if (shortsMatch) return shortsMatch[1];
        }
    } catch {
        return '';
    }

    return '';
}

function normalizeItemType(rawType, fallbackType) {
    if (typeof rawType === 'string') {
        const value = rawType.trim().toLowerCase();
        if (value === 'lecture') return 'video';
        if (['video', 'slide', 'quiz'].includes(value)) return value;
    }
    return fallbackType;
}

function normalizeSlidesPayload(slides) {
    const source = Array.isArray(slides) ? slides : []

    return source.map((slide, index) => {
        const hasElements = Array.isArray(slide?.elements) && slide.elements.length > 0
        const fallbackText = String(slide?.text || slide?.content || '').trim()

        const rawElements = hasElements
            ? slide.elements
            : (fallbackText
                ? [{
                    id: `el-${index + 1}-1`,
                    type: 'text',
                    x: 80,
                    y: 80,
                    text: fallbackText,
                    fontSize: 28,
                    color: '#1c1d1f',
                    align: 'left',
                    bold: false
                }]
                : [])

        const normalizedElements = rawElements.map((element, elementIndex) => {
            const normalizedType = element?.type === 'image' ? 'image' : 'text'

            const normalized = {
                id: String(element?.id || `el-${index + 1}-${elementIndex + 1}`),
                type: normalizedType,
                x: Number.isFinite(Number(element?.x)) ? Number(element.x) : 0,
                y: Number.isFinite(Number(element?.y)) ? Number(element.y) : 0,
                width: Number.isFinite(Number(element?.width)) ? Number(element.width) : undefined,
                height: Number.isFinite(Number(element?.height)) ? Number(element.height) : undefined
            }

            if (normalizedType === 'text') {
                normalized.text = String(element?.text || element?.content || '').trim()
                normalized.fontSize = Number.isFinite(Number(element?.fontSize || element?.styles?.fontSize)) ? Number(element?.fontSize || element?.styles?.fontSize) : 28
                normalized.color = String(element?.color || element?.styles?.color || '#1c1d1f')

                const align = String(element?.align || element?.styles?.textAlign || 'left').toLowerCase()
                normalized.align = ['left', 'center', 'right'].includes(align) ? align : 'left'
                normalized.bold = Boolean(element?.bold || Number(element?.styles?.fontWeight) >= 600)
            } else {
                normalized.src = String(element?.src || '').trim()
            }

            return normalized
        })

        return {
            id: String(slide?.id || `slide-${index + 1}`),
            title: String(slide?.title || `Slide ${index + 1}`),
            layout: String(slide?.layout || 'left-text'),
            theme: String(slide?.theme || 'light'),
            template: String(slide?.template || ''),
            semantic: slide?.semantic && typeof slide.semantic === 'object' ? slide.semantic : undefined,
            validation: slide?.validation && typeof slide.validation === 'object' ? slide.validation : undefined,
            elements: normalizedElements
        }
    })
}

function parseTimestampToSeconds(rawValue) {
    const value = String(rawValue || '').trim()
    if (!value) return 0

    if (/^\d+$/.test(value)) {
        return Math.max(0, parseInt(value, 10))
    }

    const parts = value.split(':').map((part) => part.trim())
    if (parts.length === 2) {
        const minutes = parseInt(parts[0], 10)
        const seconds = parseInt(parts[1], 10)
        if (!Number.isNaN(minutes) && !Number.isNaN(seconds)) {
            return Math.max(0, (minutes * 60) + seconds)
        }
    }

    return 0
}

function normalizeInteractiveQuizPayload(quizzes) {
    const source = Array.isArray(quizzes) ? quizzes : []

    return source
        .map((entry, index) => {
            const options = (Array.isArray(entry && entry.options) ? entry.options : [])
                .map((opt) => String(opt || '').trim())
                .filter(Boolean)
                .slice(0, 4)

            while (options.length < 4) {
                options.push('')
            }

            const rawTime = entry && (entry.triggerTimeSec ?? entry.timestamp ?? entry.time)
            const triggerTimeSec = parseTimestampToSeconds(rawTime)
            const parsedCorrect = Number(entry && entry.correctOptionIndex)

            const normalized = {
                triggerTimeSec,
                question: String(entry && entry.question || '').trim(),
                options,
                correctOptionIndex: Number.isFinite(parsedCorrect) && parsedCorrect >= 0 && parsedCorrect <= 3 ? parsedCorrect : 0,
                explanation: String(entry && entry.explanation || '').trim(),
                pauseOnShow: entry && entry.pauseOnShow === false ? false : true,
                order: Number.isFinite(Number(entry && entry.order)) ? Number(entry.order) : index
            }

            if (entry && entry._id && mongoose.isValidObjectId(entry._id)) {
                normalized._id = entry._id
            }

            return normalized
        })
        .filter((entry) => entry.question)
        .sort((a, b) => {
            const byTime = a.triggerTimeSec - b.triggerTimeSec
            if (byTime !== 0) return byTime
            return a.order - b.order
        })
        .map((entry, index) => ({ ...entry, order: index }))
}

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

function averageQuizPercent(quizResults) {
    const results = Array.isArray(quizResults) ? quizResults : [];
    let totalScore = 0;
    let totalPossible = 0;

    results.forEach((entry) => {
        const score = Number(entry && entry.score) || 0;
        const total = Number(entry && entry.total) || 0;
        if (total > 0) {
            totalScore += score;
            totalPossible += total;
        }
    });

    if (!totalPossible) return 0;
    return Math.round((totalScore / totalPossible) * 100);
}

router.get('/', async (req, res) => {
    try {
        const courses = await Course.find({}).populate('author', 'username email');
        
        let totalEnrollments = 0;
        const totalCourses = courses.length;
        const totalUsers = await User.countDocuments();
        
        const users = await User.find({}).select('enrolledCourseIds enrolledCourses').lean();
        users.forEach(u => {
            totalEnrollments += (u.enrolledCourseIds?.length || 0) + (u.enrolledCourses?.length || 0);
        });

        res.render('admin/courseManager', { 
            courses, 
            stats: { totalCourses, totalUsers, totalEnrollments } 
        });
    } catch (err) {
        console.error("Dashboard Load Error:", err);
        res.status(500).send("Internal Server Error");
    }
});

router.get('/ai/quiz', async (req, res) => {
    res.render('admin/aiQuiz');
});

router.get('/ai/slide', async (req, res) => {
    res.render('admin/aiSlide', { courseId: req.query.courseId || '' });
});
router.get('/courses/:id/editor', async (req, res) => {

    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        return res.status(404).send('Course not found')
    }

    res.render('admin/courseEditor', { course })

})

router.get('/courses/:id/video-settings', async (req, res) => {
    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        return res.status(404).send('Course not found')
    }

    const sectionIndex = parseInt(req.query.section, 10)
    const lessonIndex = parseInt(req.query.lesson, 10)

    if (Number.isNaN(sectionIndex) || Number.isNaN(lessonIndex)) {
        return res.status(400).send('Missing section or lesson index')
    }

    const lesson = getCanonicalLesson(course, sectionIndex, lessonIndex)
    if (!lesson) {
        return res.status(404).send('Lesson not found')
    }

    const normalizedType = normalizeItemType(lesson.type, 'video')
    if (normalizedType !== 'video') {
        return res.status(400).send('Advanced video settings are only available for video lessons')
    }

    const interactiveQuizzesRaw = Array.isArray(lesson?.content?.interactiveQuizzes)
        ? lesson.content.interactiveQuizzes
        : Array.isArray(lesson?.interactiveQuizzes)
            ? lesson.interactiveQuizzes
            : []

    const interactiveQuizzes = normalizeInteractiveQuizPayload(interactiveQuizzesRaw)
    const videoUrl = String(lesson.preview || (lesson.content && lesson.content.videoUrl) || lesson.refId || '')
    const youtubeVideoId = extractYouTubeId(videoUrl)

    const videoDoc = await Video.findOneAndUpdate(
        {
            courseId: course._id,
            sectionIndex,
            lessonIndex
        },
        {
            $set: {
                title: String(lesson.title || ''),
                url: videoUrl,
                source: youtubeVideoId ? 'youtube' : 'other',
                youtubeVideoId
            },
            $setOnInsert: {
                transcripts: []
            }
        },
        {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true
        }
    )

    res.render('admin/videoSettings', {
        course,
        lesson,
        sectionIndex,
        lessonIndex,
        videoUrl,
        interactiveQuizzes,
        videoId: videoDoc ? String(videoDoc._id) : ''
    })
})

router.get('/courses/:id/analytics', async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.status(404).send('Course not found');
    }

    const courseId = course._id;
    const users = await User.find({
        $or: [
            { enrolledCourseIds: courseId },
            { enrolledCourses: courseId },
            { enrolledCourses: { $elemMatch: { courseId: courseId } } }
        ]
    });

    const progressDocs = await UserCourseProgress.find({ course: courseId }).lean();
    const progressByUser = new Map(progressDocs.map((doc) => [String(doc.user), doc]));

    const totalLessons = countTotalLessons(course);
    const completionRates = users.map((user) => {
        const progress = progressByUser.get(String(user._id));
        const completed = progress && Array.isArray(progress.completedLessons)
            ? progress.completedLessons.length
            : 0;
        return totalLessons ? Math.round((completed / totalLessons) * 100) : 0;
    });

    const totalStudents = users.length;
    const avgCompletion = completionRates.length
        ? Math.round(completionRates.reduce((a, b) => a + b, 0) / completionRates.length)
        : 0;

    let totalQuizScore = 0;
    let totalQuizPossible = 0;
    const quizBuckets = new Map();

    progressDocs.forEach((doc) => {
        (doc.quizResults || []).forEach((entry) => {
            const score = Number(entry && entry.score) || 0;
            const total = Number(entry && entry.total) || 0;
            const quizId = String(entry && entry.quizId || '');

            if (total > 0) {
                totalQuizScore += score;
                totalQuizPossible += total;
            }

            if (!quizId || total <= 0) return;
            const current = quizBuckets.get(quizId) || { totalScore: 0, totalPossible: 0 };
            current.totalScore += score;
            current.totalPossible += total;
            quizBuckets.set(quizId, current);
        });
    });

    const avgQuizScore = totalQuizPossible
        ? Math.round((totalQuizScore / totalQuizPossible) * 100)
        : 0;

    const quizLabels = Array.from(quizBuckets.keys());
    const quizAverages = quizLabels.map((key) => {
        const bucket = quizBuckets.get(key);
        if (!bucket || !bucket.totalPossible) return 0;
        return Math.round((bucket.totalScore / bucket.totalPossible) * 100);
    });

    const now = Date.now();
    const activeWindowMs = 7 * 24 * 60 * 60 * 1000;
    const activeUsers = progressDocs.filter((doc) => {
        const last = doc.lastAccessed ? new Date(doc.lastAccessed).getTime() : 0;
        return last && now - last <= activeWindowMs;
    }).length;

    const progressBuckets = [0, 0, 0, 0];
    completionRates.forEach((rate) => {
        if (rate < 25) progressBuckets[0] += 1;
        else if (rate < 50) progressBuckets[1] += 1;
        else if (rate < 75) progressBuckets[2] += 1;
        else progressBuckets[3] += 1;
    });

    const studentRows = users.map((user) => {
        const progress = progressByUser.get(String(user._id));
        const completed = progress && Array.isArray(progress.completedLessons)
            ? progress.completedLessons.length
            : 0;
        const progressRate = totalLessons ? Math.round((completed / totalLessons) * 100) : 0;
        const avgScore = averageQuizPercent(progress && progress.quizResults);
        const status = progressRate >= 80 ? 'Active' : 'At Risk';

        return {
            id: String(user._id),
            name: user.username || user.email || 'User',
            progressRate,
            avgScore,
            status
        };
    });

    const insights = [];
    if (avgCompletion < 50) insights.push('Many students are dropping early.');
    if (avgQuizScore < 50) insights.push('Quiz difficulty may be too high.');
    if (activeUsers < totalStudents * 0.3) insights.push('Low engagement detected.');

    const lessonTitleMap = buildLessonTitleMap(course);
    const lessonCounts = new Map();
    progressDocs.forEach((doc) => {
        if (!doc.lessonViews) return;
        const entries = doc.lessonViews instanceof Map
            ? Array.from(doc.lessonViews.entries())
            : Object.entries(doc.lessonViews);
        entries.forEach(([lessonId, count]) => {
            const current = Number(lessonCounts.get(lessonId) || 0);
            lessonCounts.set(lessonId, current + Number(count || 0));
        });
    });

    const topLessons = Array.from(lessonCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lessonId, count]) => ({
            lessonId,
            title: lessonTitleMap.get(String(lessonId)) || 'Lesson',
            count
        }));

    res.render('admin/course-analytics', {
        course,
        users,
        analytics: {
            totalStudents,
            avgCompletion,
            avgQuizScore,
            activeUsers,
            progressBuckets,
            quizLabels,
            quizAverages,
            studentRows,
            insights,
            topLessons
        }
    });
});

router.get('/courses/:courseId/user/:userId', async (req, res) => {
    const { courseId, userId } = req.params;

    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).send('Course not found');
    }

    const progress = await UserCourseProgress.findOne({ user: userId, course: courseId });
    const totalLessons = countTotalLessons(course);
    const completed = progress ? progress.completedLessons.length : 0;
    const quizResults = progress ? progress.quizResults : [];

    res.render('admin/user-progress', {
        course,
        progress,
        totalLessons,
        completed,
        quizResults
    });
});

router.get('/courses/:id/slide-editor', async (req, res) => {
    const course = await loadEditableCourse(req.params.id)

    if (!course) {
        return res.status(404).send('Course not found')
    }

    const sectionIndex = parseInt(req.query.section, 10)
    const lessonIndex = parseInt(req.query.lesson, 10)

    const lesson = Number.isNaN(sectionIndex) || Number.isNaN(lessonIndex)
        ? null
        : getCanonicalLesson(course, sectionIndex, lessonIndex)

    const slideData = Array.isArray(lesson?.content?.slides)
        ? lesson.content.slides
        : []

    res.render('admin/slideEditor', {
        course,
        slideData,
        sectionIndex: Number.isNaN(sectionIndex) ? '' : sectionIndex,
        lessonIndex: Number.isNaN(lessonIndex) ? '' : lessonIndex,
        lessonTitle: lesson?.title || ''
    })
})

router.put('/course/:id/slide-editor/save', async (req, res) => {
    try {
        const { sectionIndex, lessonIndex, title, content } = req.body
        console.log('[CourseEditor] slide save payload:', JSON.stringify({
            sectionIndex,
            lessonIndex,
            title,
            slideCount: Array.isArray(content && content.slides) ? content.slides.length : 0
        }))

        const parsedSectionIndex = parseInt(sectionIndex, 10)
        const parsedLessonIndex = parseInt(lessonIndex, 10)

        if (Number.isNaN(parsedSectionIndex) || Number.isNaN(parsedLessonIndex)) {
            return res.status(400).json({ success: false, error: 'Invalid sectionIndex or lessonIndex' })
        }

        const normalizedSlides = normalizeSlidesPayload(content && content.slides)

        if (!normalizedSlides.length) {
            return res.status(400).json({ success: false, error: 'Slide content missing' })
        }

        const course = await loadEditableCourse(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedLessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        lesson.type = 'slide'
        lesson.title = String(title || 'Slide Lesson').trim()
        lesson.content = { ...(lesson.content || {}), slides: normalizedSlides }
        lesson.aiGenerated = false
        await prepareLessonForWrite(lesson, { debug: true, allowDriveLookup: false })
        course.markModified('sections')

        await saveEditableCourse(course)
        console.log('[CourseEditor] canonical lesson after slide save:', JSON.stringify({
            sectionIndex: parsedSectionIndex,
            lessonIndex: parsedLessonIndex,
            lessonId: String(lesson && lesson._id || ''),
            title: lesson.title,
            slideCount: Array.isArray(lesson.content && lesson.content.slides) ? lesson.content.slides.length : 0
        }))

        return res.json({ success: true })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

// New Udemy-style course editor (3-column layout)
router.get('/courses/:id/editor-new', async (req, res) => {

    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        return res.status(404).send('Course not found')
    }

    res.render('admin/courseEditorNew', { course })

})
router.put('/course/:id/lesson/edit', async (req,res)=>{

const {sectionIndex,lessonIndex,name,url,interactiveQuizzes} = req.body
console.log('[CourseEditor] incoming lesson edit payload:', JSON.stringify({ sectionIndex, lessonIndex, name, url, interactiveQuizzesCount: Array.isArray(interactiveQuizzes) ? interactiveQuizzes.length : 0 }))

const parsedSectionIndex = parseInt(sectionIndex, 10)
const parsedLessonIndex = parseInt(lessonIndex, 10)
const normalizedInteractiveQuizzes = normalizeInteractiveQuizPayload(interactiveQuizzes)

const course = await loadEditableCourse(req.params.id)
if (!course) {
    return res.status(404).send('course not found')
}

const lesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedLessonIndex]
if (!lesson) {
    return res.status(404).send('lesson not found')
}

lesson.title = String(name || lesson.title || '').trim()
if (lesson.type === 'video') {
    lesson.videoUrl = String(url || '').trim()
    lesson.preview = String(url || '').trim()
}
lesson.interactiveQuizzes = normalizedInteractiveQuizzes
lesson.content = {
    ...(lesson.content || {}),
    ...(lesson.type === 'video' ? { videoUrl: String(url || '').trim() } : {}),
    interactiveQuizzes: normalizedInteractiveQuizzes
}

await prepareLessonForWrite(lesson, { debug: true, allowDriveLookup: true })

await saveEditableCourse(course)

res.send("updated")

})
router.delete('/course/:id/lesson/delete', async (req, res) => {

    const { sectionIndex, lessonIndex } = req.body

    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        return res.status(404).json({ success: false, error: 'Course not found' })
    }

    const parsedSectionIndex = parseInt(sectionIndex, 10)
    const parsedLessonIndex = parseInt(lessonIndex, 10)
    const lessons = course.sections?.[parsedSectionIndex]?.lessons
    if (!Array.isArray(lessons) || parsedLessonIndex < 0 || parsedLessonIndex >= lessons.length) {
        return res.status(400).json({ success: false, error: 'Invalid lesson reference' })
    }

    lessons.splice(parsedLessonIndex, 1)
    reindexCanonicalSections(course)
    await saveEditableCourse(course)

    res.json({ success: true })

})
router.put('/course/:id/lesson/add', async (req, res) => {
    try {
        const { sectionIndex, name, url, type } = req.body
        console.log('[CourseEditor] incoming add lesson payload:', JSON.stringify({ sectionIndex, name, url, type }))
        const parsedSectionIndex = parseInt(sectionIndex, 10)
        const itemType = normalizeItemType(type, 'video')

        const course = await loadEditableCourse(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const videos = course.sections?.[parsedSectionIndex]?.lessons
        if (!Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'Invalid section index' })
        }

        const newItem = {
            type: itemType,
            title: name,
            videoUrl: url,
            preview: url,
            content: itemType === 'video' ? { videoUrl: url } : {},
            order: videos.length
        }

        await prepareLessonForWrite(newItem, { debug: true, allowDriveLookup: true })

        videos.push(newItem)

        reindexCanonicalSections(course)
        await saveEditableCourse(course)

        console.log('Saved item:', newItem)

        res.json({ success: true, item: newItem })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})
router.put('/course/:id/lesson/reorder', async (req, res) => {
    try {
        const {
            sectionIndex,
            lessons,
            sourceSectionIndex,
            destSectionIndex,
            sourceIndex,
            destIndex
        } = req.body
        console.log('[CourseEditor] incoming lesson reorder payload:', JSON.stringify({
            sectionIndex,
            lessonsCount: Array.isArray(lessons) ? lessons.length : null,
            sourceSectionIndex,
            destSectionIndex,
            sourceIndex,
            destIndex
        }))

        const course = await loadEditableCourse(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        // Backward-compatible mode: replace one section list directly.
        if (Array.isArray(lessons) && sectionIndex !== undefined) {
            const parsedSectionIndex = parseInt(sectionIndex, 10)
            if (Number.isNaN(parsedSectionIndex)) {
                return res.status(400).json({ success: false, error: 'Invalid section index' })
            }

            const normalizedLessons = lessons.map((item, idx) => ({
                ...item,
                order: idx
            }))

            course.sections[parsedSectionIndex].lessons = normalizedLessons.map((item, idx) => {
                const quiz = Array.isArray(item.questions)
                    ? item.questions.map((question) => {
                        const rawOptions = Array.isArray(question && question.options)
                            ? question.options.map((opt) => {
                                if (typeof opt === 'string') return { text: opt };
                                return { text: String(opt && (opt.text || opt.answer || '')).trim(), correct: Boolean(opt && opt.correct) };
                            })
                            : Array.isArray(question && question.answers)
                                ? question.answers.map((opt) => ({ text: String(opt && (opt.text || opt.answer || opt || '')).trim(), correct: Boolean(opt && opt.correct) }))
                                : [];
                        const correctIndex = rawOptions.findIndex((opt) => Boolean(opt && opt.correct));
                        return buildCanonicalQuizQuestion(question && question.question, rawOptions, correctIndex >= 0 ? correctIndex : 0);
                    })
                    : [];

                const type = normalizeItemType(item.type, 'video')
                const content = { ...(item.content || {}) }
                if (type === 'quiz') {
                    content.questions = quiz
                }
                if (type === 'video') {
                    content.videoUrl = item.preview || item.videoUrl || content.videoUrl || ''
                }

                return {
                    ...(item && item._id ? { _id: item._id } : {}),
                    title: item.title || 'Untitled Lesson',
                    type,
                    videoUrl: item.preview || item.videoUrl || '',
                    preview: item.preview || item.videoUrl || '',
                    refId: item.refId || '',
                    content,
                    quiz,
                    interactiveQuizzes: Array.isArray(item.interactiveQuizzes) ? item.interactiveQuizzes : [],
                    order: idx
                }
            })

            for (const lesson of course.sections[parsedSectionIndex].lessons) {
                await prepareLessonForWrite(lesson, { debug: true, allowDriveLookup: true })
            }
            reindexCanonicalSections(course)
            await saveEditableCourse(course)
            return res.json({ success: true })
        }

        // Preferred mode: move one item between positions/sections.
        const fromSection = parseInt(sourceSectionIndex, 10)
        const toSection = parseInt(destSectionIndex, 10)
        const fromIndex = parseInt(sourceIndex, 10)
        const toIndex = parseInt(destIndex, 10)

        if ([fromSection, toSection, fromIndex, toIndex].some(Number.isNaN)) {
            return res.status(400).json({ success: false, error: 'Invalid reorder payload' })
        }

        const sourceVideos = course.sections?.[fromSection]?.lessons
        const destinationVideos = course.sections?.[toSection]?.lessons

        if (!Array.isArray(sourceVideos) || !Array.isArray(destinationVideos)) {
            return res.status(400).json({ success: false, error: 'Invalid section references' })
        }

        if (fromIndex < 0 || fromIndex >= sourceVideos.length) {
            return res.status(400).json({ success: false, error: 'Invalid source index' })
        }

        const [movedItem] = sourceVideos.splice(fromIndex, 1)

        if (toIndex < 0 || toIndex > destinationVideos.length) {
            return res.status(400).json({ success: false, error: 'Invalid destination index' })
        }

        destinationVideos.splice(toIndex, 0, movedItem)

        sourceVideos.forEach((item, idx) => {
            item.order = idx
        })

        if (fromSection !== toSection) {
            destinationVideos.forEach((item, idx) => {
                item.order = idx
            })
        }

        reindexCanonicalSections(course)
        await saveEditableCourse(course)

        res.json({
            success: true,
            sourceSectionIndex: fromSection,
            destSectionIndex: toSection
        })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})
router.put('/course/:id/section/edit', async (req, res) => {

    const { sectionIndex, name } = req.body

    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        return res.status(404).json({ success: false, error: 'Course not found' })
    }

    const parsedSectionIndex = parseInt(sectionIndex, 10)
    const section = course.sections?.[parsedSectionIndex]
    if (!section) {
        return res.status(400).json({ success: false, error: 'Invalid section index' })
    }

    section.title = name
    await saveEditableCourse(course)

    res.json({ success: true })

})
router.post("/course/:id/section/add", async (req, res) => {

    const { name } = req.body

    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        return res.status(404).json({ success: false, error: 'Course not found' })
    }

    course.sections.push({
        title: name,
        lessons: [],
        order: course.sections.length
    })
    reindexCanonicalSections(course)
    await saveEditableCourse(course)

    res.json({ success: true })

})
router.post("/course/:id/quiz/add", async (req, res) => {
    try {
        const { sectionIndex, name, type } = req.body
        console.log('[CourseEditor] incoming add quiz payload:', JSON.stringify({ sectionIndex, name, type }))
        const parsedSectionIndex = parseInt(sectionIndex, 10)
        const itemType = normalizeItemType(type, 'quiz')

        const course = await loadEditableCourse(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const videos = course.sections?.[parsedSectionIndex]?.lessons
        if (!Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'Invalid section index' })
        }

        const newItem = {
            type: itemType,
            title: name,
            content: { questions: [] },
            quiz: [],
            order: videos.length
        }

        await prepareLessonForWrite(newItem, { debug: true, allowDriveLookup: false })

        videos.push(newItem)

        reindexCanonicalSections(course)
        await saveEditableCourse(course)

        console.log('Saved item:', newItem)

        res.json({ success: true, item: newItem })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})

// Add slide to section
router.post("/course/:id/slide/add", async (req, res) => {
    try {
        const { sectionIndex, name, type } = req.body
        console.log('[CourseEditor] incoming add slide payload:', JSON.stringify({ sectionIndex, name, type }))
        const parsedSectionIndex = parseInt(sectionIndex, 10)
        const itemType = normalizeItemType(type, 'slide')

        const course = await loadEditableCourse(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const videos = course.sections?.[parsedSectionIndex]?.lessons
        if (!Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'Invalid section index' })
        }

        const newItem = {
            type: itemType,
            title: name,
            content: {
                slides: []
            },
            order: videos.length
        }

        await prepareLessonForWrite(newItem, { debug: true, allowDriveLookup: false })

        videos.push(newItem)

        reindexCanonicalSections(course)
        await saveEditableCourse(course)

        console.log('Saved item:', newItem)

        res.json({ success: true, item: newItem })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})

// Get lesson data
router.get('/course/:id/lesson/:sectionIndex/:lessonIndex', async (req, res) => {
    try {
        const { sectionIndex, lessonIndex } = req.params
        const course = await loadEditableCourse(req.params.id)
        
        if (!course) {
            return res.json({ success: false, error: 'Course not found' })
        }
        
        const lesson = getCanonicalLesson(course, Number(sectionIndex), Number(lessonIndex))
        
        if (!lesson) {
            return res.json({ success: false, error: 'Lesson not found' })
        }

        console.log('RAW LESSON FROM API:', lesson)
        res.json({ success: true, lesson })
    } catch (err) {
        res.json({ success: false, error: err.message })
    }
})

router.get('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes', async (req, res) => {
    try {
        const { sectionIndex, lessonIndex } = req.params
        const course = await loadEditableCourse(req.params.id)

        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = getCanonicalLesson(course, Number(sectionIndex), Number(lessonIndex))
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        const fromContent = Array.isArray(lesson?.content?.interactiveQuizzes) ? lesson.content.interactiveQuizzes : []
        const fromRoot = Array.isArray(lesson?.interactiveQuizzes) ? lesson.interactiveQuizzes : []
        const interactiveQuizzes = normalizeInteractiveQuizPayload(fromContent.length ? fromContent : fromRoot)

        return res.json({ success: true, interactiveQuizzes })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.put('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes', async (req, res) => {
    try {
        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const interactiveQuizzes = normalizeInteractiveQuizPayload(req.body && req.body.interactiveQuizzes)

        const course = await loadEditableCourse(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedLessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        lesson.interactiveQuizzes = interactiveQuizzes
        lesson.content = { ...(lesson.content || {}), interactiveQuizzes }
        await saveEditableCourse(course)

        return res.json({ success: true, interactiveQuizzes })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.post('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes', async (req, res) => {
    try {
        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const course = await loadEditableCourse(req.params.id)

        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedLessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        const existing = Array.isArray(lesson.content?.interactiveQuizzes)
            ? lesson.content.interactiveQuizzes
            : Array.isArray(lesson.interactiveQuizzes)
                ? lesson.interactiveQuizzes
                : []

        const appended = normalizeInteractiveQuizPayload([...(existing || []), req.body || {}])
        lesson.interactiveQuizzes = appended
        lesson.content = lesson.content || {}
        lesson.content.interactiveQuizzes = appended

        await saveEditableCourse(course)
        return res.json({ success: true, interactiveQuizzes: appended })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.patch('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes/reorder', async (req, res) => {
    try {
        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const orderedIds = Array.isArray(req.body && req.body.orderedIds)
            ? req.body.orderedIds.map((id) => String(id))
            : []

        const course = await loadEditableCourse(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedLessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        const current = Array.isArray(lesson.content?.interactiveQuizzes)
            ? lesson.content.interactiveQuizzes
            : Array.isArray(lesson.interactiveQuizzes)
                ? lesson.interactiveQuizzes
                : []

        const byId = new Map((current || []).map((entry) => [String(entry && entry._id), entry]))
        const reordered = []

        orderedIds.forEach((id) => {
            if (byId.has(id)) reordered.push(byId.get(id))
        })

        current.forEach((entry) => {
            if (!reordered.includes(entry)) reordered.push(entry)
        })

        const normalized = normalizeInteractiveQuizPayload(reordered)
        lesson.interactiveQuizzes = normalized
        lesson.content = lesson.content || {}
        lesson.content.interactiveQuizzes = normalized

        await saveEditableCourse(course)
        return res.json({ success: true, interactiveQuizzes: normalized })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.delete('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes/:quizId', async (req, res) => {
    try {
        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const quizId = String(req.params.quizId)

        const course = await loadEditableCourse(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedLessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        const current = Array.isArray(lesson.content?.interactiveQuizzes)
            ? lesson.content.interactiveQuizzes
            : Array.isArray(lesson.interactiveQuizzes)
                ? lesson.interactiveQuizzes
                : []

        const filtered = current.filter((entry) => String(entry && entry._id) !== quizId)
        const normalized = normalizeInteractiveQuizPayload(filtered)

        lesson.interactiveQuizzes = normalized
        lesson.content = lesson.content || {}
        lesson.content.interactiveQuizzes = normalized

        await saveEditableCourse(course)
        return res.json({ success: true, interactiveQuizzes: normalized })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.get(
    "/course/:courseId/quiz/:sectionIndex/:quizIndex",
    async (req, res) => {

        const { courseId, sectionIndex, quizIndex } = req.params

        const course = await loadEditableCourse(courseId)
        if (!course) {
            return res.status(404).send('Course not found')
        }

        const quiz = getCanonicalLesson(course, Number(sectionIndex), Number(quizIndex))
        const quizForEditor = quiz
            ? {
                ...quiz,
                questions: (
                    Array.isArray(quiz.quiz)
                        ? quiz.quiz
                        : Array.isArray(quiz.questions)
                            ? quiz.questions
                            : Array.isArray(quiz.content && quiz.content.questions)
                                ? quiz.content.questions
                                : []
                ).map((question) => buildEditorQuizQuestionResponse(question))
            }
            : null
        console.log('[CourseEditor] quiz lesson payload returned to editor:', JSON.stringify({
            sectionIndex,
            quizIndex,
            questionCount: Array.isArray(quizForEditor && quizForEditor.questions) ? quizForEditor.questions.length : 0,
            title: quizForEditor && quizForEditor.title,
            answersPerQuestion: Array.isArray(quizForEditor && quizForEditor.questions)
                ? quizForEditor.questions.map((question) => Array.isArray(question.answers) ? question.answers.length : 0)
                : []
        }))

        res.render("admin/quizEditor", {
            course,
            quiz: quizForEditor,
            sectionIndex,
            quizIndex
        })

    })
router.post(
    "/course/:courseId/quiz/question/add",
    async (req, res) => {
        try {
            const { courseId } = req.params
            const {
                sectionIndex,
                quizIndex,
                question = "",
                answers = [],
                choices = [],
                options = [],
                correct,
                correctIndex
            } = req.body
            console.log('[CourseEditor] quiz save payload:', JSON.stringify({
                mode: 'add',
                sectionIndex,
                quizIndex,
                question,
                answersCount: Array.isArray(answers) ? answers.length : 0,
                optionsCount: Array.isArray(options) ? options.length : 0,
                choicesCount: Array.isArray(choices) ? choices.length : 0,
                correctIndex,
                correct
            }))

            const parsedSectionIndex = parseInt(sectionIndex, 10)
            const parsedQuizIndex = parseInt(quizIndex, 10)

            if (Number.isNaN(parsedSectionIndex) || Number.isNaN(parsedQuizIndex)) {
                return res.status(400).json({ success: false, error: "Invalid sectionIndex or quizIndex" })
            }

            const normalizedQuestion = String(question).trim() || 'Untitled question'
            const normalizedOptions = getQuizOptionPayloadSource({ answers, options, choices })
                .map(opt => {
                    if (typeof opt === 'string') return { text: opt.trim(), correct: false }
                    if (opt && typeof opt === 'object') {
                        return {
                            text: String(opt.text || opt.answer || opt.value || '').trim(),
                            correct: Boolean(opt.correct || opt.isCorrect)
                        }
                    }
                    return { text: '', correct: false }
                })
                .filter(opt => opt.text.length > 0)

            const fallbackCorrectIndex = parseInt(correct, 10)
            const parsedCorrectIndex = parseInt(correctIndex, 10)
            const finalCorrectIndex = Number.isNaN(parsedCorrectIndex) ? fallbackCorrectIndex : parsedCorrectIndex

            if (normalizedOptions.length < 2) {
                return res.status(400).json({ success: false, error: "At least 2 options are required" })
            }

            if (Number.isNaN(finalCorrectIndex) || finalCorrectIndex < 0 || finalCorrectIndex >= normalizedOptions.length) {
                return res.status(400).json({ success: false, error: "A valid correct answer must be selected" })
            }

            const optionObjects = normalizedOptions.map((opt, i) => ({
                text: opt.text,
                correct: i === finalCorrectIndex
            }))

            const course = await loadEditableCourse(courseId)
            if (!course) {
                return res.status(404).json({ success: false, error: 'Course not found' })
            }

            const quizLesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedQuizIndex]
            if (!quizLesson) {
                return res.status(404).json({ success: false, error: 'Quiz not found' })
            }

            const questions = Array.isArray(quizLesson.quiz) ? quizLesson.quiz : []
            const nextQuestion = buildCanonicalQuizQuestion(normalizedQuestion, optionObjects, finalCorrectIndex)
            questions.push(nextQuestion)
            quizLesson.quiz = questions
            quizLesson.content = { ...(quizLesson.content || {}), questions }
            course.markModified('sections')

            await saveEditableCourse(course)
            const questionIndex = questions.length - 1
            console.log('[CourseEditor] quiz payload after backend normalization:', JSON.stringify({
                mode: 'add',
                questionIndex,
                question: buildEditorQuizQuestionResponse(questions[questionIndex])
            }))

            res.json({
                success: true,
                questionIndex,
                question: buildEditorQuizQuestionResponse(questions[questionIndex])
            })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })
router.put(
    "/course/:courseId/quiz/question/update",
    async (req, res) => {
        try {
            const { courseId } = req.params
            const {
                sectionIndex,
                quizIndex,
                questionIndex,
                question = "",
                answers = [],
                choices = [],
                options = [],
                correctIndex
            } = req.body
            console.log('[CourseEditor] quiz save payload:', JSON.stringify({
                mode: 'update',
                sectionIndex,
                quizIndex,
                questionIndex,
                question,
                answersCount: Array.isArray(answers) ? answers.length : 0,
                optionsCount: Array.isArray(options) ? options.length : 0,
                choicesCount: Array.isArray(choices) ? choices.length : 0,
                correctIndex
            }))

            const parsedSectionIndex = parseInt(sectionIndex, 10)
            const parsedQuizIndex = parseInt(quizIndex, 10)
            const parsedQuestionIndex = parseInt(questionIndex, 10)
            const parsedCorrectIndex = parseInt(correctIndex, 10)

            if (
                Number.isNaN(parsedSectionIndex) ||
                Number.isNaN(parsedQuizIndex) ||
                Number.isNaN(parsedQuestionIndex)
            ) {
                return res.status(400).json({ success: false, error: "Invalid indexes" })
            }

            const normalizedQuestion = String(question).trim()
            const normalizedOptions = getQuizOptionPayloadSource({ answers, options, choices })
                .map(opt => {
                    if (typeof opt === 'string') return { text: opt.trim(), correct: false }
                    if (opt && typeof opt === 'object') {
                        return {
                            text: String(opt.text || opt.answer || opt.value || '').trim(),
                            correct: Boolean(opt.correct || opt.isCorrect)
                        }
                    }
                    return { text: '', correct: false }
                })
                .filter(opt => opt.text.length > 0)

            if (!normalizedQuestion) {
                return res.status(400).json({ success: false, error: "Question cannot be empty" })
            }

            if (normalizedOptions.length < 2) {
                return res.status(400).json({ success: false, error: "At least 2 options are required" })
            }

            if (Number.isNaN(parsedCorrectIndex) || parsedCorrectIndex < 0 || parsedCorrectIndex >= normalizedOptions.length) {
                return res.status(400).json({ success: false, error: "A valid correct answer must be selected" })
            }

            const optionObjects = normalizedOptions.map((opt, i) => ({
                text: opt.text,
                correct: i === parsedCorrectIndex
            }))

            const course = await loadEditableCourse(courseId)
            if (!course) {
                return res.status(404).json({ success: false, error: 'Course not found' })
            }

            const quizLesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedQuizIndex]
            const questions = Array.isArray(quizLesson && quizLesson.quiz) ? quizLesson.quiz : []
            if (!questions[parsedQuestionIndex]) {
                return res.status(400).json({ success: false, error: 'Question index out of range' })
            }

            questions[parsedQuestionIndex] = {
                ...(questions[parsedQuestionIndex] || {}),
                ...buildCanonicalQuizQuestion(normalizedQuestion, optionObjects, parsedCorrectIndex)
            }
            quizLesson.quiz = questions
            quizLesson.content = { ...(quizLesson.content || {}), questions }
            course.markModified('sections')
            await saveEditableCourse(course)
            console.log('[CourseEditor] quiz payload after backend normalization:', JSON.stringify({
                mode: 'update',
                questionIndex: parsedQuestionIndex,
                question: buildEditorQuizQuestionResponse(questions[parsedQuestionIndex])
            }))

            res.json({ success: true })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })
router.delete(
    "/course/:courseId/quiz/question/delete",
    async (req, res) => {
        try {
            const { courseId } = req.params
            const { sectionIndex, quizIndex, questionIndex } = req.body

            const parsedSectionIndex = parseInt(sectionIndex, 10)
            const parsedQuizIndex = parseInt(quizIndex, 10)
            const parsedQuestionIndex = parseInt(questionIndex, 10)

            if (
                Number.isNaN(parsedSectionIndex) ||
                Number.isNaN(parsedQuizIndex) ||
                Number.isNaN(parsedQuestionIndex)
            ) {
                return res.status(400).json({ success: false, error: "Invalid indexes" })
            }

            const course = await loadEditableCourse(courseId)
            if (!course) {
                return res.status(404).json({ success: false, error: 'Course not found' })
            }

            const quizLesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedQuizIndex]
            const questions = Array.isArray(quizLesson && quizLesson.quiz) ? quizLesson.quiz : []

            if (parsedQuestionIndex < 0 || parsedQuestionIndex >= questions.length) {
                return res.status(400).json({ success: false, error: "Question index out of range" })
            }

            questions.splice(parsedQuestionIndex, 1)

            quizLesson.quiz = questions
            quizLesson.content = { ...(quizLesson.content || {}), questions }
            course.markModified('sections')
            await saveEditableCourse(course)

            res.json({ success: true })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })
router.put(
    "/course/:courseId/quiz/question/reorder",
    async (req, res) => {
        try {
            const { courseId } = req.params
            const { sectionIndex, quizIndex, order } = req.body

            const parsedSectionIndex = parseInt(sectionIndex, 10)
            const parsedQuizIndex = parseInt(quizIndex, 10)

            if (Number.isNaN(parsedSectionIndex) || Number.isNaN(parsedQuizIndex)) {
                return res.status(400).json({ success: false, error: "Invalid sectionIndex or quizIndex" })
            }

            const course = await loadEditableCourse(courseId)
            if (!course) {
                return res.status(404).json({ success: false, error: 'Course not found' })
            }

            let questions =
                course.sections[parsedSectionIndex]
                    .lessons[parsedQuizIndex]
                    .quiz

            const normalizedOrder = (Array.isArray(order) ? order : []).map(i => parseInt(i, 10))
            const isValidOrder =
                normalizedOrder.length === questions.length &&
                normalizedOrder.every(i => !Number.isNaN(i) && i >= 0 && i < questions.length)

            if (!isValidOrder) {
                return res.status(400).json({ success: false, error: "Invalid question order" })
            }

            questions =
                normalizedOrder.map(i => questions[i])

            course.sections[parsedSectionIndex]
                .lessons[parsedQuizIndex]
                .quiz = questions
            course.sections[parsedSectionIndex]
                .lessons[parsedQuizIndex]
                .content = {
                    ...(course.sections[parsedSectionIndex].lessons[parsedQuizIndex].content || {}),
                    questions
                }
            course.markModified('sections')

            await saveEditableCourse(course)

            res.json({ success: true })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })
router.get(
    "/course/:courseId/quiz/:sectionIndex/:quizIndex",
    async (req, res) => {

        const { courseId, sectionIndex, quizIndex } = req.params

        const course = await loadEditableCourse(courseId)
        if (!course) {
            return res.status(404).send('Course not found')
        }

        const quiz = getCanonicalLesson(course, Number(sectionIndex), Number(quizIndex))

        res.render("quizPlayer", { quiz })

    })

// ==================== SLIDES MANAGEMENT ====================

// Add slides to a lesson
router.put('/course/:id/lesson/slides/add', async (req, res) => {
    const { sectionIndex, lessonIndex, slides, content } = req.body

    const normalizedSlides = normalizeSlidesPayload(
        Array.isArray(slides) ? slides : (content && content.slides)
    )

    if (!normalizedSlides.length) {
        return res.status(400).json({ success: false, error: 'Slide content missing' })
    }

    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        return res.status(404).json({ success: false, error: 'Course not found' })
    }

    const lesson = course.sections?.[Number(sectionIndex)]?.lessons?.[Number(lessonIndex)]
    if (!lesson) {
        return res.status(404).json({ success: false, error: 'Lesson not found' })
    }

    lesson.content = { ...(lesson.content || {}), slides: normalizedSlides }
    lesson.aiGenerated = true
    course.markModified('sections')
    await saveEditableCourse(course)

    res.json({ success: true })
})

// Update a single slide
router.put('/course/:id/lesson/slides/update', async (req, res) => {
    const { sectionIndex, lessonIndex, slideIndex, title, content } = req.body

    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        return res.status(404).json({ success: false, error: 'Course not found' })
    }

    const lesson = course.sections?.[Number(sectionIndex)]?.lessons?.[Number(lessonIndex)]
    const slides = Array.isArray(lesson && lesson.content && lesson.content.slides) ? lesson.content.slides : []
    if (!lesson || !slides[slideIndex]) {
        return res.status(404).json({ success: false, error: 'Slide not found' })
    }

    slides[slideIndex].title = title
    slides[slideIndex].content = content
    lesson.content = { ...(lesson.content || {}), slides }
    course.markModified('sections')
    await saveEditableCourse(course)

    res.json({ success: true })
})

// Delete all slides from a lesson
router.put('/course/:id/lesson/slides/delete', async (req, res) => {
    const { sectionIndex, lessonIndex } = req.body

    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        return res.status(404).json({ success: false, error: 'Course not found' })
    }

    const lesson = course.sections?.[Number(sectionIndex)]?.lessons?.[Number(lessonIndex)]
    if (!lesson) {
        return res.status(404).json({ success: false, error: 'Lesson not found' })
    }

    lesson.content = { ...(lesson.content || {}), slides: [] }
    lesson.aiGenerated = false
    course.markModified('sections')
    await saveEditableCourse(course)

    res.json({ success: true })
})


module.exports = router
