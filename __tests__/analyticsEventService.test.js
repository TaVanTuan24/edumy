jest.mock('../models/analyticsEvent', () => ({
  create: jest.fn()
}));

const AnalyticsEvent = require('../models/analyticsEvent');
const {
  ANALYTICS_EVENTS,
  sanitizeMetadata,
  trackEventSafe
} = require('../services/analyticsEventService');

describe('analyticsEventService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('trackEventSafe does not throw when DB create fails', async () => {
    AnalyticsEvent.create.mockRejectedValueOnce(new Error('db down'));

    expect(() => trackEventSafe({
      eventType: ANALYTICS_EVENTS.LESSON_STARTED,
      user: '68a69b0a055071b7e4410b8f',
      metadata: { lessonTitle: 'Intro' }
    })).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));
    expect(AnalyticsEvent.create).toHaveBeenCalledTimes(1);
  });

  test('metadata sanitizer removes sensitive keys recursively', () => {
    const sanitized = sanitizeMetadata({
      token: 'secret-token',
      apiKey: 'secret-api-key',
      nested: {
        password: 'secret-password',
        authorization: 'Bearer abc',
        safe: 'ok'
      },
      cookie: 'session=secret'
    });

    expect(sanitized).toEqual({
      nested: {
        safe: 'ok'
      }
    });
  });

  test('metadata sanitizer truncates long strings', () => {
    const sanitized = sanitizeMetadata({
      text: 'a'.repeat(1500)
    });

    expect(sanitized.text).toHaveLength(1000);
  });

  test('metadata sanitizer limits very large metadata payloads', () => {
    const original = process.env.ANALYTICS_METADATA_MAX_BYTES;
    process.env.ANALYTICS_METADATA_MAX_BYTES = '100';

    const sanitized = sanitizeMetadata({
      rows: Array.from({ length: 50 }, (_, index) => ({ index, value: 'x'.repeat(20) }))
    });

    expect(sanitized).toEqual({
      _truncated: true,
      _reason: 'metadata_exceeded_max_bytes'
    });

    if (original === undefined) {
      delete process.env.ANALYTICS_METADATA_MAX_BYTES;
    } else {
      process.env.ANALYTICS_METADATA_MAX_BYTES = original;
    }
  });
});
