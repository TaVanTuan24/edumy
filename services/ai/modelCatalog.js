const DEFAULT_MODEL = process.env.AI_CHAT_MODEL || 'gpt-5.5'

const MODEL_CATALOG = [
    {
        id: 'grok',
        label: 'Grok Scraper',
        provider: 'x.com',
        providerKey: 'grokScraper',
        enabled: false,
        description: 'Local browser automation via grok-scraper'
    },
    {
        id: 'grok-api',
        label: 'Grok API',
        provider: 'xAI',
        providerKey: 'xai',
        requiresKey: 'xaiKey',
        apiModel: process.env.XAI_MODEL || 'grok-4-latest',
        timeoutEnv: 'XAI_TIMEOUT_MS',
        description: 'xAI Grok API'
    },
    {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        provider: 'OpenAI',
        providerKey: 'openai',
        requiresKey: 'openaiKey',
        apiModel: process.env.OPENAI_GPT54_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4',
        timeoutEnv: 'OPENAI_TIMEOUT_MS',
        description: 'OpenAI GPT-5.4'
    },
    {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        provider: 'OpenAI',
        providerKey: 'openai',
        requiresKey: 'openaiKey',
        apiModel: process.env.OPENAI_GPT55_MODEL || 'gpt-5.5',
        timeoutEnv: 'OPENAI_TIMEOUT_MS',
        description: 'OpenAI GPT-5.5'
    },
    {
        id: 'claude-3-5-sonnet',
        label: 'Claude Sonnet',
        provider: 'Anthropic',
        providerKey: 'claude',
        requiresKey: 'claudeKey',
        apiModel: process.env.CLAUDE_SONNET_MODEL || 'claude-3-5-sonnet-20241022',
        timeoutEnv: 'CLAUDE_TIMEOUT_MS',
        description: 'Anthropic Claude Sonnet'
    },
    {
        id: 'claude-3-opus',
        label: 'Claude Opus',
        provider: 'Anthropic',
        providerKey: 'claude',
        requiresKey: 'claudeKey',
        apiModel: process.env.CLAUDE_OPUS_MODEL || 'claude-3-opus-20240229',
        timeoutEnv: 'CLAUDE_TIMEOUT_MS',
        description: 'Anthropic Claude Opus'
    },
    {
        id: 'gemini-pro',
        label: 'Gemini Pro',
        provider: 'Google',
        providerKey: 'gemini',
        requiresKey: 'geminiKey',
        apiModel: process.env.GEMINI_PRO_MODEL || 'gemini-3-flash-preview',
        timeoutEnv: 'GEMINI_TIMEOUT_MS',
        description: 'Google Gemini'
    }
]

function getCatalogModels() {
    return MODEL_CATALOG.map((model) => ({ ...model }))
}

function getCatalogModel(id) {
    return getCatalogModels().find((model) => model.id === id) || getCatalogModels()[0]
}

module.exports = {
    DEFAULT_MODEL,
    MODEL_CATALOG,
    getCatalogModels,
    getCatalogModel
}
