const Course = require('../models/course');
const scanDriveStructure = require('../utils/driveScanner');
const Progress = require('../models/progress');
const Note = require('../models/note');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const mongoose = require('mongoose');
const { awardGamification, buildGamificationViewModel, recordLearningActivity } = require('../utils/gamification');
const Discussion = require('../models/discussion');
const { logAuditEvent } = require('../utils/auditLogger');
const { wantsJson } = require('../utils/requestHelpers');
const logger = require('../utils/logger');
const AnalyticsEvent = require('../models/analyticsEvent');
const { ANALYTICS_EVENTS, trackEventSafe } = require('../services/analyticsEventService');
const { buildLearnerDashboard } = require('../services/learnerDashboardService');
const { getEffectiveCourseStatus } = require('../utils/courseLifecycle');
const { findLessonContext } = require('../utils/lessonLocator');
const { buildLessonAiContext, buildLessonAiPrompt } = require('../services/lessonAiContextService');
const { generatePromptReply, normalizeAiModel } = require('../services/ai/chatOrchestrator');
const {
  applyGeneratedCourseSummary,
  clearGeneratedCourseSummary,
  generateCourseSummary
} = require('../services/ai/courseSummaryService');
const { buildCourseSectionsFromPreview } = require('../services/youtube/youtubeCourseImportService');
const {
  getCanonicalSections,
  syncCourseContent
} = require('../utils/courseContentAdapter');

function countCourseLessons(course) {
  const sections = getCanonicalSections(course);
  return sections.reduce((total, section) => {
    const lessons = Array.isArray(section && section.lessons) ? section.lessons : [];
    return total + lessons.length;
  }, 0);
}


function sanitizeCourseInput(rawCourse) {
  const source = rawCourse && typeof rawCourse === 'object' ? rawCourse : {};
  const allowedFields = ['title', 'description', 'driveLink', 'topic', 'sections'];
  let parsedSections = Array.isArray(source.sections) ? source.sections : null;

  if (!parsedSections && typeof source.sectionsJson === 'string' && source.sectionsJson.trim()) {
    try {
      const candidate = JSON.parse(source.sectionsJson);
      if (Array.isArray(candidate)) {
        const looksLikePreview = candidate.some((section) => Array.isArray(section && section.videos));
        parsedSections = looksLikePreview ? buildCourseSectionsFromPreview(candidate) : candidate;
      }
    } catch {
      parsedSections = null;
    }
  }

  const sanitized = allowedFields.reduce((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      acc[key] = source[key];
    }
    return acc;
  }, {});

  if (parsedSections) {
    sanitized.sections = parsedSections;
  }

  return sanitized;
}

function buildCourseFormData(rawCourse = {}) {
  return {
    title: String(rawCourse.title || '').trim(),
    description: String(rawCourse.description || '').trim(),
    driveLink: String(rawCourse.driveLink || '').trim(),
    youtubePlaylistUrl: String(rawCourse.youtubePlaylistUrl || '').trim(),
    importSource: String(rawCourse.importSource || '').trim().toLowerCase() === 'youtube' ? 'youtube' : 'drive',
    sectionsJson: String(rawCourse.sectionsJson || '').trim(),
    topic: String(rawCourse.topic || '').trim(),
    imageUrl: String(rawCourse.imageUrl || '').trim(),
    thumbnailMode: String(rawCourse.thumbnailMode || '').trim().toLowerCase() === 'url' ? 'url' : 'upload'
  };
}

function isSafeExternalImageUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return { ok: true, value: '' };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, message: 'Thumbnail URL must be a valid absolute URL.' };
  }

  const protocol = String(parsed.protocol || '').toLowerCase();
  if (!['http:', 'https:'].includes(protocol)) {
    return { ok: false, message: 'Thumbnail URL must use http or https.' };
  }

  return { ok: true, value: parsed.toString() };
}

function buildExternalImageEntry(imageUrl) {
  return {
    url: imageUrl,
    filename: `external-url-${Date.now()}`
  };
}

