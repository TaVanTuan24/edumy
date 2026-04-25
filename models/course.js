const mongoose = require('mongoose');
const review = require('./review');
const { syncCourseContent } = require('../utils/courseContentAdapter');
const { formatDuration, parseDurationToSeconds } = require('../utils/duration');
const { extractDriveFileMeta } = require('../utils/driveVideoMetadata');
const { syncCourseAggregateFields } = require('../utils/courseStats');
const Schema = mongoose.Schema;
const VALID_COURSE_STATUSES = ['draft', 'published', 'archived'];

const opts = { toJSON: { virtuals: true }, timestamps: true }

// ==================== SUBSCHEMA DEFINITIONS ====================

const _slideElementSchema = new Schema({
    id: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['text', 'image'],
        required: true
    },
    x: {
        type: Number,
        default: 0
    },
    y: {
        type: Number,
        default: 0
    },
    text: {
        type: String,
        default: ''
    },
    src: {
        type: String,
        default: ''
    },
    fontSize: {
        type: Number,
        default: 28
    },
    color: {
        type: String,
        default: '#1c1d1f'
    },
    align: {
        type: String,
        enum: ['left', 'center', 'right'],
        default: 'left'
    },
    bold: {
        type: Boolean,
        default: false
    }
}, { _id: false })

// Quiz question schema
const quizQuestionSchema = new Schema({
    question: {
        type: String,
        required: true
    },
    options: [{
        type: String,
        required: true
    }],
    correctAnswer: {
        type: String,
        required: true
    }
}, { _id: true })

const interactiveVideoQuizSchema = new Schema({
    triggerTimeSec: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    question: {
        type: String,
        required: true,
        trim: true,
        default: ''
    },
    options: {
        type: [String],
        default: []
    },
    correctOptionIndex: {
        type: Number,
        required: true,
        min: 0,
        max: 3,
        default: 0
    },
    explanation: {
        type: String,
        trim: true,
        default: ''
    },
    pauseOnShow: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    }
}, { _id: true })

// Lesson schema - supports video, slide, or quiz
const lessonSchema = new Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['video', 'slide', 'quiz'],
        required: true
    },
    videoUrl: {
        type: String,
        default: ''
    },
    preview: {
        type: String,
        default: ''
    },
    refId: {
        type: String,
        default: ''
    },
    description: {
        type: String,
        default: ''
    },
    duration: {
        type: Schema.Types.Mixed,
        default: null
    },
    durationSeconds: {
        type: Number,
        min: 0,
        default: null
    },
    durationFormatted: {
        type: String,
        default: ''
    },
    durationSyncPending: {
        type: Boolean,
        default: false
    },
    aiGenerated: {
        type: Boolean,
        default: false
    },
    content: {
        type: Object,
        required: true,
        default: {}
    },
    quiz: [quizQuestionSchema],
    interactiveQuizzes: {
        type: [interactiveVideoQuizSchema],
        default: []
    },
    order: {
        type: Number,
        default: 0
    }
}, { _id: true })

// Section schema
const sectionSchema = new Schema({
    title: {
        type: String,
        default: ''
    },
    lessons: {
        type: [lessonSchema],
        default: [],
        validate: {
            validator(value) {
                return Array.isArray(value)
            },
            message: 'Section lessons must be an array'
        }
    },
    order: {
        type: Number,
        default: 0
    }
}, { _id: true })

// ==================== MAIN COURSE SCHEMA ====================

