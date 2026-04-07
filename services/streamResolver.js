const { URL } = require('url');
const { execFile } = require('child_process');

const DIRECT_EXTENSIONS = ['.m3u8', '.mp4', '.mov', '.m4v', '.webm'];
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be'
]);

function normalizePreferredFormat(input) {
  return input === 'mp4' ? 'mp4' : 'm3u8';
}

function safeUrlParse(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function isYoutubeUrl(parsedUrl) {
  if (!parsedUrl) return false;
  return YOUTUBE_HOSTS.has(parsedUrl.hostname.toLowerCase());
}

function isDirectPlayableUrl(parsedUrl) {
  if (!parsedUrl) return false;
  const lowerPath = parsedUrl.pathname.toLowerCase();
  return DIRECT_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
}

function normalizeErrorDetails(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return String(err);
}

function runWithTimeout(promise, timeoutMs) {
  const timeoutPromise = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`Resolver timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

async function withRetries(taskFn, retries) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await taskFn();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Resolver failed');
}

function pickBestFormat(formats, preferredFormat) {
  const safeFormats = Array.isArray(formats) ? formats : [];
  const directFormats = safeFormats.filter((f) => f && typeof f.url === 'string' && f.url.length > 0);

  const hlsCandidates = directFormats
    .filter((f) => {
      const mimeType = String(f.mimeType || '').toLowerCase();
      const protocol = String(f.protocol || '').toLowerCase();
      const url = String(f.url || '').toLowerCase();

      return f.isHLS === true
        || mimeType.includes('application/vnd.apple.mpegurl')
        || protocol.includes('m3u8')
        || url.includes('.m3u8');
    })
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));

  const mp4Candidates = directFormats
    .filter((f) => {
      const container = String(f.container || '').toLowerCase();
      const mimeType = String(f.mimeType || '').toLowerCase();
      const url = String(f.url || '').toLowerCase();
      return container === 'mp4' || mimeType.includes('video/mp4') || url.includes('.mp4');
    })
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));

  if (preferredFormat === 'm3u8') {
    if (hlsCandidates[0]) return { url: hlsCandidates[0].url, format: 'm3u8' };
    if (mp4Candidates[0]) return { url: mp4Candidates[0].url, format: 'mp4' };
  } else {
    if (mp4Candidates[0]) return { url: mp4Candidates[0].url, format: 'mp4' };
    if (hlsCandidates[0]) return { url: hlsCandidates[0].url, format: 'm3u8' };
  }

  return null;
}

function tryLoadYtdlCore() {
  try {
    return require('@distube/ytdl-core');
  } catch (_) {
    try {
      return require('ytdl-core');
    } catch (_) {
      return null;
    }
  }
}

async function resolveYouTubeViaYtdlCore(sourceUrl, preferredFormat, timeoutMs) {
  const ytdl = tryLoadYtdlCore();
  if (!ytdl || typeof ytdl.getInfo !== 'function') {
    throw new Error('ytdl-core not installed');
  }

  const info = await runWithTimeout(ytdl.getInfo(sourceUrl), timeoutMs);
  const selected = pickBestFormat(info && info.formats, preferredFormat);
  if (!selected) {
    throw new Error('No playable YouTube format found from ytdl-core');
  }

  return selected;
}

function execFileAsync(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 6
    }, (error, stdout, stderr) => {
      if (error) {
        const details = stderr || stdout || error.message;
        return reject(new Error(details));
      }

      return resolve(stdout);
    });
  });
}

async function resolveYouTubeViaYtDlp(sourceUrl, preferredFormat, timeoutMs) {
  const output = await execFileAsync('yt-dlp', ['-J', sourceUrl], timeoutMs);
  const parsed = JSON.parse(output || '{}');
  const selected = pickBestFormat(parsed && parsed.formats, preferredFormat);
  if (!selected) {
    throw new Error('No playable YouTube format found from yt-dlp');
  }

  return selected;
}

async function resolveYouTubeStream(sourceUrl, preferredFormat, timeoutMs, retries) {
  const errors = [];

  try {
    return await withRetries(
      () => resolveYouTubeViaYtdlCore(sourceUrl, preferredFormat, timeoutMs),
      retries
    );
  } catch (err) {
    errors.push(`ytdl-core: ${normalizeErrorDetails(err)}`);
  }

  try {
    return await withRetries(
      () => resolveYouTubeViaYtDlp(sourceUrl, preferredFormat, timeoutMs),
      retries
    );
  } catch (err) {
    errors.push(`yt-dlp: ${normalizeErrorDetails(err)}`);
  }

  throw new Error(errors.join(' | '));
}

async function resolveStream(input) {
  const sourceUrl = String((input && input.sourceUrl) || '').trim();
  const preferredFormat = normalizePreferredFormat(input && input.preferredFormat);

  const timeoutMs = Math.max(1000, Number(process.env.VR_STREAM_RESOLVE_TIMEOUT_MS) || 8000);
  const retries = Math.max(0, Number(process.env.VR_STREAM_RESOLVE_RETRIES) || 1);

  const parsedUrl = safeUrlParse(sourceUrl);
  if (!parsedUrl) {
    return {
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'sourceUrl must be a valid http/https URL'
      }
    };
  }

  if (isDirectPlayableUrl(parsedUrl)) {
    const format = parsedUrl.pathname.toLowerCase().endsWith('.m3u8') ? 'm3u8' : 'mp4';
    return {
      success: true,
      data: {
        resolvedUrl: sourceUrl,
        format,
        provider: 'direct',
        expiresAt: null,
        headers: {}
      }
    };
  }

  if (isYoutubeUrl(parsedUrl)) {
    try {
      const selected = await resolveYouTubeStream(sourceUrl, preferredFormat, timeoutMs, retries);
      return {
        success: true,
        data: {
          resolvedUrl: selected.url,
          format: selected.format,
          provider: 'youtube',
          expiresAt: null,
          headers: {
            'User-Agent': process.env.VR_STREAM_UPSTREAM_USER_AGENT || ''
          }
        }
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'RESOLVE_FAILED',
          message: 'Failed to resolve a playable stream URL from YouTube source',
          details: normalizeErrorDetails(err)
        }
      };
    }
  }

  return {
    success: false,
    error: {
      code: 'UNSUPPORTED_SOURCE',
      message: 'Unsupported source URL. Only direct media links and YouTube URLs are supported.'
    }
  };
}

module.exports = {
  resolveStream,
  normalizePreferredFormat,
  safeUrlParse,
  isYoutubeUrl,
  isDirectPlayableUrl
};
