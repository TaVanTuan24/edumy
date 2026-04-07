const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const Course = require('../models/course');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const ExpressError = require('../utils/ExpressError');
const { resolveStream, safeUrlParse } = require('../services/streamResolver');
const { createStreamProxyToken, verifyStreamProxyToken } = require('../utils/signStreamToken');

function getEnrolledCourseIdStrings(userDoc) {
  const ids = [];

  const enrolledCourses = Array.isArray(userDoc && userDoc.enrolledCourses)
    ? userDoc.enrolledCourses
    : [];
  for (const entry of enrolledCourses) {
    if (!entry) continue;
    if (entry.courseId) {
      ids.push(String(entry.courseId));
      continue;
    }
    ids.push(String(entry));
  }

  const directIds = Array.isArray(userDoc && userDoc.enrolledCourseIds)
    ? userDoc.enrolledCourseIds
    : [];
  for (const id of directIds) {
    if (!id) continue;
    ids.push(String(id));
  }

  return Array.from(new Set(ids.filter((id) => mongoose.isValidObjectId(id))));
}

function isUserEnrolledInCourse(userDoc, courseId) {
  if (!userDoc || !courseId) return false;

  if (typeof userDoc.findEnrollment === 'function' && userDoc.findEnrollment(courseId)) {
    return true;
  }

  return getEnrolledCourseIdStrings(userDoc).includes(String(courseId));
}

function getOrderedLessonsFromSections(sections) {
  const safeSections = Array.isArray(sections) ? sections : [];

  const sortedSections = safeSections
    .slice()
    .sort((a, b) => Number(a && a.order) - Number(b && b.order));

  const lessons = [];
  for (const section of sortedSections) {
    const sectionTitle = String(
      (section && (section.sectionTitle || section.sectionName || section.title || section.name))
      || 'Nội dung khóa học'
    );

    const sectionOrder = Number.isFinite(Number(section && section.order))
      ? Number(section.order)
      : null;

    const sectionLessons = Array.isArray(section && section.lessons) ? section.lessons.slice() : [];
    sectionLessons.sort((a, b) => Number(a && a.order) - Number(b && b.order));

    for (const lesson of sectionLessons) {
      lessons.push({
        ...lesson,
        sectionTitle,
        sectionOrder
      });
    }
  }

  return lessons;
}

function getOrderedLessonsFromDriveStructure(driveStructure) {
  const safeSections = Array.isArray(driveStructure) ? driveStructure : [];
  const lessons = [];

  for (const section of safeSections) {
    const sectionTitle = String(
      (section && (section.sectionTitle || section.sectionName || section.section || section.title || section.name))
      || 'Nội dung khóa học'
    );

    const sectionOrder = Number.isFinite(Number(section && section.order))
      ? Number(section.order)
      : null;

    const sectionItems = Array.isArray(section && section.videos) ? section.videos.slice() : [];
    sectionItems.sort((a, b) => Number(a && a.order) - Number(b && b.order));

    for (const item of sectionItems) {
      lessons.push({
        ...item,
        sectionTitle,
        sectionOrder
      });
    }
  }

  return lessons;
}

function getCourseLessons(courseDoc) {
  const sectionLessons = getOrderedLessonsFromSections(courseDoc && courseDoc.sections);
  if (sectionLessons.length > 0) {
    return sectionLessons.map((lesson) => ({
      id: String(lesson && lesson._id),
      title: String((lesson && lesson.title) || 'Untitled Lesson'),
      duration: lesson && lesson.duration ? lesson.duration : null,
      order: Number.isFinite(Number(lesson && lesson.order)) ? Number(lesson.order) : null,
      sectionTitle: String((lesson && lesson.sectionTitle) || 'Nội dung khóa học'),
      sectionOrder: Number.isFinite(Number(lesson && lesson.sectionOrder)) ? Number(lesson.sectionOrder) : null,
      content: lesson && lesson.content ? lesson.content : null,
      videoUrl: lesson && lesson.videoUrl ? lesson.videoUrl : ''
    }));
  }

  const legacyLessons = getOrderedLessonsFromDriveStructure(courseDoc && courseDoc.driveStructure);
  return legacyLessons.map((item, idx) => ({
    id: String((item && (item._id || item.refId)) || `legacy_lesson_${idx + 1}`),
    title: String((item && (item.title || item.name)) || 'Untitled Lesson'),
    duration: (item && item.duration) || (item && item.content && item.content.duration) || null,
    order: Number.isFinite(Number(item && item.order)) ? Number(item.order) : idx + 1,
    sectionTitle: String((item && item.sectionTitle) || 'Nội dung khóa học'),
    sectionOrder: Number.isFinite(Number(item && item.sectionOrder)) ? Number(item.sectionOrder) : null,
    content: item && item.content ? item.content : null,
    videoUrl: item && item.preview ? item.preview : ''
  }));
}