function getUploadedImageEntries(files) {
  return Array.isArray(files)
    ? files.map((file) => ({ url: file.path, filename: file.filename }))
    : [];
}

function resolveCourseImages({ files, imageUrl, thumbnailMode }) {
  const uploadedImages = getUploadedImageEntries(files);
  if (uploadedImages.length > 0) {
    return { ok: true, images: uploadedImages, source: 'upload' };
  }

  if (thumbnailMode === 'upload') {
    return { ok: true, images: [], source: 'none' };
  }

  const validation = isSafeExternalImageUrl(imageUrl);
  if (!validation.ok) {
    return { ok: false, images: [], source: 'url', message: validation.message };
  }

  if (!validation.value) {
    return { ok: true, images: [], source: 'none' };
  }

  return {
    ok: true,
    images: [buildExternalImageEntry(validation.value)],
    source: 'url'
  };
}


function appendRecentActivity(progressDoc, activity) {
  const entry = {
    type: String(activity && activity.type || 'activity'),
    label: String(activity && activity.label || 'Learning activity'),
    lessonId: String(activity && activity.lessonId || ''),
    lessonName: String(activity && activity.lessonName || ''),
    lessonType: String(activity && activity.lessonType || ''),
    sectionIndex: Number.isInteger(Number(activity && activity.sectionIndex)) ? Number(activity.sectionIndex) : null,
    lessonIndex: Number.isInteger(Number(activity && activity.lessonIndex)) ? Number(activity.lessonIndex) : null,
    createdAt: activity && activity.createdAt ? new Date(activity.createdAt) : new Date()
  };

  progressDoc.recentActivity = Array.isArray(progressDoc.recentActivity) ? progressDoc.recentActivity : [];
  progressDoc.recentActivity.push(entry);
  progressDoc.recentActivity = progressDoc.recentActivity
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-20);
}

function setResumeMetadata(progressDoc, course, payload = {}) {
  const sectionIndex = Number.isInteger(Number(payload.sectionIndex)) ? Number(payload.sectionIndex) : null;
  const lessonIndex = Number.isInteger(Number(payload.lessonIndex)) ? Number(payload.lessonIndex) : null;
  const lessonId = String(payload.lessonId || '').trim();
  const lessonName = String(payload.lessonName || '').trim();
  const lessonType = String(payload.lessonType || '').trim();

  let lessonContext = null;
  if (course) {
    lessonContext = findLessonContext(course, {
      lessonId,
      sectionIndex,
      lessonIndex
    });
  }

  progressDoc.lastLessonId = lessonId || String(lessonContext && lessonContext.lesson && lessonContext.lesson._id || progressDoc.lastLessonId || '');
  progressDoc.lastLessonName = lessonName || String(lessonContext && lessonContext.lesson && lessonContext.lesson.title || progressDoc.lastLessonName || '');
  progressDoc.lastLessonType = lessonType || String(lessonContext && lessonContext.lesson && lessonContext.lesson.type || progressDoc.lastLessonType || '');
  progressDoc.lastSectionIndex = sectionIndex !== null ? sectionIndex : (lessonContext ? lessonContext.sectionIndex : progressDoc.lastSectionIndex);
  progressDoc.lastLessonIndex = lessonIndex !== null ? lessonIndex : (lessonContext ? lessonContext.lessonIndex : progressDoc.lastLessonIndex);
}

async function markUserLearningActivity(userId, activityDate) {
  const user = await User.findById(userId);
  if (!user) return null;

  await recordLearningActivity(user, activityDate, { save: true });
  return user;
}

