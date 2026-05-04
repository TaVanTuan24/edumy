const aiRouter = require('./aiRouter')
const { aiConfig } = require('../../config/ai')

async function generateChatReply({ model, messages, userId }) {
    const selectedModel = normalizeAiModel(model)
    const prompt = buildConversationPrompt(messages)
    return generatePromptReply({ model: selectedModel, prompt, messages, userId })
}

async function generateChatReplyStream({ model, messages, userId, onToken, onEvent, signal }) {
    const selectedModel = normalizeAiModel(model)
    const prompt = buildConversationPrompt(messages)
    return generatePromptReplyStream({
        model: selectedModel,
        prompt,
        messages,
        userId,
        options: { signal },
        onToken,
        onEvent
    })
}

async function generatePromptReply({ model, prompt, messages, userId, options = {} }) {
    const selectedModel = normalizeAiModel(model)
    return aiRouter.generate({ userId, model: selectedModel, prompt, messages, options })
}

async function generatePromptReplyStream({ model, prompt, messages, userId, options = {}, onToken, onEvent }) {
    const selectedModel = normalizeAiModel(model)
    return aiRouter.generateStream({ userId, model: selectedModel, prompt, messages, options, onToken, onEvent })
}

function buildConversationPrompt(messages) {
    const transcript = (Array.isArray(messages) ? messages : [])
        .filter((msg) => msg && msg.content && msg.status !== 'error')
        .slice(-12)
        .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n')

    return `${transcript}\n\nAssistant:`.trim()
}

function normalizeAiModel(model) {
    return String(model || '').trim().slice(0, 200)
}

function getModelOptions() {
    return []
}

function getAiErrorResponse(error, _model) {
    if (error && error.publicMessage) {
        return {
            code: error.code || 'AI_SERVICE_ERROR',
            statusCode: error.statusCode || 503,
            message: error.publicMessage
        }
    }

    if (error && error.code === 'ECONNREFUSED') {
        return {
            code: 'AI_ENDPOINT_UNREACHABLE',
            statusCode: 503,
            message: 'AI service unavailable. Please check the configured AI provider.'
        }
    }

    if (error && error.response) {
        return {
            code: 'AI_PROVIDER_ERROR',
            statusCode: error.response.status || 503,
            message: (error.response.data && error.response.data.error) || 'AI service error'
        }
    }

    return {
        code: 'AI_CHAT_FAILED',
        statusCode: 500,
        message: 'Failed to process your request. Please try again.'
    }
}

module.exports = {
    aiConfig,
    getModelOptions,
    normalizeAiModel,
    generateChatReply,
    generateChatReplyStream,
    generatePromptReply,
    generatePromptReplyStream,
    getAiErrorResponse
}
