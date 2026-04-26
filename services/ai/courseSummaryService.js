const Course = require('../../models/course')
const { generatePromptReply } = require('./chatOrchestrator')
const { aiConfig } = require('../../config/ai')
const grokService = require('./grokService')
const grokSetupService = require('./grokSetupService')
const { getCanonicalSections } = require('../../utils/courseContentAdapter')

const MIN_SUMMARY_LENGTH = 30
const GROK_TIMEOUT_MS = 15000
const GPT_TIMEOUT_MS = 15000
const OLLAMA_TIMEOUT_MS = 12000

async function generateCourseSummaryWithFallback(course, options = {}) {
    const settings = options && typeof options === 'object' ? options : {}
    const force = Boolean(settings.force)
    const persist = settings.persist !== false
    const userId = settings.userId || null
    const cached = readStoredSummary(course)

    if (!force && cached.summary) {
        return {
            summary: cached.summary,
            providerUsed: cached.providerUsed,
            fallbackUsed: cached.fallbackUsed,
            failedProviders: cached.failedProviders,
            generatedAt: cached.generatedAt,
            stale: isSummaryStale(course),
            cached: true,
            unavailable: false
        }
    }

    const prompt = buildCourseSummaryPrompt(course)
    const failedProviders = []
    const providers = [
        {
            id: 'grok-scraper',
            run: () => tryGrokSummary(prompt)
        },
        {
            id: 'gpt5.4',
            run: () => tryGptSummary(prompt, userId)
        },
        {
            id: 'llama3.2',
            run: () => tryLlamaSummary(prompt, userId)
        }
    ]

    for (const provider of providers) {
        const startedAt = Date.now()
        try {
            const raw = await provider.run()
            const cleaned = validateSummary(cleanSummaryText(raw))
            const result = {
                summary: cleaned,
                providerUsed: provider.id,
                fallbackUsed: provider.id !== 'grok-scraper',
                failedProviders,
                generatedAt: new Date(),
                stale: false,
                cached: false,
                unavailable: false
            }

            logSummaryAttempt(course, provider.id, true, Date.now() - startedAt, '')

            if (persist) {
                await persistSummary(course, result)
            }

            return result
        } catch (error) {
            const reason = sanitizeFailure(error)
            failedProviders.push({
                provider: provider.id,
                code: reason.code
            })
            logSummaryAttempt(course, provider.id, false, Date.now() - startedAt, reason.code)
        }
    }

    if (cached.summary) {
        return {
            summary: cached.summary,
            providerUsed: cached.providerUsed,
            fallbackUsed: cached.fallbackUsed,
            failedProviders,
            generatedAt: cached.generatedAt,
            stale: true,
            cached: true,
            unavailable: false,
            refreshFailed: true
        }
    }

    return {
        summary: '',
        providerUsed: '',
        fallbackUsed: false,
        failedProviders,
        generatedAt: null,
        stale: false,
        cached: false,
        unavailable: true
    }
}

function buildCourseSummaryPrompt(course) {
    const title = normalizeText(course && course.title)
    const topic = normalizeText(course && course.topic)
    const description = normalizeText(course && course.description)
    const outline = buildCourseOutline(course)

    return [
        'You are writing a course preview summary for learners.',
        '',
        'Write in Vietnamese because the app UI is Vietnamese, unless the course content clearly requires another language.',
        'Use only the provided course information.',
        'Do not invent lessons, tools, projects, or outcomes that are not present.',
        'Avoid hype and marketing exaggeration.',
        'Keep the summary concise, practical, and learner-friendly.',
        'Output must be plain text only.',
        'Use 2 to 4 short paragraphs or a compact bullet list.',
        'Explain:',
        '- what the learner will study',
        '- the main skills or topics covered',
        '- who the course is suitable for if it can be inferred',
        '',
        `Course title: ${title || 'Untitled course'}`,
        `Topic/category: ${topic || 'General'}`,
        `Existing description: ${description || '(none)'}`,
        `Curriculum outline: ${JSON.stringify(outline)}`,
        '',
        'Return only the final summary text.'
    ].join('\n')
}

function buildCourseOutline(course) {
    const sections = getCanonicalSections(course).slice(0, 12)

    return sections.map((section, sectionIndex) => {
        const lessons = Array.isArray(section && section.lessons) ? section.lessons.slice(0, 12) : []
        return {
            section: normalizeText(section && section.title) || `Section ${sectionIndex + 1}`,
            lessons: lessons.map((lesson, lessonIndex) => ({
                title: normalizeText(lesson && lesson.title) || `Lesson ${lessonIndex + 1}`,
                type: normalizeText(lesson && lesson.type) || inferLessonTypeLabel(lesson),
                description: normalizeText(lesson && lesson.description)
            }))
        }
    })
}

async function tryGrokSummary(prompt) {
    const status = await grokSetupService.getStatus()
    if (!status || !status.ready) {
        const error = new Error('Grok unavailable')
        error.code = status && status.enabled ? 'GROK_NOT_READY' : 'GROK_DISABLED'
        throw error
    }

    return withTimeout(
        grokService.generate(prompt).then((text) => grokService.cleanGrokReply(text)),
        GROK_TIMEOUT_MS,
        'GROK_TIMEOUT'
    )
}