async function markCourseSeenForUser(userId, course) {
  if (!userId || !course) return { hadUpdate: false, markedSeen: false };

  const user = await User.findById(userId);
  if (!user) return { hadUpdate: false, markedSeen: false };

  let enrollment = user.findEnrollment(course._id);
  if (!enrollment) return { hadUpdate: false, markedSeen: false };

  if (!enrollment.courseId) {
    const idx = (user.enrolledCourses || []).findIndex((entry) => String(entry) === String(course._id));
    if (idx !== -1) {
      user.enrolledCourses[idx] = {
        courseId: course._id,
        progress: {
          completedCount: 0,
          lastLessonId: ''
        },
        lastSeenUpdatedAt: null,
        enrolledAt: new Date()
      };
      enrollment = user.enrolledCourses[idx];
    }
  }

  if (!enrollment || !enrollment.courseId) return { hadUpdate: false, markedSeen: false };

  const courseUpdatedAt = course.updatedAt ? new Date(course.updatedAt) : new Date();
  const lastSeen = enrollment.lastSeenUpdatedAt ? new Date(enrollment.lastSeenUpdatedAt) : null;
  const hadUpdate = !lastSeen || courseUpdatedAt > lastSeen;

  if (hadUpdate) {
    enrollment.lastSeenUpdatedAt = courseUpdatedAt;
    await user.save();
    return { hadUpdate: true, markedSeen: true };
  }

  return { hadUpdate: false, markedSeen: false };
}

module.exports.index = async (req, res) => {
  const dashboard = await buildLearnerDashboard(req.user._id);
  res.render('courses/index', {
    courses: dashboard.myCourses,
    dashboard
  });
};

module.exports.renderNewForm = (req, res) => {
  res.render('courses/new', {
    formData: {},
    thumbnailError: ''
  });
};

module.exports.createCourse = async (req, res) => {
  const formData = buildCourseFormData(req.body.course);
  const imageResult = resolveCourseImages({
    files: req.files,
    imageUrl: formData.imageUrl,
    thumbnailMode: formData.thumbnailMode
  });

  if (!imageResult.ok) {
    return res.status(400).render('courses/new', {
      formData,
      thumbnailError: imageResult.message
    });
  }

  const course = new Course(sanitizeCourseInput(req.body.course));
  course.images = imageResult.images;
  course.author = req.user._id;
  const importSource = String(req.body && req.body.course && req.body.course.importSource || 'drive').trim().toLowerCase();

  if (importSource !== 'youtube') {
  const driveLink = String(course.driveLink || '');
  const match = driveLink.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) {
    const folderId = match[1];
    try {
      const structure = await scanDriveStructure(folderId);
      course.sections = structure.reverse();
    } catch (err) {
      logger.error({ err }, "Google Drive scan error");
      req.flash('error', 'Could not scan Drive content. Please check the link.');
    }
  } else if (!Array.isArray(course.sections) || !course.sections.length) {
    req.flash('error', 'Invalid Drive link.');
  }

  }

  await course.save();

  let aiSummaryFailed = false;
  try {
    const summaryResult = await generateCourseSummary(course, {
      userId: req.user && req.user._id
    });
    applyGeneratedCourseSummary(course, summaryResult);
    await course.save();
    logger.info('[course-summary] generated once for course: %s', String(course._id));
  } catch (err) {
    aiSummaryFailed = true;
    clearGeneratedCourseSummary(course);
    await course.save();
    logger.error({ err }, '[course-summary] failed to generate AI summary');
  }

  await logAuditEvent({
    req,
    action: 'course_created',
    targetType: 'course',
    targetId: String(course._id),
    metadata: {
      title: course.title,
      topic: course.topic,
      sectionCount: Array.isArray(course.sections) ? course.sections.length : 0,
      importSource
    }
  });
  req.flash('success', aiSummaryFailed
    ? 'Successfully made a new course. AI summary could not be generated yet.'
    : 'Successfully made a new course!');
  res.redirect(`/courses/${course._id}`);
};