function getThumbnailUrl(courseDoc) {
  if (Array.isArray(courseDoc && courseDoc.images) && courseDoc.images.length > 0) {
    const firstImage = courseDoc.images.find((img) => img && img.url);
    if (firstImage && firstImage.url) return firstImage.url;
  }

  const lessons = getCourseLessons(courseDoc);
  for (const lesson of lessons) {
    if (lesson.videoUrl) return lesson.videoUrl;

    const slides = Array.isArray(lesson.content && lesson.content.slides)
      ? lesson.content.slides
      : [];
    for (const slide of slides) {
      const elements = Array.isArray(slide && slide.elements) ? slide.elements : [];
      const imageElement = elements.find((el) => el && el.type === 'image' && el.src);
      if (imageElement && imageElement.src) return imageElement.src;
    }
  }

  return '';
}

module.exports.getVrCourses = async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('enrolledCourses enrolledCourseIds')
    .lean();

  if (!user) {
    throw new ExpressError('User not found', 404);
  }

  const enrolledIds = getEnrolledCourseIdStrings(user);
  if (enrolledIds.length === 0) {
    return res.json({ success: true, data: [] });
  }

  const objectIds = enrolledIds.map((id) => new mongoose.Types.ObjectId(id));

  const [courses, progressDocs] = await Promise.all([
    Course.find({ _id: { $in: objectIds } })
      .select('title description images sections driveStructure')
      .lean(),
    UserCourseProgress.find({ user: req.user._id, course: { $in: objectIds } })
      .select('course completedLessons completionRate')
      .lean()
  ]);

  const progressMap = new Map(progressDocs.map((doc) => [String(doc.course), doc]));
  const orderMap = new Map(enrolledIds.map((id, idx) => [id, idx]));

  const data = courses
    .slice()
    .sort((a, b) => (orderMap.get(String(a._id)) || 0) - (orderMap.get(String(b._id)) || 0))
    .map((course) => {
      const lessons = getCourseLessons(course);
      const totalLessons = lessons.length;
      const progress = progressMap.get(String(course._id));
      const rawCompletedLessons = Array.isArray(progress && progress.completedLessons)
        ? progress.completedLessons.length
        : 0;
      const completedLessons = totalLessons
        ? Math.min(rawCompletedLessons, totalLessons)
        : rawCompletedLessons;

      const computedPercentage = totalLessons
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;

      const storedCompletionRate = Number(progress && progress.completionRate);
      const percentage = Number.isFinite(storedCompletionRate)
        ? Math.max(0, Math.min(100, Math.round(storedCompletionRate)))
        : computedPercentage;

      return {
        id: String(course._id),
        title: String(course.title || ''),
        description: String(course.description || ''),
        thumbnailUrl: getThumbnailUrl(course),
        progress: percentage,
        totalLessons,
        completedLessons
      };
    });

  return res.json({ success: true, data });
};

module.exports.getVrCourseLessons = async (req, res) => {
  const { courseId } = req.params;

  if (!mongoose.isValidObjectId(courseId)) {
    throw new ExpressError('Course not found', 404);
  }

  const [user, course, progressDoc] = await Promise.all([
    User.findById(req.user._id)
      .select('enrolledCourses enrolledCourseIds')
      .lean(),
    Course.findById(courseId)
      .select('sections driveStructure')
      .lean(),
    UserCourseProgress.findOne({ user: req.user._id, course: courseId })
      .select('completedLessons')
      .lean()
  ]);

  if (!user) {
    throw new ExpressError('User not found', 404);
  }

  if (!course) {
    throw new ExpressError('Course not found', 404);
  }

  if (!isUserEnrolledInCourse(user, courseId)) {
    throw new ExpressError('Course not found or user not enrolled', 404);
  }

  const completedSet = new Set(
    Array.isArray(progressDoc && progressDoc.completedLessons)
      ? progressDoc.completedLessons.map((id) => String(id))
      : []
  );

  const lessons = getCourseLessons(course).map((lesson, idx) => ({
    id: String(lesson.id),
    title: String(lesson.title || ''),
    type: String(lesson.type || (lesson.videoUrl ? 'lecture' : '')),
    videoUrl: lesson.videoUrl || '',
    duration: lesson.duration || null,
    order: Number.isFinite(Number(lesson.order)) ? Number(lesson.order) : idx + 1,
    sectionTitle: String(lesson.sectionTitle || ''),
    sectionOrder: Number.isFinite(Number(lesson.sectionOrder)) ? Number(lesson.sectionOrder) : null,
    isCompleted: completedSet.has(String(lesson.id))
  }));

  return res.json({ success: true, data: lessons });
};

