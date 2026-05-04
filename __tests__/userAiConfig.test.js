describe('user-defined AI config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  test('encrypts, decrypts, and masks API keys without exposing the raw value', () => {
    process.env.USER_AI_KEY_ENCRYPTION_SECRET = 'a'.repeat(64);
    const { encryptKey, decryptKey, maskApiKey } = require('../utils/apiKeyCrypto');

    const encrypted = encryptKey('sk-test-1234abcd');

    expect(encrypted).not.toContain('sk-test-1234abcd');
    expect(decryptKey(encrypted)).toBe('sk-test-1234abcd');
    expect(maskApiKey('sk-test-1234abcd')).toBe('sk-...abcd');
  });

  test('normalizes OpenAI-compatible base URLs', () => {
    const { normalizeUserAiBaseUrl } = require('../services/ai/userAiClient');

    expect(normalizeUserAiBaseUrl('https://api.example.com/v1/chat/completions/')).toBe('https://api.example.com/v1');
    expect(normalizeUserAiBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1');
  });

  test('validation accepts arbitrary model strings and rejects invalid URLs', () => {
    const { aiUserSettingsSchema } = require('../middleware/validate');

    const valid = aiUserSettingsSchema.validate({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      model: 'anthropic/claude-3.5-sonnet'
    });
    const invalid = aiUserSettingsSchema.validate({
      baseUrl: 'not-a-url',
      apiKey: 'sk-test',
      model: 'any-model'
    });

    expect(valid.error).toBeUndefined();
    expect(invalid.error).toBeDefined();
  });

  test('AI call without config returns AI_CONFIG_REQUIRED', async () => {
    jest.doMock('../models/userAISettings', () => ({
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) })
    }));

    const { generate } = require('../services/ai/userAiClient');

    await expect(generate({
      userId: 'user-1',
      messages: [{ role: 'user', content: 'Hello' }]
    })).rejects.toMatchObject({
      code: 'AI_CONFIG_REQUIRED',
      publicMessage: 'Please configure your AI model, API key, and base URL before using AI chat.'
    });
  });

  test('AI call uses user-defined baseUrl and model', async () => {
    process.env.USER_AI_KEY_ENCRYPTION_SECRET = 'b'.repeat(64);
    const { encryptKey } = require('../utils/apiKeyCrypto');
    const encrypted = encryptKey('sk-user-key');
    const post = jest.fn().mockResolvedValue({
      data: {
        id: 'chatcmpl-test',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }]
      }
    });

    jest.doMock('axios', () => ({ post }));
    jest.doMock('../models/userAISettings', () => ({
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'anthropic/claude-3.5-sonnet',
          apiKeyEncrypted: encrypted
        })
      })
    }));

    const { generate } = require('../services/ai/userAiClient');
    const result = await generate({
      userId: 'user-1',
      messages: [{ role: 'user', content: 'Hello' }],
      options: { maxTokens: 20, temperature: 0.2 }
    });

    expect(result.content).toBe('ok');
    expect(post).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        model: 'anthropic/claude-3.5-sonnet',
        max_tokens: 20,
        temperature: 0.2
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-user-key'
        })
      })
    );
  });
});
