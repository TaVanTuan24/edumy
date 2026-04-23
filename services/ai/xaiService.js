const axios = require('axios')
const { aiConfig } = require('../../config/ai')
const { normalizeMessages, normalizeFinalResponse, createStreamEvent } = require('./normalize')
const { createRequestController, readSseStream } = require('./streamAdapters')
const { normalizeProviderError } = require('./errors')

const PROVIDER = 'xai'
const BASE_URL = 'https://api.x.ai/v1/chat/completions'

async function generate(request) {
    try {
        const response = await axios.post(
            BASE_URL,
            buildPayload(request, false),
            buildAxiosConfig(request)
        )
        const choice = response.data && response.data.choices && response.data.choices[0]
        return normalizeFinalResponse({
            provider: PROVIDER,
            model: request.model,
            requestId: response.data && response.data.id,
            content: choice && choice.message ? choice.message.content : '',
            usage: response.data && response.data.usage,
            finishReason: choice && choice.finish_reason
        })
    } catch (error) {
        throw normalizeProviderError(error, PROVIDER)
    }
}

async function stream(request, onEvent) {
    const controller = createRequestController({
        signal: request.signal,
        timeoutMs: request.timeoutMs || aiConfig.providers.xai.timeoutMs,
        provider: PROVIDER
    })
    let content = ''
    let requestId = ''
    let usage
    let finishReason

    try {
        if (onEvent) onEvent(createStreamEvent('start', { provider: PROVIDER, model: request.model }))
        const response = await axios.post(
            BASE_URL,
            buildPayload(request, true),
            buildAxiosConfig({ ...request, signal: controller.signal, responseType: 'stream' })
        )

        await readSseStream(response.data, ({ data, done }) => {
            if (done || !data) return
            requestId = requestId || data.id || ''
            if (data.usage) usage = data.usage
            const choice = data.choices && data.choices[0]
            if (!choice) return
            if (choice.finish_reason) finishReason = choice.finish_reason
            const delta = choice.delta && (choice.delta.content || choice.delta.refusal)
                ? String(choice.delta.content || choice.delta.refusal)
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
        const normalized = normalizeProviderError(error, PROVIDER)
        if (onEvent) onEvent(createStreamEvent('error', { provider: PROVIDER, model: request.model, error: toStreamError(normalized) }))
        throw normalized
    } finally {
        controller.cleanup()
    }
}

function buildPayload(request, streamMode) {
    const messages = normalizeMessages(request.messages, request.prompt)
    const systemPrompt = request.systemPrompt
    const payloadMessages = systemPrompt
        ? [{ role: 'system', content: String(systemPrompt) }, ...messages.filter((message) => message.role !== 'system')]
        : messages

    return {
        model: request.model,
        messages: payloadMessages.map(toMessage),
        temperature: request.temperature === undefined ? 0.7 : request.temperature,
        max_tokens: request.maxTokens || 2048,
        stream: streamMode,
        stream_options: streamMode ? { include_usage: true } : undefined
    }
}

function buildAxiosConfig(request) {
    return {
        headers: {
            Authorization: `Bearer ${request.apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: request.timeoutMs || aiConfig.providers.xai.timeoutMs,
        signal: request.signal,
        responseType: request.responseType
    }
}

function toMessage(message) {
    return {
        role: message.role === 'system' ? 'system' : message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || '')
    }
}

function toStreamError(error) {
    return {
        code: error.code || 'AI_PROVIDER_ERROR',
        message: error.publicMessage || 'AI service error'
    }
}

module.exports = {
    generate,
    stream
}
