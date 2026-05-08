const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const http = require('http');
const https = require('https');
const path = require('path');
const { isLoggedIn, isAdmin } = require('../middleware');
const Course = require('../models/course');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const Video = require('../models/video');
const adminAnalyticsRoutes = require('./adminAnalytics');
const { adminActionLimiter } = require('../utils/rateLimiters')
const { logAuditEvent } = require('../utils/auditLogger')
const { getEffectiveCourseStatus, computeCourseReadiness, setCourseStatus, buildCourseStatusBadge } = require('../utils/courseLifecycle')
const { previewYoutubeImport, buildCourseSectionsFromPreview } = require('../services/youtube/youtubeCourseImportService')
const {
    getCanonicalSections,
    syncCourseContent
} = require('../utils/courseContentAdapter');
const { prepareLessonForWrite, syncCourseAggregateFields } = require('../utils/courseStats');
const {
    cloudinary,
    pdfFileFilter,
    getPdfUploadOptions,
    MAX_PDF_UPLOAD_BYTES
} = require('../config/cloudinary');
const {
    normalizeStoredPdfUrl,
    isPublicCloudinaryRawUploadUrl,
    isLikelyRestrictedCloudinaryPdfUrl,
    getUploadedCloudinaryPdfUrl,
    buildPdfDeliveryErrorMessage
} = require('../utils/cloudinaryPdf');
const { getLessonContentMode, hasCustomSlides } = require('../utils/lessonContentMode');

router.use(isLoggedIn, isAdmin);
router.use('/courses/:courseId/analytics', adminAnalyticsRoutes);
router.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase())) {
        return adminActionLimiter(req, res, next)
    }
    return next()
})

const slidePdfUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_UPLOAD_BYTES },
    fileFilter: pdfFileFilter
})

async function recordAdminAudit(req, action, targetType, targetId, metadata) {
    await logAuditEvent({
        req,
        action,
        targetType,
        targetId,
        metadata
    })
}

function matchesStatusFilter(course, statusFilter) {
    if (!statusFilter || statusFilter === 'all') return true
    return getEffectiveCourseStatus(course) === statusFilter
}

function normalizeImportedPreviewSections(sections) {
    return (Array.isArray(sections) ? sections : [])
        .map((section, sectionIndex) => ({
            title: String(section && section.title || '').trim() || `Section ${sectionIndex + 1}`,
            description: String(section && section.description || '').trim(),
            videos: (Array.isArray(section && section.videos) ? section.videos : [])
                .map((video) => ({
                    title: String(video && video.title || '').trim(),
                    videoId: String(video && video.videoId || '').trim(),
                    url: String(video && video.url || '').trim(),
                    thumbnail: String(video && video.thumbnail || '').trim(),
                    durationSeconds: Number.isFinite(Number(video && video.durationSeconds)) ? Number(video.durationSeconds) : null,
                    durationFormatted: String(video && video.durationFormatted || '').trim()
                }))
                .filter((video) => video.title && video.videoId && video.url)
        }))
        .filter((section) => Array.isArray(section.videos) && section.videos.length > 0)
}

router.post('/youtube/import/preview', async (req, res) => {
    try {
        const playlistUrl = String(req.body && req.body.playlistUrl || '').trim()
        if (!playlistUrl) {
            return res.status(400).json({ success: false, error: 'Playlist URL is required.' })
        }

        const preview = await previewYoutubeImport({
            playlistUrl,
            userId: req.user && req.user._id,
            options: {
                courseTitle: req.body && req.body.courseTitle,
                topic: req.body && req.body.topic
            }
        })

        return res.json({ success: true, preview })
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            error: error.publicMessage || error.message || 'Failed to import YouTube playlist.'
        })
    }
})

