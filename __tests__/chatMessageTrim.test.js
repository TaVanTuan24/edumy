const mongoose = require('mongoose');

// Test the trim logic used in chat model pre-save hook
describe('Chat message trim logic', () => {
  const MAX_CHAT_MESSAGES = Number(process.env.MAX_CHAT_MESSAGES || 200);

  function trimMessages(messages, max = MAX_CHAT_MESSAGES) {
    if (!Array.isArray(messages)) return [];
    if (messages.length <= max) return messages;
    return messages.slice(-max);
  }

  test('returns all messages when under limit', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    expect(trimMessages(messages)).toHaveLength(1);
  });

  test('returns all messages when exactly at limit', () => {
    const messages = Array.from({ length: MAX_CHAT_MESSAGES }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`
    }));
    expect(trimMessages(messages)).toHaveLength(MAX_CHAT_MESSAGES);
  });

  test('trims oldest messages when over limit', () => {
    const count = MAX_CHAT_MESSAGES + 50;
    const messages = Array.from({ length: count }, (_, i) => ({
      role: 'user',
      content: `msg-${i}`
    }));
    const result = trimMessages(messages);
    expect(result).toHaveLength(MAX_CHAT_MESSAGES);
    // Should keep the most recent ones
    expect(result[0].content).toBe(`msg-${count - MAX_CHAT_MESSAGES}`);
    expect(result[result.length - 1].content).toBe(`msg-${count - 1}`);
  });

  test('returns empty array for non-array input', () => {
    expect(trimMessages(null)).toEqual([]);
    expect(trimMessages(undefined)).toEqual([]);
    expect(trimMessages('not an array')).toEqual([]);
  });

  test('respects custom max parameter', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: 'user',
      content: `msg-${i}`
    }));
    expect(trimMessages(messages, 3)).toHaveLength(3);
  });
});