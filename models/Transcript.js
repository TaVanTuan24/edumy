const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const transcriptSchema = new Schema({
  videoId: {
    type: Schema.Types.ObjectId,
    ref: 'Video',
    required: true,
    index: true
  },
  offset: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  duration: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  text: {
    type: String,
    required: true,
    trim: true
  }
}, { timestamps: true });

// Compound index for RAG queries that sort transcripts by offset within a video
transcriptSchema.index({ videoId: 1, offset: 1 });

module.exports = mongoose.model('Transcript', transcriptSchema);
