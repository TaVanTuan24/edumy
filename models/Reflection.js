const mongoose = require('mongoose');

const reflectionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
    index: true
  },
  lessonId: {
    type: String,
    required: true,
    index: true
  },
  sectionIndex: {
    type: Number,
    default: 0
  },
  lessonIndex: {
    type: Number,
    default: 0
  },
  prompt: {
    type: String,
    required: true,
    trim: true
  },
  answer: {
    type: String,
    required: true,
    trim: true
  },
  wordCount: {
    type: Number,
    default: 0,
    min: 0
  },
  characterCount: {
    type: Number,
    default: 0,
    min: 0
  }
}, { timestamps: true });

// Compound indexes for common queries
reflectionSchema.index({ course: 1, lessonId: 1 });
reflectionSchema.index({ user: 1, course: 1, lessonId: 1 });
reflectionSchema.index({ course: 1, lessonId: 1, createdAt: -1 });

module.exports = mongoose.model('Reflection', reflectionSchema);