module.exports.showCourses = async (req, res) => {
  const course = await Course.findById(req.params.id)
    .populate({ path: 'reviews', populate: { path: 'author' } })
    .populate('author');

  if (!course) {
    req.flash('error', 'Cannot find that course!');
    return res.redirect('/courses');
  }

  const updateStatus = await markCourseSeenForUser(req.user && req.user._id, course);
  const effectiveStatus = getEffectiveCourseStatus(course);

  syncCourseContent(course);

  let completedVideos = [];
  let gamification = null;
  if (req.user) {
    const progress = await Progress.findOne({ user: req.user._id, course: course._id });
    if (progress?.completedVideos) completedVideos = progress.completedVideos;

    const profileUser = await User.findById(req.user._id);
    if (profileUser) {
      await recordLearningActivity(profileUser, new Date(), { save: true });
      gamification = buildGamificationViewModel(profileUser);
    }
  }

  const notes = await Note.find({ user: req.user?._id, course: course._id });
  const discussionHighlights = await Discussion.find({ course: course._id })
    .populate('author', 'username')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  const normalizedDiscussionHighlights = (discussionHighlights || []).map((entry) => {
    const answersCount = Array.isArray(entry.answers) ? entry.answers.length : 0;
    const score = (Array.isArray(entry.upvoters) ? entry.upvoters.length : 0)
      - (Array.isArray(entry.downvoters) ? entry.downvoters.length : 0);

    return {
      ...entry,
      answersCount,
      score
    };
  });

  const sectionNotes = Array(Array.isArray(course.sections) ? course.sections.length : 0).fill('');
  notes.forEach(n => {
    sectionNotes[n.sectionIndex] = n.content;
  });

  res.render('courses/show', {
    course,
    completedVideos,
    sectionNotes,
    hasCourseUpdate: updateStatus.hadUpdate,
    gamification,
    discussionHighlights: normalizedDiscussionHighlights,
    courseStatusNotice: effectiveStatus !== 'published'
      ? 'This course is currently not publicly listed, but you can continue learning because you are already enrolled.'
      : ''
  });
};

module.exports.renderEditForm = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) {
    req.flash('error', 'Cannot find that course!');
    return res.redirect('/courses');
  }
  res.render('courses/edit', { course });
};

module.exports.updateCourse = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) {
    req.flash('error', 'Cannot find that course!');
    return res.redirect('/courses');
  }

  const imageResult = resolveCourseImages({
    files: req.files,
    imageUrl: req.body && req.body.course ? req.body.course.imageUrl : '',
    thumbnailMode: req.body && req.body.course ? req.body.course.thumbnailMode : 'upload'
  });
  if (!imageResult.ok) {
    req.flash('error', imageResult.message);
    return res.redirect(`/courses/${req.params.id}/edit`);
  }

  course.set(sanitizeCourseInput(req.body.course));

  const imgs = imageResult.source === 'upload' ? imageResult.images : [];

  if (imgs.length) {
    course.images.push(...imgs);
  } else if (imageResult.source === 'url' && imageResult.images.length) {
    course.images.push(...imageResult.images);
  }
  await course.save();
  await logAuditEvent({
    req,
    action: 'course_updated',
    targetType: 'course',
    targetId: String(course._id),
    metadata: {
      title: course.title,
      topic: course.topic,
      imageSource: imageResult.source
    }
  });
  req.flash('success', 'Successfully updated course!');
  res.redirect(`/courses/${course._id}`);
};

module.exports.regenerateAiSummary = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) {
    if (wantsJson(req)) {
      return res.status(404).json({ success: false, error: 'Course not found.' });
    }
    req.flash('error', 'Course not found.');
    return res.redirect('/courses');
  }

  const redirectTo = `/explore/${course._id}/preview`;

  try {
    const summaryResult = await generateCourseSummary(course, {
      userId: req.user && req.user._id
    });
    applyGeneratedCourseSummary(course, summaryResult);
    await course.save();
    logger.info('[course-summary] generated once for course: %s', String(course._id));

    if (wantsJson(req)) {
      return res.json({
        success: true,
        summary: summaryResult.summary,
        aiSummaryGeneratedAt: summaryResult.generatedAt,
        aiSummaryModel: summaryResult.model
      });
    }

    req.flash('success', `AI summary regenerated with ${summaryResult.model}.`);
    return res.redirect(redirectTo);
  } catch (err) {
    logger.error({ err }, '[course-summary] failed to generate AI summary');

    if (wantsJson(req)) {
      return res.status(503).json({
        success: false,
        error: 'AI summary is temporarily unavailable.'
      });
    }

    req.flash('error', 'AI summary is temporarily unavailable.');
    return res.redirect(redirectTo);
  }
};

