const ollamaService = require('./ollamaService')
const grokService = require('./grokService')
const { normalizeAiModel, getModelOptions, aiConfig } = require('../../config/ai')

async function generateChatReply({ model, messages }) {
    const selectedModel = normalizeAiModel(model)
    const prompt = buildConversationPrompt(messages)
    return generatePromptReply({ model: selectedModel, prompt })
}

async function generateChatReplyStream({ model, messages, onToken }) {
    const selectedModel = normalizeAiModel(model)
    const prompt = buildConversationPrompt(messages)
    return generatePromptReplyStream({ model: selectedModel, prompt, onToken })
}

async function generatePromptReply({ model, prompt, options = {} }) {
    const selectedModel = normalizeAiModel(model)

    if (selectedModel === 'grok') {
        return grokService.generate(prompt)
    }

    return ollamaService.generate(prompt, options)
}

async function generatePromptReplyStream({ model, prompt, options = {}, onToken }) {
    const selectedModel = normalizeAiModel(model)

    if (selectedModel === 'grok') {
        const reply = await grokService.generate(prompt)
        await simulateStream(reply, onToken)
        return reply
    }

    return ollamaService.generateStream(prompt, options, onToken)
}

async function simulateStream(text, onToken) {
    const tokens = String(text || '').match(/\S+\s*|\n+/g) || []
    for (const token of tokens) {
        if (onToken) onToken(token)
        await new Promise((resolve) => setTimeout(resolve, 18))
    }
}

function buildConversationPrompt(messages) {
    const transcript = (Array.isArray(messages) ? messages : [])
        .filter((msg) => msg && msg.content && msg.status !== 'error')
        .slice(-12)
        .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n')

    return `${transcript}\n\nAssistant:`.trim()
}

function getAiErrorResponse(error, model) {
    if (error && error.publicMessage) {
        return {
            code: error.code || 'AI_SERVICE_ERROR',
            statusCode: error.statusCode || 503,
            message: error.publicMessage
        }
    }

    if (error && error.code === 'ECONNREFUSED') {
        return {
            code: 'OLLAMA_UNAVAILABLE',
            statusCode: 503,
            message: 'AI service unavailable. Is Ollama running?'
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
        message: model === 'grok'
            ? 'Grok could not process your request. Please try again or switch to llama3.2.'
            : 'Failed to process your request. Please try again.'
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
