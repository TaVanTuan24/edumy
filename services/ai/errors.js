class AIProviderError extends Error {
    constructor(message, options = {}) {
        super(message || 'AI provider error')
        this.name = this.constructor.name
        this.code = options.code || 'AI_PROVIDER_ERROR'
        this.statusCode = options.statusCode || 503
        this.provider = options.provider || ''
        this.model = options.model || ''
        this.publicMessage = options.publicMessage || message || 'AI service error'
        this.cause = options.cause
    }
}

class AIKeyMissingError extends AIProviderError {
    constructor(provider) {
        super('API key not configured', {
            code: 'API_KEY_MISSING',
            statusCode: 400,
            provider,
            publicMessage: 'API key not configured for this provider. Open AI Settings and add a key.'
        })
    }
}

class AIAuthError extends AIProviderError {
    constructor(provider, cause) {
        super('AI provider authentication failed', {
            code: 'AI_AUTH_FAILED',
            statusCode: 401,
            provider,
            publicMessage: 'The API key for this provider was rejected. Check it in AI Settings.',
            cause
        })
    }
}

class AIRateLimitError extends AIProviderError {
    constructor(provider, cause) {
        super('AI provider rate limit exceeded', {
            code: 'AI_RATE_LIMITED',
            statusCode: 429,
            provider,
            publicMessage: 'This AI provider is rate limiting requests. Please try again shortly.',
            cause
        })
    }
}

class AITimeoutError extends AIProviderError {
    constructor(provider, cause) {
        super('AI provider request timed out', {
            code: 'AI_TIMEOUT',
            statusCode: 504,
            provider,
            publicMessage: 'The AI provider took too long to respond. Please try again.',
            cause
        })
    }
}

class AIAbortError extends AIProviderError {
    constructor(provider, cause) {
        super('AI request was aborted', {
            code: 'AI_ABORTED',
            statusCode: 499,
            provider,
            publicMessage: 'The AI request was cancelled.',
            cause
        })
    }
}

function normalizeProviderError(error, provider) {
    if (error instanceof AIProviderError) return error
    if (error && (error.name === 'AbortError' || error.code === 'ERR_CANCELED')) {
        return new AIAbortError(provider, error)
    }
    if (error && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
        return new AITimeoutError(provider, error)
    }

    const status = error && error.response && error.response.status
    const responseMessage = extractProviderMessage(error)
    if (status === 401 || status === 403) return new AIAuthError(provider, error)
    if (status === 408 || status === 504) return new AITimeoutError(provider, error)
    if (status === 429) return new AIRateLimitError(provider, error)

    return new AIProviderError('AI service error', {
        code: status === 404 ? 'AI_MODEL_NOT_AVAILABLE' : 'AI_PROVIDER_ERROR',
        statusCode: status || 503,
        provider,
        publicMessage: status === 404
            ? 'This model is not available for the selected provider.'
            : responseMessage || 'AI service error',
        cause: error
    })
}

function extractProviderMessage(error) {
    const data = error && error.response && error.response.data
    if (!data) return ''
    if (typeof data === 'string') return data
    if (data.error && typeof data.error.message === 'string') return data.error.message
    if (typeof data.message === 'string') return data.message
    if (data.response && data.response.error && typeof data.response.error.message === 'string') {
        return data.response.error.message
    }
    return ''
}

module.exports = {
    AIProviderError,
    AIKeyMissingError,
    AIAuthError,
    AIRateLimitError,
    AITimeoutError,
    AIAbortError,
    normalizeProviderError
}
