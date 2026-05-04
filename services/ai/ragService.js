/**
 * RAG (Retrieval-Augmented Generation) service for course-aware AI Q&A.
 *
 * Handles:
 * - Building lesson documents from course structure
 * - Building transcript documents from Video/Transcript models
 * - Chunking documents for search
 * - Tokenizing and scoring chunks against a user query
 * - Returning ranked relevant content
 */

const Video = require('../../models/video');
const Transcript = require('../../models/Transcript');
const { getCanonicalSections } = require('../../utils/courseContentAdapter');
const { stripHtml, chunkText, normalizeVideoUrl, extractYouTubeVideoId } = require('../../utils/aiHelpers');

// ==================== DOCUMENT BUILDERS ====================

function buildLessonDocs(course) {
  const docs = [];
  const sections = getCanonicalSections(course);
  sections.forEach((section) => {
    const lessons = Array.isArray(section && section.lessons) ? section.lessons : [];
    lessons.forEach((lesson) => {
      docs.push(...extractLessonDocs(lesson, section.title || '', course._id));
    });
  });

  return docs;
}

function extractLessonDocs(item, sectionTitle, courseId) {
  if (!item) return [];

  const type = String(item.type || 'video').toLowerCase();
  const lessonId = String(item._id || '');
  const title = stripHtml(item.title || '');
  const section = stripHtml(sectionTitle || '');

  const docs = [];

  if (type === 'video' || type === 'lecture') {
    const parts = [title, section, stripHtml(item.description || '')].filter(Boolean);
    docs.push({ courseId, lessonId, type: 'video', content: parts.join('\n') });
    return docs;
  }

  if (type === 'slide') {
    const slides = Array.isArray(item.content && item.content.slides)
      ? item.content.slides
      : Array.isArray(item.slides)
        ? item.slides
        : [];

    const slideText = slides
      .flatMap((slide) => Array.isArray(slide && slide.elements) ? slide.elements : [])
      .map((el) => stripHtml(el && el.text))
      .filter(Boolean);

    docs.push({ courseId, lessonId, type: 'slide', content: [title, section, ...slideText].filter(Boolean).join('\n') });
    return docs;
  }

  if (type === 'quiz') {
    const questions = Array.isArray(item.content && item.content.questions)
      ? item.content.questions
      : Array.isArray(item.questions)
        ? item.questions
        : [];

    const quizText = questions.flatMap((q) => {
      const question = stripHtml(q && q.question);
      const options = Array.isArray(q && q.options)
        ? q.options.map((opt) => stripHtml(opt && (opt.text || opt)))
        : [];
      return [question, ...options].filter(Boolean);
    });

    docs.push({ courseId, lessonId, type: 'quiz', content: [title, section, ...quizText].filter(Boolean).join('\n') });
  }

  return docs;
}

// ==================== TRANSCRIPT DOCS ====================

function findLessonById(course, lessonId) {
  const target = String(lessonId || '').trim();
  if (!target) return null;

  const sections = getCanonicalSections(course);
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const items = Array.isArray(section && section.lessons) ? section.lessons : [];

    for (let lessonIndex = 0; lessonIndex < items.length; lessonIndex += 1) {
      const item = items[lessonIndex];
      if (!item) continue;
      if (String(item._id || '') !== target) continue;

      return {
        lesson: item,
        sectionIndex,
        lessonIndex,
        sectionTitle: section && section.title ? String(section.title) : ''
      };
    }
  }

  return null;
}

