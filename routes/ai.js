const express = require("express")
const router = express.Router()
const User = require("../models/user")
const aiChatController = require("../controllers/aiChatController")
const { generatePromptReply, normalizeAiModel } = require("../services/ai/chatOrchestrator")
const { aiConfig } = require("../config/ai")
const { awardGamification } = require('../utils/gamification')
const logger = require('../utils/logger')
const aiCourseController = require('../controllers/aiCourseController')
const { aiChatLimiter, aiSettingsLimiter, aiStreamLimiter } = require('../utils/rateLimiters')
const { validate, aiChatMessageSchema, aiQuizGenerateSchema, aiSlideGenerateSchema } = require('../middleware/validate')
const {
    buildSlidePrompt,
    parseAiSlideResponse,
    createFallbackResolvedSlides,
    resolveDraftSlides
} = require('../utils/aiSlidePipeline')

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized. Please login." })
    }
    next()
}

// Apply authentication middleware to all routes
router.use(isAuthenticated)

// Open chat page
router.get("/", aiChatController.renderChat)

router.get("/models", aiChatController.listModels)

router.get("/settings", aiChatController.getSettings)

router.post("/settings", aiSettingsLimiter, aiChatController.saveSettings)

router.delete("/settings/:provider", aiSettingsLimiter, aiChatController.clearSetting)

router.delete("/settings/:provider/base-url", aiSettingsLimiter, aiChatController.resetBaseUrl)

router.post("/settings/:provider/test", aiSettingsLimiter, aiChatController.testProviderConnection)

// Stream message - creates new chat or appends to existing conversation
router.post("/chat/stream", aiStreamLimiter, validate(aiChatMessageSchema), aiChatController.streamMessage)

// Send message - creates new chat or appends to existing
router.post("/chat", aiChatLimiter, validate(aiChatMessageSchema), async (req, res, next) => {
    const { courseId, question } = req.body || {}

    if (!courseId || !question) {
        return aiChatController.sendMessage(req, res, next)
    }

    return aiCourseController.handleCourseQuestion(req, res)
})

router.post("/generate-quiz", validate(aiQuizGenerateSchema), async (req, res) => {
    try {
        const userPrompt = String(req.body.prompt || '').trim();
        const difficulty = String(req.body.difficulty || 'medium').toLowerCase();
        const count = Math.min(Math.max(parseInt(req.body.count, 10) || 5, 1), 10);

        const safeDifficulty = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
        const trimmedPrompt = userPrompt.slice(0, 1000);

        const prompt = `You are a quiz generator.\n\nGenerate EXACTLY ${count} multiple choice questions.\nEach question MUST have EXACTLY 4 answers.\nDifficulty: ${safeDifficulty}.\n\nRULES:\n- Only ONE correct answer\n- Other 3 answers must be plausible but incorrect\n- DO NOT return less than 4 answers\n- DO NOT return explanations\n\nTopic: ${trimmedPrompt}\n\nReturn JSON format ONLY:\n[\n  {\n    "question": "string",\n    "answers": [\n      {"text": "A", "correct": false},\n      {"text": "B", "correct": false},\n      {"text": "C", "correct": true},\n      {"text": "D", "correct": false}\n    ]\n  }\n]\n`;

        const raw = await callConfiguredAi({
            prompt,
            model: aiConfig.chatModel,
            userId: req.user && req.user._id,
            temperature: 0.3,
            topP: 0.9,
            maxTokens: 1600
        });
        const parsed = parseQuizJson(raw);

        if (!parsed.length) {
            return res.status(422).json({ error: 'Invalid AI response' });
        }

        const gamificationUser = await User.findById(req.user._id);
        if (gamificationUser) {
            await awardGamification(gamificationUser, { action: 'aiQuizGenerate' });
        }

        res.json({ success: true, questions: parsed });
    } catch (err) {
        logger.error({ err }, 'AI Quiz Error');
        if (err.publicMessage) {
            return res.status(err.statusCode || 503).json({ error: err.publicMessage });
        }
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'AI service unavailable. Please check the configured AI provider.' });
        }
        res.status(500).json({ error: 'Failed to generate quiz' });
    }
});

// List all chats for current user
router.get("/list", aiChatController.listChats)

