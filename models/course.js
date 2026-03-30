const mongoose = require('mongoose');
const review = require('./review');
const Schema = mongoose.Schema;

const opts = { toJSON: { virtuals: true }, timestamps: true }

// ==================== SUBSCHEMA DEFINITIONS ====================

const slideElementSchema = new Schema({
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

const slideSchema = new Schema({
    id: {
        type: String,
        required: true,
        trim: true
    },
    elements: {
        type: [slideElementSchema],
        default: []
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

// Legacy driveStructure item schema used by current course editor.
const driveItemSchema = new Schema({
    type: {
        type: String,
        enum: ['video', 'quiz', 'slide'],
        required: true
    },
    name: {
        type: String,
        trim: true,
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
    content: {
        type: Object,
        required: true,
        default: {}
    },
    questions: {
        type: [Schema.Types.Mixed],
        default: []
    },
    order: {
        type: Number,
        default: 0
    }
}, { _id: true })

const driveSectionSchema = new Schema({
    section: {
        type: String,
        default: ''
    },
    videos: {
        type: [driveItemSchema],
        default: []
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
    content: {
        type: Object,
        required: true,
        default: {}
    },
    quiz: [quizQuestionSchema],
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
    lessons: [lessonSchema],
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
    // Legacy structure - kept for backward compatibility
    driveStructure: {
        type: [driveSectionSchema],
        default: []
    },
    // New structured content
    sections: [sectionSchema],
    topic: {
        type: String,
        enum: ['Software', 'Hardware', 'AI', 'Network', 'Language', 'Security', 'Other'],
        required: true
    },
    author: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    reviews: [{
        type: Schema.Types.ObjectId,
        ref: 'Review'
    }]
}, opts)

function inferLegacyItemType(item) {
    if (!item || typeof item !== 'object') return 'video'

    const currentType = typeof item.type === 'string' ? item.type.trim().toLowerCase() : ''
    if (currentType === 'lecture') return 'video'
    if (['video', 'slide', 'quiz'].includes(currentType)) return currentType

    if (Array.isArray(item.questions) && item.questions.length > 0) return 'quiz'
    if (typeof item.content === 'string' && item.content.trim().length > 0) return 'slide'
    if (item.content && typeof item.content === 'object' && Array.isArray(item.content.slides) && item.content.slides.length > 0) return 'slide'

    return 'video'
}

function inferLessonType(lesson) {
    if (!lesson || typeof lesson !== 'object') return 'video'

    const currentType = typeof lesson.type === 'string' ? lesson.type.trim().toLowerCase() : ''
    if (currentType === 'lecture') return 'video'
    if (['video', 'slide', 'quiz'].includes(currentType)) return currentType

    if (Array.isArray(lesson.quiz) && lesson.quiz.length > 0) return 'quiz'
    if (lesson.content && typeof lesson.content === 'object' && Array.isArray(lesson.content.slides) && lesson.content.slides.length > 0) return 'slide'

    return 'video'
}

CourseSchema.pre('validate', function(next) {
    if (Array.isArray(this.driveStructure)) {
        this.driveStructure.forEach((section) => {
            if (!section || !Array.isArray(section.videos)) return

            section.videos.forEach((item) => {
                item.type = inferLegacyItemType(item)

                if (item.type === 'slide') {
                    const contentObj = (item.content && typeof item.content === 'object' && !Array.isArray(item.content))
                        ? item.content
                        : {}

                    const slidesFromContent = Array.isArray(contentObj.slides) ? contentObj.slides : []
                    const legacyTextSlide = (typeof item.content === 'string' && item.content.trim().length > 0)
                        ? [{
                            id: `slide-${item._id || Date.now()}`,
                            elements: [{
                                id: `el-${item._id || Date.now()}`,
                                type: 'text',
                                x: 80,
                                y: 80,
                                text: item.content.trim(),
                                fontSize: 28,
                                color: '#1c1d1f',
                                align: 'left',
                                bold: false
                            }]
                        }]
                        : []
                    const normalizedSlides = slidesFromContent.length > 0 ? slidesFromContent : legacyTextSlide

                    item.content = {
                        ...contentObj,
                        slides: normalizedSlides
                    }
                }
            })
        })
    }

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
            })
        })
    }

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