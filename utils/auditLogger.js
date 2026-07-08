const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value).reduce((acc, key) => {
    if (/key|token|secret|password/i.test(key)) {
      return acc;
    }

    acc[key] = sanitizeValue(value[key]);
    return acc;
  }, {});
}

async function logAuditEvent({ req, userId, action, targetType, targetId, metadata = {} }) {
  try {
    await AuditLog.create({
      user: userId || (req && req.user && req.user._id) || null,
      action: String(action || '').trim(),
      targetType: String(targetType || 'system').trim(),
      targetId: String(targetId || '').trim(),
      metadata: sanitizeValue(metadata)
    });
  } catch (error) {
    logger.error({ err: error }, '[AuditLog] Failed to write audit log');
  }
}

module.exports = {
  logAuditEvent
};
