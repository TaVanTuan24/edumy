const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const Course = require('../models/course');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const ExpressError = require('../utils/ExpressError');
const { resolveStream, safeUrlParse } = require('../services/streamResolver');
const { createStreamProxyToken, verifyStreamProxyToken } = require('../utils/signStreamToken');
const { getCanonicalSections } = require('../utils/courseContentAdapter');
const { stripFileExtension } = require('../utils/formatLessonName');

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

  return safeSections
    .slice()
    .sort((a, b) => Number(a && a.order) - Number(b && b.order))
    .flatMap((section) => {
      const sectionTitle = String((section && section.title) || 'Course Content');
      const sectionOrder = Number.isFinite(Number(section && section.order))
        ? Number(section.order)
        : null;
      const sectionLessons = Array.isArray(section && section.lessons) ? section.lessons.slice() : [];

      return sectionLessons
        .sort((a, b) => Number(a && a.order) - Number(b && b.order))
        .map((lesson) => ({
          ...lesson,
          sectionTitle,
          sectionOrder
        }));
    });
}

function getCourseLessons(courseDoc) {
  return getOrderedLessonsFromSections(getCanonicalSections(courseDoc)).map((lesson, lessonIndex) => ({
    id: String((lesson && lesson._id) || `lesson_${lessonIndex + 1}`),
    title: stripFileExtension(String((lesson && lesson.title) || 'Untitled Lesson')),
    type: String((lesson && lesson.type) || ''),
    duration: lesson && lesson.duration ? lesson.duration : null,
    order: Number.isFinite(Number(lesson && lesson.order)) ? Number(lesson.order) : lessonIndex,
    sectionTitle: String((lesson && lesson.sectionTitle) || 'Course Content'),
    sectionOrder: Number.isFinite(Number(lesson && lesson.sectionOrder)) ? Number(lesson.sectionOrder) : null,
    content: lesson && lesson.content ? lesson.content : null,
    quiz: Array.isArray(lesson && lesson.quiz) ? lesson.quiz : [],
    questions: Array.isArray(lesson && lesson.content && lesson.content.questions) ? lesson.content.questions : [],
    videoUrl: lesson && (lesson.videoUrl || lesson.preview || lesson.refId) ? (lesson.videoUrl || lesson.preview || lesson.refId) : ''
  }));
}

function hasPlayableVideoSource(lesson) {
  return Boolean(getPlayableVideoSource(lesson));
}

function getPlayableVideoSource(lesson) {
  const candidates = [
    lesson && lesson.videoUrl,
    lesson && lesson.preview,
    lesson && lesson.refId,
    lesson && lesson.content && lesson.content.videoUrl,
    lesson && lesson.content && lesson.content.streamUrl,
    lesson && lesson.content && lesson.content.url
  ];

  const match = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return match ? match.trim() : '';
}

function hasRealSlides(lesson) {
  return extractStructuredSlidePages(lesson).length > 0
    || extractSlidePages(lesson).length > 0
    || !!extractSlideText(lesson);
}

function hasRealQuizQuestions(lesson) {
  return normalizeQuizQuestions(lesson).length > 0;
}

function hasRealTimedQuizEvents(lesson) {
  return normalizeTimedQuizQuestions(lesson).length > 0;
}

function normalizeLessonType(lesson) {
  const raw = String((lesson && lesson.type) || '').trim().toLowerCase();
  const hasSlides = hasRealSlides(lesson);
  const hasQuiz = hasRealQuizQuestions(lesson);
  const hasTimedQuiz = hasRealTimedQuizEvents(lesson);
  const hasVideoUrl = hasPlayableVideoSource(lesson);

  // Trust coherent explicit types first.
  if (raw === 'slide' || raw === 'presentation' || raw === 'ppt' || raw === 'document') {
    return hasSlides ? 'slide' : 'unknown';
  }
  if (raw === 'quiz') {
    return (hasQuiz || hasTimedQuiz) ? 'quiz' : 'unknown';
  }
  if (raw === 'lecture' || raw === 'video') {
    return hasVideoUrl ? 'video' : 'unknown';
  }

  // Strict fallback for legacy / drifted payloads.
  if (hasSlides) return 'slide';
  if (hasQuiz) return 'quiz';
  if (hasVideoUrl) return 'video';
  if (hasTimedQuiz) return 'quiz';

  return 'unknown';
}

