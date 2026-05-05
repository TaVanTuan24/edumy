const mongoose = require('mongoose');
const AnalyticsEvent = require('../models/analyticsEvent');
const logger = require('../utils/logger');

const ANALYTICS_EVENTS = Object.freeze({
  LESSON_STARTED: 'lesson_started',
  LESSON_COMPLETED: 'lesson_completed',
  VIDEO_PROGRESS: 'video_progress',
  COURSE_ENROLLED: 'course_enrolled',
  COURSE_COMPLETED: 'course_completed',
  QUIZ_ATTEMPT_STARTED: 'quiz_attempt_started',
  QUIZ_QUESTION_ANSWERED: 'quiz_question_answered',
  QUIZ_COMPLETED: 'quiz_completed',
  AI_QUESTION_ASKED: 'ai_question_asked',
  NOTIFICATION_CLICKED: 'notification_clicked'
});

const EVENT_TYPE_SET = new Set(Object.values(ANALYTICS_EVENTS));
const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'token',
  'password',
  'authorization',
  'cookie',
  'secret',
  'set-cookie'
]);
const MAX_DEPTH = 4;
const MAX_STRING_LENGTH = 1000;
const DEFAULT_METADATA_MAX_BYTES = 10240;

function getMetadataMaxBytes() {
  const configured = Number(process.env.ANALYTICS_METADATA_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_METADATA_MAX_BYTES;
}

function isAnalyticsEnabled() {
  return String(process.env.ANALYTICS_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function normalizeObjectId(value) {
  const candidate = value && value._id ? value._id : value;
  if (!candidate) return null;
  if (mongoose.isValidObjectId(candidate)) return candidate;
  return null;
}

function normalizeString(value, maxLength = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key || '').trim().toLowerCase());
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value === undefined ? null : value), 'utf8');
}

function sanitizeMetadataValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Date) return value.toISOString();

  if (typeof value !== 'object') return String(value).slice(0, MAX_STRING_LENGTH);

  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadataValue(item, depth + 1, seen));
  }

  return Object.keys(value).reduce((acc, key) => {
    if (isSensitiveKey(key)) return acc;
    acc[key] = sanitizeMetadataValue(value[key], depth + 1, seen);
    return acc;
  }, {});
}

function sanitizeMetadata(metadata = {}) {
  const safeInput = metadata && typeof metadata === 'object' ? metadata : {};
  const sanitized = sanitizeMetadataValue(safeInput) || {};
  const maxBytes = getMetadataMaxBytes();

  if (byteLength(sanitized) <= maxBytes) {
    return sanitized;
  }

  return {
    _truncated: true,
    _reason: 'metadata_exceeded_max_bytes'
  };
}

async function trackEvent({
  req,
  user,
  eventType,
  course,
  lessonId,
  quizId,
  sessionId,
  metadata,
  source
} = {}) {
  if (!isAnalyticsEnabled()) return null;

  if (!EVENT_TYPE_SET.has(eventType)) {
    logger.warn({ eventType }, 'Analytics event type rejected');
    return null;
  }

  try {
    const requestUser = req && req.user ? req.user : null;
    const userId = normalizeObjectId(user || requestUser);
    const courseId = normalizeObjectId(course);
    const userAgent = req && req.headers
      ? normalizeString(req.headers['user-agent'], 500)
      : null;

    return await AnalyticsEvent.create({
      user: userId,
      eventType,
      course: courseId,
      lessonId: normalizeString(lessonId, 200),
      quizId: normalizeString(quizId, 200),
      sessionId: normalizeString(sessionId || (req && req.sessionID), 200),
      metadata: sanitizeMetadata(metadata),
      source: source === 'client' ? 'client' : 'server',
      userAgent,
      ipHash: null
    });
  } catch (err) {
    logger.warn({ err, eventType }, 'Analytics event tracking failed');
    return null;
  }
}

function trackEventSafe(payload) {
  trackEvent(payload).catch((err) => {
    logger.warn({ err }, 'Analytics event tracking failed');
  });
}

module.exports = {
  ANALYTICS_EVENTS,
  EVENT_TYPE_SET,
  sanitizeMetadata,
  trackEvent,
  trackEventSafe
};