router.post('/youtube/import/apply', async (req, res) => {
    try {
        const courseId = String(req.body && req.body.courseId || '').trim()
        if (!courseId) {
            return res.status(400).json({ success: false, error: 'Course id is required.' })
        }

        const course = await loadEditableCourse(courseId)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found.' })
        }

        const previewSections = normalizeImportedPreviewSections(req.body && req.body.sections)
        if (!previewSections.length) {
            return res.status(400).json({ success: false, error: 'No playlist sections were provided.' })
        }

        const mappedSections = buildCourseSectionsFromPreview(previewSections)
        for (const section of mappedSections) {
            for (const lesson of section.lessons) {
                await prepareLessonForWrite(lesson, { debug: false, allowDriveLookup: false })
            }
        }

        course.sections = Array.isArray(course.sections) ? course.sections.concat(mappedSections) : mappedSections
        reindexCanonicalSections(course)
        await saveEditableCourse(course)
        await recordAdminAudit(req, 'youtube_playlist_imported', 'course', String(course._id), {
            playlistTitle: String(req.body && req.body.playlistTitle || '').trim(),
            sectionCount: mappedSections.length,
            lessonCount: mappedSections.reduce((sum, section) => sum + section.lessons.length, 0)
        })

        return res.json({ success: true, courseId: String(course._id) })
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            error: error.publicMessage || error.message || 'Failed to apply playlist import.'
        })
    }
})

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

function findQuizQuestionIndex(questions, questionIndex, questionId) {
    const source = Array.isArray(questions) ? questions : []
    const id = String(questionId || '').trim()
    if (id) {
        const byId = source.findIndex((question) => String(question && question._id || '') === id)
        if (byId >= 0) return byId
    }

    const parsedQuestionIndex = parseInt(questionIndex, 10)
    if (!Number.isNaN(parsedQuestionIndex)) return parsedQuestionIndex
    return -1
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

function sanitizeUploadFilename(name, fallbackBaseName) {
    const trimmed = String(name || '').trim()
    const parsed = path.parse(trimmed)
    const baseName = (parsed.name || fallbackBaseName || 'document')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 120) || (fallbackBaseName || 'document')
    return `${baseName}.pdf`
}

function fetchUrlStatus(url, redirects = 0) {
    return new Promise((resolve) => {
        const target = normalizeStoredPdfUrl(url)
        if (!target) {
            return resolve({ status: 0, finalUrl: '' })
        }

        let parsed
        try {
            parsed = new URL(target)
        } catch {
            return resolve({ status: 0, finalUrl: target })
        }

        const client = parsed.protocol === 'http:' ? http : https
        const req = client.request(parsed, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'edumy-pdf-health-check/1.0'
            }
        }, (response) => {
            const status = Number(response && response.statusCode) || 0
            const location = response && response.headers ? response.headers.location : ''

            if ([301, 302, 303, 307, 308].includes(status) && location && redirects < 3) {
                response.resume()
                let nextUrl = ''
                try {
                    nextUrl = new URL(location, target).toString()
                } catch {
                    nextUrl = ''
                }

                if (!nextUrl) {
                    return resolve({ status, finalUrl: target })
                }

                return fetchUrlStatus(nextUrl, redirects + 1).then(resolve)
            }

            response.resume()
            return resolve({ status, finalUrl: target })
        })

        req.on('error', () => resolve({ status: 0, finalUrl: target }))
        req.setTimeout(8000, () => req.destroy(new Error('timeout')))
        req.end()
    })
}

