const path = require('path')
const { DEFAULT_MODEL, getCatalogModels, getCatalogModel } = require('../services/ai/modelCatalog')

const MODEL_OPTIONS = getCatalogModels()
const SUPPORTED_MODELS = MODEL_OPTIONS.map((model) => model.id)
const LEGACY_OPENAI_MODELS = new Set(['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4'])
const LEGACY_LOCAL_MODELS = new Set(['llama3', 'llama3.1', 'llama3.2'])
const OPENAI_UPGRADE_MODEL = 'gpt-5.4'

function readBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function readNumber(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const grokEnabled = readBoolean(process.env.GROK_ENABLED, false)
const envDefaultModel = String(process.env.AI_DEFAULT_MODEL || '').trim()
const requestedDefaultModel = SUPPORTED_MODELS.includes(envDefaultModel)
    ? envDefaultModel
    : LEGACY_OPENAI_MODELS.has(envDefaultModel)
        ? OPENAI_UPGRADE_MODEL
        : DEFAULT_MODEL

const aiConfig = {
    provider: String(process.env.AI_PROVIDER || 'openai-compatible').trim().toLowerCase() || 'openai-compatible',
    defaultModel: requestedDefaultModel === 'grok' && !grokEnabled ? DEFAULT_MODEL : requestedDefaultModel,
    chatModel: String(process.env.AI_CHAT_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    summaryModel: String(process.env.AI_SUMMARY_MODEL || 'gpt-5.5').trim() || 'gpt-5.5',
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
    if (LEGACY_OPENAI_MODELS.has(value)) return OPENAI_UPGRADE_MODEL
    if (LEGACY_LOCAL_MODELS.has(value)) return aiConfig.chatModel
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