module.exports.deleteCourse = async (req, res) => {
  const course = await Course.findByIdAndDelete(req.params.id);
  if (course) {
    await logAuditEvent({
      req,
      action: 'course_deleted',
      targetType: 'course',
      targetId: String(course._id),
      metadata: {
        title: course.title
      }
    });
  }
  req.flash('success', 'Successfully deleted course!');
  res.redirect('/courses');
};

module.exports.updateProgress = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { video, completed, lessonId, lessonName, lessonType, sectionIndex, lessonIndex } = req.body;
    const userId = req.user._id;

    const hasLessonId = !!lessonId;
    const hasVideo = typeof video === 'string' && video.length > 0;
    if (!hasVideo && !hasLessonId) throw new Error('Missing video URL or invalid video URL format');

    const videoLink = hasVideo ? video.split('?')[0] : '';
    const courseObjectId = new mongoose.Types.ObjectId(courseId);

    if (hasVideo) {
      let progress = await Progress.findOne({ user: userId, course: courseObjectId });
      if (!progress) {
        progress = new Progress({ user: userId, course: courseObjectId, completedVideos: [] });
      }

      const alreadyExists = progress.completedVideos.some(v => v.split('?')[0] === videoLink);

      if (completed === true || completed === 'true') {
        if (!alreadyExists) progress.completedVideos.push(videoLink);
      } else {
        progress.completedVideos = progress.completedVideos.filter(v => v.split('?')[0] !== videoLink);
      }

      await progress.save();
    }

    if (lessonId) {
      const progressDoc = await UserCourseProgress.findOneAndUpdate(
        { user: userId, course: courseObjectId },
        { $setOnInsert: { user: userId, course: courseObjectId } },
        { new: true, upsert: true }
      );

      const lessonKey = String(lessonId);
      const hasLesson = progressDoc.completedLessons.includes(lessonKey);

      let lessonJustCompleted = false;
      if (completed === true || completed === 'true') {
        if (!hasLesson) progressDoc.completedLessons.push(lessonKey);
        lessonJustCompleted = !hasLesson;
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

      const course = await Course.findById(courseObjectId).select('sections');
      progressDoc.lastAccessed = new Date();
      setResumeMetadata(progressDoc, course, { lessonId, lessonName, lessonType, sectionIndex, lessonIndex });
      appendRecentActivity(progressDoc, {
        type: completed === true || completed === 'true' ? 'lesson-complete' : 'lesson-progress',
        label: completed === true || completed === 'true'
          ? `Completed ${progressDoc.lastLessonName || 'lesson'}`
          : `Continued ${progressDoc.lastLessonName || 'lesson'}`,
        lessonId,
        lessonName: progressDoc.lastLessonName,
        lessonType: progressDoc.lastLessonType,
        sectionIndex: progressDoc.lastSectionIndex,
        lessonIndex: progressDoc.lastLessonIndex,
        createdAt: progressDoc.lastAccessed
      });

      const watchDelta = Number(req.body.watchTime);
      if (Number.isFinite(watchDelta) && watchDelta > 0) {
        progressDoc.watchTime = Number(progressDoc.watchTime || 0) + watchDelta;
      }

      const totalLessons = countCourseLessons(course);
      progressDoc.completionRate = totalLessons
        ? Math.round((progressDoc.completedLessons.length / totalLessons) * 100)
        : 0;

      await progressDoc.save();

      const activityUser = await markUserLearningActivity(userId, progressDoc.lastAccessed);

      if (lessonJustCompleted) {
        const user = activityUser || await User.findById(userId);
        if (user) {
          await awardGamification(user, { action: 'lessonComplete' });

          if (progressDoc.completionRate === 100) {
            await awardGamification(user, { action: 'courseComplete' });
          }
        }

        trackEventSafe({
          req,
          eventType: ANALYTICS_EVENTS.LESSON_COMPLETED,
          course: courseObjectId,
          lessonId,
          metadata: {
            lessonTitle: progressDoc.lastLessonName || lessonName || '',
            lessonType: progressDoc.lastLessonType || lessonType || '',
            sectionIndex: progressDoc.lastSectionIndex,
            lessonIndex: progressDoc.lastLessonIndex,
            completionSource: hasVideo ? 'video_end' : 'manual'
          }
        });

        if (progressDoc.completionRate === 100) {
          (async () => {
            const exists = await AnalyticsEvent.exists({
              user: userId,
              course: courseObjectId,
              eventType: ANALYTICS_EVENTS.COURSE_COMPLETED
            });

            if (exists) return;

            trackEventSafe({
              req,
              eventType: ANALYTICS_EVENTS.COURSE_COMPLETED,
              course: courseObjectId,
              metadata: {
                completionRate: progressDoc.completionRate,
                completedLessonsCount: progressDoc.completedLessons.length,
                totalLessonsCount: totalLessons,
                completedAt: progressDoc.lastAccessed ? progressDoc.lastAccessed.toISOString() : new Date().toISOString()
              }
            });
          })().catch((err) => {
            logger.warn({ err }, 'Course completion analytics check failed');
          });
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[Progress save error]');
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.saveQuizResult = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { quizId, score, total, attemptId, durationSeconds, passed, attemptNumber, lessonName, lessonType, sectionIndex, lessonIndex } = req.body;
    const userId = req.user._id;

    if (!quizId) {
      return res.status(400).json({ success: false, error: 'Missing quizId' });
    }

    const courseObjectId = new mongoose.Types.ObjectId(courseId);
    const progressDoc = await UserCourseProgress.findOneAndUpdate(
      { user: userId, course: courseObjectId },
      { $setOnInsert: { user: userId, course: courseObjectId } },
      { new: true, upsert: true }
    );

    const quizKey = String(quizId);
    const nextScore = Number(score) || 0;
    const nextTotal = Number(total) || 0;
    const existingIndex = progressDoc.quizResults.findIndex((entry) => String(entry.quizId) === quizKey);

    if (existingIndex >= 0) {
      progressDoc.quizResults[existingIndex].score = nextScore;
      progressDoc.quizResults[existingIndex].total = nextTotal;
    } else {
      progressDoc.quizResults.push({ quizId: quizKey, score: nextScore, total: nextTotal });
    }

    const course = await Course.findById(courseObjectId).select('sections');
    progressDoc.lastAccessed = new Date();
    setResumeMetadata(progressDoc, course, {
      lessonId: quizKey,
      lessonName,
      lessonType,
      sectionIndex,
      lessonIndex
    });
    appendRecentActivity(progressDoc, {
      type: 'quiz-result',
      label: `Completed quiz ${progressDoc.lastLessonName || ''}`.trim(),
      lessonId: quizKey,
      lessonName: progressDoc.lastLessonName,
      lessonType: progressDoc.lastLessonType || 'quiz',
      sectionIndex: progressDoc.lastSectionIndex,
      lessonIndex: progressDoc.lastLessonIndex,
      createdAt: progressDoc.lastAccessed
    });

    await progressDoc.save();
    await markUserLearningActivity(userId, progressDoc.lastAccessed);

    trackEventSafe({
      req,
      eventType: ANALYTICS_EVENTS.QUIZ_COMPLETED,
      course: courseObjectId,
      lessonId: quizKey,
      quizId: quizKey,
      metadata: {
        attemptId: attemptId || '',
        score: nextScore,
        total: nextTotal,
        percentage: nextTotal > 0 ? Math.round((nextScore / nextTotal) * 100) : 0,
        durationSeconds: Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : null,
        passed: typeof passed === 'boolean' ? passed : null,
        attemptNumber: Number.isFinite(Number(attemptNumber)) ? Number(attemptNumber) : null,
        lessonTitle: progressDoc.lastLessonName || lessonName || '',
        lessonType: progressDoc.lastLessonType || lessonType || 'quiz',
        sectionIndex: progressDoc.lastSectionIndex,
        lessonIndex: progressDoc.lastLessonIndex
      }
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[Quiz Result Save Error]');
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.saveNote = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { sectionIndex, content } = req.body;
    const userId = req.user._id;

    let note = await Note.findOne({ user: userId, course: courseId, sectionIndex });
    if (!note) {
      note = new Note({ user: userId, course: courseId, sectionIndex, content });
    } else {
      note.content = content;
    }

    await note.save();
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[Notes error]');
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.createReview = async (req, res) => {
  try {
    const courseId = req.params.id;
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || '').trim();

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Invalid rating' });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    course.reviewEntries = Array.isArray(course.reviewEntries) ? course.reviewEntries : [];
    course.reviewEntries.push({
      user: req.user && req.user._id,
      rating: rating,
      comment: comment
    });

    await course.save();
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[Review Create Error]');
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.getReviews = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('reviewEntries.user', 'username');

    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    const reviews = Array.isArray(course.reviewEntries) ? course.reviewEntries : [];
    const total = reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0);
    const avg = reviews.length ? total / reviews.length : 0;

    res.json({
      success: true,
      reviews: reviews.map((r) => ({
        user: r.user && r.user.username ? r.user.username : '',
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt
      })),
      averageRating: avg,
      reviewCount: reviews.length
    });
  } catch (err) {
    logger.error({ err }, '[Review Fetch Error]');
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.askLessonAi = async (req, res) => {
  const startedAt = Date.now();
  let selectedModel = '';
  try {
    const { courseId } = req.params;
    const { lessonId, sectionIndex, lessonIndex, action, question, model } = req.body || {};

    const course = await Course.findById(courseId).select('title topic description sections');
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    syncCourseContent(course);

    const context = await buildLessonAiContext({
      userId: req.user._id,
      course,
      lessonId,
      sectionIndex,
      lessonIndex
    });

    if (!context) {
      return res.status(400).json({ success: false, error: 'Invalid lesson reference' });
    }

    selectedModel = normalizeAiModel(model);
    const prompt = buildLessonAiPrompt({
      context,
      action,
      question
    });

    const reply = await generatePromptReply({
      userId: req.user._id,
      model: selectedModel,
      prompt,
      options: {
        temperature: 0.3,
        topP: 0.9,
        maxTokens: 1400,
        timeoutMs: 120000
      }
    });

    const safeAction = String(action || 'custom').trim().toLowerCase() || 'custom';
    const profileUser = await User.findById(req.user._id);
    if (profileUser) {
      await awardGamification(profileUser, { action: 'aiTutor', meta: { lessonAction: safeAction } });
    }

    trackEventSafe({
      req,
      eventType: ANALYTICS_EVENTS.AI_QUESTION_ASKED,
      course: courseId,
      lessonId: context.lessonId || lessonId,
      metadata: {
        messageLength: String(question || '').length,
        chatId: '',
        model: selectedModel,
        providerType: 'user_byok',
        action: safeAction,
        success: true,
        latencyMs: Date.now() - startedAt
      }
    });

    return res.json({
      success: true,
      model: selectedModel,
      lesson: {
        id: context.lessonId,
        name: context.lessonName,
        type: context.lessonType,
        sectionTitle: context.sectionTitle
      },
      answer: reply
    });
  } catch (err) {
    logger.error({ err }, '[Lesson AI Error]');
    trackEventSafe({
      req,
      eventType: ANALYTICS_EVENTS.AI_QUESTION_ASKED,
      course: req.params && req.params.courseId,
      lessonId: req.body && req.body.lessonId,
      metadata: {
        messageLength: String(req.body && req.body.question || '').length,
        chatId: '',
        model: selectedModel,
        providerType: 'user_byok',
        action: String(req.body && req.body.action || 'custom').trim().toLowerCase() || 'custom',
        success: false,
        latencyMs: Date.now() - startedAt
      }
    });
    if (err.publicMessage) {
      return res.status(err.statusCode || 503).json({ success: false, error: err.publicMessage });
    }
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({ success: false, error: 'AI service unavailable. Please check the configured AI provider.' });
    }
    return res.status(500).json({ success: false, error: 'Failed to generate AI tutor response.' });
  }
};
