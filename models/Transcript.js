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

module.exports = mongoose.model('Transcript', transcriptSchema);
