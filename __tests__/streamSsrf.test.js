// Regression tests for SSRF hardening in the VR stream resolver:
// internal / non-public hosts must be blocked at both the resolver and the request validator.

const {
  isBlockedStreamHost,
  resolveStream
} = require('../services/streamResolver');
const validateStreamRequest = require('../middleware/validateStreamRequest');

describe('isBlockedStreamHost', () => {
  test.each([
    'localhost',
    'app.localhost',
    'metadata.google.internal',
    '127.0.0.1',
    '0.0.0.0',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata endpoint
    '100.64.0.1', // CGNAT
    '::1',
    '[::1]',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1'
  ])('blocks non-public host %s', (host) => {
    expect(isBlockedStreamHost(host)).toBe(true);
  });

  test.each([
    'www.youtube.com',
    'youtu.be',
    'example.com',
    '8.8.8.8',
    '172.32.0.1', // just outside the private 172.16/12 range
    '93.184.216.34'
  ])('allows public host %s', (host) => {
    expect(isBlockedStreamHost(host)).toBe(false);
  });

  test('blocks empty/garbage host', () => {
    expect(isBlockedStreamHost('')).toBe(true);
    expect(isBlockedStreamHost(null)).toBe(true);
  });
});

describe('resolveStream blocks internal hosts', () => {
  test('direct media URL pointing at the cloud metadata endpoint is blocked', async () => {
    const result = await resolveStream({
      sourceUrl: 'http://169.254.169.254/latest/meta-data/x.mp4',
      preferredFormat: 'mp4'
    });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('BLOCKED_HOST');
  });

  test('loopback URL is blocked', async () => {
    const result = await resolveStream({
      sourceUrl: 'http://127.0.0.1:8080/internal.m3u8',
      preferredFormat: 'm3u8'
    });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('BLOCKED_HOST');
  });
});

describe('validateStreamRequest', () => {
  function createResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  }

  test('rejects a blocked (internal) source host with 400 BLOCKED_HOST', () => {
    const req = { body: { sourceUrl: 'http://169.254.169.254/x.mp4' } };
    const res = createResponse();
    const next = jest.fn();

    validateStreamRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'BLOCKED_HOST' })
      })
    );
  });

  test('accepts a valid public source URL and populates streamResolveInput', () => {
    const req = { body: { sourceUrl: 'https://www.youtube.com/watch?v=abc123', preferredFormat: 'mp4' } };
    const res = createResponse();
    const next = jest.fn();

    validateStreamRequest(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.streamResolveInput).toEqual(
      expect.objectContaining({
        sourceUrl: 'https://www.youtube.com/watch?v=abc123',
        preferredFormat: 'mp4'
      })
    );
  });
});
