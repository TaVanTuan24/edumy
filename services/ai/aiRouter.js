const UserAISettings = require('../../models/userAISettings')
const { decryptKey } = require('../../utils/apiKeyCrypto')
const { getModelConfig, normalizeAiModel } = require('../../config/ai')
const { getProvider } = require('./providerRegistry')
const { normalizeMessages, createStreamEvent, normalizeFinalResponse } = require('./normalize')
const { AIKeyMissingError, AIProviderError } = require('./errors')
const ollamaService = require('./ollamaService')
const grokService = require('./grokService')

async function generate({ userId, model, prompt, messages, options = {} }) {
    const result = await generateNormalized({ userId, model, prompt, messages, options })
    return result.content
}

async function generateNormalized({ userId, model, prompt, messages, options = {} }) {
    const selectedModel = normalizeAiModel(model)
    const config = getModelConfig(selectedModel)

    if (selectedModel === 'grok') {
        const content = await grokService.generate(prompt)
        return normalizeFinalResponse({
            provider: 'grokScraper',
            model: selectedModel,
            content,
            finishReason: 'stop'
        })
    }

    if (config.providerKey === 'ollama') {
        const content = await ollamaService.generate(prompt, options)
        return normalizeFinalResponse({
            provider: 'ollama',
            model: selectedModel,
            content,
            finishReason: 'stop'
        })
    }

    const apiKey = await getUserApiKey(userId, config.requiresKey)
    const provider = getProvider(config.providerKey)
    if (!provider || typeof provider.generate !== 'function') {
        throw new AIProviderError(`Unsupported AI provider: ${config.providerKey}`, {
            provider: config.providerKey,
            code: 'AI_PROVIDER_UNSUPPORTED'
        })
    }

    return provider.generate({
        apiKey,
        model: config.apiModel,
        prompt,
        messages: normalizeMessages(messages, prompt),
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        timeoutMs: options.timeoutMs,
        signal: options.signal
    })
}

async function generateStream({ userId, model, prompt, messages, options = {}, onToken, onEvent }) {
    const result = await generateStreamNormalized({ userId, model, prompt, messages, options, onToken, onEvent })
    return result.content
}

async function generateStreamNormalized({ userId, model, prompt, messages, options = {}, onToken, onEvent }) {
    const selectedModel = normalizeAiModel(model)
    const config = getModelConfig(selectedModel)

    if (selectedModel === 'grok') {
        if (onEvent) onEvent(createStreamEvent('start', { provider: 'grokScraper', model: selectedModel }))
        const reply = await grokService.generate(prompt)
        await simulateStream(reply, (token) => {
            if (onToken) onToken(token)
            if (onEvent) onEvent(createStreamEvent('delta', { provider: 'grokScraper', model: selectedModel, delta: token }))
        })
        const final = normalizeFinalResponse({ provider: 'grokScraper', model: selectedModel, content: reply, finishReason: 'stop' })
        if (onEvent) onEvent(createStreamEvent('complete', final))
        return final
    }

    if (config.providerKey === 'ollama') {
        if (onEvent) onEvent(createStreamEvent('start', { provider: 'ollama', model: selectedModel }))
        const reply = await ollamaService.generateStream(prompt, options, (token) => {
            if (onToken) onToken(token)
            if (onEvent) onEvent(createStreamEvent('delta', { provider: 'ollama', model: selectedModel, delta: token }))
        })
        const final = normalizeFinalResponse({ provider: 'ollama', model: selectedModel, content: reply, finishReason: 'stop' })
        if (onEvent) onEvent(createStreamEvent('complete', final))
        return final
    }

    const apiKey = await getUserApiKey(userId, config.requiresKey)
    const provider = getProvider(config.providerKey)
    if (!provider || typeof provider.stream !== 'function') {
        throw new AIProviderError(`Unsupported AI provider: ${config.providerKey}`, {
            provider: config.providerKey,
            code: 'AI_PROVIDER_UNSUPPORTED'
        })
    }

    return provider.stream({
        apiKey,
        model: config.apiModel,
        prompt,
        messages: normalizeMessages(messages, prompt),
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        timeoutMs: options.timeoutMs,
        signal: options.signal
    }, (event) => {
        if (event.type === 'delta' && event.delta && onToken) onToken(event.delta)
        if (onEvent) onEvent(event)
    })
}

async function getUserApiKey(userId, keyField) {
    if (!keyField) return ''
    const settings = await UserAISettings.findOne({ user: userId }).lean()
    const encrypted = settings && settings[keyField]
    const apiKey = decryptKey(encrypted)
    if (!apiKey) {
        throw new AIKeyMissingError(keyField.replace(/Key$/, ''))
    }
    return apiKey
}

async function simulateStream(text, onToken) {
    const tokens = String(text || '').match(/\S+\s*|\n+/g) || []
    for (const token of tokens) {
        if (onToken) onToken(token)
        await new Promise((resolve) => setTimeout(resolve, 18))
    }
}

module.exports = {
    generate,
    generateNormalized,
    generateStream,
    generateStreamNormalized,
    simulateStream
}
