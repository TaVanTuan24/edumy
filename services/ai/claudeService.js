const axios = require('axios')
const { aiConfig } = require('../../config/ai')
const { normalizeMessages, normalizeFinalResponse, createStreamEvent } = require('./normalize')
const { createRequestController, readSseStream } = require('./streamAdapters')
const { normalizeProviderError } = require('./errors')
const { getDefaultProviderBaseUrl, joinProviderUrl } = require('./providerBaseUrls')

const PROVIDER = 'claude'

async function generate(request) {
    try {
        const response = await axios.post(
            getMessagesUrl(request),
            buildPayload(request, false),
            buildAxiosConfig(request)
        )
        return normalizeFinalResponse({
            provider: PROVIDER,
            model: request.model,
            requestId: response.data && response.data.id,
            content: extractText(response.data),
            usage: response.data && response.data.usage,
            finishReason: response.data && response.data.stop_reason
        })
    } catch (error) {
        throw applyCustomBaseUrlHint(normalizeProviderError(error, PROVIDER), request)
    }
}

async function stream(request, onEvent) {
    const controller = createRequestController({
        signal: request.signal,
        timeoutMs: request.timeoutMs || aiConfig.providers.claude.timeoutMs,
        provider: PROVIDER
    })
    let content = ''
    let requestId = ''
    let usage
    let finishReason

    try {
        if (onEvent) onEvent(createStreamEvent('start', { provider: PROVIDER, model: request.model }))
        const response = await axios.post(
            getMessagesUrl(request),
            buildPayload(request, true),
            buildAxiosConfig({ ...request, signal: controller.signal, responseType: 'stream' })
        )

        await readSseStream(response.data, ({ data }) => {
            if (!data) return
            if (data.type === 'message_start' && data.message) {
                requestId = data.message.id || requestId
                usage = data.message.usage || usage
            }
            if (data.type === 'message_delta') {
                usage = data.usage || usage
                finishReason = data.delta && data.delta.stop_reason ? data.delta.stop_reason : finishReason
            }
            if (data.type !== 'content_block_delta') return

            const delta = data.delta && data.delta.type === 'text_delta'
                ? String(data.delta.text || '')
                : ''
            if (!delta) return

            content += delta
            if (onEvent) onEvent(createStreamEvent('delta', { provider: PROVIDER, model: request.model, requestId, delta }))
        })

        const final = normalizeFinalResponse({ provider: PROVIDER, model: request.model, requestId, content, usage, finishReason })
        if (onEvent) onEvent(createStreamEvent('complete', final))
        return final
    } catch (error) {
        controller.throwIfTimedOut(error)
        const normalized = applyCustomBaseUrlHint(normalizeProviderError(error, PROVIDER), request)
        if (onEvent) onEvent(createStreamEvent('error', { provider: PROVIDER, model: request.model, error: toStreamError(normalized) }))
        throw normalized
    } finally {
        controller.cleanup()
    }
}

function buildPayload(request, streamMode) {
    const normalized = normalizeMessages(request.messages, request.prompt)
    const systemMessages = normalized.filter((message) => message.role === 'system').map((message) => message.content)
    const messages = normalized.filter((message) => message.role !== 'system').map(toClaudeMessage)
    const system = [request.systemPrompt, ...systemMessages].filter(Boolean).join('\n\n')

    return {
        model: request.model,
        max_tokens: request.maxTokens || 2048,
        temperature: request.temperature === undefined ? 0.7 : request.temperature,
        system: system || undefined,
        messages,
        stream: streamMode
    }
}

function buildAxiosConfig(request) {
    return {
        headers: {
            'x-api-key': request.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        timeout: request.timeoutMs || aiConfig.providers.claude.timeoutMs,
        signal: request.signal,
        responseType: request.responseType,
        maxRedirects: 3
    }
}

function toClaudeMessage(message) {
    return {
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || '')
    }
}

function extractText(data) {
    const content = data && Array.isArray(data.content) ? data.content : []
    return content
        .filter((item) => item && item.type === 'text')
        .map((item) => String(item.text || ''))
        .join('')
        .trim()
}

function getMessagesUrl(request) {
    return joinProviderUrl(
        String(request.baseUrl || getDefaultProviderBaseUrl(PROVIDER)).replace(/\/+$/, ''),
        'messages'
    )
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
