'use strict';

const mongoose = require('mongoose');
const Course = require('../models/course');
const Reflection = require('../models/Reflection');
const AnalyticsEvent = require('../models/analyticsEvent');
const ExpressError = require('../utils/ExpressError');
const logger = require('../utils/logger');
const { generateReflectionSuggestions, generateReflectionSummary } = require('../services/ai/reflectionAiService');

// ---- Helpers ----

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function getCanonicalLesson(course, sectionIndex, lessonIndex) {
  const si = Number(sectionIndex);
  const li = Number(lessonIndex);
  if (!course || !Array.isArray(course.sections)) return null;
  const section = course.sections[si];
  if (!section || !Array.isArray(section.lessons)) return null;
  return section.lessons[li] || null;
}

function getLessonId(course, sectionIndex, lessonIndex) {
  const lesson = getCanonicalLesson(course, sectionIndex, lessonIndex);
  return lesson ? String(lesson._id || '') : '';
}

function buildLessonContentSummary(lesson) {
  if (!lesson) return {};

  const parts = [];

  // Collect content text from slides
  if (lesson.content && Array.isArray(lesson.content.slides)) {
    for (const slide of lesson.content.slides) {
      if (slide.elements) {
        for (const el of slide.elements) {
          if (el.text) parts.push(String(el.text).trim());
        }
      }
      if (slide.text) parts.push(String(slide.text).trim());
    }
  }

  // Collect content from description
  if (lesson.description) parts.push(String(lesson.description).trim());

  // Collect quiz questions text
  let quizText = '';
  if (Array.isArray(lesson.quiz) && lesson.quiz.length) {
    quizText = lesson.quiz.map((q) => q.question || '').filter(Boolean).join('; ');
  }

  return {
    lessonTitle: lesson.title || '',
    lessonType: lesson.type || '',
    lessonDescription: lesson.description || '',
    mainContent: parts.join('\n').slice(0, 4000),
    existingQuizQuestions: quizText
  };
}

function normalizeReflectionConfig(body) {
  const src = body || {};
  const rubric = src.rubric || {};

  return {
    enabled: Boolean(src.enabled),
    title: String(src.title || 'Exit Ticket').trim() || 'Exit Ticket',
    prompt: String(src.prompt || '').trim(),
    purpose: String(src.purpose || '').trim(),
    required: Boolean(src.required),
    minLength: Math.max(0, Number(src.minLength) || 0),
    rubric: {
      good: String(rubric.good || '').trim(),
      partial: String(rubric.partial || '').trim(),
      weak: String(rubric.weak || '').trim()
    },
    webOnly: src.webOnly !== false,
    createdByAI: Boolean(src.createdByAI)
  };
}

// ---- Admin: Get reflection config for a lesson ----

