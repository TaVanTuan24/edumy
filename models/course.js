const mongoose = require('mongoose');
const review = require('./review');
const Schema = mongoose.Schema;

const opts = { toJSON: { virtuals: true } }

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
        default: 'video'
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
        type: Array,
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