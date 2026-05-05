const express = require('express');
const Joi = require('joi');
const mongoose = require('mongoose');
const { isLoggedIn } = require('../middleware');
const { validate } = require('../middleware/validate');
const { createLimiter } = require('../utils/rateLimiters');
const { ANALYTICS_EVENTS, trackEventSafe } = require('../services/analyticsEventService');

const router = express.Router();
const METADATA_MAX_BYTES = Number(process.env.ANALYTICS_METADATA_MAX_BYTES) || 10240;

function metadataSize(value) {
  return Buffer.byteLength(JSON.stringify(value || {}), 'utf8');
}

const analyticsEventSchema = Joi.object({
  eventType: Joi.string().valid(...Object.values(ANALYTICS_EVENTS)).required(),
  courseId: Joi.string().custom((value, helpers) => {
    if (!value) return value;
    if (!mongoose.isValidObjectId(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }).allow('', null).optional(),
  lessonId: Joi.string().trim().max(200).allow('', null).optional(),
  quizId: Joi.string().trim().max(200).allow('', null).optional(),
  sessionId: Joi.string().trim().max(200).allow('', null).optional(),
  _csrf: Joi.string().allow('').optional().strip(),
  user: Joi.any().forbidden(),
  metadata: Joi.object().unknown(true).default({}).custom((value, helpers) => {
    if (metadataSize(value) > METADATA_MAX_BYTES) {
      return helpers.message(`metadata must not exceed ${METADATA_MAX_BYTES} bytes`);
    }
    return value;
  })
}).unknown(false);

const analyticsLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many analytics events. Please slow down.',
  jsonMessage: 'Too many analytics events.',
  code: 'ANALYTICS_RATE_LIMITED'
});

router.post('/events', isLoggedIn, analyticsLimiter, validate(analyticsEventSchema), (req, res) => {
  trackEventSafe({
    req,
    eventType: req.body.eventType,
    course: req.body.courseId,
    lessonId: req.body.lessonId,
    quizId: req.body.quizId,
    sessionId: req.body.sessionId,
    metadata: req.body.metadata,
    source: 'client'
  });

  res.json({ success: true });
});

module.exports = router;
