const ollama = require('../config/ollama');
const { aiConfig } = require('../config/ai');
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
  const title = normalizeText(course && course.title) || 'Khóa học';
  const topic = normalizeText(course && course.topic) || 'nhiều chủ đề';
  const outline = buildCurriculumOutline(course);
  const sectionNames = outline.map((entry) => entry.sectionTitle).filter(Boolean).slice(0, 3);
  const lessonNames = outline.flatMap((entry) => entry.lessons).slice(0, 5).map((line) => line.replace(/^[^:]+:\s*/, ''));

  const sectionPart = sectionNames.length
    ? `Nội dung được tổ chức qua các phần như ${sectionNames.join(', ')}.`
    : 'Nội dung được chia thành các phần học rõ ràng.';

  const lessonPart = lessonNames.length
    ? `Bạn sẽ đi qua các bài học tiêu biểu như ${lessonNames.join(', ')}.`
    : 'Khóa học tập trung vào các bài học thực hành và dễ theo dõi.';

  return `${title} là khóa học thuộc chủ đề ${topic}, được thiết kế để giúp người học nắm được lộ trình học tập rõ ràng từ cơ bản đến ứng dụng. ${sectionPart} ${lessonPart}`;
}

function buildPrompt(course) {
  const title = normalizeText(course && course.title);
  const topic = normalizeText(course && course.topic);
  const outline = buildCurriculumOutline(course);

  return [
    'You are an educational course copywriter.',
    '',
    'Write a concise Vietnamese course description based only on the curriculum structure below.',
    'Rules:',
    '- Return JSON only',
    '- No markdown',
    '- No bullet points',
    '- 2 to 3 sentences',
    '- 60 to 110 Vietnamese words',
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

async function callOllama(prompt) {
  const response = await ollama.post(
    '/api/generate',
    {
      model: aiConfig.ollama.model,
      prompt,
      stream: false
    },
    { timeout: Math.min(aiConfig.ollama.timeoutMs, 12000) }
  );

  return response && response.data && response.data.response
    ? String(response.data.response)
    : '';
}

async function generateCourseDescription(course) {
  const cacheKey = `${String(course && course._id || '')}:${String(course && course.updatedAt || '')}`;
  if (descriptionCache.has(cacheKey)) {
    return descriptionCache.get(cacheKey);
  }

  const fallbackDescription = buildFallbackDescription(course);

  try {
    const prompt = buildPrompt(course);
    const aiText = await callOllama(prompt);
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
