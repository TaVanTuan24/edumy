const { normalizeProviderError } = require('../services/ai/errors');

describe('normalizeProviderError', () => {
  test('maps auth failures to invalid key', () => {
    const error = normalizeProviderError({
      response: {
        status: 401,
        data: { error: { message: 'invalid api key' } }
      }
    }, 'openai');

    expect(error.publicMessage).toBe('Invalid API key.');
    expect(error.code).toBe('AI_AUTH_FAILED');
  });

  test('maps quota failures to quota exceeded', () => {
    const error = normalizeProviderError({
      response: {
        status: 400,
        data: { error: { message: 'insufficient_quota' } }
      }
    }, 'openai');

    expect(error.publicMessage).toBe('Quota exceeded.');
    expect(error.code).toBe('AI_QUOTA_EXCEEDED');
  });

  test('maps 429 failures to rate limited', () => {
    const error = normalizeProviderError({
      response: {
        status: 429,
        data: { error: { message: 'too many requests' } }
      }
    }, 'xai');

    expect(error.publicMessage).toBe('Rate limited.');
    expect(error.code).toBe('AI_RATE_LIMITED');
  });
});
