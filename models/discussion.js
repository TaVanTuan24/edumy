const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const answerSchema = new Schema({
  author: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  body: {
    type: String,
    required: true,
    trim: true,
    maxlength: 10000
  },
  upvoters: {
    type: [Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },
  downvoters: {
    type: [Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },
  isAccepted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

answerSchema.virtual('score').get(function() {
  return Number(this.upvoters.length || 0) - Number(this.downvoters.length || 0);
});

const discussionSchema = new Schema({
  course: {
    type: Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
    index: true
  },
  lessonId: {
    type: String,
    default: '',
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 180
  },
  body: {
    type: String,
    required: true,
    trim: true,
    maxlength: 20000
  },
  tags: {
    type: [String],
    default: []
  },
  author: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  upvoters: {
    type: [Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },
  downvoters: {
    type: [Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },
  answers: {
    type: [answerSchema],
    default: []
  },
  acceptedAnswerId: {
    type: Schema.Types.ObjectId,
    default: null
  }
}, { timestamps: true });

discussionSchema.virtual('score').get(function() {
  return Number(this.upvoters.length || 0) - Number(this.downvoters.length || 0);
});

discussionSchema.virtual('answersCount').get(function() {
  return Array.isArray(this.answers) ? this.answers.length : 0;
});

discussionSchema.index({ course: 1, createdAt: -1 });
discussionSchema.index({ course: 1, lessonId: 1, createdAt: -1 });

module.exports = mongoose.model('Discussion', discussionSchema);
