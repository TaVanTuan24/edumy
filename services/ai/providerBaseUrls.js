const { normalizeBaseUrl } = require('../../utils/validateAiBaseUrl')

const DEFAULT_BASE_URLS = {
    openai: readBaseUrl(process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1'),
    xai: readBaseUrl(process.env.XAI_BASE_URL || 'https://api.x.ai/v1'),
    claude: readBaseUrl(process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com/v1'),
    gemini: readBaseUrl(process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta')
}

const BASE_URL_FIELDS = {
    openai: 'openaiBaseUrl',
    xai: 'xaiBaseUrl',
    claude: 'claudeBaseUrl',
    gemini: 'geminiBaseUrl'
}

function getProviderBaseUrl(provider, settings) {
    return getProviderBaseUrlInfo(provider, settings).baseUrl
}

function getProviderBaseUrlInfo(provider, settings) {
    const providerKey = String(provider || '').toLowerCase()
    const field = BASE_URL_FIELDS[providerKey]
    const customBaseUrl = field && settings ? readCustomBaseUrl(settings[field], providerKey) : ''
    const baseUrl = customBaseUrl || getDefaultProviderBaseUrl(providerKey)

    return {
        baseUrl,
        baseUrlConfigured: Boolean(customBaseUrl),
        field
    }
}

function getDefaultProviderBaseUrl(provider) {
    return DEFAULT_BASE_URLS[String(provider || '').toLowerCase()] || ''
}

function joinProviderUrl(baseUrl, suffix) {
    const root = `${readBaseUrl(baseUrl)}/`
    const relative = String(suffix || '').replace(/^\/+/, '')
    return new URL(relative, root).toString()
}

function readBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '')
}

function readCustomBaseUrl(value, provider) {
    const raw = readBaseUrl(value)
    if (!raw) return ''
    try {
        return normalizeBaseUrl(raw, provider) || ''
    } catch {
        return ''
    }
}

module.exports = {
    BASE_URL_FIELDS,
    getProviderBaseUrl,
    getProviderBaseUrlInfo,
    getDefaultProviderBaseUrl,
    joinProviderUrl
}
