const { aiConfig } = require('../config/ai');
const { generatePromptReply } = require('../services/ai/chatOrchestrator');
const { getCanonicalSections } = require('./courseContentAdapter');

const descriptionCache = new Map();

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildCurriculumOutline(course) {
  const sections = getCanonicalSections(course);

  return sections.map((section, sectionIndex) => {
    const sectionTitle = normalizeText(section && section.title) || `Section ${sectionIndex + 1}`;
    const items = Array.isArray(section && section.lessons) ? section.lessons : [];
    const lessons = items
      .map((item, lessonIndex) => {
        const type = normalizeText(item && item.type) || 'video';
        const name = normalizeText(item && item.title) || `Lesson ${lessonIndex + 1}`;
        return `${type}: ${name}`;
      })
      .slice(0, 12);

    return {
      sectionTitle,
      lessons
    };
  }).slice(0, 12);
}

function buildFallbackDescription(course) {
  const title = normalizeText(course && course.title) || 'Course';
  const topic = normalizeText(course && course.topic) || 'multiple topics';
  const outline = buildCurriculumOutline(course);
  const sectionNames = outline.map((entry) => entry.sectionTitle).filter(Boolean).slice(0, 3);
  const lessonNames = outline.flatMap((entry) => entry.lessons).slice(0, 5).map((line) => line.replace(/^[^:]+:\s*/, ''));

  const sectionPart = sectionNames.length
    ? `Content is organized into sections such as ${sectionNames.join(', ')}.`
    : 'Content is divided into clear learning sections.';

  const lessonPart = lessonNames.length
    ? `You will work through representative lessons such as ${lessonNames.join(', ')}.`
    : 'The course focuses on practical, easy-to-follow lessons.';

  return `${title} is a ${topic} course designed to help learners follow a clear path from fundamentals to application. ${sectionPart} ${lessonPart}`;
}

function buildPrompt(course) {
  const title = normalizeText(course && course.title);
  const topic = normalizeText(course && course.topic);
  const outline = buildCurriculumOutline(course);

  return [
    'You are an educational course copywriter.',
    '',
    'Write a concise English course description based only on the curriculum structure below.',
    'Rules:',
    '- Return JSON only',
    '- No markdown',
    '- No bullet points',
    '- 2 to 3 sentences',
    '- 60 to 110 English words',
    '- Keep it natural, clear, and appealing',
    '- Do not invent lessons or tools not present in the outline',
    '- Summarize what learners will study and why it matters',
    '',
    `Course title: ${title}`,
    `Topic: ${topic}`,
    `Curriculum outline: ${JSON.stringify(outline)}`,
    '',
    'Return format:',
    '{"description":"..."}'
  ].join('\n');
}

function parseAiDescription(text) {
  const raw = normalizeText(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    const parsed = JSON.parse(raw);
    const description = normalizeText(parsed && parsed.description);
    if (description) return description;
  } catch (_error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        const description = normalizeText(parsed && parsed.description);
        if (description) return description;
      } catch {
        // Ignore nested parse failure and fallback to plain text below.
      }
    }
  }

  return raw;
}

async function callAi(prompt) {
  return generatePromptReply({
    model: aiConfig.chatModel,
    prompt,
    options: {
      temperature: 0.2,
      maxTokens: 220,
      timeoutMs: Math.min(aiConfig.providers.openai.timeoutMs, 12000)
    }
  });
}

async function generateCourseDescription(course) {
  const cacheKey = `${String(course && course._id || '')}:${String(course && course.updatedAt || '')}`;
  if (descriptionCache.has(cacheKey)) {
    return descriptionCache.get(cacheKey);
  }

  const fallbackDescription = buildFallbackDescription(course);

  try {
    const prompt = buildPrompt(course);
    const aiText = await callAi(prompt);
    const description = parseAiDescription(aiText) || fallbackDescription;
    const safeDescription = normalizeText(description) || fallbackDescription;
    descriptionCache.set(cacheKey, safeDescription);
    return safeDescription;
  } catch (_error) {
    descriptionCache.set(cacheKey, fallbackDescription);
    return fallbackDescription;
  }
}

module.exports = {
  buildFallbackDescription,
  buildCurriculumOutline,
  generateCourseDescription
};
