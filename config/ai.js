const path = require('path')

const DEFAULT_MODEL = 'llama3.2'
const SUPPORTED_MODELS = ['llama3.2', 'grok']

function readBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function readNumber(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const grokEnabled = readBoolean(process.env.GROK_ENABLED, false)
const requestedDefaultModel = SUPPORTED_MODELS.includes(process.env.AI_DEFAULT_MODEL)
    ? process.env.AI_DEFAULT_MODEL
    : DEFAULT_MODEL

const aiConfig = {
    defaultModel: requestedDefaultModel === 'grok' && !grokEnabled ? DEFAULT_MODEL : requestedDefaultModel,
    ollama: {
        model: process.env.OLLAMA_MODEL || DEFAULT_MODEL,
        timeoutMs: readNumber(process.env.OLLAMA_TIMEOUT_MS, 120000)
    },
    grok: {
        enabled: grokEnabled,
        scraperPath: path.resolve(process.env.GROK_SCRAPER_PATH || path.join(__dirname, '..', 'grok-scraper')),
        timeoutMs: readNumber(process.env.GROK_TIMEOUT_MS, 300000)
    }
}

function normalizeAiModel(model) {
    const value = String(model || aiConfig.defaultModel || DEFAULT_MODEL).trim()
    return SUPPORTED_MODELS.includes(value) ? value : aiConfig.defaultModel
}

function getModelOptions() {
    return [
        {
            id: 'llama3.2',
            label: 'llama3.2',
            provider: 'Ollama',
            enabled: true,
            description: 'Local Ollama model'
        },
        {
            id: 'grok',
            label: 'Grok',
            provider: 'x.com',
            enabled: aiConfig.grok.enabled,
            description: 'Local browser automation via grok-scraper'
        }
    ]
}

function setGrokEnabled(enabled) {
    aiConfig.grok.enabled = Boolean(enabled)
    process.env.GROK_ENABLED = enabled ? 'true' : 'false'
    if (aiConfig.defaultModel === 'grok' && !aiConfig.grok.enabled) {
        aiConfig.defaultModel = DEFAULT_MODEL
    }
}

module.exports = {
    aiConfig,
    SUPPORTED_MODELS,
    normalizeAiModel,
    getModelOptions,
    setGrokEnabled
}
