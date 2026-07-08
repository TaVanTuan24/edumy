// Regression tests for CSRF middleware hardening:
// - tokens are no longer accepted from the query string (disclosure risk)
// - malformed tokens are rejected cleanly (no 500 from timingSafeEqual length mismatch)

const {
  csrfProtection,
  generateCsrfToken
} = require('../middleware/csrf');

const SESSION_ID = 'test-session-id';

function createRequest({ method = 'POST', headers = {}, body = {}, query = {} } = {}) {
  const lowerHeaders = {};
  Object.keys(headers).forEach((key) => {
    lowerHeaders[key.toLowerCase()] = headers[key];
  });

  return {
    method,
    sessionID: SESSION_ID,
    protocol: 'https',
    secure: true,
    body,
    query,
    get: (name) => lowerHeaders[String(name).toLowerCase()]
  };
}

function createResponse() {
  return {
    locals: {},
    cookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
}

describe('csrfProtection', () => {
  test('accepts a valid token supplied via the x-csrf-token header', () => {
    const token = generateCsrfToken(SESSION_ID);
    const req = createRequest({ headers: { 'x-csrf-token': token } });
    const res = createResponse();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('accepts a valid token supplied in the request body', () => {
    const token = generateCsrfToken(SESSION_ID);
    const req = createRequest({ body: { _csrf: token } });
    const res = createResponse();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects a valid token supplied ONLY via the query string', () => {
    const token = generateCsrfToken(SESSION_ID);
    const req = createRequest({ query: { _csrf: token } });
    const res = createResponse();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'EBADCSRFTOKEN' })
    );
  });

  test('rejects a malformed token without throwing (buffer length mismatch guard)', () => {
    const req = createRequest({ headers: { 'x-csrf-token': 'aaa.bbb.ccc' } });
    const res = createResponse();
    const next = jest.fn();

    expect(() => csrfProtection(req, res, next)).not.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'EBADCSRFTOKEN' })
    );
  });

  test('rejects when no token is present', () => {
    const req = createRequest();
    const res = createResponse();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('safe (GET) requests pass through and expose a token to templates', () => {
    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(typeof res.locals.csrfToken).toBe('string');
    expect(res.locals.csrfToken.length).toBeGreaterThan(0);
  });
});
