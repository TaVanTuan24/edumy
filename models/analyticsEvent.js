const mongoose = require('mongoose');

const ANALYTICS_EVENT_TYPES = [
  'lesson_started',
  'lesson_completed',
  'video_progress',
  'course_enrolled',
  'course_completed',
  'quiz_attempt_started',
  'quiz_question_answered',
  'quiz_completed',
  'ai_question_asked',
  'notification_clicked'
];

const analyticsEventSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    default: null
  },
  eventType: {
    type: String,
    required: true,
    index: true,
    enum: ANALYTICS_EVENT_TYPES
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    index: true,
    default: null
  },
  lessonId: {
    type: String,
    default: null,
    index: true
  },
  quizId: {
    type: String,
    default: null,
    index: true
  },
  sessionId: {
    type: String,
    default: null,
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  source: {
    type: String,
    enum: ['server', 'client'],
    default: 'server'
  },
  userAgent: {
    type: String,
    default: null
  },
  ipHash: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

analyticsEventSchema.index({ user: 1, createdAt: -1 });
analyticsEventSchema.index({ course: 1, eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);
module.exports.ANALYTICS_EVENT_TYPES = ANALYTICS_EVENT_TYPES;
