const UserAISettings = require('../../models/userAISettings')
const { decryptKey } = require('../../utils/apiKeyCrypto')
const { getModelConfig, normalizeAiModel } = require('../../config/ai')
const { getProvider } = require('./providerRegistry')
const { normalizeMessages, createStreamEvent, normalizeFinalResponse } = require('./normalize')
const { AIKeyMissingError, AIProviderError } = require('./errors')
const grokService = require('./grokService')
const { getProviderBaseUrlInfo } = require('./providerBaseUrls')

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

    const providerRequestConfig = await getUserProviderRequestConfig(userId, config)
    const provider = getProvider(config.providerKey)
    if (!provider || typeof provider.generate !== 'function') {
        throw new AIProviderError(`Unsupported AI provider: ${config.providerKey}`, {
            provider: config.providerKey,
            code: 'AI_PROVIDER_UNSUPPORTED'
        })
    }

    return provider.generate({
        apiKey: providerRequestConfig.apiKey,
        baseUrl: providerRequestConfig.baseUrl,
        baseUrlConfigured: providerRequestConfig.baseUrlConfigured,
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

    const providerRequestConfig = await getUserProviderRequestConfig(userId, config)
    const provider = getProvider(config.providerKey)
    if (!provider || typeof provider.stream !== 'function') {
        throw new AIProviderError(`Unsupported AI provider: ${config.providerKey}`, {
            provider: config.providerKey,
            code: 'AI_PROVIDER_UNSUPPORTED'
        })
    }

    return provider.stream({
        apiKey: providerRequestConfig.apiKey,
        baseUrl: providerRequestConfig.baseUrl,
        baseUrlConfigured: providerRequestConfig.baseUrlConfigured,
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

async function getUserProviderRequestConfig(userId, modelConfig) {
    if (!modelConfig || !modelConfig.requiresKey) {
        return {
            apiKey: '',
            baseUrl: '',
            baseUrlConfigured: false
        }
    }

    const settings = userId ? await UserAISettings.findOne({ user: userId }).lean() : null
    const encrypted = settings && settings[modelConfig.requiresKey]
    const apiKey = decryptKey(encrypted)
    if (apiKey) {
        const baseUrlInfo = getProviderBaseUrlInfo(modelConfig.providerKey, settings)
        return {
            apiKey,
            baseUrl: baseUrlInfo.baseUrl,
            baseUrlConfigured: baseUrlInfo.baseUrlConfigured
        }
    }

    const globalConfig = getGlobalProviderRequestConfig(modelConfig.providerKey)
    if (globalConfig) {
        return globalConfig
    }

    throw new AIKeyMissingError(modelConfig.requiresKey.replace(/Key$/, ''))
}

function getGlobalProviderRequestConfig(providerKey) {
    if (String(providerKey || '').toLowerCase() !== 'openai') {
        return null
    }

    const apiKey = String(process.env.AI_API_KEY || '').trim()
    const baseUrl = String(process.env.AI_BASE_URL || '').trim()
    if (!apiKey || !baseUrl) {
        return null
    }

    return {
        apiKey,
        baseUrl,
        baseUrlConfigured: true
    }
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
