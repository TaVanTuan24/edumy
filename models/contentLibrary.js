const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ==================== CONTENT LIBRARY SCHEMA ====================
// Stores reusable content: lessons, slides, quizzes

const contentLibrarySchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['lesson', 'slide', 'quiz'],
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    // Store the actual content data
    data: {
        type: Schema.Types.Mixed,
        default: {}
    },
    // For quick access to key fields
    preview: {
        type: String,
        default: ''
    },
    // Tags for searching
    tags: [{
        type: String,
        trim: true
    }],
    // Track usage count
    usageCount: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for faster queries
contentLibrarySchema.index({ userId: 1, type: 1 });
contentLibrarySchema.index({ userId: 1, title: 'text', tags: 'text' });

// Pre-save middleware to update timestamp
contentLibrarySchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Virtual for display icon
contentLibrarySchema.virtual('icon').get(function() {
    const icons = {
        lesson: '🎥',
        slide: '📄',
        quiz: '❓'
    };
    return icons[this.type] || '📁';
});

// Virtual for content summary
contentLibrarySchema.virtual('summary').get(function() {
    if (this.type === 'slide' && this.data.slides) {
        return `${this.data.slides.length} slides`;
    }
    if (this.type === 'quiz' && this.data.quiz) {
        return `${this.data.quiz.length} questions`;
    }
    if (this.type === 'lesson' && this.data.videoUrl) {
        return 'Video lesson';
    }
    return 'No content';
});

module.exports = mongoose.model('ContentLibrary', contentLibrarySchema);
