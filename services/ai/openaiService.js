const axios = require('axios')
const { Readable } = require('stream')
const { aiConfig } = require('../../config/ai')
const { normalizeMessages, normalizeFinalResponse, createStreamEvent } = require('./normalize')
const { createRequestController, readSseStream } = require('./streamAdapters')
const { normalizeProviderError } = require('./errors')
const { getDefaultProviderBaseUrl, joinProviderUrl } = require('./providerBaseUrls')

const PROVIDER = 'openai'

async function generate(request) {
    try {
        const response = await axios.post(
            getResponsesUrl(request),
            buildPayload(request, false),
            buildAxiosConfig(request)
        )

        return normalizeFinalResponse({
            provider: PROVIDER,
            model: request.model,
            requestId: extractRequestId(response.data),
            content: extractResponseText(response.data),
            usage: extractUsage(response.data),
            finishReason: extractFinishReason(response.data)
        })
    } catch (error) {
        throw applyCustomBaseUrlHint(await normalizeOpenAiError(error), request)
    }
}

async function stream(request, onEvent) {
    const controller = createRequestController({
        signal: request.signal,
        timeoutMs: request.timeoutMs || aiConfig.providers.openai.timeoutMs,
        provider: PROVIDER
    })
    let content = ''
    let requestId = ''
    let usage
    let finishReason

    try {
        if (onEvent) onEvent(createStreamEvent('start', { provider: PROVIDER, model: request.model }))
        const response = await axios.post(
            getResponsesUrl(request),
            buildPayload(request, true),
            buildAxiosConfig({ ...request, signal: controller.signal, responseType: 'stream' })
        )

        await readSseStream(response.data, ({ event, data, done }) => {
            if (done || !data) return

            const eventType = String(data.type || event || '')
            requestId = requestId || extractRequestId(data)

            if (eventType === 'response.output_text.delta') {
                const delta = String(data.delta || '')
                if (!delta) return
                content += delta
                if (onEvent) {
                    onEvent(createStreamEvent('delta', {
                        provider: PROVIDER,
                        model: request.model,
                        requestId,
                        delta
                    }))
                }
                return
            }

            if (eventType === 'response.completed') {
                usage = extractUsage(data)
                finishReason = extractFinishReason(data)
                if (!content) {
                    content = extractResponseText(data)
                }
                return
            }

            if (eventType === 'response.failed' || eventType === 'error') {
                throw new Error(extractErrorMessage(data))
            }
        })

        const final = normalizeFinalResponse({
            provider: PROVIDER,
            model: request.model,
            requestId,
            content,
            usage,
            finishReason
        })
        if (onEvent) onEvent(createStreamEvent('complete', final))
        return final
    } catch (error) {
        controller.throwIfTimedOut(error)
        const normalized = applyCustomBaseUrlHint(await normalizeOpenAiError(error), request)
        if (onEvent) onEvent(createStreamEvent('error', { provider: PROVIDER, model: request.model, error: toStreamError(normalized) }))
        throw normalized
    } finally {
        controller.cleanup()
    }
}

function buildPayload(request, streamMode) {
    const messages = normalizeMessages(request.messages, request.prompt)
    const systemPrompt = request.systemPrompt
    const input = messages
        .filter((message) => message.role !== 'system')
        .map(toResponsesInput)

    return {
        model: request.model,
        instructions: systemPrompt ? String(systemPrompt) : undefined,
        input,
        store: false,
        reasoning: {
            effort: getReasoningEffort(request)
        },
        max_tokens: request.maxTokens || 2048,
        stream: streamMode
    }
}

