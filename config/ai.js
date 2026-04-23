const path = require('path')
const { DEFAULT_MODEL, getCatalogModels, getCatalogModel } = require('../services/ai/modelCatalog')

const MODEL_OPTIONS = getCatalogModels()
const SUPPORTED_MODELS = MODEL_OPTIONS.map((model) => model.id)

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
    const value = String(model || aiConfig.defaultModel || DEFAULT_MODEL).trim()
    return SUPPORTED_MODELS.includes(value) ? value : aiConfig.defaultModel
}

function getModelOptions() {
    return MODEL_OPTIONS.map((model) => ({
        ...model,
        enabled: model.id === 'grok' ? aiConfig.grok.enabled : model.enabled === true
    }))
}

function getModelConfig(model) {
    return getCatalogModel(model)
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
    MODEL_OPTIONS,
    normalizeAiModel,
    getModelOptions,
    getModelConfig,
    setGrokEnabled
}