function extractSlideText(lesson) {
  const direct = lesson && lesson.content && lesson.content.text;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  if (Array.isArray(direct)) {
    const lines = direct
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim());
    if (lines.length > 0) return lines.join('\n\n');
  }

  const alt = [
    lesson && lesson.content && lesson.content.description,
    lesson && lesson.content && lesson.content.body,
    lesson && lesson.content && lesson.content.summary
  ];

  for (const item of alt) {
    if (typeof item === 'string' && item.trim()) {
      return item.trim();
    }
  }

  return '';
}

function extractSlidePages(lesson) {
  const pages = [];
  const rawSlides = Array.isArray(lesson && lesson.content && lesson.content.slides)
    ? lesson.content.slides
    : (Array.isArray(lesson && lesson.slides)
      ? lesson.slides
      : (Array.isArray(lesson && lesson.content && lesson.content.pages) ? lesson.content.pages : []));

  for (const slide of rawSlides) {
    if (!slide) continue;

    if (typeof slide === 'string') {
      const txt = slide.trim();
      if (txt) pages.push(txt);
      continue;
    }

    const elements = Array.isArray(slide.elements) ? slide.elements : [];
    const textParts = elements
      .filter((el) => el && el.type === 'text' && typeof el.text === 'string' && el.text.trim())
      .map((el) => el.text.trim());

    const objectParts = [
      slide && slide.title,
      slide && slide.text,
      slide && slide.content,
      slide && slide.body,
      slide && slide.description,
      slide && slide.note
    ]
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim());

    const merged = [...textParts, ...objectParts];

    if (merged.length > 0) {
      pages.push(merged.join('\n\n'));
    }
  }

  return pages;
}

function getSlideCanvasSize(lesson, slide) {
  const rawWidth = Number(
    (slide && (slide.canvasWidth ?? slide.width))
    ?? (lesson && lesson.content && (lesson.content.canvasWidth ?? lesson.content.width))
    ?? 1280
  );
  const rawHeight = Number(
    (slide && (slide.canvasHeight ?? slide.height))
    ?? (lesson && lesson.content && (lesson.content.canvasHeight ?? lesson.content.height))
    ?? 720
  );

  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1280;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 720;

  return { width, height };
}

function resolveVrAssetUrl(req, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//i.test(raw) || /^data:/i.test(raw)) {
    return raw;
  }
  if (!req) {
    return raw;
  }

  const prefix = `${req.protocol}://${req.get('host')}`;
  return raw.startsWith('/') ? `${prefix}${raw}` : `${prefix}/${raw}`;
}

function normalizeSlideElementForVr(req, element, slideIndex, elementIndex) {
  if (!element || typeof element !== 'object') return null;

  const type = element.type === 'image' ? 'image' : 'text';
  const normalized = {
    id: String(element.id || `slide-${slideIndex + 1}-el-${elementIndex + 1}`),
    type,
    x: Number.isFinite(Number(element.x)) ? Number(element.x) : 0,
    y: Number.isFinite(Number(element.y)) ? Number(element.y) : 0,
    width: Number.isFinite(Number(element.width)) ? Number(element.width) : (type === 'image' ? 320 : 320),
    height: Number.isFinite(Number(element.height)) ? Number(element.height) : (type === 'image' ? 220 : 80)
  };

  if (type === 'image') {
    normalized.src = resolveVrAssetUrl(req, element.src || element.url || element.imageUrl);
  } else {
    normalized.text = String(element.text || element.content || '').trim();
    normalized.fontSize = Number.isFinite(Number(element.fontSize)) ? Number(element.fontSize) : 28;
    normalized.color = String(element.color || '#1c1d1f').trim() || '#1c1d1f';
    normalized.align = String(element.align || 'left').trim().toLowerCase();
    normalized.bold = Boolean(element.bold);
  }

  return normalized;
}

