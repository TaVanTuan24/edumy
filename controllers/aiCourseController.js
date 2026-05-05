/**
 * Controller for course-aware AI Q&A endpoints.
 *
 * Orchestrates RAG service, cache, prompt building, and AI call.
 * Replaces inline business logic previously in routes/ai.js.
 */

const Course = require('../models/course');
const User = require('../models/user');
const { normalizeAiModel } = require('../services/ai/chatOrchestrator');
const { generatePromptReply } = require('../services/ai/chatOrchestrator');
const { awardGamification } = require('../utils/gamification');
const { userCanAccessCourse } = require('../middleware');
const { stripHtml } = require('../utils/aiHelpers');
const { buildLessonDocs, buildTranscriptDocsForLesson, buildChunks, searchRelevantContent } = require('../services/ai/ragService');
const { buildCourseTutorPrompt } = require('../services/ai/aiPromptService');
const aiCache = require('../services/ai/aiCacheService');
const logger = require('../utils/logger');
const { ANALYTICS_EVENTS, trackEventSafe } = require('../services/analyticsEventService');

async function askAiTutor(prompt, model, userId) {
  return generatePromptReply({
    userId,
    model,
    prompt,
    options: {
      temperature: 0.2,
      topP: 0.9,
      maxTokens: 1200,
      timeoutMs: 120000
    }
  });
}

async function answerCourseQuestion({ course, question, lessonId, context, model, userId }) {
  const trimmedQuestion = stripHtml(question).slice(0, 800);
  if (!trimmedQuestion) return '';

  const courseId = String(course && course._id || '');
  const contextLessonId = context && context.lessonId ? String(context.lessonId) : String(lessonId || '');
  const selectedModel = normalizeAiModel(model);
  const cacheKey = `${selectedModel}:${courseId}:${contextLessonId}:${trimmedQuestion.toLowerCase()}`;
  const cached = aiCache.get(cacheKey);
  if (cached) return cached;

  if (!course) return 'I could not find this in the course.';

  const docs = buildLessonDocs(course);
  const transcriptDocs = await buildTranscriptDocsForLesson(course, contextLessonId);
  if (transcriptDocs.length) {
    docs.push(...transcriptDocs);
  }
  const chunks = buildChunks(docs);
  const relevant = searchRelevantContent(chunks, trimmedQuestion, contextLessonId);
  const transcriptChunks = relevant
    .filter((item) => String(item && item.type || '') === 'video-transcript')
    .map((item) => item.content);
  const lessonChunks = relevant
    .filter((item) => String(item && item.type || '') !== 'video-transcript')
    .map((item) => item.content);

  const contextType = context && context.type ? String(context.type) : '';
  const contextSlide = context && context.slideIndex !== undefined && context.slideIndex !== null
    ? String(context.slideIndex)
    : 'N/A';

  const prompt = buildCourseTutorPrompt({
    question: trimmedQuestion,
    contextLessonId,
    contextType,
    contextSlide,
    transcriptChunks,
    lessonChunks
  });

  const answer = await askAiTutor(prompt, selectedModel, userId);
  const finalAnswer = answer && answer.trim() ? answer.trim() : 'I do not have enough lesson data to answer accurately.';
  aiCache.set(cacheKey, finalAnswer);
  return finalAnswer;
}

/**
 * POST /ai/chat (when courseId and question are provided)
 */
async function handleCourseQuestion(req, res) {
  const startedAt = Date.now();
  let model = '';
  try {
    const userId = req.user._id;
    const { courseId, question, lessonId, context } = req.body || {};
    model = normalizeAiModel(req.body && req.body.model);
    const course = await Course.findById(courseId).select('author sections');
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const user = await User.findById(userId).select('email enrolledCourses enrolledCourseIds');
    if (!user || !userCanAccessCourse(user, course)) {
      return res.status(403).json({ error: 'You do not have access to this course.' });
    }

    const response = await answerCourseQuestion({
      course,
      question,
      lessonId,
      context,
      userId,
      model
    });

    const gamificationUser = await User.findById(userId);
    if (gamificationUser) {
      await awardGamification(gamificationUser, { action: 'aiTutor' });
    }

    trackEventSafe({
      req,
      eventType: ANALYTICS_EVENTS.AI_QUESTION_ASKED,
      course: courseId,
      lessonId: lessonId || (context && context.lessonId),
      metadata: {
        messageLength: String(question || '').length,
        chatId: '',
        model,
        providerType: 'user_byok',
        success: true,
        latencyMs: Date.now() - startedAt
      }
    });

    return res.json({ success: true, answer: response, model });
  } catch (err) {
    logger.error({ err }, 'AI Course Chat Error');
    trackEventSafe({
      req,
      eventType: ANALYTICS_EVENTS.AI_QUESTION_ASKED,
      course: req.body && req.body.courseId,
      lessonId: req.body && (req.body.lessonId || (req.body.context && req.body.context.lessonId)),
      metadata: {
        messageLength: String(req.body && req.body.question || '').length,
        chatId: '',
        model,
        providerType: 'user_byok',
        success: false,
        latencyMs: Date.now() - startedAt
      }
    });
    if (err.publicMessage) {
      return res.status(err.statusCode || 503).json({ error: err.publicMessage });
    }
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'AI service unavailable. Please check the configured AI provider.' });
    }
    return res.status(500).json({ error: 'Failed to process your request. Please try again.' });
  }
}

module.exports = {
  answerCourseQuestion,
  handleCourseQuestion
};
