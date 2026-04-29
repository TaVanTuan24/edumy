const { generatePromptReply } = require('./chatOrchestrator');
const { aiConfig, SUPPORTED_MODELS } = require('../../config/ai');
const { getCanonicalSections } = require('../../utils/courseContentAdapter');

const DEFAULT_SUMMARY_MODEL = 'gpt-5.5';
const MIN_SUMMARY_LENGTH = 30;
const MAX_SECTIONS = 12;
const MAX_LESSONS_PER_SECTION = 12;

function getCourseSummaryModel() {
    const requested = String(process.env.AI_SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL).trim();
    return SUPPORTED_MODELS.includes(requested) ? requested : DEFAULT_SUMMARY_MODEL;
}

async function generateCourseSummary(course, options = {}) {
    const userId = options && options.userId ? options.userId : null;
    const model = getCourseSummaryModel();
    const prompt = buildCourseSummaryPrompt(course);
    const generatedAt = new Date();

    const raw = await generatePromptReply({
        userId,
        model,
        prompt,
        options: {
            temperature: 0.2,
            maxTokens: 700,
            timeoutMs: aiConfig.providers.openai.timeoutMs
        }
    });

    return {
        summary: validateSummary(cleanSummaryText(raw)),
        model,
        generatedAt
    };
}

function readStoredCourseSummary(course) {
    const legacySummary = course && course.aiSummary && typeof course.aiSummary === 'object' && !Array.isArray(course.aiSummary)
        ? course.aiSummary
        : null;
    const summary = typeof (course && course.aiSummary) === 'string'
        ? normalizeTextPreserveParagraphs(course.aiSummary)
        : normalizeTextPreserveParagraphs(legacySummary && legacySummary.text);
    const generatedAt = course && course.aiSummaryGeneratedAt
        ? course.aiSummaryGeneratedAt
        : (legacySummary && legacySummary.generatedAt ? legacySummary.generatedAt : null);
    const model = String(course && course.aiSummaryModel || legacySummary && (legacySummary.model || legacySummary.provider) || '').trim();

    return {
        summary,
        generatedAt: generatedAt || null,
        model
    };
}

function applyGeneratedCourseSummary(course, result) {
    if (!course) return course;

    course.aiSummary = result && result.summary ? result.summary : '';
    course.aiSummaryGeneratedAt = result && result.generatedAt ? result.generatedAt : null;
    course.aiSummaryModel = result && result.model ? result.model : '';

    return course;
}

function clearGeneratedCourseSummary(course) {
    if (!course) return course;

    course.aiSummary = '';
    course.aiSummaryGeneratedAt = null;
    course.aiSummaryModel = '';

    return course;
}

function isCourseSummaryStale(course) {
    const legacySummary = course && course.aiSummary && typeof course.aiSummary === 'object' && !Array.isArray(course.aiSummary)
        ? course.aiSummary
        : null;
    if (!legacySummary || !legacySummary.sourceUpdatedAt || !course || !course.updatedAt) return false;

    return new Date(legacySummary.sourceUpdatedAt).getTime() < new Date(course.updatedAt).getTime();
}

function buildCourseSummaryPrompt(course) {
    const title = normalizeText(course && course.title) || 'Untitled course';
    const description = normalizeText(course && course.description);
    const topic = normalizeText(course && course.topic) || 'General';
    const sections = buildCourseOutline(course);

    return [
        'You are an expert course editor.',
        '',
        'Generate a concise and helpful course summary for the following online course.',
        '',
        'Requirements:',
        '- Write in English.',
        '- Start with 1 short paragraph.',
        '- Then add 3 to 5 bullet points describing what learners will gain.',
        '- Avoid marketing exaggeration.',
        '- Do not invent specific lessons that are not present.',
        '- Use only the provided course information.',
        '- Return plain text only.',
        '',
        `Course title: ${title}`,
        `Course description: ${description || '(none)'}`,
        `Topic: ${topic}`,
        'Sections and lessons:',
        JSON.stringify(sections),
        '',
        'Return only the final summary.'
    ].join('\n');
}

function buildCourseOutline(course) {
    return getCanonicalSections(course)
        .slice(0, MAX_SECTIONS)
        .map((section, sectionIndex) => ({
            section: normalizeText(section && section.title) || `Section ${sectionIndex + 1}`,
            lessons: (Array.isArray(section && section.lessons) ? section.lessons : [])
                .slice(0, MAX_LESSONS_PER_SECTION)
                .map((lesson, lessonIndex) => ({
                    title: normalizeText(lesson && lesson.title) || `Lesson ${lessonIndex + 1}`,
                    type: inferLessonTypeLabel(lesson),
                    description: normalizeText(lesson && lesson.description)
                }))
        }));
}

function cleanSummaryText(value) {
    return String(value || '')
        .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ''))
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function validateSummary(text) {
    const summary = normalizeTextPreserveParagraphs(text);
    if (!summary || summary.length < MIN_SUMMARY_LENGTH) {
        const error = new Error('Summary too short');
        error.code = 'SUMMARY_TOO_SHORT';
        throw error;
    }

    if (/^(error|failed|unable|timed out|quota|unauthorized|forbidden|not found)\b/i.test(summary)) {
        const error = new Error('Provider error text');
        error.code = 'SUMMARY_PROVIDER_ERROR_TEXT';
        throw error;
    }

    return summary;
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTextPreserveParagraphs(value) {
    return String(value || '')
        .split(/\n{2,}/)
        .map((part) => normalizeText(part))
        .filter(Boolean)
        .join('\n\n')
        .trim();
}

function inferLessonTypeLabel(lesson) {
    const type = normalizeText(lesson && lesson.type).toLowerCase();
    if (type) return type;
    if (lesson && lesson.content && Array.isArray(lesson.content.slides) && lesson.content.slides.length) return 'slide';
    if (lesson && Array.isArray(lesson.quiz) && lesson.quiz.length) return 'quiz';
    return 'video';
}

module.exports = {
    DEFAULT_SUMMARY_MODEL,
    applyGeneratedCourseSummary,
    buildCourseSummaryPrompt,
    clearGeneratedCourseSummary,
    generateCourseSummary,
    getCourseSummaryModel,
    isCourseSummaryStale,
    readStoredCourseSummary
};