function extractStructuredSlidePages(reqOrLesson, maybeLesson) {
  const lesson = maybeLesson || reqOrLesson;
  const req = maybeLesson ? reqOrLesson : null;
  const rawSlides = Array.isArray(lesson && lesson.content && lesson.content.slides)
    ? lesson.content.slides
    : (Array.isArray(lesson && lesson.slides)
      ? lesson.slides
      : (Array.isArray(lesson && lesson.content && lesson.content.pages) ? lesson.content.pages : []));

  const pages = [];

  rawSlides.forEach((slide, slideIndex) => {
    if (!slide) return;

    if (typeof slide === 'string') {
      const text = slide.trim();
      if (!text) return;
      const { width, height } = getSlideCanvasSize(lesson, null);
      pages.push({
        id: `slide-${slideIndex + 1}`,
        title: `Slide ${slideIndex + 1}`,
        layout: 'left-text',
        theme: 'light',
        canvasWidth: width,
        canvasHeight: height,
        elements: [{
          id: `slide-${slideIndex + 1}-text-1`,
          type: 'text',
          x: 80,
          y: 80,
          width: Math.max(320, width - 160),
          height: Math.max(120, height - 160),
          text,
          fontSize: 28,
          color: '#1c1d1f',
          align: 'left',
          bold: false
        }]
      });
      return;
    }

    const { width, height } = getSlideCanvasSize(lesson, slide);
    const rawElements = Array.isArray(slide.elements) ? slide.elements : [];
    const elements = rawElements
      .map((element, elementIndex) => normalizeSlideElementForVr(req, element, slideIndex, elementIndex))
      .filter((element) => {
        if (!element) return false;
        if (element.type === 'image') return Boolean(element.src);
        return Boolean(element.text);
      });

    if (elements.length === 0) {
      const fallbackText = String(
        slide.title
        || slide.text
        || slide.content
        || slide.body
        || slide.description
        || ''
      ).trim();

      if (fallbackText) {
        elements.push({
          id: `slide-${slideIndex + 1}-text-1`,
          type: 'text',
          x: 80,
          y: 80,
          width: Math.max(320, width - 160),
          height: Math.max(120, height - 160),
          text: fallbackText,
          fontSize: 28,
          color: '#1c1d1f',
          align: 'left',
          bold: false
        });
      }
    }

    if (elements.length === 0) return;

    pages.push({
      id: String(slide.id || `slide-${slideIndex + 1}`),
      title: String(slide.title || `Slide ${slideIndex + 1}`),
      layout: String(slide.layout || 'left-text'),
      theme: String(slide.theme || 'light'),
      canvasWidth: width,
      canvasHeight: height,
      elements
    });
  });

  return pages;
}

function normalizeQuizQuestions(lesson) {
  const sourceRows = [];

  const appendRows = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (row) sourceRows.push(row);
    }
  };

  appendRows(lesson && lesson.quiz);
  appendRows(lesson && lesson.questions);
  appendRows(lesson && lesson.interactiveQuizzes);
  appendRows(lesson && lesson.content && lesson.content.quiz);
  appendRows(lesson && lesson.content && lesson.content.questions);
  appendRows(lesson && lesson.content && lesson.content.interactiveQuizzes);

  const normalized = [];
  for (const row of sourceRows) {
    if (!row) continue;

    const question = String(
      row.question || row.content || row.prompt || row.title || row.text || ''
    ).trim();

    let rawOptions = [];
    if (Array.isArray(row.options)) rawOptions = row.options;
    else if (Array.isArray(row.answers)) rawOptions = row.answers;
    else if (Array.isArray(row.choices)) rawOptions = row.choices;
    else if (row.options && typeof row.options === 'object') rawOptions = Object.values(row.options);

    const options = rawOptions
      .map((opt) => {
        if (opt == null) return '';
        if (typeof opt === 'string') return opt.trim();
        if (typeof opt === 'object') {
          return String(opt.text || opt.label || opt.value || '').trim();
        }
        return String(opt).trim();
      })
      .filter(Boolean);

    const correctIndexRaw = Number(
      row.correctIndex
      ?? row.correctAnswerIndex
      ?? row.correctOptionIndex
      ?? row.answerIndex
      ?? row.correct_answer_index
      ?? row.correct
      ?? row.correctAnswer
      ?? 0
    );

    if (!question || options.length === 0) continue;

    let computedCorrectIndex = Number.isFinite(correctIndexRaw)
      ? Math.round(correctIndexRaw)
      : 0;

    // Handle one-based index style payloads.
    if (computedCorrectIndex >= 1 && computedCorrectIndex <= options.length) {
      computedCorrectIndex -= 1;
    }

    // Handle correct answer represented as option text.
    if (typeof row.correctAnswer === 'string') {
      const byText = options.findIndex((opt) => opt.toLowerCase() === row.correctAnswer.trim().toLowerCase());
      if (byText >= 0) {
        computedCorrectIndex = byText;
      }
    }

    computedCorrectIndex = Math.max(0, Math.min(options.length - 1, computedCorrectIndex));

    normalized.push({
      question,
      options,
      explanation: String(
        row.explanation
        || row.explain
        || row.reason
        || row.solution
        || row.wrongExplanation
        || row.feedback
        || row.description
        || ''
      ).trim(),
      correctIndex: computedCorrectIndex
    });
  }

  return normalized;
}