const CourseSchema = new Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    images: [{
        url: String,
        filename: String
    }],
    description: String,
    driveLink: String,
    sections: {
        type: [sectionSchema],
        default: [],
        validate: {
            validator(value) {
                return Array.isArray(value)
            },
            message: 'Course sections must be an array'
        }
    },
    totalDurationSeconds: {
        type: Number,
        min: 0,
        default: 0
    },
    totalDurationFormatted: {
        type: String,
        default: ''
    },
    totalVideoCount: {
        type: Number,
        min: 0,
        default: 0
    },
    totalLessonCount: {
        type: Number,
        min: 0,
        default: 0
    },
    totalSectionCount: {
        type: Number,
        min: 0,
        default: 0
    },
    topic: {
        type: String,
        enum: ['Software', 'Hardware', 'AI', 'Network', 'Language', 'Security', 'Other'],
        required: true
    },
    status: {
        type: String,
        enum: VALID_COURSE_STATUSES,
        default: 'draft'
    },
    publishedAt: {
        type: Date,
        default: null
    },
    lastEditedAt: {
        type: Date,
        default: Date.now
    },
    unpublishedReason: {
        type: String,
        trim: true,
        default: ''
    },
    archivedAt: {
        type: Date,
        default: null
    },
    author: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewEntries: [{
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        rating: {
            type: Number,
            min: 1,
            max: 5,
            default: 5
        },
        comment: {
            type: String,
            trim: true,
            default: ''
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    reviews: [{
        type: Schema.Types.ObjectId,
        ref: 'Review'
    }]
}, opts)

function inferLessonType(lesson) {
    if (!lesson || typeof lesson !== 'object') return 'video'

    const currentType = typeof lesson.type === 'string' ? lesson.type.trim().toLowerCase() : ''
    if (currentType === 'lecture') return 'video'
    if (['video', 'slide', 'quiz'].includes(currentType)) return currentType

    if (Array.isArray(lesson.quiz) && lesson.quiz.length > 0) return 'quiz'
    if (lesson.content && typeof lesson.content === 'object' && Array.isArray(lesson.content.slides) && lesson.content.slides.length > 0) return 'slide'
    if (lesson.content && typeof lesson.content === 'object' && lesson.content.pdf && typeof lesson.content.pdf === 'object' && String(lesson.content.pdf.url || '').trim()) return 'slide'

    return 'video'
}

function normalizeInteractiveQuizzes(rawQuizzes) {
    const source = Array.isArray(rawQuizzes) ? rawQuizzes : []

    return source
        .map((entry, index) => {
            const rawOptions = Array.isArray(entry && entry.options) ? entry.options : []
            const normalizedOptions = rawOptions
                .map((opt) => String(opt || '').trim())
                .filter(Boolean)
                .slice(0, 4)

            while (normalizedOptions.length < 4) {
                normalizedOptions.push('')
            }

            const parsedTime = Number(entry && entry.triggerTimeSec)
            const parsedCorrect = Number(entry && entry.correctOptionIndex)

            const normalized = {
                triggerTimeSec: Number.isFinite(parsedTime) && parsedTime >= 0 ? parsedTime : 0,
                question: String(entry && entry.question || '').trim(),
                options: normalizedOptions,
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
        .sort((a, b) => {
            const timeDiff = a.triggerTimeSec - b.triggerTimeSec
            if (timeDiff !== 0) return timeDiff
            return a.order - b.order
        })
        .map((entry, index) => ({ ...entry, order: index }))
}

CourseSchema.pre('validate', function(next) {
    syncCourseContent(this)

    if (Array.isArray(this.sections)) {
        this.sections.forEach((section) => {
            if (!section || !Array.isArray(section.lessons)) return

            section.lessons.forEach((lesson) => {
                lesson.type = inferLessonType(lesson)

                if (!lesson.content || typeof lesson.content !== 'object' || Array.isArray(lesson.content)) {
                    lesson.content = {}
                }

                if (lesson.type === 'slide' && !Array.isArray(lesson.content.slides)) {
                    lesson.content.slides = []
                }

                if (lesson.type === 'video') {
                    const fromContent = Array.isArray(lesson.content.interactiveQuizzes) ? lesson.content.interactiveQuizzes : []
                    const fromRoot = Array.isArray(lesson.interactiveQuizzes) ? lesson.interactiveQuizzes : []
                    const normalizedInteractive = normalizeInteractiveQuizzes(fromContent.length ? fromContent : fromRoot)
                    const parsedDurationSeconds = parseDurationToSeconds(
                        lesson.durationSeconds != null
                            ? lesson.durationSeconds
                            : (lesson.duration != null ? lesson.duration : lesson.content.duration)
                    )

                    lesson.interactiveQuizzes = normalizedInteractive
                    lesson.content.interactiveQuizzes = normalizedInteractive
                    lesson.durationSeconds = Number.isFinite(parsedDurationSeconds) && parsedDurationSeconds > 0
                        ? parsedDurationSeconds
                        : null
                    lesson.durationFormatted = lesson.durationSeconds
                        ? formatDuration(lesson.durationSeconds)
                        : ''
                    lesson.durationSyncPending = !lesson.durationSeconds
                        && Boolean(extractDriveFileMeta(String(lesson.videoUrl || '').trim()))

                    if (!lesson.content || typeof lesson.content !== 'object' || Array.isArray(lesson.content)) {
                        lesson.content = {}
                    }

                    lesson.content.durationSeconds = lesson.durationSeconds
                    lesson.content.durationFormatted = lesson.durationFormatted
                    lesson.content.durationSyncPending = lesson.durationSyncPending
                } else {
                    lesson.durationSeconds = null
                    lesson.durationFormatted = ''
                    lesson.durationSyncPending = false
                    lesson.content.durationSeconds = null
                    lesson.content.durationFormatted = ''
                    lesson.content.durationSyncPending = false
                }
            })
        })
    }

    syncCourseAggregateFields(this)

    if (!this.status || !VALID_COURSE_STATUSES.includes(String(this.status))) {
        this.status = 'published'
    }

    this.lastEditedAt = new Date()

    next()
})

CourseSchema.virtual('properties.popUpMarkup').get(function () {
    return `<strong><a href="/courses/${this._id}">${this.title}</a><strong>`;
})



CourseSchema.post('findOneAndDelete', async function (doc) {
    if (doc) {
        await review.deleteMany({
            _id: {
                $in: doc.reviews
            }
        })
    }
})

module.exports = mongoose.model('Course', CourseSchema)