function uploadPdfBufferToCloudinary(file, folder) {
    return new Promise((resolve, reject) => {
        const publicId = path.parse(String(file && file.originalname || 'document.pdf')).name
            .replace(/[^a-zA-Z0-9_-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 120) || `pdf-${Date.now()}`

        const stream = cloudinary.uploader.upload_stream(
            getPdfUploadOptions({
                folder,
                publicId
            }),
            (error, result) => {
                if (error) return reject(error)
                return resolve(result)
            }
        )

        stream.end(file.buffer)
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
                clientId: String(entry && entry.clientId || '').trim(),
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
        const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
        const courses = await Course.find({}).populate('author', 'username email');
        
        let totalEnrollments = 0;
        const visibleCourses = courses.filter((course) => matchesStatusFilter(course, statusFilter));
        const totalCourses = courses.length;
        const totalUsers = await User.countDocuments();
        
        const users = await User.find({}).select('enrolledCourseIds enrolledCourses').lean();
        users.forEach(u => {
            totalEnrollments += (u.enrolledCourseIds?.length || 0) + (u.enrolledCourses?.length || 0);
        });

        const coursesWithStatus = visibleCourses.map((course) => ({
            ...course.toObject(),
            statusBadge: buildCourseStatusBadge(course),
            readiness: computeCourseReadiness(course)
        }));

        res.render('admin/courseManager', { 
            courses: coursesWithStatus, 
            stats: { totalCourses, totalUsers, totalEnrollments },
            statusFilter
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

    res.render('admin/courseEditor', {
        course,
        statusBadge: buildCourseStatusBadge(course),
        readiness: computeCourseReadiness(course),
        getLessonContentMode
    })

})

router.post('/courses/:id/publish', async (req, res) => {
    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        req.flash('error', 'Course not found')
        return res.redirect('/admin')
    }

    const readiness = computeCourseReadiness(course)
    setCourseStatus(course, 'published')
    await course.save()
    await recordAdminAudit(req, 'course_published', 'course', String(course._id), {
        title: course.title,
        isPublishReady: readiness.isPublishReady
    })

    req.flash(readiness.isPublishReady ? 'success' : 'error', readiness.isPublishReady
        ? 'Course published successfully.'
        : 'Course published, but the readiness checklist still has incomplete items.')
    res.redirect(req.get('Referrer') || '/admin')
})

router.post('/courses/:id/unpublish', async (req, res) => {
    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        req.flash('error', 'Course not found')
        return res.redirect('/admin')
    }

    setCourseStatus(course, 'draft', { unpublishedReason: 'Unpublished from admin' })
    await course.save()
    await recordAdminAudit(req, 'course_unpublished', 'course', String(course._id), {
        title: course.title
    })

    req.flash('success', 'Course moved back to draft.')
    res.redirect(req.get('Referrer') || '/admin')
})

router.post('/courses/:id/archive', async (req, res) => {
    const course = await loadEditableCourse(req.params.id)
    if (!course) {
        req.flash('error', 'Course not found')
        return res.redirect('/admin')
    }

    setCourseStatus(course, 'archived')
    await course.save()
    await recordAdminAudit(req, 'course_archived', 'course', String(course._id), {
        title: course.title
    })

    req.flash('success', 'Course archived.')
    res.redirect(req.get('Referrer') || '/admin')
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
        : Array.isArray(lesson?.slides)
            ? lesson.slides
            : []
    const rawPdfData = lesson?.content?.pdf || lesson?.pdf
    const pdfData = rawPdfData && typeof rawPdfData === 'object'
        ? rawPdfData
        : typeof rawPdfData === 'string' && rawPdfData.trim()
            ? { url: rawPdfData.trim(), originalName: 'PDF document', mimeType: 'application/pdf' }
        : null

    res.render('admin/slideEditor', {
        course,
        slideData,
        pdfData,
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
        const pdf = content && content.pdf && typeof content.pdf === 'object'
            ? {
                url: normalizeStoredPdfUrl(content.pdf.url),
                filename: String(content.pdf.filename || '').trim(),
                originalName: String(content.pdf.originalName || '').trim(),
                size: Number(content.pdf.size) || 0,
                mimeType: String(content.pdf.mimeType || '').trim() || 'application/pdf',
                uploadedAt: content.pdf.uploadedAt ? new Date(content.pdf.uploadedAt) : new Date()
            }
            : null

        if (!normalizedSlides.length && !(pdf && pdf.url)) {
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
        lesson.content = {
            ...(lesson.content || {}),
            slides: normalizedSlides,
            ...(pdf && pdf.url ? { pdf } : {})
        }
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
        await recordAdminAudit(req, 'slide_deck_saved', 'lesson', String(lesson && lesson._id || ''), {
            courseId: String(course._id),
            title: lesson.title,
            slideCount: Array.isArray(lesson.content && lesson.content.slides) ? lesson.content.slides.length : 0
        })

        return res.json({ success: true })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.post('/slides/:courseId/:sectionIndex/:lessonIndex/import-pdf', (req, res, next) => {
    slidePdfUpload.single('pdf')(req, res, function(uploadError) {
        if (uploadError) {
            const isSizeError = uploadError && uploadError.code === 'LIMIT_FILE_SIZE'
            return res.status(400).json({
                success: false,
                error: isSizeError
                    ? 'PDF file is too large. Maximum size is 20MB.'
                    : (uploadError.message || 'Failed to upload PDF.')
            })
        }
        return next()
    })
}, async (req, res) => {
    try {
        const course = await loadEditableCourse(req.params.courseId)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found.' })
        }

        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        if (Number.isNaN(parsedSectionIndex) || Number.isNaN(parsedLessonIndex)) {
            return res.status(400).json({ success: false, error: 'Invalid lesson reference.' })
        }

        const lesson = getCanonicalLesson(course, parsedSectionIndex, parsedLessonIndex)
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found.' })
        }

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ success: false, error: 'PDF file is required.' })
        }

        const uploadResult = await uploadPdfBufferToCloudinary(req.file, 'CourseLessonPdfs')
        const deliveryUrl = getUploadedCloudinaryPdfUrl(uploadResult)
        if (process.env.NODE_ENV !== 'production') {
            console.log('[SlideEditor] Cloudinary PDF secure_url:', deliveryUrl || '(missing)')
        }

        if (!deliveryUrl || !isPublicCloudinaryRawUploadUrl(deliveryUrl)) {
            if (uploadResult && uploadResult.public_id) {
                try {
                    await cloudinary.uploader.destroy(String(uploadResult.public_id), {
                        resource_type: 'raw',
                        type: 'upload',
                        invalidate: true
                    })
                } catch {
                    // Non-fatal cleanup failure
                }
            }

            return res.status(502).json({
                success: false,
                code: 'PDF_URL_INVALID',
                error: 'Cloudinary did not return a public raw upload secure_url for this PDF.'
            })
        }

        const deliveryStatus = await fetchUrlStatus(deliveryUrl)
        if (deliveryStatus.status !== 200) {
            if (uploadResult && uploadResult.public_id) {
                try {
                    await cloudinary.uploader.destroy(String(uploadResult.public_id), {
                        resource_type: 'raw',
                        type: 'upload',
                        invalidate: true
                    })
                } catch {
                    // Non-fatal cleanup failure
                }
            }

            return res.status(502).json({
                success: false,
                code: deliveryStatus.status === 401 || deliveryStatus.status === 403 ? 'PDF_NOT_PUBLIC' : 'PDF_DELIVERY_CHECK_FAILED',
                error: buildPdfDeliveryErrorMessage(deliveryStatus.status),
                deliveryStatus: deliveryStatus.status
            })
        }

        const originalName = sanitizeUploadFilename(req.file.originalname, 'lesson-document')
        const pdf = {
            url: deliveryUrl,
            filename: String(uploadResult && (uploadResult.public_id || uploadResult.asset_id) || '').trim(),
            originalName,
            size: Number(req.file.size) || 0,
            mimeType: 'application/pdf',
            uploadedAt: new Date()
        }

        lesson.type = 'slide'
        lesson.content = {
            ...(lesson.content || {}),
            pdf
        }

        if (!String(lesson.title || '').trim()) {
            lesson.title = path.parse(originalName).name
        }

        await prepareLessonForWrite(lesson, { debug: true, allowDriveLookup: false })
        course.markModified('sections')
        await saveEditableCourse(course)
        await recordAdminAudit(req, 'lesson_pdf_imported', 'lesson', String(lesson && lesson._id || ''), {
            courseId: String(course._id),
            title: lesson.title,
            originalName,
            size: pdf.size
        })

        return res.json({ success: true, pdf })
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to import PDF.'
        })
    }
})

