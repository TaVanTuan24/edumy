function normalizeMessages(messages, fallbackPrompt) {
    const normalized = (Array.isArray(messages) ? messages : [])
        .filter((message) => message && message.content && message.status !== 'error')
        .map((message) => ({
            role: normalizeRole(message.role),
            content: String(message.content || '')
        }))
        .filter((message) => message.content)
        .slice(-16)

    if (normalized.length) return normalized
    return [{ role: 'user', content: String(fallbackPrompt || '') }]
}

function normalizeRole(role) {
    if (role === 'system') return 'system'
    if (role === 'assistant') return 'assistant'
    return 'user'
}

function normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return undefined
    return {
        inputTokens: usage.prompt_tokens || usage.input_tokens || usage.promptTokenCount,
        outputTokens: usage.completion_tokens || usage.output_tokens || usage.candidatesTokenCount,
        totalTokens: usage.total_tokens || usage.totalTokenCount
    }
}

function createStreamEvent(type, data = {}) {
    return {
        type,
        requestId: data.requestId,
        provider: data.provider,
        model: data.model,
        delta: data.delta,
        content: data.content,
        usage: normalizeUsage(data.usage),
        finishReason: data.finishReason,
        error: data.error
    }
}

function normalizeFinalResponse({ provider, model, content, usage, finishReason, requestId }) {
    return {
        provider,
        model,
        content: String(content || '').trim(),
        usage: normalizeUsage(usage),
        finishReason,
        requestId
    }
}

module.exports = {
    normalizeMessages,
    normalizeRole,
    normalizeUsage,
    createStreamEvent,
    normalizeFinalResponse
}
