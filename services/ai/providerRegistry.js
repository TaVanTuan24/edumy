const openaiService = require('./openaiService')
const xaiService = require('./xaiService')
const claudeService = require('./claudeService')
const geminiService = require('./geminiService')

const providers = {
    openai: openaiService,
    xai: xaiService,
    claude: claudeService,
    gemini: geminiService
}

function getProvider(providerKey) {
    return providers[providerKey] || null
}

module.exports = {
    getProvider
}