router.get('/slides/:courseId/:sectionIndex/:lessonIndex/pdf-health', async (req, res) => {
    try {
        const course = await loadEditableCourse(req.params.courseId)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found.' })
        }

        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const lesson = getCanonicalLesson(course, parsedSectionIndex, parsedLessonIndex)
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found.' })
        }

        const pdf = lesson.content && lesson.content.pdf && typeof lesson.content.pdf === 'object'
            ? lesson.content.pdf
            : null

        const url = normalizeStoredPdfUrl(pdf && pdf.url)
        if (!url) {
            return res.status(404).json({ success: false, error: 'PDF URL not found for this lesson.' })
        }

        const statusResult = await fetchUrlStatus(url)
        const status = Number(statusResult.status) || 0
        const ok = status === 200
        const likelyRestricted = isLikelyRestrictedCloudinaryPdfUrl(url) || status === 401 || status === 403

        return res.json({
            success: true,
            url,
            status,
            ok,
            likelyRestricted
        })
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message || 'Failed to validate PDF URL.' })
    }
})

router.delete('/slides/:courseId/:sectionIndex/:lessonIndex/pdf', async (req, res) => {
    try {
        const course = await loadEditableCourse(req.params.courseId)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found.' })
        }

        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const lesson = getCanonicalLesson(course, parsedSectionIndex, parsedLessonIndex)
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found.' })
        }

        if (!hasCustomSlides(lesson)) {
            return res.status(400).json({
                success: false,
                error: 'Add at least one slide before removing the PDF.'
            })
        }

        const nextContent = { ...(lesson.content || {}) }
        delete nextContent.pdf
        lesson.content = nextContent

        await prepareLessonForWrite(lesson, { debug: true, allowDriveLookup: false })
        course.markModified('sections')
        await saveEditableCourse(course)
        await recordAdminAudit(req, 'lesson_pdf_removed', 'lesson', String(lesson && lesson._id || ''), {
            courseId: String(course._id),
            title: lesson.title
        })

        return res.json({ success: true })
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message || 'Failed to remove PDF.' })
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
router.put('/course/:id/lesson/edit', async (req, res) => {
    try {
        const { sectionIndex, lessonIndex, name, url, interactiveQuizzes } = req.body
        console.log('[CourseEditor] incoming lesson edit payload:', JSON.stringify({ sectionIndex, lessonIndex, name, url, interactiveQuizzesCount: Array.isArray(interactiveQuizzes) ? interactiveQuizzes.length : 0 }))

        const parsedSectionIndex = parseInt(sectionIndex, 10)
        const parsedLessonIndex = parseInt(lessonIndex, 10)
        const normalizedName = String(name || '').trim()

        if (Number.isNaN(parsedSectionIndex) || Number.isNaN(parsedLessonIndex)) {
            return res.status(400).json({ success: false, error: 'Invalid section or lesson index' })
        }

        if (!normalizedName) {
            return res.status(400).json({ success: false, error: 'Lesson name is required' })
        }

        const course = await loadEditableCourse(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedLessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        lesson.title = normalizedName
        if (lesson.type === 'video') {
            const normalizedUrl = String(url || '').trim()
            const normalizedInteractiveQuizzes = normalizeInteractiveQuizPayload(interactiveQuizzes)
            lesson.videoUrl = normalizedUrl
            lesson.preview = normalizedUrl
            lesson.interactiveQuizzes = normalizedInteractiveQuizzes
            lesson.content = {
                ...(lesson.content || {}),
                videoUrl: normalizedUrl,
                interactiveQuizzes: normalizedInteractiveQuizzes
            }
        }

        await prepareLessonForWrite(lesson, { debug: true, allowDriveLookup: lesson.type === 'video' })
        course.markModified('sections')

        await saveEditableCourse(course)
        const savedLesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedLessonIndex] || lesson
        await recordAdminAudit(req, 'lesson_updated', 'lesson', String(savedLesson && savedLesson._id || ''), {
            courseId: String(course._id),
            title: savedLesson.title,
            type: savedLesson.type
        })

        return res.json({ success: true, lesson: savedLesson })
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message || 'Failed to update lesson' })
    }
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

    const removedLesson = lessons[parsedLessonIndex]
    lessons.splice(parsedLessonIndex, 1)
    reindexCanonicalSections(course)
    await saveEditableCourse(course)
    await recordAdminAudit(req, 'lesson_deleted', 'lesson', String(removedLesson && removedLesson._id || ''), {
        courseId: String(course._id),
        title: removedLesson && removedLesson.title
    })

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
        const savedItem = videos[videos.length - 1]
        await recordAdminAudit(req, 'lesson_added', 'lesson', String(savedItem && savedItem._id || ''), {
            courseId: String(course._id),
            title: savedItem && savedItem.title,
            type: savedItem && savedItem.type
        })

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
        await recordAdminAudit(req, 'lesson_reordered', 'course', String(course._id), {
            sourceSectionIndex: fromSection,
            destSectionIndex: toSection
        })

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
    await recordAdminAudit(req, 'section_updated', 'section', String(section && section._id || ''), {
        courseId: String(course._id),
        title: section.title
    })

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
    const addedSection = course.sections[course.sections.length - 1]
    await recordAdminAudit(req, 'section_added', 'section', String(addedSection && addedSection._id || ''), {
        courseId: String(course._id),
        title: addedSection && addedSection.title
    })

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
        await recordAdminAudit(req, 'interactive_quizzes_replaced', 'lesson', String(lesson && lesson._id || ''), {
            courseId: String(course._id),
            quizCount: interactiveQuizzes.length
        })

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
        await recordAdminAudit(req, 'interactive_quiz_added', 'lesson', String(lesson && lesson._id || ''), {
            courseId: String(course._id),
            quizCount: appended.length
        })
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
        await recordAdminAudit(req, 'interactive_quizzes_reordered', 'lesson', String(lesson && lesson._id || ''), {
            courseId: String(course._id),
            quizCount: normalized.length
        })
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
        await recordAdminAudit(req, 'interactive_quiz_deleted', 'lesson', String(lesson && lesson._id || ''), {
            courseId: String(course._id),
            quizId
        })
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
        const quizPlain = quiz && typeof quiz.toObject === 'function'
            ? quiz.toObject()
            : quiz
        const quizTitle = String(
            (quizPlain && (quizPlain.title || quizPlain.name))
            || (quiz && (quiz.title || quiz.name))
            || ''
        ).trim()
        const quizForEditor = quiz
            ? {
                ...quizPlain,
                title: quizTitle,
                name: quizTitle,
                questions: (
                    Array.isArray(quizPlain && quizPlain.quiz)
                        ? quizPlain.quiz
                        : Array.isArray(quizPlain && quizPlain.questions)
                            ? quizPlain.questions
                            : Array.isArray(quizPlain && quizPlain.content && quizPlain.content.questions)
                                ? quizPlain.content.questions
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
            await recordAdminAudit(req, 'quiz_question_added', 'lesson', String(quizLesson && quizLesson._id || ''), {
                courseId: String(course._id),
                questionIndex
            })

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
                questionId,
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
            const parsedCorrectIndex = parseInt(correctIndex, 10)

            if (
                Number.isNaN(parsedSectionIndex) ||
                Number.isNaN(parsedQuizIndex)
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
            const resolvedQuestionIndex = findQuizQuestionIndex(questions, questionIndex, questionId)
            if (resolvedQuestionIndex < 0 || !questions[resolvedQuestionIndex]) {
                return res.status(400).json({ success: false, error: 'Question index out of range' })
            }

            questions[resolvedQuestionIndex] = {
                ...(questions[resolvedQuestionIndex] || {}),
                ...buildCanonicalQuizQuestion(normalizedQuestion, optionObjects, parsedCorrectIndex)
            }
            quizLesson.quiz = questions
            quizLesson.content = { ...(quizLesson.content || {}), questions }
            course.markModified('sections')
            await saveEditableCourse(course)
            console.log('[CourseEditor] quiz payload after backend normalization:', JSON.stringify({
                mode: 'update',
                questionIndex: resolvedQuestionIndex,
                question: buildEditorQuizQuestionResponse(questions[resolvedQuestionIndex])
            }))
            await recordAdminAudit(req, 'quiz_question_updated', 'lesson', String(quizLesson && quizLesson._id || ''), {
                courseId: String(course._id),
                questionIndex: resolvedQuestionIndex
            })

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
            const { sectionIndex, quizIndex, questionIndex, questionId } = req.body

            const parsedSectionIndex = parseInt(sectionIndex, 10)
            const parsedQuizIndex = parseInt(quizIndex, 10)

            if (
                Number.isNaN(parsedSectionIndex) ||
                Number.isNaN(parsedQuizIndex)
            ) {
                return res.status(400).json({ success: false, error: "Invalid indexes" })
            }

            const course = await loadEditableCourse(courseId)
            if (!course) {
                return res.status(404).json({ success: false, error: 'Course not found' })
            }

            const quizLesson = course.sections?.[parsedSectionIndex]?.lessons?.[parsedQuizIndex]
            const questions = Array.isArray(quizLesson && quizLesson.quiz) ? quizLesson.quiz : []
            const resolvedQuestionIndex = findQuizQuestionIndex(questions, questionIndex, questionId)

            if (resolvedQuestionIndex < 0 || resolvedQuestionIndex >= questions.length) {
                return res.status(400).json({ success: false, error: "Question index out of range" })
            }

            questions.splice(resolvedQuestionIndex, 1)

            quizLesson.quiz = questions
            quizLesson.content = { ...(quizLesson.content || {}), questions }
            course.markModified('sections')
            await saveEditableCourse(course)
            await recordAdminAudit(req, 'quiz_question_deleted', 'lesson', String(quizLesson && quizLesson._id || ''), {
                courseId: String(course._id),
                questionIndex: resolvedQuestionIndex
            })

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
            const { sectionIndex, quizIndex, order, orderedIds } = req.body

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

            const idOrder = Array.isArray(orderedIds)
                ? orderedIds.map((id) => String(id || '').trim()).filter(Boolean)
                : []

            if (idOrder.length) {
                const byId = new Map(questions.map((question) => [String(question && question._id || ''), question]))
                const seen = new Set()
                const reorderedById = []

                idOrder.forEach((id) => {
                    if (!byId.has(id) || seen.has(id)) return
                    reorderedById.push(byId.get(id))
                    seen.add(id)
                })

                questions.forEach((question) => {
                    const id = String(question && question._id || '')
                    if (!seen.has(id)) reorderedById.push(question)
                })

                if (reorderedById.length !== questions.length) {
                    return res.status(400).json({ success: false, error: "Invalid question order" })
                }

                questions = reorderedById
            } else {
                const normalizedOrder = (Array.isArray(order) ? order : []).map(i => parseInt(i, 10))
                const isValidOrder =
                    normalizedOrder.length === questions.length &&
                    normalizedOrder.every(i => !Number.isNaN(i) && i >= 0 && i < questions.length)

                if (!isValidOrder) {
                    return res.status(400).json({ success: false, error: "Invalid question order" })
                }

                questions = normalizedOrder.map(i => questions[i])
            }

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
            await recordAdminAudit(req, 'quiz_questions_reordered', 'lesson', String(course.sections[parsedSectionIndex].lessons[parsedQuizIndex] && course.sections[parsedSectionIndex].lessons[parsedQuizIndex]._id || ''), {
                courseId: String(course._id),
                questionCount: questions.length
            })

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
    await recordAdminAudit(req, 'lesson_slides_added', 'lesson', String(lesson && lesson._id || ''), {
        courseId: String(course._id),
        slideCount: normalizedSlides.length
    })

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
    await recordAdminAudit(req, 'lesson_slide_updated', 'lesson', String(lesson && lesson._id || ''), {
        courseId: String(course._id),
        slideIndex: Number(slideIndex)
    })

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
    await recordAdminAudit(req, 'lesson_slides_deleted', 'lesson', String(lesson && lesson._id || ''), {
        courseId: String(course._id)
    })

    res.json({ success: true })
})


module.exports = router
