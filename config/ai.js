const path = require('path')

function readBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function readNumber(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const grokEnabled = readBoolean(process.env.GROK_ENABLED, false)

const aiConfig = {
    provider: 'user-defined',
    defaultModel: '',
    chatModel: '',
    summaryModel: String(process.env.AI_SUMMARY_MODEL || '').trim(),
    grok: {
        enabled: grokEnabled,
        scraperPath: path.resolve(process.env.GROK_SCRAPER_PATH || path.join(__dirname, '..', 'grok-scraper')),
        timeoutMs: readNumber(process.env.GROK_TIMEOUT_MS, 300000)
    },
    providers: {
        openai: {
            timeoutMs: readNumber(process.env.OPENAI_TIMEOUT_MS, 120000)
        },
        xai: {
            timeoutMs: readNumber(process.env.XAI_TIMEOUT_MS, 180000)
        },
        claude: {
            timeoutMs: readNumber(process.env.CLAUDE_TIMEOUT_MS, 180000)
        },
        gemini: {
            timeoutMs: readNumber(process.env.GEMINI_TIMEOUT_MS, 180000)
        }
    }
}

function normalizeAiModel(model) {
    return String(model || '').trim().slice(0, 200)
}

module.exports = {
    aiConfig,
    normalizeAiModel
}