router.post("/generate-slide", validate(aiSlideGenerateSchema), async (req, res) => {
    try {
        const userPrompt = String(req.body.prompt || '').trim()
        const style = String(req.body.style || 'professional').toLowerCase()
        const count = Math.min(Math.max(parseInt(req.body.count, 10) || 5, 3), 8)
        const language = String(req.body.language || 'English').trim()

        const safeStyle = ['professional', 'minimal', 'modern', 'dark'].includes(style) ? style : 'professional'
        const trimmedPrompt = userPrompt.slice(0, 1000)
        const prompt = buildSlidePrompt({
            topic: trimmedPrompt,
            count,
            style: safeStyle,
            language
        })

        const result = await generateWithRetry(prompt, 3, {
            topic: trimmedPrompt,
            requestedCount: count,
            style: safeStyle,
            language
        })

        const gamificationUser = await User.findById(req.user._id)
        if (gamificationUser) {
            await awardGamification(gamificationUser, { action: 'aiSlideGenerate' })
        }

        res.json({
            success: true,
            slides: result.slides,
            draftSlides: result.semanticSlides,
            semanticSlides: result.semanticSlides,
            examples: result.examples
        })
    } catch (err) {
        logger.error({ err }, 'AI Slide Error')
        const fallback = createFallbackResolvedSlides(req.body && req.body.prompt)
        res.status(200).json({
            success: true,
            slides: fallback,
            draftSlides: [],
            semanticSlides: [],
            examples: [],
            fallback: true,
            error: 'Failed to generate slides'
        })
    }
})

router.post("/resolve-slide-draft", async (req, res) => {
    try {
        const slides = Array.isArray(req.body && req.body.slides) ? req.body.slides : []
        const topic = String(req.body && req.body.prompt || '').trim()
        const style = String(req.body && req.body.style || 'professional').toLowerCase()
        const language = String(req.body && req.body.language || 'English').trim()
        const safeStyle = ['professional', 'minimal', 'modern', 'dark'].includes(style) ? style : 'professional'

        if (!slides.length) {
            return res.status(400).json({ success: false, error: 'Draft slides are required' })
        }

        const result = resolveDraftSlides(slides, {
            topic,
            requestedCount: slides.length,
            style: safeStyle,
            language
        })

        return res.json({
            success: true,
            slides: result.slides,
            draftSlides: result.semanticSlides,
            semanticSlides: result.semanticSlides,
            examples: result.examples
        })
    } catch (err) {
        logger.error({ err }, 'AI Slide Resolve Error')
        return res.status(500).json({ success: false, error: 'Failed to resolve draft slides' })
    }
})

router.post("/generate-slide-refine", async (req, res) => {
    try {
        const promptTopic = String(req.body && req.body.prompt || '').trim()
        const style = String(req.body && req.body.style || 'professional').toLowerCase()
        const language = String(req.body && req.body.language || 'English').trim()
        const action = String(req.body && req.body.action || 'regenerate').toLowerCase()
        const currentSlide = req.body && req.body.slide && typeof req.body.slide === 'object' ? req.body.slide : {}
        const safeStyle = ['professional', 'minimal', 'modern', 'dark'].includes(style) ? style : 'professional'

        if (!promptTopic) {
            return res.status(400).json({ success: false, error: 'Prompt is required' })
        }

        const slideContext = JSON.stringify(currentSlide || {})
        const refinePrompt = [
            'You are a professional presentation slide generator.',
            '',
            'Your job is to create clean, concise, visually structured slide content.',
            '',
            'Rules:',
            '- Return JSON only',
            '- Do not include explanations',
            '- Do not use coordinates',
            '- Use only structured content',
            '- Generate exactly 1 slide',
            '- Use one of these templates when appropriate: ["title-center", "title-content", "bullet-list", "two-column", "section-divider", "title-left-content-right", "summary-slide"]',
            '- Keep bullet points short (max 10-12 words)',
            '- Avoid repetition and placeholders like [object Object]',
            '- Content must be meaningful and educational',
            '',
            `Action: ${action === 'improve' ? 'Improve and strengthen this slide draft' : 'Regenerate this slide draft with a fresh angle'}`,
            `Presentation topic: ${promptTopic}`,
            `Visual style: ${safeStyle}`,
            `Language: ${language}`,
            `Current slide draft: ${slideContext}`,
            '',
            'Return format:',
            '{',
            '  "slides": [',
            '    {',
            '      "template": "bullet-list",',
            '      "title": "...",',
            '      "bullets": ["...", "...", "..."]',
            '    }',
            '  ]',
            '}'
        ].join('\n')

        const result = await generateWithRetry(refinePrompt, 2, {
            topic: promptTopic,
            requestedCount: 1,
            style: safeStyle,
            language
        })

        return res.json({
            success: true,
            slide: Array.isArray(result.semanticSlides) && result.semanticSlides[0] ? result.semanticSlides[0] : null
        })
    } catch (err) {
        logger.error({ err }, 'AI Slide Refine Error')
        return res.status(500).json({ success: false, error: 'Failed to refine slide' })
    }
})