function normalizeTimedQuizQuestions(lesson) {
  const sourceRows = [];

  const appendRows = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (row) sourceRows.push(row);
    }
  };

  appendRows(lesson && lesson.interactiveQuizzes);
  appendRows(lesson && lesson.timedQuizzes);
  appendRows(lesson && lesson.popupQuizzes);
  appendRows(lesson && lesson.videoQuizzes);
  appendRows(lesson && lesson.content && lesson.content.interactiveQuizzes);
  appendRows(lesson && lesson.content && lesson.content.timedQuizzes);

  const normalized = [];
  for (const row of sourceRows) {
    if (!row) continue;

    const question = String(
      row.question || row.content || row.prompt || row.title || row.text || ''
    ).trim();

    let rawOptions = [];
    if (Array.isArray(row.options)) rawOptions = row.options;
    else if (Array.isArray(row.answers)) rawOptions = row.answers;
    else if (Array.isArray(row.choices)) rawOptions = row.choices;
    else if (row.options && typeof row.options === 'object') rawOptions = Object.values(row.options);

    const options = rawOptions
      .map((opt) => {
        if (opt == null) return '';
        if (typeof opt === 'string') return opt.trim();
        if (typeof opt === 'object') {
          return String(opt.text || opt.label || opt.value || '').trim();
        }
        return String(opt).trim();
      })
      .filter(Boolean);

    const rawTrigger = row.triggerTimeSec
      ?? row.triggerTime
      ?? row.time
      ?? row.timecode
      ?? row.showAt
      ?? row.timestamp
      ?? row.startAt
      ?? row.at;

    const hasTrigger = !(rawTrigger == null || String(rawTrigger).trim() === '');

    const correctIndexRaw = Number(
      row.correctIndex
      ?? row.correctAnswerIndex
      ?? row.correctOptionIndex
      ?? row.answerIndex
      ?? row.correct_answer_index
      ?? row.correct
      ?? row.correctAnswer
      ?? 0
    );

    if (!question || options.length === 0 || !hasTrigger) continue;

    let computedCorrectIndex = Number.isFinite(correctIndexRaw)
      ? Math.round(correctIndexRaw)
      : 0;

    if (computedCorrectIndex >= 1 && computedCorrectIndex <= options.length) {
      computedCorrectIndex -= 1;
    }

    if (typeof row.correctAnswer === 'string') {
      const byText = options.findIndex((opt) => opt.toLowerCase() === row.correctAnswer.trim().toLowerCase());
      if (byText >= 0) {
        computedCorrectIndex = byText;
      }
    }

    computedCorrectIndex = Math.max(0, Math.min(options.length - 1, computedCorrectIndex));

    const triggerNumber = Number(rawTrigger);
    const triggerTimeSec = Number.isFinite(triggerNumber) ? Math.max(0, triggerNumber) : undefined;

    normalized.push({
      id: String(row._id || row.id || ''),
      question,
      options,
      correctIndex: computedCorrectIndex,
      explanation: String(
        row.explanation
        || row.explain
        || row.reason
        || row.solution
        || row.wrongExplanation
        || row.feedback
        || row.description
        || ''
      ).trim(),
      ...(typeof triggerTimeSec === 'number' ? { triggerTimeSec } : {}),
      ...(typeof rawTrigger === 'string' ? { timecode: rawTrigger.trim() } : {})
    });
  }

  return normalized;
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
      .select('title description images sections')
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
      .select('sections')
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

  const lessons = getCourseLessons(course).map((lesson, idx) => {
    const slidePages = extractStructuredSlidePages(req, lesson);
    const slides = extractSlidePages(lesson);
    const slideText = extractSlideText(lesson);
    const quizQuestions = normalizeQuizQuestions(lesson);
    const timedQuizzes = normalizeTimedQuizQuestions(lesson);
    const normalizedType = normalizeLessonType({
      ...lesson,
      slides,
      slideText,
      quiz: quizQuestions,
      questions: quizQuestions,
      interactiveQuizzes: timedQuizzes
    });

    const shapedLesson = {
      type: normalizedType,
      id: String(lesson.id),
      title: stripFileExtension(String(lesson.title || '')),
      videoUrl: getPlayableVideoSource(lesson),
      slideText,
      slides,
      slidePages,
      slideCanvasWidth: slidePages[0] && slidePages[0].canvasWidth ? slidePages[0].canvasWidth : 1280,
      slideCanvasHeight: slidePages[0] && slidePages[0].canvasHeight ? slidePages[0].canvasHeight : 720,
      slideCount: slidePages.length || slides.length,
      quizQuestions,
      quizQuestionsCount: quizQuestions.length,
      timedQuizzes,
      interactiveQuizzes: timedQuizzes,
      duration: lesson.duration || null,
      order: Number.isFinite(Number(lesson.order)) ? Number(lesson.order) : idx + 1,
      sectionTitle: String(lesson.sectionTitle || ''),
      sectionOrder: Number.isFinite(Number(lesson.sectionOrder)) ? Number(lesson.sectionOrder) : null,
      isCompleted: completedSet.has(String(lesson.id))
    };

    console.log('[VR] lesson payload shaped:', JSON.stringify({
      courseId,
      lessonId: shapedLesson.id,
      title: shapedLesson.title,
      type: shapedLesson.type,
      hasSlides: shapedLesson.slideCount > 0 || shapedLesson.slidePages.length > 0 || Boolean(shapedLesson.slideText),
      slidePageCount: shapedLesson.slidePages.length,
      slideCanvasWidth: shapedLesson.slideCanvasWidth,
      slideCanvasHeight: shapedLesson.slideCanvasHeight,
      quizCount: shapedLesson.quizQuestionsCount,
      timedQuizCount: shapedLesson.timedQuizzes.length,
      hasVideoUrl: Boolean(shapedLesson.videoUrl)
    }));

    return shapedLesson;
  });

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
      .select('sections')
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

