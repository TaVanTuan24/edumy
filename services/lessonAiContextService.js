const Video = require('../models/video');
const Transcript = require('../models/Transcript');
const Note = require('../models/note');
const { findLessonContext } = require('../utils/lessonLocator');

function trimText(value, maxChars) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > maxChars ? text.slice(0, maxChars) + '...' : text;
}

function extractSlideText(lesson) {
  const slides = Array.isArray(lesson && lesson.content && lesson.content.slides) ? lesson.content.slides : [];
  return slides.flatMap((slide) => {
    const elements = Array.isArray(slide && slide.elements) ? slide.elements : [];
    return elements
      .filter((element) => element && element.type === 'text' && element.text)
      .map((element) => String(element.text).trim());
  }).filter(Boolean).join('\n');
}

function extractQuizText(lesson) {
  const questions = Array.isArray(lesson && lesson.quiz) ? lesson.quiz : Array.isArray(lesson && lesson.content && lesson.content.questions) ? lesson.content.questions : [];
  return questions.map((question) => {
    const options = Array.isArray(question && question.options) ? question.options.join(' | ') : '';
    return `${String(question && question.question || '').trim()} ${options}`.trim();
  }).filter(Boolean).join('\n');
}

async function extractTranscriptText(courseId, sectionIndex, lessonIndex) {
  const video = await Video.findOne({ courseId, sectionIndex, lessonIndex }).select('_id').lean();
  if (!video) return '';

  const transcriptRows = await Transcript.find({ videoId: video._id })
    .sort({ offset: 1 })
    .select('text')
    .lean();

  return transcriptRows.map((row) => String(row && row.text || '').trim()).filter(Boolean).join(' ');
}

async function buildLessonAiContext({ userId, course, lessonId, sectionIndex, lessonIndex }) {
  const located = findLessonContext(course, { lessonId, sectionIndex, lessonIndex });
  if (!located) {
    return null;
  }

  const { lesson, section, sectionIndex: resolvedSectionIndex, lessonIndex: resolvedLessonIndex } = located;
  const note = await Note.findOne({
    user: userId,
    course: course._id,
    sectionIndex: resolvedSectionIndex
  }).select('content').lean();

  const transcriptText = lesson.type === 'video'
    ? await extractTranscriptText(course._id, resolvedSectionIndex, resolvedLessonIndex)
    : '';

  const slideText = extractSlideText(lesson);
  const quizText = extractQuizText(lesson);

  const parts = [
    `Course: ${String(course.title || '').trim()}`,
    course.topic ? `Topic: ${String(course.topic).trim()}` : '',
    course.description ? `Course description: ${trimText(course.description, 500)}` : '',
    `Section: ${String(section && section.title || '').trim()}`,
    `Lesson: ${String(lesson.title || '').trim()}`,
    `Lesson type: ${String(lesson.type || '').trim()}`,
    slideText ? `Slide content:\n${trimText(slideText, 1800)}` : '',
    quizText ? `Quiz content:\n${trimText(quizText, 1400)}` : '',
    transcriptText ? `Transcript excerpt:\n${trimText(transcriptText, 2500)}` : '',
    note && note.content ? `Learner note excerpt:\n${trimText(note.content, 600)}` : ''
  ].filter(Boolean);

  return {
    lessonId: String(lesson._id || ''),
    lessonName: String(lesson.title || ''),
    lessonType: String(lesson.type || ''),
    sectionTitle: String(section && section.title || ''),
    sectionIndex: resolvedSectionIndex,
    lessonIndex: resolvedLessonIndex,
    promptContext: parts.join('\n\n')
  };
}

function buildLessonAiPrompt({ context, action, question }) {
  const normalizedAction = String(action || 'custom').trim().toLowerCase();
  const actionInstructions = {
    summarize: 'Summarize this lesson clearly with key takeaways, short bullets, and one quick recap.',
    explain: 'Explain this lesson like the learner is a beginner. Use simple wording and one relatable analogy if helpful.',
    practice: 'Generate 3 to 5 short practice questions with concise answers or answer keys in markdown.',
    flashcards: 'Create 4 to 6 flashcards in markdown using Term, Explanation, and Example.',
    custom: 'Answer the learner question using the lesson context first. If context is incomplete, say what is missing.'
  };

  const userPrompt = normalizedAction === 'custom'
    ? String(question || '').trim()
    : String(question || '').trim() || actionInstructions[normalizedAction] || actionInstructions.custom;

  return [
    'You are Edumy AI Tutor.',
    'Use the provided lesson context as the main source of truth.',
    'Keep the response helpful, structured, and concise.',
    'Respond in markdown.',
    '',
    `Requested action: ${normalizedAction}`,
    '',
    'Lesson context:',
    context.promptContext,
    '',
    'Learner request:',
    userPrompt
  ].join('\n');
}

module.exports = {
  buildLessonAiContext,
  buildLessonAiPrompt
};
