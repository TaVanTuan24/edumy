const mockExecFile = jest.fn();

jest.mock('child_process', () => ({
  execFile: (...args) => mockExecFile(...args)
}));

const mockGetInfo = jest.fn();

jest.mock('@distube/ytdl-core', () => ({
  getInfo: (...args) => mockGetInfo(...args)
}));

describe('streamResolver', () => {
  const originalSkipManagedDownload = process.env.VR_STREAM_SKIP_YTDLP_DOWNLOAD;

  beforeEach(() => {
    jest.resetModules();
    mockExecFile.mockReset();
    mockGetInfo.mockReset();
    process.env.VR_STREAM_SKIP_YTDLP_DOWNLOAD = 'true';
  });

  afterAll(() => {
    if (typeof originalSkipManagedDownload === 'undefined') {
      delete process.env.VR_STREAM_SKIP_YTDLP_DOWNLOAD;
      return;
    }

    process.env.VR_STREAM_SKIP_YTDLP_DOWNLOAD = originalSkipManagedDownload;
  });

  test('youtube resolve success via ytdl-core', async () => {
    mockExecFile.mockImplementation((command, args, options, cb) => {
      cb(new Error('spawn yt-dlp ENOENT'), '', '');
    });

    mockGetInfo.mockResolvedValue({
      formats: [
        {
          url: 'https://stream.example.com/master.m3u8',
          isHLS: true,
          bitrate: 1000,
          mimeType: 'application/vnd.apple.mpegurl'
        }
      ]
    });

    const { resolveStream } = require('../services/streamResolver');
    const result = await resolveStream({
      sourceUrl: 'https://www.youtube.com/watch?v=abc123',
      preferredFormat: 'm3u8'
    });

    expect(result.success).toBe(true);
    expect(result.data.provider).toBe('youtube');
    expect(result.data.format).toBe('m3u8');
    expect(result.data.resolvedUrl).toBe('https://stream.example.com/master.m3u8');
  });

  test('youtube toolchain unavailable returns RESOLVE_FAILED', async () => {
    mockGetInfo.mockRejectedValue(new Error('ytdl-core not installed'));
    mockExecFile.mockImplementation((command, args, options, cb) => {
      cb(new Error('spawn yt-dlp ENOENT'), '', '');
    });

    const { resolveStream } = require('../services/streamResolver');
    const result = await resolveStream({
      sourceUrl: 'https://www.youtube.com/watch?v=abc123',
      preferredFormat: 'm3u8'
    });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('RESOLVE_FAILED');
    expect(result.error.details).toContain('yt-dlp');
    expect(result.error.details).toContain('MISSING_BINARY');
  });

  test('invalid input returns INVALID_INPUT', async () => {
    const { resolveStream } = require('../services/streamResolver');
    const result = await resolveStream({ sourceUrl: 'not-a-url', preferredFormat: 'm3u8' });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  test('unsupported source returns UNSUPPORTED_SOURCE', async () => {
    const { resolveStream } = require('../services/streamResolver');
    const result = await resolveStream({
      sourceUrl: 'https://example.com/page.html',
      preferredFormat: 'm3u8'
    });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('UNSUPPORTED_SOURCE');
  });
});