function parseCompletedFlag(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

module.exports.updateVrCourseProgress = async (req, res) => {
  const { courseId } = req.params;
  const { lessonId, video, completed, watchTime } = req.body || {};

  if (!mongoose.isValidObjectId(courseId)) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }

  if (typeof lessonId !== 'string' || !lessonId.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payload: lessonId is required'
    });
  }

  const completedValue = parseCompletedFlag(completed);
  if (completedValue === null) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payload: completed must be a boolean'
    });
  }

  if (typeof video !== 'undefined' && typeof video !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Invalid payload: video must be a string'
    });
  }

  if (typeof watchTime !== 'undefined') {
    const parsedWatchTime = Number(watchTime);
    if (!Number.isFinite(parsedWatchTime) || parsedWatchTime < 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payload: watchTime must be a non-negative number'
      });
    }
  }

  const [user, course] = await Promise.all([
    User.findById(req.user && req.user._id)
      .select('enrolledCourses enrolledCourseIds')
      .lean(),
    Course.findById(courseId)
      .select('sections driveStructure')
      .lean()
  ]);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  if (!course || !isUserEnrolledInCourse(user, courseId)) {
    return res.status(404).json({
      success: false,
      message: 'Course not found or user not enrolled'
    });
  }

  const lessonKey = lessonId.trim();
  const courseLessons = getCourseLessons(course);
  const lessonExists = courseLessons.some((lesson) => String(lesson.id) === lessonKey);
  if (!lessonExists) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payload: lessonId does not exist in course'
    });
  }

  try {
    const progressDoc = await UserCourseProgress.findOneAndUpdate(
      { user: req.user._id, course: courseId },
      { $setOnInsert: { user: req.user._id, course: courseId } },
      { new: true, upsert: true }
    );

    const hasLesson = Array.isArray(progressDoc.completedLessons)
      && progressDoc.completedLessons.includes(lessonKey);

    if (completedValue) {
      if (!hasLesson) progressDoc.completedLessons.push(lessonKey);
    } else if (hasLesson) {
      progressDoc.completedLessons = progressDoc.completedLessons.filter((id) => id !== lessonKey);
    }

    if (progressDoc.lessonViews && typeof progressDoc.lessonViews.get === 'function') {
      const current = Number(progressDoc.lessonViews.get(lessonKey) || 0);
      progressDoc.lessonViews.set(lessonKey, current + 1);
    } else {
      progressDoc.lessonViews = progressDoc.lessonViews || {};
      const current = Number(progressDoc.lessonViews[lessonKey] || 0);
      progressDoc.lessonViews[lessonKey] = current + 1;
    }

    const watchDelta = Number(watchTime);
    if (Number.isFinite(watchDelta) && watchDelta > 0) {
      progressDoc.watchTime = Number(progressDoc.watchTime || 0) + watchDelta;
    }

    progressDoc.lastAccessed = new Date();

    const totalLessons = courseLessons.length;
    progressDoc.completionRate = totalLessons
      ? Math.round((progressDoc.completedLessons.length / totalLessons) * 100)
      : 0;

    await progressDoc.save();

    return res.json({
      success: true,
      data: {
        completedLessons: progressDoc.completedLessons,
        totalLessons,
        completionRate: progressDoc.completionRate,
        courseId: String(courseId),
        lessonId: lessonKey,
        completed: completedValue
      }
    });
  } catch (err) {
    console.error('[VR progress update error]', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error'
    });
  }
};

function buildStreamError(code, message, details) {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  };
}

function statusCodeForStreamError(code) {
  if (code === 'INVALID_INPUT') return 400;
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'UNSUPPORTED_SOURCE') return 400;
  if (code === 'RESOLVE_FAILED') return 502;
  return 500;
}

function getProxyAllowedHostPatterns() {
  const raw = process.env.VR_STREAM_PROXY_ALLOWED_HOSTS
    || '*.googlevideo.com,*.youtube.com,youtu.be,*.googleusercontent.com,*.cloudinary.com';

  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isHostAllowed(hostname, patterns) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;

  return patterns.some((pattern) => {
    if (!pattern) return false;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix);
    }
    return host === pattern;
  });
}

function logStreamEvent(payload) {
  try {
    console.log(JSON.stringify({
      domain: 'vr.stream',
      ts: new Date().toISOString(),
      ...payload
    }));
  } catch (_) {
    console.log('[vr.stream]', payload);
  }
}

