const mongoose = require('mongoose');

const { Schema } = mongoose;

const vrLoginSessionSchema = new Schema({
  code: {
    type: String,
    required: true,
    trim: true
  },
  deviceId: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'expired', 'used'],
    default: 'pending',
    index: true
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  approvedAt: {
    type: Date,
    default: null
  },
  accessToken: {
    type: String,
    default: ''
  },
  refreshToken: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

vrLoginSessionSchema.index(
  { deviceId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' }
  }
);

vrLoginSessionSchema.index({ code: 1, createdAt: -1 });

module.exports = mongoose.model('VRLoginSession', vrLoginSessionSchema);