module.exports.saveVrQuizResult = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      quizId,
      score,
      total,
      attemptId,
      durationSeconds,
      passed,
      attemptNumber,
      lessonName,
      lessonType,
      sectionIndex,
      lessonIndex
    } = req.body || {};

    if (!mongoose.isValidObjectId(courseId)) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    if (typeof quizId !== 'string' || !quizId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payload: quizId is required'
      });
    }

    const parsedScore = Number(score);
    const parsedTotal = Number(total);
    if (!Number.isFinite(parsedScore) || parsedScore < 0 || !Number.isFinite(parsedTotal) || parsedTotal < 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payload: score and total must be non-negative numbers'
      });
    }

    const [user, course] = await Promise.all([
      User.findById(req.user && req.user._id)
        .select('enrolledCourses enrolledCourseIds')
        .lean(),
      Course.findById(courseId)
        .select('sections')
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

    const quizKey = quizId.trim();
    const progressDoc = await UserCourseProgress.findOneAndUpdate(
      { user: req.user._id, course: courseId },
      { $setOnInsert: { user: req.user._id, course: courseId } },
      { new: true, upsert: true }
    );

    const existingIndex = Array.isArray(progressDoc.quizResults)
      ? progressDoc.quizResults.findIndex((entry) => String(entry.quizId) === quizKey)
      : -1;

    if (existingIndex >= 0) {
      progressDoc.quizResults[existingIndex].score = parsedScore;
      progressDoc.quizResults[existingIndex].total = parsedTotal;
    } else {
      progressDoc.quizResults.push({
        quizId: quizKey,
        score: parsedScore,
        total: parsedTotal
      });
    }

    progressDoc.lastAccessed = new Date();
    progressDoc.lastLessonId = quizKey;
    progressDoc.lastLessonName = String(lessonName || '').trim();
    progressDoc.lastLessonType = String(lessonType || 'quiz').trim().toLowerCase();
    progressDoc.lastSectionIndex = Number.isInteger(Number(sectionIndex)) ? Number(sectionIndex) : null;
    progressDoc.lastLessonIndex = Number.isInteger(Number(lessonIndex)) ? Number(lessonIndex) : null;

    progressDoc.recentActivity = Array.isArray(progressDoc.recentActivity) ? progressDoc.recentActivity : [];
    progressDoc.recentActivity.push({
      type: 'quiz-result',
      label: `Completed quiz ${progressDoc.lastLessonName || ''}`.trim(),
      lessonId: quizKey,
      lessonName: progressDoc.lastLessonName,
      lessonType: progressDoc.lastLessonType,
      sectionIndex: progressDoc.lastSectionIndex,
      lessonIndex: progressDoc.lastLessonIndex,
      createdAt: progressDoc.lastAccessed
    });
    progressDoc.recentActivity = progressDoc.recentActivity.slice(-20);

    await progressDoc.save();

    return res.json({
      success: true,
      data: {
        courseId: String(courseId),
        quizId: quizKey,
        score: parsedScore,
        total: parsedTotal,
        attemptId: String(attemptId || ''),
        durationSeconds: Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : 0,
        passed: typeof passed === 'boolean' ? passed : (parsedTotal > 0 ? parsedScore >= Math.ceil(parsedTotal * 0.7) : false),
        attemptNumber: Number.isInteger(Number(attemptNumber)) ? Number(attemptNumber) : 1
      }
    });
  } catch (err) {
    console.error('[VR quiz result save error]', err);
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
  } catch {
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
