const { generatePromptReply } = require('./chatOrchestrator');
const { aiConfig, SUPPORTED_MODELS } = require('../../config/ai');
const { getCanonicalSections } = require('../../utils/courseContentAdapter');

const DEFAULT_SUMMARY_MODEL = 'gpt-5.5';
const MIN_SUMMARY_LENGTH = 30;
const MAX_SECTIONS = 12;
const MAX_LESSONS_PER_SECTION = 12;
const VIETNAMESE_CHAR_PATTERN = /[\u0102\u0103\u00C2\u00E2\u0110\u0111\u00CA\u00EA\u00D4\u00F4\u01A0\u01A1\u01AF\u01B0\u00C1\u00E1\u00C0\u00E0\u1EA2\u1EA3\u00C3\u00E3\u1EA0\u1EA1\u1EA4\u1EA5\u1EA6\u1EA7\u1EA8\u1EA9\u1EAA\u1EAB\u1EAC\u1EAD\u1EAE\u1EAF\u1EB0\u1EB1\u1EB2\u1EB3\u1EB4\u1EB5\u1EB6\u1EB7\u00C9\u00E9\u00C8\u00E8\u1EBA\u1EBB\u1EBC\u1EBD\u1EB8\u1EB9\u1EBE\u1EBF\u1EC0\u1EC1\u1EC2\u1EC3\u1EC4\u1EC5\u1EC6\u1EC7\u00CD\u00ED\u00CC\u00EC\u1EC8\u1EC9\u0128\u0129\u1ECA\u1ECB\u00D3\u00F3\u00D2\u00F2\u1ECE\u1ECF\u00D5\u00F5\u1ECC\u1ECD\u1ED0\u1ED1\u1ED2\u1ED3\u1ED4\u1ED5\u1ED6\u1ED7\u1ED8\u1ED9\u1EDA\u1EDB\u1EDC\u1EDD\u1EDE\u1EDF\u1EE0\u1EE1\u1EE2\u1EE3\u00DA\u00FA\u00D9\u00F9\u1EE6\u1EE7\u0168\u0169\u1EE4\u1EE5\u1EE8\u1EE9\u1EEA\u1EEB\u1EEC\u1EED\u1EEE\u1EEF\u1EF0\u1EF1\u00DD\u00FD\u1EF2\u1EF3\u1EF6\u1EF7\u1EF8\u1EF9\u1EF4\u1EF5]/i;
const VIETNAMESE_KEYWORD_PATTERN = /\b(khoa hoc|bai hoc|nguoi hoc|thuc hanh|tong quan|lap trinh|bao mat|mang may tinh)\b/i;

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
    const preferredLanguage = shouldWriteVietnamese(course) ? 'Vietnamese' : 'English';

    return [
        'You are an expert course editor.',
        '',
        'Generate a concise and helpful course summary for the following online course.',
        '',
        'Requirements:',
        `- Write in ${preferredLanguage}.`,
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

function shouldWriteVietnamese(course) {
    const haystack = [
        course && course.title,
        course && course.description,
        course && course.topic,
        ...getCanonicalSections(course).flatMap((section) => [
            section && section.title,
            ...(Array.isArray(section && section.lessons) ? section.lessons.map((lesson) => lesson && lesson.title) : [])
        ])
    ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');

    if (!haystack) return true;
    if (VIETNAMESE_CHAR_PATTERN.test(haystack)) return true;
    return VIETNAMESE_KEYWORD_PATTERN.test(haystack);
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
