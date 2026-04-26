const axios = require('axios')
const { aiConfig } = require('../../config/ai')
const { normalizeMessages, normalizeFinalResponse, createStreamEvent } = require('./normalize')
const { createRequestController, readSseStream } = require('./streamAdapters')
const { normalizeProviderError } = require('./errors')
const { getDefaultProviderBaseUrl, joinProviderUrl } = require('./providerBaseUrls')

const PROVIDER = 'gemini'

async function generate(request) {
    try {
        const response = await axios.post(
            getGenerateUrl(request),
            buildPayload(request),
            buildAxiosConfig(request)
        )
        const candidate = response.data && Array.isArray(response.data.candidates)
            ? response.data.candidates[0]
            : null
        return normalizeFinalResponse({
            provider: PROVIDER,
            model: request.model,
            content: extractCandidateText(candidate),
            usage: response.data && response.data.usageMetadata,
            finishReason: candidate && candidate.finishReason
        })
    } catch (error) {
        throw applyCustomBaseUrlHint(normalizeProviderError(error, PROVIDER), request)
    }
}

async function stream(request, onEvent) {
    const controller = createRequestController({
        signal: request.signal,
        timeoutMs: request.timeoutMs || aiConfig.providers.gemini.timeoutMs,
        provider: PROVIDER
    })
    let content = ''
    let usage
    let finishReason

    try {
        if (onEvent) onEvent(createStreamEvent('start', { provider: PROVIDER, model: request.model }))
        const response = await axios.post(
            getStreamUrl(request),
            buildPayload(request),
            buildAxiosConfig({ ...request, signal: controller.signal, responseType: 'stream' })
        )

        await readSseStream(response.data, ({ data }) => {
            if (!data) return
            if (data.usageMetadata) usage = data.usageMetadata
            const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null
            if (candidate && candidate.finishReason) finishReason = candidate.finishReason
            const delta = extractCandidateText(candidate)
            if (!delta) return

            content += delta
            if (onEvent) onEvent(createStreamEvent('delta', { provider: PROVIDER, model: request.model, delta }))
        })

        const final = normalizeFinalResponse({ provider: PROVIDER, model: request.model, content, usage, finishReason })
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

function buildPayload(request) {
    const normalized = normalizeMessages(request.messages, request.prompt)
    const systemMessages = normalized.filter((message) => message.role === 'system').map((message) => message.content)
    const contents = normalized.filter((message) => message.role !== 'system').map(toGeminiContent)
    const systemInstructionText = [request.systemPrompt, ...systemMessages].filter(Boolean).join('\n\n')

    return {
        contents,
        systemInstruction: systemInstructionText
            ? { parts: [{ text: systemInstructionText }] }
            : undefined,
        generationConfig: {
            temperature: request.temperature === undefined ? 0.7 : request.temperature,
            maxOutputTokens: request.maxTokens || 2048
        }
    }
}

function buildAxiosConfig(request) {
    return {
        headers: {
            'x-goog-api-key': request.apiKey,
            'Content-Type': 'application/json'
        },
        timeout: request.timeoutMs || aiConfig.providers.gemini.timeoutMs,
        signal: request.signal,
        responseType: request.responseType,
        maxRedirects: 3
    }
}

function toGeminiContent(message) {
    return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(message.content || '') }]
    }
}

function extractCandidateText(candidate) {
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
        ? candidate.content.parts
        : []
    return parts.map((part) => part && part.text ? String(part.text) : '').join('')
}

function modelPath(model) {
    const value = String(model || '').replace(/^models\//, '')
    return `models/${encodeURIComponent(value)}`
}

function getGenerateUrl(request) {
    return joinProviderUrl(
        String(request.baseUrl || getDefaultProviderBaseUrl(PROVIDER)).replace(/\/+$/, ''),
        `${modelPath(request.model)}:generateContent`
    )
}

function getStreamUrl(request) {
    return joinProviderUrl(
        String(request.baseUrl || getDefaultProviderBaseUrl(PROVIDER)).replace(/\/+$/, ''),
        `${modelPath(request.model)}:streamGenerateContent?alt=sse`
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
