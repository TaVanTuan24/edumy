const { normalizePreferredFormat, safeUrlParse, isBlockedStreamHost } = require('../services/streamResolver');

module.exports = function validateStreamRequest(req, res, next) {
  const body = req.body || {};
  const sourceUrl = String(body.sourceUrl || '').trim();
  const preferredFormatRaw = body.preferredFormat;

  if (!sourceUrl) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'sourceUrl is required'
      }
    });
  }

  const parsedSourceUrl = safeUrlParse(sourceUrl);
  if (!parsedSourceUrl) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'sourceUrl must be a valid http/https URL'
      }
    });
  }

  if (isBlockedStreamHost(parsedSourceUrl.hostname)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'BLOCKED_HOST',
        message: 'sourceUrl host is not allowed'
      }
    });
  }

  if (typeof preferredFormatRaw !== 'undefined' && preferredFormatRaw !== 'm3u8' && preferredFormatRaw !== 'mp4') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'preferredFormat must be either m3u8 or mp4'
      }
    });
  }

  if (typeof body.courseId !== 'undefined' && typeof body.courseId !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'courseId must be a string when provided'
      }
    });
  }

  if (typeof body.lessonId !== 'undefined' && typeof body.lessonId !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'lessonId must be a string when provided'
      }
    });
  }

  req.streamResolveInput = {
    sourceUrl,
    preferredFormat: normalizePreferredFormat(preferredFormatRaw),
    courseId: typeof body.courseId === 'string' ? body.courseId : '',
    lessonId: typeof body.lessonId === 'string' ? body.lessonId : ''
  };

  return next();
};
