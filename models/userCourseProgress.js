const mongoose = require('mongoose');

const userCourseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  completedLessons: { type: [String], default: [] },
  totalWatchTime: { type: Number, default: 0 },
  lessonTracking: {
    type: [
      {
        lessonId: { type: String, default: '' },
        type: { type: String, default: '' },
        watchTime: { type: Number, default: 0 },
        lastPosition: { type: Number, default: 0 },
        interactions: {
          play: { type: Number, default: 0 },
          pause: { type: Number, default: 0 },
          seek: { type: Number, default: 0 }
        },
        completed: { type: Boolean, default: false },
        slidesViewed: { type: Number, default: 0 },
        quizAttempts: { type: Number, default: 0 },
        quizScore: { type: Number, default: 0 }
      }
    ],
    default: []
  },
  quizResults: {
    type: [
      {
        quizId: { type: String, default: '' },
        score: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      }
    ],
    default: []
  },
  lastAccessed: { type: Date, default: null },
  watchTime: { type: Number, default: 0 },
  completionRate: { type: Number, default: 0 },
  lessonViews: {
    type: Map,
    of: Number,
    default: {}
  }
}, { timestamps: true });

userCourseSchema.index({ user: 1, course: 1 }, { unique: true });

module.exports = mongoose.model('UserCourseProgress', userCourseSchema);
