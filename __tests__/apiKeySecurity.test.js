const { validateApiKey, buildKeyStatus } = require('../utils/apiKeySecurity');

describe('apiKeySecurity', () => {
  test('accepts a long OpenAI-compatible key', () => {
    const result = validateApiKey('openai', 'sk-test-abcdefghijklmnopqrstuvwxyz');

    expect(result.ok).toBe(true);
    expect(result.masked).toBe('****wxyz');
  });

  test('rejects invalid Claude key prefixes', () => {
    const result = validateApiKey('claude', 'not-a-real-claude-key');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/format is invalid/i);
  });

  test('buildKeyStatus only exposes safe mask data', () => {
    expect(buildKeyStatus('AIzaabcdefghijklmnopqrstuvwx1234567890')).toEqual({
      connected: true,
      masked: '****7890'
    });
  });
});