module.exports.resolveVrStream = async (req, res) => {
  const requestId = crypto.randomUUID();
  const userId = String(req.user && req.user._id || '');
  const {
    sourceUrl,
    preferredFormat,
    courseId,
    lessonId
  } = req.streamResolveInput || {};

  try {
    const result = await resolveStream({ sourceUrl, preferredFormat });
    if (!result.success) {
      const code = result.error && result.error.code ? result.error.code : 'RESOLVE_FAILED';
      const message = result.error && result.error.message
        ? result.error.message
        : 'Failed to resolve stream';
      const details = result.error && result.error.details ? result.error.details : '';

      logStreamEvent({
        requestId,
        userId,
        courseId,
        lessonId,
        provider: 'unknown',
        result: 'failed',
        code
      });

      return res.status(statusCodeForStreamError(code)).json(buildStreamError(code, message, details));
    }

    const shouldProxy = process.env.VR_STREAM_USE_PROXY === 'true';
    const proxyTtlSeconds = Number(process.env.VR_STREAM_PROXY_TTL_SECONDS) || 300;

    let responseData = result.data;
    if (shouldProxy) {
      const tokenData = createStreamProxyToken({
        sourceUrl: result.data.resolvedUrl,
        format: result.data.format,
        provider: result.data.provider,
        headers: result.data.headers || {}
      }, proxyTtlSeconds);

      responseData = {
        resolvedUrl: `${req.protocol}://${req.get('host')}/api/vr/stream/proxy?token=${encodeURIComponent(tokenData.token)}`,
        format: result.data.format,
        provider: 'proxy',
        expiresAt: tokenData.expiresAt,
        headers: result.data.headers || {}
      };
    }

    logStreamEvent({
      requestId,
      userId,
      courseId,
      lessonId,
      provider: responseData.provider,
      format: responseData.format,
      result: 'success'
    });

    return res.json({
      success: true,
      data: {
        resolvedUrl: responseData.resolvedUrl,
        format: responseData.format,
        provider: responseData.provider,
        expiresAt: responseData.expiresAt,
        headers: responseData.headers || {}
      }
    });
  } catch (err) {
    logStreamEvent({
      requestId,
      userId,
      courseId,
      lessonId,
      provider: 'unknown',
      result: 'failed',
      code: 'RESOLVE_FAILED'
    });

    return res.status(502).json(buildStreamError(
      'RESOLVE_FAILED',
      'Failed to resolve stream URL',
      err && err.message ? err.message : ''
    ));
  }
};

module.exports.proxyVrStream = async (req, res) => {
  const requestId = crypto.randomUUID();
  const token = String(req.query && req.query.token || '');

  const verified = verifyStreamProxyToken(token);
  if (!verified.valid) {
    return res
      .status(statusCodeForStreamError(verified.code || 'UNAUTHORIZED'))
      .json(buildStreamError(verified.code || 'UNAUTHORIZED', verified.message || 'Unauthorized'));
  }

  const payload = verified.payload || {};
  const sourceUrl = String(payload.sourceUrl || '').trim();
  const parsedSource = safeUrlParse(sourceUrl);
  if (!parsedSource) {
    return res.status(400).json(buildStreamError('INVALID_INPUT', 'Invalid source URL in proxy token'));
  }

  const allowedPatterns = getProxyAllowedHostPatterns();
  if (!isHostAllowed(parsedSource.hostname, allowedPatterns)) {
    return res.status(401).json(buildStreamError('UNAUTHORIZED', 'Proxy host is not allowed'));
  }

  const upstreamHeaders = {
    ...(req.headers.range ? { Range: req.headers.range } : {}),
    ...(payload.headers && payload.headers['User-Agent']
      ? { 'User-Agent': String(payload.headers['User-Agent']) }
      : {})
  };

  const timeoutMs = Math.max(1000, Number(process.env.VR_STREAM_PROXY_TIMEOUT_MS) || 12000);

  try {
    const upstream = await axios.get(sourceUrl, {
      responseType: 'stream',
      timeout: timeoutMs,
      headers: upstreamHeaders,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const passHeaders = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'cache-control'];
    for (const headerName of passHeaders) {
      const headerValue = upstream.headers[headerName];
      if (typeof headerValue !== 'undefined') {
        res.setHeader(headerName, headerValue);
      }
    }

    res.status(upstream.status);
    logStreamEvent({
      requestId,
      userId: 'proxy-token',
      provider: payload.provider || 'proxy',
      result: 'success',
      status: upstream.status
    });

    upstream.data.on('error', () => {
      if (!res.headersSent) {
        res.status(502).json(buildStreamError('RESOLVE_FAILED', 'Upstream stream error'));
      } else {
        res.end();
      }
    });

    return upstream.data.pipe(res);
  } catch (err) {
    logStreamEvent({
      requestId,
      userId: 'proxy-token',
      provider: payload.provider || 'proxy',
      result: 'failed',
      code: 'RESOLVE_FAILED'
    });

    return res.status(502).json(buildStreamError(
      'RESOLVE_FAILED',
      'Failed to proxy stream',
      err && err.message ? err.message : ''
    ));
  }
};