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
            publicMessage: 'Please configure your AI model, API key, and base URL before using AI chat.'
        })
    }
}

class AIConfigRequiredError extends AIProviderError {
    constructor() {
        super('User AI configuration is required', {
            code: 'AI_CONFIG_REQUIRED',
            statusCode: 400,
            provider: 'user-defined',
            publicMessage: 'Please configure your AI model, API key, and base URL before using AI chat.'
        })
    }
}

class AIAuthError extends AIProviderError {
    constructor(provider, cause) {
        super('AI provider authentication failed', {
            code: 'AI_AUTH_FAILED',
            statusCode: 401,
            provider,
            publicMessage: 'Invalid API key.',
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
            publicMessage: 'Rate limited.',
            cause
        })
    }
}

class AIQuotaExceededError extends AIProviderError {
    constructor(provider, cause) {
        super('AI provider quota exceeded', {
            code: 'AI_QUOTA_EXCEEDED',
            statusCode: 402,
            provider,
            publicMessage: 'Quota exceeded.',
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

class AIEndpointUnreachableError extends AIProviderError {
    constructor(provider, cause) {
        super('AI provider endpoint could not be reached', {
            code: 'AI_ENDPOINT_UNREACHABLE',
            statusCode: 502,
            provider,
            publicMessage: 'The AI provider endpoint could not be reached.',
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
    if (error && ['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ECONNRESET', 'ERR_INVALID_URL', 'ERR_NETWORK'].includes(error.code)) {
        return new AIEndpointUnreachableError(provider, error)
    }

    const status = error && error.response && error.response.status
    const responseMessage = extractProviderMessage(error)
    const normalizedMessage = responseMessage.toLowerCase()
    if (status === 401 || status === 403 || /invalid api key|incorrect api key|authentication|unauthorized|forbidden|invalid x-api-key|invalid argument.*api key|api key not valid/i.test(responseMessage)) {
        return new AIAuthError(provider, error)
    }
    if (status === 429 || /rate limit|too many requests/i.test(responseMessage)) return new AIRateLimitError(provider, error)
    if (/quota|insufficient_quota|billing|credit balance|resource has been exhausted|exceeded your current quota/i.test(normalizedMessage)) {
        return new AIQuotaExceededError(provider, error)
    }
    if (status === 408 || status === 504) return new AITimeoutError(provider, error)

    return new AIProviderError('AI service error', {
        code: status === 404 ? 'AI_MODEL_NOT_AVAILABLE' : 'AI_PROVIDER_ERROR',
        statusCode: status || 503,
        provider,
        publicMessage: status === 404
            ? 'This model is not available for the selected provider.'
            : 'AI service error. Please try again.',
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
    AIConfigRequiredError,
    AIAuthError,
    AIRateLimitError,
    AIQuotaExceededError,
    AITimeoutError,
    AIAbortError,
    AIEndpointUnreachableError,
    normalizeProviderError
}
