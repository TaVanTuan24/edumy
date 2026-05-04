const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const videoSchema = new Schema({
  title: {
    type: String,
    trim: true,
    default: ''
  },
  url: {
    type: String,
    trim: true,
    default: ''
  },
  source: {
    type: String,
    enum: ['youtube', 'other'],
    default: 'other'
  },
  youtubeVideoId: {
    type: String,
    trim: true,
    default: ''
  },
  courseId: {
    type: Schema.Types.ObjectId,
    ref: 'Course',
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
  transcripts: [{ type: Schema.Types.ObjectId, ref: 'Transcript' }]
}, { timestamps: true });

videoSchema.index({ courseId: 1, sectionIndex: 1, lessonIndex: 1 }, { unique: true, sparse: true });

// Sparse indexes for RAG service lookups by URL/youtubeVideoId
videoSchema.index({ courseId: 1, url: 1 }, { sparse: true });
videoSchema.index({ courseId: 1, youtubeVideoId: 1 }, { sparse: true });

module.exports = mongoose.model('Video', videoSchema);