async function tryGptSummary(prompt, userId) {
    return generatePromptReply({
        userId,
        model: 'gpt-5.4',
        prompt,
        options: {
            temperature: 0.3,
            maxTokens: 500,
            timeoutMs: Math.min(aiConfig.providers.openai.timeoutMs, GPT_TIMEOUT_MS)
        }
    })
}

async function tryLlamaSummary(prompt, userId) {
    return generatePromptReply({
        userId,
        model: 'llama3.2',
        prompt,
        options: {
            temperature: 0.3,
            maxTokens: 420,
            timeoutMs: Math.min(aiConfig.ollama.timeoutMs, OLLAMA_TIMEOUT_MS)
        }
    })
}

function cleanSummaryText(value) {
    return String(value || '')
        .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ''))
        .replace(/^#\s+/gm, '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function validateSummary(text) {
    const summary = normalizeTextPreserveParagraphs(text)
    if (!summary || summary.length < MIN_SUMMARY_LENGTH) {
        const error = new Error('Summary too short')
        error.code = 'SUMMARY_TOO_SHORT'
        throw error
    }

    if (/^(error|failed|unable|timed out|quota|unauthorized|forbidden|not found)\b/i.test(summary)) {
        const error = new Error('Provider error text')
        error.code = 'SUMMARY_PROVIDER_ERROR_TEXT'
        throw error
    }

    if ((summary.startsWith('{') && summary.endsWith('}')) || (summary.startsWith('[') && summary.endsWith(']'))) {
        const error = new Error('Unexpected JSON output')
        error.code = 'SUMMARY_RAW_JSON'
        throw error
    }

    return summary
}

function readStoredSummary(course) {
    const aiSummary = course && course.aiSummary && typeof course.aiSummary === 'object'
        ? course.aiSummary
        : {}

    return {
        summary: normalizeTextPreserveParagraphs(aiSummary.text),
        providerUsed: String(aiSummary.provider || ''),
        fallbackUsed: Boolean(aiSummary.fallbackUsed),
        failedProviders: Array.isArray(aiSummary.failedProviders)
            ? aiSummary.failedProviders.map((entry) => ({
                provider: String(entry && entry.provider || ''),
                code: String(entry && entry.code || '')
            })).filter((entry) => entry.provider)
            : [],
        generatedAt: aiSummary.generatedAt || null
    }
}

function isSummaryStale(course) {
    const sourceUpdatedAt = course && course.aiSummary ? course.aiSummary.sourceUpdatedAt : null
    const updatedAt = course && course.updatedAt ? new Date(course.updatedAt) : null
    if (!sourceUpdatedAt || !updatedAt) return false
    return new Date(sourceUpdatedAt).getTime() < updatedAt.getTime()
}

async function persistSummary(course, result) {
    if (!course || !course._id || !result || !result.summary) return

    await Course.updateOne(
        { _id: course._id },
        {
            $set: {
                aiSummary: {
                    text: result.summary,
                    provider: result.providerUsed,
                    generatedAt: result.generatedAt || new Date(),
                    fallbackUsed: Boolean(result.fallbackUsed),
                    sourceUpdatedAt: course.updatedAt || new Date(),
                    failedProviders: Array.isArray(result.failedProviders) ? result.failedProviders.slice(0, 3) : []
                }
            }
        }
    )

    if (course.aiSummary && typeof course.aiSummary === 'object') {
        course.aiSummary.text = result.summary
        course.aiSummary.provider = result.providerUsed
        course.aiSummary.generatedAt = result.generatedAt || new Date()
        course.aiSummary.fallbackUsed = Boolean(result.fallbackUsed)
        course.aiSummary.sourceUpdatedAt = course.updatedAt || new Date()
        course.aiSummary.failedProviders = Array.isArray(result.failedProviders) ? result.failedProviders.slice(0, 3) : []
    }
}

function sanitizeFailure(error) {
    return {
        code: String(error && error.code || 'UNKNOWN_ERROR').trim() || 'UNKNOWN_ERROR'
    }
}

function logSummaryAttempt(course, provider, success, durationMs, code) {
    const payload = {
        courseId: String(course && course._id || ''),
        provider,
        success: Boolean(success),
        durationMs: Number(durationMs) || 0,
        code: String(code || '')
    }

    if (success) {
        console.info('[course-summary]', payload)
    } else {
        console.warn('[course-summary]', payload)
    }
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeTextPreserveParagraphs(value) {
    return String(value || '')
        .split(/\n{2,}/)
        .map((part) => normalizeText(part))
        .filter(Boolean)
        .join('\n\n')
        .trim()
}

function inferLessonTypeLabel(lesson) {
    const type = normalizeText(lesson && lesson.type).toLowerCase()
    if (type) return type
    if (lesson && lesson.content && Array.isArray(lesson.content.slides) && lesson.content.slides.length) return 'slide'
    if (lesson && Array.isArray(lesson.quiz) && lesson.quiz.length) return 'quiz'
    return 'video'
}

function withTimeout(promise, timeoutMs, code) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const error = new Error('Timed out')
            error.code = code || 'TIMEOUT'
            reject(error)
        }, timeoutMs)

        promise
            .then((value) => {
                clearTimeout(timer)
                resolve(value)
            })
            .catch((error) => {
                clearTimeout(timer)
                reject(error)
            })
    })
}

module.exports = {
    buildCourseSummaryPrompt,
    generateCourseSummaryWithFallback,
    isSummaryStale
}
