const axios = require('axios')
const UserAISettings = require('../../models/userAISettings')
const { decryptKey } = require('../../utils/apiKeyCrypto')
const { normalizeMessages, normalizeFinalResponse, createStreamEvent } = require('./normalize')
const { createRequestController, readSseStream } = require('./streamAdapters')
const { AIConfigRequiredError, normalizeProviderError } = require('./errors')

const PROVIDER = 'user-defined'
const DEFAULT_TIMEOUT_MS = 60000

async function generate({ userId, prompt, messages, options = {} }) {
    const config = await loadUserAiConfig(userId)

    try {
        const response = await axios.post(
            getChatCompletionsUrl(config.baseUrl),
            buildPayload({ config, prompt, messages, options, stream: false }),
            buildAxiosConfig({ config, options })
        )

        return normalizeFinalResponse({
            provider: PROVIDER,
            model: config.model,
            requestId: response.data && response.data.id,
            content: extractChatCompletionText(response.data),
            usage: response.data && response.data.usage,
            finishReason: extractFinishReason(response.data)
        })
    } catch (error) {
        throw normalizeUserAiError(error)
    }
}

async function stream({ userId, prompt, messages, options = {}, onEvent }) {
    const config = await loadUserAiConfig(userId)
    const controller = createRequestController({
        signal: options.signal,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        provider: PROVIDER
    })
    let content = ''
    let requestId = ''
    let usage
    let finishReason

    try {
        if (onEvent) onEvent(createStreamEvent('start', { provider: PROVIDER, model: config.model }))
        const response = await axios.post(
            getChatCompletionsUrl(config.baseUrl),
            buildPayload({ config, prompt, messages, options, stream: true }),
            buildAxiosConfig({
                config,
                options: { ...options, signal: controller.signal, responseType: 'stream' }
            })
        )

        await readSseStream(response.data, ({ data, done }) => {
            if (done || !data) return
            requestId = requestId || String(data.id || '')

            const choice = Array.isArray(data.choices) ? data.choices[0] : null
            const delta = choice && choice.delta && typeof choice.delta.content === 'string'
                ? choice.delta.content
                : ''
            if (delta) {
                content += delta
                if (onEvent) {
                    onEvent(createStreamEvent('delta', {
                        provider: PROVIDER,
                        model: config.model,
                        requestId,
                        delta
                    }))
                }
            }

            if (choice && choice.finish_reason) finishReason = choice.finish_reason
            if (data.usage) usage = data.usage
        })

        const final = normalizeFinalResponse({
            provider: PROVIDER,
            model: config.model,
            requestId,
            content,
            usage,
            finishReason
        })
        if (onEvent) onEvent(createStreamEvent('complete', final))
        return final
    } catch (error) {
        controller.throwIfTimedOut(error)
        const normalized = normalizeUserAiError(error)
        if (onEvent) {
            onEvent(createStreamEvent('error', {
                provider: PROVIDER,
                model: config.model,
                error: {
                    code: normalized.code || 'AI_PROVIDER_ERROR',
                    message: normalized.publicMessage || 'AI service error'
                }
            }))
        }
        throw normalized
    } finally {
        controller.cleanup()
    }
}

async function testConnection(configInput) {
    const config = normalizeRuntimeConfig(configInput)
    try {
        await axios.post(
            getChatCompletionsUrl(config.baseUrl),
            {
                model: config.model,
                messages: [{ role: 'user', content: 'Reply with "ok".' }],
                temperature: 0,
                max_tokens: 16,
                stream: false
            },
            buildAxiosConfig({ config, options: { timeoutMs: 15000 } })
        )
        return true
    } catch (error) {
        throw normalizeUserAiError(error)
    }
}

async function loadUserAiConfig(userId) {
    const settings = userId ? await UserAISettings.findOne({ user: userId }).lean() : null
    const baseUrl = normalizeUserAiBaseUrl(settings && settings.baseUrl)
    const model = String(settings && settings.model || '').trim()
    const apiKey = decryptKey(settings && settings.apiKeyEncrypted)

    if (baseUrl && model) {
        return { baseUrl, model, apiKey }
    }

    const fallback = getGlobalFallbackConfig()
    if (fallback) return fallback

    throw new AIConfigRequiredError()
}

function getGlobalFallbackConfig() {
    if (String(process.env.ALLOW_GLOBAL_AI_FALLBACK || '').toLowerCase() !== 'true') return null

    const baseUrl = normalizeUserAiBaseUrl(process.env.AI_BASE_URL || '')
    const model = String(process.env.AI_MODEL || process.env.AI_DEFAULT_MODEL || '').trim()
    const apiKey = String(process.env.AI_API_KEY || '').trim()
    if (!baseUrl || !model) return null
    return { baseUrl, model, apiKey }
}

function normalizeRuntimeConfig(input) {
    const baseUrl = normalizeUserAiBaseUrl(input && input.baseUrl)
    const model = String(input && input.model || '').trim()
    const apiKey = String(input && input.apiKey || '').trim()
    if (!baseUrl || !model) throw new AIConfigRequiredError()
    return { baseUrl, model, apiKey }
}

function normalizeUserAiBaseUrl(input) {
    const raw = String(input || '').trim()
    if (!raw) return ''

    let parsed
    try {
        parsed = new URL(raw)
    } catch {
        return ''
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    parsed.pathname = parsed.pathname
        .replace(/\/+$/, '')
        .replace(/\/chat\/completions$/i, '')
    return parsed.toString().replace(/\/+$/, '')
}

function getChatCompletionsUrl(baseUrl) {
    return `${String(baseUrl || '').replace(/\/+$/, '')}/chat/completions`
}

function buildPayload({ config, prompt, messages, options, stream }) {
    const payload = {
        model: config.model,
        messages: normalizeMessages(messages, prompt),
        temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
        max_tokens: options.maxTokens || 2048,
        stream
    }

    if (!stream && options && options.responseFormat === 'json_object') {
        payload.response_format = { type: 'json_object' }
    }

    return payload
}

function buildAxiosConfig({ config, options }) {
    const headers = { 'Content-Type': 'application/json' }
    if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`
    }

    return {
        headers,
        timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        signal: options.signal,
        responseType: options.responseType,
        maxRedirects: 3
    }
}

function extractChatCompletionText(data) {
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null
    const content = choice && choice.message && choice.message.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return ''
                if (typeof entry.text === 'string') return entry.text
                if (typeof entry.content === 'string') return entry.content
                if (entry.type === 'text' && typeof entry.value === 'string') return entry.value
                return ''
            })
            .join('')
            .trim()
    }
    return ''
}

function extractFinishReason(data) {
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null
    return choice && choice.finish_reason ? choice.finish_reason : undefined
}

function normalizeUserAiError(error) {
    const normalized = normalizeProviderError(error, PROVIDER)
    normalized.cause = undefined
    if (['AI_PROVIDER_ERROR', 'AI_MODEL_NOT_AVAILABLE', 'AI_ENDPOINT_UNREACHABLE'].includes(normalized.code)) {
        normalized.publicMessage = 'Could not connect to this AI provider. Please check base URL, API key, and model.'
    }
    return normalized
}

module.exports = {
    generate,
    stream,
    testConnection,
    loadUserAiConfig,
    normalizeUserAiBaseUrl,
    normalizeRuntimeConfig,
    getChatCompletionsUrl
}