module.exports.getReflectionConfig = async (req, res) => {
  const { id: courseId, sectionIndex, lessonIndex } = req.params;

  if (!mongoose.isValidObjectId(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  const course = await Course.findById(courseId).select('sections');
  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  const lesson = getCanonicalLesson(course, sectionIndex, lessonIndex);
  if (!lesson) {
    return res.status(404).json({ success: false, error: 'Lesson not found' });
  }

  const reflection = lesson.reflection || {};

  return res.json({
    success: true,
    reflection: {
      enabled: Boolean(reflection.enabled),
      title: reflection.title || 'Exit Ticket',
      prompt: reflection.prompt || '',
      purpose: reflection.purpose || '',
      required: Boolean(reflection.required),
      minLength: reflection.minLength || 0,
      rubric: {
        good: reflection.rubric && reflection.rubric.good || '',
        partial: reflection.rubric && reflection.rubric.partial || '',
        weak: reflection.rubric && reflection.rubric.weak || ''
      },
      webOnly: reflection.webOnly !== false,
      createdByAI: Boolean(reflection.createdByAI)
    }
  });
};

// ---- Admin: Save reflection config for a lesson ----

module.exports.saveReflectionConfig = async (req, res) => {
  const { id: courseId, sectionIndex, lessonIndex } = req.params;

  if (!mongoose.isValidObjectId(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  // Verify course exists and lesson is valid
  const course = await Course.findById(courseId).select('_id sections');
  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  const si = Number(sectionIndex);
  const li = Number(lessonIndex);
  const lesson = getCanonicalLesson(course, si, li);
  if (!lesson) {
    return res.status(404).json({ success: false, error: 'Lesson not found' });
  }

  const config = normalizeReflectionConfig(req.body);

  // Validate: if enabled, prompt must not be empty
  if (config.enabled && !config.prompt) {
    return res.status(400).json({ success: false, error: 'Prompt is required when reflection is enabled.' });
  }

  // Use findByIdAndUpdate with $set to bypass pre('validate') hook
  // which calls syncCourseContent() and may reset lesson objects
  const updatePath = `sections.${si}.lessons.${li}.reflection`;
  const updateResult = await Course.findByIdAndUpdate(
    courseId,
    { $set: { [updatePath]: config } },
    { new: true, runValidators: false }
  ).select('sections');

  if (!updateResult) {
    return res.status(500).json({ success: false, error: 'Failed to save reflection config.' });
  }

  // Verify the save by reading back
  const savedLesson = getCanonicalLesson(updateResult, si, li);
  const savedReflection = savedLesson && savedLesson.reflection ? savedLesson.reflection : {};

  logger.info({
    courseId,
    sectionIndex: si,
    lessonIndex: li,
    enabled: savedReflection.enabled,
    hasPrompt: Boolean(savedReflection.prompt)
  }, '[Reflection] Config saved');

  return res.json({ success: true, reflection: config });
};

// ---- Admin: Generate AI reflection suggestions ----

module.exports.generateAiSuggestions = async (req, res) => {
  const { id: courseId, sectionIndex, lessonIndex } = req.params;

  if (!mongoose.isValidObjectId(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  const course = await Course.findById(courseId).select('sections title');
  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  const lesson = getCanonicalLesson(course, sectionIndex, lessonIndex);
  if (!lesson) {
    return res.status(404).json({ success: false, error: 'Lesson not found' });
  }

  const context = buildLessonContentSummary(lesson);

  let suggestions;
  try {
    suggestions = await generateReflectionSuggestions({
      userId: req.user && req.user._id,
      lessonTitle: context.lessonTitle,
      lessonType: context.lessonType,
      lessonDescription: context.lessonDescription,
      mainContent: context.mainContent,
      existingQuizQuestions: context.existingQuizQuestions
    });
  } catch (err) {
    const message = err && err.publicMessage
      ? err.publicMessage
      : (err && err.message ? err.message : 'AI generation failed');
    return res.status(502).json({ success: false, error: message });
  }

  if (!Array.isArray(suggestions) || !suggestions.length) {
    return res.status(422).json({ success: false, error: 'AI returned no valid suggestions.' });
  }

  return res.json({ success: true, suggestions });
};

// ---- Admin: Get all reflection submissions for a lesson ----

module.exports.getSubmissions = async (req, res) => {
  const { courseId, sectionIndex, lessonIndex } = req.params;

  if (!mongoose.isValidObjectId(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  const lessonId = getLessonId(await Course.findById(courseId).select('sections'), sectionIndex, lessonIndex);
  if (!lessonId) {
    return res.status(404).json({ success: false, error: 'Lesson not found' });
  }

  const submissions = await Reflection.find({ course: courseId, lessonId })
    .populate('user', 'username email')
    .sort({ createdAt: -1 })
    .lean();

  return res.json({
    success: true,
    count: submissions.length,
    submissions
  });
};

// ---- Admin: Generate AI summary of reflection submissions ----

module.exports.generateAiSummary = async (req, res) => {
  const { courseId, sectionIndex, lessonIndex } = req.params;

  if (!mongoose.isValidObjectId(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  const course = await Course.findById(courseId).select('sections');
  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  const lesson = getCanonicalLesson(course, sectionIndex, lessonIndex);
  if (!lesson) {
    return res.status(404).json({ success: false, error: 'Lesson not found' });
  }

  const lessonId = String(lesson._id || '');
  const submissions = await Reflection.find({ course: courseId, lessonId })
    .select('answer submittedAt')
    .sort({ createdAt: -1 })
    .lean();

  if (!submissions.length) {
    return res.json({
      success: true,
      summary: {
        commonUnderstandings: [],
        commonConfusions: [],
        representativeResponses: [],
        improvementSuggestions: [],
        overallInsight: 'No submissions available to analyze.'
      },
      submissionCount: 0
    });
  }

  let summary;
  try {
    summary = await generateReflectionSummary({
      userId: req.user && req.user._id,
      lessonTitle: lesson.title || '',
      lessonPrompt: lesson.reflection && lesson.reflection.prompt || '',
      submissions
    });
  } catch (err) {
    const message = err && err.publicMessage
      ? err.publicMessage
      : (err && err.message ? err.message : 'AI summary generation failed');
    return res.status(502).json({ success: false, error: message });
  }

  return res.json({
    success: true,
    summary,
    submissionCount: submissions.length
  });
};

// ---- Learner: Get reflection for a lesson ----

module.exports.getLessonReflection = async (req, res) => {
  const { courseId, sectionIndex, lessonIndex } = req.params;

  if (!mongoose.isValidObjectId(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  const course = await Course.findById(courseId).select('sections');
  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  let lesson = getCanonicalLesson(course, sectionIndex, lessonIndex);
  const requestedSi = Number(sectionIndex);
  const requestedLi = Number(lessonIndex);

  // If lesson at requested index has no reflection, search by _id from query param
  // to handle index mismatch between admin editor and learner page
  const queryLessonId = String(req.query.lessonId || '').trim();
  if (queryLessonId && mongoose.isValidObjectId(queryLessonId)) {
    const lessonAtIndex = lesson;
    const hasReflectionAtIndex = lessonAtIndex && lessonAtIndex.reflection && lessonAtIndex.reflection.enabled;

    if (!hasReflectionAtIndex) {
      // Search entire course for the lesson by _id
      for (let si = 0; si < (course.sections || []).length; si++) {
        const section = course.sections[si];
        if (!section || !Array.isArray(section.lessons)) continue;
        for (let li = 0; li < section.lessons.length; li++) {
          const candidate = section.lessons[li];
          if (candidate && String(candidate._id || '') === queryLessonId) {
            lesson = candidate;
            logger.info({
              courseId,
              requestedIndex: `${requestedSi}/${requestedLi}`,
              foundIndex: `${si}/${li}`,
              lessonId: queryLessonId
            }, '[Reflection] getLessonReflection: index mismatch, found by lessonId');
            break;
          }
        }
        if (lesson && String(lesson._id || '') === queryLessonId) break;
      }
    }
  }

  if (!lesson) {
    return res.status(404).json({ success: false, error: 'Lesson not found' });
  }

  const reflection = lesson.reflection;
  const lessonId = String(lesson._id || '');

  logger.info({
    courseId,
    sectionIndex: requestedSi,
    lessonIndex: requestedLi,
    lessonId,
    lessonTitle: lesson.title || '',
    hasReflection: Boolean(reflection),
    reflectionEnabled: reflection ? Boolean(reflection.enabled) : false
  }, '[Reflection] getLessonReflection');

  if (!reflection || !reflection.enabled) {
    return res.json({ success: true, hasReflection: false });
  }

  // Find user's existing submission
  const existingSubmission = await Reflection.findOne({
    user: req.user._id,
    course: courseId,
    lessonId
  }).sort({ createdAt: -1 }).lean();

  return res.json({
    success: true,
    hasReflection: true,
    reflection: {
      enabled: true,
      title: reflection.title || 'Exit Ticket',
      prompt: reflection.prompt || '',
      purpose: reflection.purpose || '',
      required: Boolean(reflection.required),
      minLength: reflection.minLength || 0,
      rubric: reflection.rubric || {},
      webOnly: reflection.webOnly !== false
    },
    submission: existingSubmission ? {
      id: String(existingSubmission._id),
      answer: existingSubmission.answer,
      wordCount: existingSubmission.wordCount,
      characterCount: existingSubmission.characterCount,
      submittedAt: existingSubmission.createdAt,
      updatedAt: existingSubmission.updatedAt
    } : null
  });
};

// ---- Admin: Get all reflections for a specific learner in a course ----

module.exports.getLearnerReflections = async (req, res) => {
  const { courseId, userId } = req.params;

  if (!mongoose.isValidObjectId(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid user ID' });
  }

  const course = await Course.findById(courseId).select('sections');
  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  // Collect all lessons with reflection enabled
  const reflectionLessons = [];
  const sections = Array.isArray(course.sections) ? course.sections : [];

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    if (!section || !Array.isArray(section.lessons)) continue;
    for (let li = 0; li < section.lessons.length; li++) {
      const lesson = section.lessons[li];
      if (!lesson) continue;
      const ref = lesson.reflection;
      if (ref && ref.enabled) {
        reflectionLessons.push({
          lessonId: String(lesson._id || ''),
          sectionIndex: si,
          lessonIndex: li,
          sectionTitle: section.title || 'Section ' + (si + 1),
          lessonTitle: lesson.title || 'Lesson ' + (li + 1),
          title: ref.title || 'Exit Ticket',
          prompt: ref.prompt || '',
          purpose: ref.purpose || '',
          required: Boolean(ref.required),
          minLength: ref.minLength || 0,
          rubric: ref.rubric || {}
        });
      }
    }
  }

  if (!reflectionLessons.length) {
    return res.json({ success: true, hasReflectionLessons: false, reflections: [] });
  }

  // Fetch all submissions by this user for this course
  const submissions = await Reflection.find({
    course: courseId,
    user: userId
  }).lean();

  // Build a map of lessonId -> submission (take latest if multiple)
  const submissionMap = {};
  for (const sub of submissions) {
    const key = String(sub.lessonId || '');
    if (!key) continue;
    // Keep the latest submission (submissions are not sorted, compare createdAt)
    if (!submissionMap[key] || new Date(sub.createdAt) > new Date(submissionMap[key].createdAt)) {
      submissionMap[key] = sub;
    }
  }

  // Also build a fallback map using sectionIndex-lessonIndex key
  const submissionMapByIndex = {};
  for (const sub of submissions) {
    const key = String(sub.sectionIndex) + '-' + String(sub.lessonIndex);
    if (!submissionMapByIndex[key] || new Date(sub.createdAt) > new Date(submissionMapByIndex[key].createdAt)) {
      submissionMapByIndex[key] = sub;
    }
  }

  // Match submissions to lessons
  const reflections = reflectionLessons.map(function(rl) {
    let sub = submissionMap[rl.lessonId] || null;
    // Fallback: try matching by sectionIndex-lessonIndex
    if (!sub) {
      const indexKey = rl.sectionIndex + '-' + rl.lessonIndex;
      sub = submissionMapByIndex[indexKey] || null;
    }

    return {
      lessonId: rl.lessonId,
      sectionIndex: rl.sectionIndex,
      lessonIndex: rl.lessonIndex,
      sectionTitle: rl.sectionTitle,
      lessonTitle: rl.lessonTitle,
      title: rl.title,
      prompt: rl.prompt,
      purpose: rl.purpose,
      required: rl.required,
      minLength: rl.minLength,
      submitted: Boolean(sub),
      answer: sub ? (sub.answer || '') : '',
      wordCount: sub ? (sub.wordCount || 0) : 0,
      characterCount: sub ? (sub.characterCount || 0) : 0,
      submittedAt: sub ? sub.createdAt : null,
      updatedAt: sub ? sub.updatedAt : null
    };
  });

  return res.json({ success: true, hasReflectionLessons: true, reflections });
};

// ---- Learner: Submit reflection ----

module.exports.submitReflection = async (req, res) => {
  const { courseId, sectionIndex, lessonIndex } = req.params;
  const { answer } = req.body;

  if (!mongoose.isValidObjectId(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  if (!answer || !String(answer).trim()) {
    return res.status(400).json({ success: false, error: 'Answer is required.' });
  }

  const course = await Course.findById(courseId).select('sections');
  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  const lesson = getCanonicalLesson(course, sectionIndex, lessonIndex);
  if (!lesson) {
    return res.status(404).json({ success: false, error: 'Lesson not found' });
  }

  const reflectionConfig = lesson.reflection;
  if (!reflectionConfig || !reflectionConfig.enabled) {
    return res.status(400).json({ success: false, error: 'Reflection is not enabled for this lesson.' });
  }

  const trimmedAnswer = String(answer).trim();
  const wordCount = countWords(trimmedAnswer);
  const characterCount = trimmedAnswer.length;

  // Validate minLength
  if (reflectionConfig.minLength > 0 && characterCount < reflectionConfig.minLength) {
    return res.status(400).json({
      success: false,
      error: `Answer must be at least ${reflectionConfig.minLength} characters. Your answer is ${characterCount} characters.`
    });
  }

  const lessonId = String(lesson._id || '');

  // Check if user already has a submission — update it or create new
  const existing = await Reflection.findOne({
    user: req.user._id,
    course: courseId,
    lessonId
  });

  let submission;
  if (existing) {
    existing.answer = trimmedAnswer;
    existing.wordCount = wordCount;
    existing.characterCount = characterCount;
    await existing.save();
    submission = existing;
  } else {
    submission = await Reflection.create({
      user: req.user._id,
      course: courseId,
      lessonId,
      sectionIndex: Number(sectionIndex),
      lessonIndex: Number(lessonIndex),
      prompt: reflectionConfig.prompt || '',
      answer: trimmedAnswer,
      wordCount,
      characterCount
    });
  }

  // Record analytics event
  try {
    await AnalyticsEvent.create({
      user: req.user._id,
      eventType: 'reflection_submitted',
      course: courseId,
      lessonId,
      metadata: {
        courseId: String(courseId),
        lessonId,
        answerLength: characterCount,
        wordCount,
        required: Boolean(reflectionConfig.required),
        isResubmit: Boolean(existing),
        submittedAt: new Date().toISOString()
      },
      source: 'server'
    });
  } catch (analyticsErr) {
    // Non-fatal: log but don't block submission
    logger.warn({ err: analyticsErr }, '[Reflection] Failed to record analytics event');
  }

  return res.json({
    success: true,
    message: existing ? 'Reflection updated successfully.' : 'Reflection submitted successfully.',
    submission: {
      id: String(submission._id),
      answer: submission.answer,
      wordCount: submission.wordCount,
      characterCount: submission.characterCount,
      submittedAt: submission.createdAt,
      updatedAt: submission.updatedAt
    }
  });
};