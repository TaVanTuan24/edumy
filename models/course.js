const mongoose = require('mongoose');
const review = require('./review');
const Schema = mongoose.Schema;

const opts = { toJSON: { virtuals: true }, timestamps: true }

// ==================== SUBSCHEMA DEFINITIONS ====================

// Slide schema
const slideSchema = new Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    content: {
        type: String,
        required: true
    }
}, { _id: true })

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
        type: String,
        default: ''
    },
    questions: {
        type: [Schema.Types.Mixed],
        default: []
    },
    slides: {
        type: [slideSchema],
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
    slides: [slideSchema],
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
    if (Array.isArray(item.slides) && item.slides.length > 0) return 'slide'
    if (typeof item.content === 'string' && item.content.trim().length > 0) return 'slide'

    return 'video'
}

function inferLessonType(lesson) {
    if (!lesson || typeof lesson !== 'object') return 'video'

    const currentType = typeof lesson.type === 'string' ? lesson.type.trim().toLowerCase() : ''
    if (currentType === 'lecture') return 'video'
    if (['video', 'slide', 'quiz'].includes(currentType)) return currentType

    if (Array.isArray(lesson.quiz) && lesson.quiz.length > 0) return 'quiz'
    if (Array.isArray(lesson.slides) && lesson.slides.length > 0) return 'slide'

    return 'video'
}

CourseSchema.pre('validate', function(next) {
    if (Array.isArray(this.driveStructure)) {
        this.driveStructure.forEach((section) => {
            if (!section || !Array.isArray(section.videos)) return

            section.videos.forEach((item) => {
                item.type = inferLegacyItemType(item)
            })
        })
    }

    if (Array.isArray(this.sections)) {
        this.sections.forEach((section) => {
            if (!section || !Array.isArray(section.lessons)) return

            section.lessons.forEach((lesson) => {
                lesson.type = inferLessonType(lesson)
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