function buildAxiosConfig(request) {
    return {
        headers: {
            Authorization: `Bearer ${request.apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: request.timeoutMs || aiConfig.providers.openai.timeoutMs,
        signal: request.signal,
        responseType: request.responseType,
        maxRedirects: 3
    }
}

function toResponsesInput(message) {
    return {
        type: 'message',
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || '')
    }
}

function getResponsesUrl(request) {
    return joinProviderUrl(getBaseUrl(request), 'responses')
}

function getBaseUrl(request) {
    return String(request.baseUrl || getDefaultProviderBaseUrl(PROVIDER)).replace(/\/+$/, '')
}

function getReasoningEffort(request) {
    const value = String(request.reasoningEffort || process.env.OPENAI_REASONING_EFFORT || 'high').trim().toLowerCase()
    return ['minimal', 'low', 'medium', 'high'].includes(value) ? value : 'high'
}

function extractRequestId(data) {
    if (!data || typeof data !== 'object') return ''
    if (typeof data.id === 'string') return data.id
    if (typeof data.response_id === 'string') return data.response_id
    if (data.response && typeof data.response.id === 'string') return data.response.id
    return ''
}

function extractUsage(data) {
    if (!data || typeof data !== 'object') return undefined
    if (data.usage) return data.usage
    if (data.response && data.response.usage) return data.response.usage
    return undefined
}

function extractFinishReason(data) {
    if (!data || typeof data !== 'object') return undefined
    if (typeof data.finish_reason === 'string') return data.finish_reason
    if (data.response && typeof data.response.status === 'string') {
        return data.response.status === 'completed' ? 'stop' : data.response.status
    }
    if (typeof data.status === 'string') {
        return data.status === 'completed' ? 'stop' : data.status
    }
    return undefined
}

function extractResponseText(data) {
    if (!data || typeof data !== 'object') return ''
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text

    const response = data.response && typeof data.response === 'object' ? data.response : data
    const output = Array.isArray(response.output) ? response.output : []
    const parts = []

    output.forEach((item) => {
        const content = Array.isArray(item && item.content) ? item.content : []
        content.forEach((entry) => {
            if (!entry || typeof entry !== 'object') return
            if (typeof entry.text === 'string' && entry.text) {
                parts.push(entry.text)
            }
        })
    })

    return parts.join('').trim()
}

function extractErrorMessage(data) {
    if (!data || typeof data !== 'object') return 'AI service error'
    if (data.error && typeof data.error.message === 'string') return data.error.message
    if (typeof data.message === 'string') return data.message
    if (data.response && data.response.error && typeof data.response.error.message === 'string') {
        return data.response.error.message
    }
    return 'AI service error'
}

async function normalizeOpenAiError(error) {
    if (error && error.response && error.response.data) {
        const data = error.response.data
        if (typeof data === 'string') {
            error.response.data = tryParseJson(data)
        } else if (isReadableStream(data)) {
            const raw = await readErrorStream(data)
            error.response.data = tryParseJson(raw)
        }
    }

    return normalizeProviderError(error, PROVIDER)
}

function isReadableStream(value) {
    return value instanceof Readable || (value && typeof value.on === 'function' && typeof value.read !== 'undefined')
}

async function readErrorStream(stream) {
    let buffer = ''

    await new Promise((resolve, reject) => {
        stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8')
        })
        stream.on('end', resolve)
        stream.on('error', reject)
    })

    return buffer
}

function tryParseJson(value) {
    const text = String(value || '').trim()
    if (!text) return {}

    try {
        return JSON.parse(text)
    } catch {
        return { message: text }
    }
}

function toStreamError(error) {
    return {
        code: error.code || 'AI_PROVIDER_ERROR',
        message: error.publicMessage || 'AI service error'
    }
}

function applyCustomBaseUrlHint(error, request) {
    if (!request || !request.baseUrlConfigured) return error
    if (error && ['AI_PROVIDER_ERROR', 'AI_MODEL_NOT_AVAILABLE', 'AI_ENDPOINT_UNREACHABLE'].includes(error.code)) {
        error.publicMessage = 'The custom API endpoint could not complete the request. Check your Base URL, API key, and model name.'
    }
    return error
}

module.exports = {
    generate,
    stream
}
