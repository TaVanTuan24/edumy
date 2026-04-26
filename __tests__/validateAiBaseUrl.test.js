const { normalizeBaseUrl, getSafeBaseUrlHost } = require('../utils/validateAiBaseUrl')

describe('validateAiBaseUrl', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('returns null for an empty value', () => {
    expect(normalizeBaseUrl('', 'openai')).toBeNull()
  })

  test('normalizes trailing slashes and strips provider endpoint suffixes', () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_AI_CUSTOM_BASE_URLS = 'true'

    expect(normalizeBaseUrl('https://api.example.com/v1/responses/', 'openai')).toBe('https://api.example.com/v1')
    expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions', 'xai')).toBe('https://api.example.com/v1')
    expect(normalizeBaseUrl('https://api.anthropic.com/v1/messages/', 'claude')).toBe('https://api.anthropic.com/v1')
  })

  test('rejects credentials and query strings', () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_AI_CUSTOM_BASE_URLS = 'true'

    expect(() => normalizeBaseUrl('https://user:pass@example.com/v1', 'openai')).toThrow(/cannot include username or password/i)
    expect(() => normalizeBaseUrl('https://api.example.com/v1?token=secret', 'openai')).toThrow(/cannot include query strings/i)
  })

  test('rejects non-https remote URLs in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_AI_CUSTOM_BASE_URLS = 'true'
    process.env.ALLOW_AI_LOCAL_BASE_URLS = 'false'

    expect(() => normalizeBaseUrl('http://api.example.com/v1', 'openai')).toThrow(/must use https/i)
  })

  test('allows localhost http URLs in development', () => {
    process.env.NODE_ENV = 'development'
    process.env.ALLOW_AI_CUSTOM_BASE_URLS = 'true'
    delete process.env.ALLOW_AI_LOCAL_BASE_URLS

    expect(normalizeBaseUrl('http://127.0.0.1:8080/v1/', 'openai')).toBe('http://127.0.0.1:8080/v1')
  })

  test('rejects localhost URLs in production by default', () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_AI_CUSTOM_BASE_URLS = 'true'
    delete process.env.ALLOW_AI_LOCAL_BASE_URLS

    expect(() => normalizeBaseUrl('http://localhost:8080/v1', 'openai')).toThrow(/cannot target localhost or a private network/i)
  })

  test('returns a safe host label', () => {
    expect(getSafeBaseUrlHost('https://api.example.com/v1')).toBe('api.example.com')
  })
})
