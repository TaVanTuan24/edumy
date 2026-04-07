const { URL } = require('url');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ytDlpWrapModule = null;
let ytDlpBinaryPathCache = null;
let ytDlpDownloadPromise = null;

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

function extractYouTubeId(rawUrl) {
  const parsed = safeUrlParse(rawUrl);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();
  if (host.includes('youtu.be')) {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id || null;
  }

  if (!host.includes('youtube.com')) return null;

  const fromQuery = parsed.searchParams.get('v');
  if (fromQuery) return fromQuery;

  const pathParts = parsed.pathname.split('/').filter(Boolean);
  if (pathParts.length >= 2) {
    const type = pathParts[0].toLowerCase();
    if (type === 'shorts' || type === 'live' || type === 'embed' || type === 'v') {
      return pathParts[1];
    }
  }

  return null;
}

function normalizeYouTubeSourceUrl(rawUrl) {
  const id = extractYouTubeId(rawUrl);
  if (!id) return rawUrl;
  return `https://www.youtube.com/watch?v=${id}`;
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

function classifyResolverError(message) {
  const text = String(message || '').toLowerCase();

  if (text.includes('cannot find module') || text.includes('not installed')) {
    return 'MISSING_DEPENDENCY';
  }

  if (text.includes('enoent') || text.includes('not recognized as an internal or external command')) {
    return 'MISSING_BINARY';
  }

  if (text.includes('timeout')) {
    return 'TIMEOUT';
  }

  if (text.includes('json') && (text.includes('parse') || text.includes('unexpected token'))) {
    return 'PARSE_FAILED';
  }

  return 'UNKNOWN';
}

function buildResolverFailureDetail(stage, err) {
  const message = normalizeErrorDetails(err);
  const reason = classifyResolverError(message);
  return `${stage}[${reason}]: ${message}`;
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

  function hasVideo(format) {
    if (!format) return false;
    if (typeof format.hasVideo === 'boolean') return format.hasVideo;
    const vcodec = String(format.vcodec || '').toLowerCase();
    const videoExt = String(format.video_ext || '').toLowerCase();
    if (vcodec || videoExt) {
      return (vcodec && vcodec !== 'none') || (videoExt && videoExt !== 'none');
    }

    // Some resolvers omit explicit hasVideo/vcodec fields on otherwise playable entries.
    return true;
  }

  function hasAudio(format) {
    if (!format) return false;
    if (typeof format.hasAudio === 'boolean') return format.hasAudio;
    const acodec = String(format.acodec || '').toLowerCase();
    const audioExt = String(format.audio_ext || '').toLowerCase();
    if (acodec || audioExt) {
      return (acodec && acodec !== 'none') || (audioExt && audioExt !== 'none');
    }

    // Some resolvers omit explicit hasAudio/acodec fields on otherwise playable entries.
    return true;
  }

  function isHls(format) {
    const mimeType = String(format.mimeType || '').toLowerCase();
    const protocol = String(format.protocol || '').toLowerCase();
    const ext = String(format.ext || '').toLowerCase();
    const url = String(format.url || '').toLowerCase();

    return format.isHLS === true
      || mimeType.includes('application/vnd.apple.mpegurl')
      || protocol.includes('m3u8')
      || ext === 'm3u8'
      || url.includes('.m3u8');
  }

  function isMp4(format) {
    const container = String(format.container || '').toLowerCase();
    const mimeType = String(format.mimeType || '').toLowerCase();
    const ext = String(format.ext || '').toLowerCase();
    const videoExt = String(format.video_ext || '').toLowerCase();
    const url = String(format.url || '').toLowerCase();
    return container === 'mp4'
      || ext === 'mp4'
      || videoExt === 'mp4'
      || mimeType.includes('video/mp4')
      || url.includes('.mp4');
  }

  function score(format) {
    const height = Number(format.height || 0);
    const bitrate = Number(format.bitrate || format.tbr || 0);
    return (height * 1000000) + bitrate;
  }

  const progressiveCandidates = directFormats.filter((f) => hasVideo(f) && hasAudio(f));

  const hlsCandidates = progressiveCandidates
    .filter((f) => isHls(f))
    .sort((a, b) => score(b) - score(a));

  const mp4Candidates = progressiveCandidates
    .filter((f) => isMp4(f))
    .sort((a, b) => score(b) - score(a));

  const anyProgressive = progressiveCandidates
    .sort((a, b) => score(b) - score(a));

  if (preferredFormat === 'm3u8') {
    if (hlsCandidates[0]) return { url: hlsCandidates[0].url, format: 'm3u8' };
    if (mp4Candidates[0]) return { url: mp4Candidates[0].url, format: 'mp4' };
    if (anyProgressive[0]) return { url: anyProgressive[0].url, format: isHls(anyProgressive[0]) ? 'm3u8' : 'mp4' };
  } else {
    if (mp4Candidates[0]) return { url: mp4Candidates[0].url, format: 'mp4' };
    if (hlsCandidates[0]) return { url: hlsCandidates[0].url, format: 'm3u8' };
    if (anyProgressive[0]) return { url: anyProgressive[0].url, format: isHls(anyProgressive[0]) ? 'm3u8' : 'mp4' };
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

function tryLoadYtDlpWrap() {
  if (ytDlpWrapModule) return ytDlpWrapModule;

  try {
    ytDlpWrapModule = require('yt-dlp-wrap');
    return ytDlpWrapModule;
  } catch (_) {
    return null;
  }
}

function getDefaultYtDlpBinaryPath() {
  const extension = process.platform === 'win32' ? '.exe' : '';
  return path.join(os.tmpdir(), 'edumy-vr-stream', 'yt-dlp', `yt-dlp${extension}`);
}

async function ensureManagedYtDlpBinary(timeoutMs) {
  const configuredPath = String(process.env.VR_STREAM_YTDLP_PATH || '').trim();
  if (configuredPath) {
    if (!fs.existsSync(configuredPath)) {
      throw new Error(`Configured VR_STREAM_YTDLP_PATH does not exist: ${configuredPath}`);
    }
    return configuredPath;
  }

  if (ytDlpBinaryPathCache && fs.existsSync(ytDlpBinaryPathCache)) {
    return ytDlpBinaryPathCache;
  }

  const binaryPath = getDefaultYtDlpBinaryPath();
  if (fs.existsSync(binaryPath)) {
    ytDlpBinaryPathCache = binaryPath;
    return binaryPath;
  }

  if (process.env.VR_STREAM_SKIP_YTDLP_DOWNLOAD === 'true') {
    throw new Error('Managed yt-dlp download disabled by VR_STREAM_SKIP_YTDLP_DOWNLOAD=true');
  }

  const YTDlpWrap = tryLoadYtDlpWrap();
  if (!YTDlpWrap || typeof YTDlpWrap.default?.downloadFromGithub !== 'function') {
    throw new Error('yt-dlp-wrap missing downloadFromGithub()');
  }

  if (!ytDlpDownloadPromise) {
    ytDlpDownloadPromise = (async () => {
      const targetDir = path.dirname(binaryPath);
      fs.mkdirSync(targetDir, { recursive: true });

      // Use a larger timeout for first-time binary download.
      const downloadTimeout = Math.max(timeoutMs * 2, 20000);
      await runWithTimeout(
        YTDlpWrap.default.downloadFromGithub(binaryPath, undefined, os.platform()),
        downloadTimeout
      );

      if (process.platform !== 'win32') {
        fs.chmodSync(binaryPath, 0o755);
      }

      ytDlpBinaryPathCache = binaryPath;
      return binaryPath;
    })().finally(() => {
      ytDlpDownloadPromise = null;
    });
  }

  return ytDlpDownloadPromise;
}

async function resolveYouTubeViaYtDlpWrap(sourceUrl, preferredFormat, timeoutMs) {
  const YTDlpWrap = tryLoadYtDlpWrap();
  if (!YTDlpWrap) {
    throw new Error('yt-dlp-wrap not installed');
  }

  const ytDlpWrap = new YTDlpWrap.default();
  const output = await runWithTimeout(ytDlpWrap.execPromise(['-J', sourceUrl]), timeoutMs);

  let parsed;
  try {
    parsed = JSON.parse(output || '{}');
  } catch (err) {
    throw new Error(`yt-dlp-wrap parse failure: ${normalizeErrorDetails(err)}`);
  }

  const selected = pickBestFormat(parsed && parsed.formats, preferredFormat);
  if (!selected) {
    throw new Error('No playable YouTube format found from yt-dlp-wrap');
  }

  return selected;
}

async function resolveYouTubeViaYtDlpDirectUrl(command, sourceUrl, preferredFormat, timeoutMs) {
  const selector = preferredFormat === 'm3u8'
    ? 'best[protocol*=m3u8][vcodec!=none]/best[acodec!=none][vcodec!=none][ext=mp4]/best[acodec!=none][vcodec!=none]/best'
    : 'best[acodec!=none][vcodec!=none][ext=mp4]/best[acodec!=none][vcodec!=none]/best';

  const output = await execFileAsync(command, ['-g', '--no-playlist', '--no-warnings', '-f', selector, sourceUrl], timeoutMs);
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('http://') || line.startsWith('https://'));

  if (!lines.length) {
    throw new Error('yt-dlp -g returned no playable URL');
  }

  const resolved = lines[0];
  const inferredFormat = resolved.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4';
  return { url: resolved, format: inferredFormat };
}

async function resolveYouTubeViaYtDlp(sourceUrl, preferredFormat, timeoutMs) {
  const output = await execFileAsync('yt-dlp', ['-J', '--no-playlist', '--no-warnings', sourceUrl], timeoutMs);
  let parsed;
  try {
    parsed = JSON.parse(output || '{}');
  } catch (err) {
    throw new Error(`yt-dlp parse failure: ${normalizeErrorDetails(err)}`);
  }
  const selected = pickBestFormat(parsed && parsed.formats, preferredFormat);
  if (!selected) {
    return resolveYouTubeViaYtDlpDirectUrl('yt-dlp', sourceUrl, preferredFormat, timeoutMs);
  }

  return selected;
}

async function resolveYouTubeViaManagedYtDlp(sourceUrl, preferredFormat, timeoutMs) {
  const binaryPath = await ensureManagedYtDlpBinary(timeoutMs);
  const output = await execFileAsync(binaryPath, ['-J', '--no-playlist', '--no-warnings', sourceUrl], timeoutMs);

  let parsed;
  try {
    parsed = JSON.parse(output || '{}');
  } catch (err) {
    throw new Error(`managed yt-dlp parse failure: ${normalizeErrorDetails(err)}`);
  }

  const selected = pickBestFormat(parsed && parsed.formats, preferredFormat);
  if (!selected) {
    return resolveYouTubeViaYtDlpDirectUrl(binaryPath, sourceUrl, preferredFormat, timeoutMs);
  }

  return selected;
}

async function resolveYouTubeStream(sourceUrl, preferredFormat, timeoutMs, retries) {
  const errors = [];
  const normalizedSourceUrl = normalizeYouTubeSourceUrl(sourceUrl);

  try {
    return await withRetries(
      () => resolveYouTubeViaYtdlCore(normalizedSourceUrl, preferredFormat, timeoutMs),
      retries
    );
  } catch (err) {
    errors.push(buildResolverFailureDetail('ytdl-core', err));
  }

  try {
    return await withRetries(
      () => resolveYouTubeViaYtDlp(normalizedSourceUrl, preferredFormat, timeoutMs),
      retries
    );
  } catch (err) {
    errors.push(buildResolverFailureDetail('yt-dlp', err));
  }

  try {
    return await withRetries(
      () => resolveYouTubeViaManagedYtDlp(normalizedSourceUrl, preferredFormat, timeoutMs),
      retries
    );
  } catch (err) {
    errors.push(buildResolverFailureDetail('yt-dlp-managed', err));
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