router.post("/:id/regenerate/stream", aiChatController.streamRegenerateLast)

router.post("/:id/regenerate", aiChatController.regenerateLast)

// Get a specific chat with all messages
router.get("/:id", aiChatController.getChat)

// Delete a chat
router.delete("/:id", aiChatController.deleteChat)

async function callConfiguredAi({ prompt, model, userId, temperature, topP, maxTokens }) {
    return generatePromptReply({
        userId,
        model,
        prompt,
        options: {
            temperature: temperature === undefined ? 0.3 : temperature,
            topP: topP === undefined ? 0.9 : topP,
            maxTokens: maxTokens || 1200,
            timeoutMs: Math.min(aiConfig.providers.openai.timeoutMs, 20000)
        }
    })
}

function parseQuizJson(raw) {
    const cleaned = String(raw || '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim()

    let jsonText = cleaned
    const start = cleaned.indexOf('[')
    const end = cleaned.lastIndexOf(']')
    if (start !== -1 && end !== -1 && end > start) {
        jsonText = cleaned.slice(start, end + 1)
    }

    let parsed = []
    try {
        const data = JSON.parse(jsonText)
        if (Array.isArray(data)) parsed = data
        if (!Array.isArray(data) && Array.isArray(data.questions)) parsed = data.questions
    } catch {
        return []
    }

    return parsed.map((item) => normalizeQuizQuestion(item)).filter(Boolean)
}

function normalizeQuizQuestion(item) {
    if (!item || typeof item !== 'object') return null

    const question = String(item.question || item.prompt || '').trim()
    const answersSource = Array.isArray(item.answers)
        ? item.answers
        : Array.isArray(item.options)
            ? item.options
            : []

    const answers = answersSource.map((answer) => {
        if (typeof answer === 'string') {
            return { text: answer.trim(), correct: false }
        }
        return {
            text: String(answer.text || answer.answer || '').trim(),
            correct: Boolean(answer.correct || answer.isCorrect)
        }
    }).filter((answer) => answer.text)

    if (!question) return null

    while (answers.length < 4) {
        answers.push({ text: 'Placeholder answer', correct: false })
    }

    if (answers.length > 4) {
        answers.length = 4
    }

    let correctIndex = answers.findIndex((answer) => answer.correct)
    if (correctIndex < 0) {
        correctIndex = 0
    }

    answers.forEach((answer, idx) => {
        answer.correct = idx === correctIndex
    })

    return { question, answers }
}

function parseSlideJson(raw, options) {
    try {
        return parseAiSlideResponse(raw, options)
    } catch (error) {
        console.warn('AI Slide Parse Error:', error.message)
        return {
            semanticSlides: [],
            slides: createFallbackResolvedSlides(options && options.topic),
            examples: []
        }
    }
}

async function generateWithRetry(prompt, retries, options) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
            const raw = await callConfiguredAi({
                prompt,
                model: aiConfig.chatModel,
                temperature: 0.3,
                topP: 0.9,
                maxTokens: 2200
            })
            const result = parseSlideJson(raw, options)
            if (Array.isArray(result.slides) && result.slides.length) {
                return result
            }
        } catch (error) {
            console.warn('AI Slide Retry', attempt + 1, error.message)
        }
    }

    return {
        semanticSlides: [],
        slides: createFallbackResolvedSlides(options && options.topic),
        examples: []
    }
}

module.exports = router