async function buildTranscriptDocsForLesson(course, lessonId) {
  const found = findLessonById(course, lessonId);
  if (!found || !found.lesson) return [];

  const lessonType = String(found.lesson.type || 'video').toLowerCase();
  if (lessonType !== 'video' && lessonType !== 'lecture') return [];

  const courseObjectId = course && course._id;
  if (!courseObjectId) return [];

  const lessonPreviewUrl = normalizeVideoUrl(
    found.lesson.preview || (found.lesson.content && found.lesson.content.videoUrl) || ''
  );
  const lessonYoutubeId = extractYouTubeVideoId(lessonPreviewUrl);

  let videoDoc = await Video.findOne({
    courseId: courseObjectId,
    sectionIndex: found.sectionIndex,
    lessonIndex: found.lessonIndex
  }).select('_id title url youtubeVideoId').lean();

  if (!videoDoc && lessonPreviewUrl) {
    videoDoc = await Video.findOne({
      courseId: courseObjectId,
      url: lessonPreviewUrl
    }).select('_id title url youtubeVideoId').lean();
  }

  if (!videoDoc && lessonYoutubeId) {
    videoDoc = await Video.findOne({
      courseId: courseObjectId,
      youtubeVideoId: lessonYoutubeId
    }).select('_id title url youtubeVideoId').lean();
  }

  if (!videoDoc || !videoDoc._id) return [];

  const transcriptRows = await Transcript.find({ videoId: videoDoc._id })
    .sort({ offset: 1 })
    .select('offset text')
    .lean();

  if (!transcriptRows.length) return [];

  const transcriptText = transcriptRows
    .map((row) => stripHtml(row && row.text))
    .filter(Boolean)
    .join(' ')
    .trim();

  if (!transcriptText) return [];

  const lessonTitle = stripHtml(found.lesson.title || videoDoc.title || '');
  const sectionTitle = stripHtml(found.sectionTitle || '');
  const content = [
    lessonTitle ? `Video lesson: ${lessonTitle}` : '',
    sectionTitle ? `Section: ${sectionTitle}` : '',
    `Transcript: ${transcriptText}`
  ].filter(Boolean).join('\n');

  return [{
    courseId: courseObjectId,
    lessonId: String(found.lesson._id || lessonId || ''),
    type: 'video-transcript',
    content
  }];
}

// ==================== CHUNKING & SEARCH ====================

function buildChunks(docs) {
  return docs.flatMap((doc) => {
    const chunks = chunkText(stripHtml(doc.content));
    return chunks.map((chunk) => ({
      courseId: doc.courseId,
      lessonId: doc.lessonId,
      type: doc.type,
      content: chunk
    }));
  });
}

function tokenizeForSearch(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_\u00C0-\u024F\u1E00-\u1EFF]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreChunkForQuery(chunk, queryTokens, fullQuery, contextLessonId) {
  const content = String(chunk && chunk.content || '').toLowerCase();
  const type = String(chunk && chunk.type || '').toLowerCase();
  const lessonId = String(chunk && chunk.lessonId || '');

  let score = 0;

  if (contextLessonId && lessonId === String(contextLessonId)) {
    score += 6;
  }

  if (type === 'video-transcript') {
    score += 8;
  } else if (type === 'video') {
    score += 3;
  }

  if (fullQuery && content.includes(fullQuery)) {
    score += 6;
  }

  queryTokens.forEach((token) => {
    if (content.includes(token)) {
      score += 1.5;
    }
  });

  return score;
}

function searchRelevantContent(chunks, query, lessonId) {
  const lower = String(query || '').toLowerCase();
  if (!lower) return [];

  const tokens = tokenizeForSearch(lower);
  const scored = (Array.isArray(chunks) ? chunks : []).map((chunk) => ({
    chunk,
    score: scoreChunkForQuery(chunk, tokens, lower, lessonId)
  }));

  scored.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const ranked = [];
  scored.forEach((entry) => {
    const item = entry && entry.chunk;
    if (!item || !String(item.content || '').trim()) return;
    const key = String(item.lessonId || '') + ':' + String(item.type || '') + ':' + String(item.content || '');
    if (seen.has(key)) return;
    seen.add(key);
    ranked.push(item);
  });

  return ranked.slice(0, 8);
}

module.exports = {
  buildLessonDocs,
  buildTranscriptDocsForLesson,
  buildChunks,
  searchRelevantContent
};