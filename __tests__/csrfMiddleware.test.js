const { generateCsrfToken, verifyCsrfToken } = require('../middleware/csrf');

describe('CSRF middleware', () => {
  test('generateCsrfToken produces a 3-part token', () => {
    const token = generateCsrfToken('session-123');
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBeTruthy(); // timestamp
    expect(parts[1]).toBeTruthy(); // random
    expect(parts[2]).toBeTruthy(); // hmac
  });

  test('verifyCsrfToken accepts a valid token for the same session', () => {
    const sessionId = 'test-session';
    const token = generateCsrfToken(sessionId);
    expect(verifyCsrfToken(token, sessionId)).toBe(true);
  });

  test('verifyCsrfToken rejects token for different session', () => {
    const token = generateCsrfToken('session-a');
    expect(verifyCsrfToken(token, 'session-b')).toBe(false);
  });

  test('verifyCsrfToken rejects empty/null token', () => {
    expect(verifyCsrfToken('', 'session')).toBe(false);
    expect(verifyCsrfToken(null, 'session')).toBe(false);
    expect(verifyCsrfToken(undefined, 'session')).toBe(false);
  });

  test('verifyCsrfToken rejects malformed token', () => {
    expect(verifyCsrfToken('only.two', 'session')).toBe(false);
    expect(verifyCsrfToken('a.b.c.d', 'session')).toBe(false);
    expect(verifyCsrfToken('not-a-token', 'session')).toBe(false);
  });

  test('verifyCsrfToken rejects tampered token', () => {
    const token = generateCsrfToken('session');
    const parts = token.split('.');
    parts[1] = 'tampered' + parts[1];
    expect(verifyCsrfToken(parts.join('.'), 'session')).toBe(false);
  });
});