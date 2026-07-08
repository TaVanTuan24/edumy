'use strict';

/**
 * Robust YouTube transcript fetching service.
 *
 * Strategy order:
 *  A. youtube-transcript library (fast, works on residential IPs)
 *  B. yt-dlp subtitle extraction (reliable on datacenter/cloud IPs with proxy)
 *
 * Env vars:
 *   TRANSCRIPT_DEBUG=true          Enable verbose logging
 *   TRANSCRIPT_FETCH_TIMEOUT_MS    Timeout per yt-dlp call (default 30000)
 *   YOUTUBE_PROXY_URL              Proxy URL for yt-dlp (e.g. socks5://host:1080)
 *   YTDLP_COOKIES_PATH             Path to cookies.txt for yt-dlp
 *   YTDLP_PATH                     Path to yt-dlp binary (default: yt-dlp)
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const logger = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEBUG = process.env.TRANSCRIPT_DEBUG === 'true';
const TIMEOUT_MS = Math.max(5000, Number(process.env.TRANSCRIPT_FETCH_TIMEOUT_MS) || 30000);
const PROXY_URL = String(process.env.YOUTUBE_PROXY_URL || '').trim();
const COOKIES_PATH = String(process.env.YTDLP_COOKIES_PATH || '').trim();

function getYtdlpPath() {
  return process.env.YTDLP_PATH || process.env.VR_STREAM_YTDLP_PATH || 'yt-dlp';
}

function proxyEnabled() {
  return !!PROXY_URL;
}

// ---------------------------------------------------------------------------
// Structured logging helpers
// ---------------------------------------------------------------------------

function tlog(videoId, strategy, message, extra) {
  const entry = { videoId, strategy, msg: message };
  if (extra && typeof extra === 'object') Object.assign(entry, extra);
  if (DEBUG) {
    logger.info(entry, '[TranscriptService]');
  }
}

// ---------------------------------------------------------------------------
// Recognized subtitle extensions
// ---------------------------------------------------------------------------

const SUBTITLE_EXTENSIONS = [
  '.json3',
  '.vtt',
  '.srv1',
  '.srv2',
  '.srv3',
  '.ttml',
  '.srt',
  '.scc',
  '.dfxp',
  '.vtt.new',
  '.srv1.new',
];

function isSubtitleFile(filename) {
  const lower = filename.toLowerCase();
  return SUBTITLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function getSubtitleFormat(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json3')) return 'json3';
  if (lower.endsWith('.vtt') || lower.endsWith('.vtt.new')) return 'vtt';
  if (lower.endsWith('.srv1') || lower.endsWith('.srv1.new')) return 'srv1';
  if (lower.endsWith('.srv2')) return 'srv2';
  if (lower.endsWith('.srv3')) return 'srv3';
  if (lower.endsWith('.ttml') || lower.endsWith('.dfxp')) return 'ttml';
  if (lower.endsWith('.srt')) return 'srt';
  if (lower.endsWith('.scc')) return 'scc';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Strategy A: youtube-transcript library
// ---------------------------------------------------------------------------

let fetchTranscriptFn = null;

async function fetchViaLibrary(videoId) {
  tlog(videoId, 'A-library', 'Attempting youtube-transcript library');

  if (!fetchTranscriptFn) {
    const ytModule = await import('youtube-transcript/dist/youtube-transcript.esm.js');
    fetchTranscriptFn = ytModule && ytModule.fetchTranscript;
  }

  if (typeof fetchTranscriptFn !== 'function') {
    throw new Error('youtube-transcript library export not a function');
  }

  const result = await fetchTranscriptFn(videoId);
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error('Library returned empty transcript');
  }

  const normalized = normalizeLibrarySegments(result);
  tlog(videoId, 'A-library', 'Success', { segments: normalized.length });
  return normalized;
}

function normalizeLibrarySegments(rows) {
  if (!Array.isArray(rows)) return [];

  const durations = rows
    .map((r) => Math.abs(Number(r && r.duration) || 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  const offsets = rows
    .map((r) => Math.abs(Number(r && r.offset) || 0))
    .filter((n) => n > 0);

  const medianDur = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
  const maxOffset = offsets.length ? Math.max(...offsets) : 0;
  const scale = (medianDur > 120 || maxOffset > 100000) ? 1000 : 1;

  return rows.map((r) => ({
    text: String(r && r.text || '').trim(),
    offset: Math.max(0, Number(r && r.offset) || 0) / scale,
    duration: Math.max(0, Number(r && r.duration) || 0) / scale,
  })).filter((s) => s.text);
}

// ---------------------------------------------------------------------------
// Strategy B: yt-dlp subtitle extraction
// ---------------------------------------------------------------------------

/**
 * Build yt-dlp args for subtitle extraction.
 */
function buildYtdlpArgs(videoId, outputPath, subFormat, langs) {
  const url = 'https://www.youtube.com/watch?v=' + videoId;

  const args = [
    url,
    '--skip-download',
    '--no-warnings',
    '--no-check-certificates',
    '--no-call-home',
    '--sub-format', subFormat,
    '--sub-langs', langs,
    '--write-sub',
    '--write-auto-sub',
    '-o', outputPath,
  ];

  if (PROXY_URL) {
    args.unshift('--proxy', PROXY_URL);
  }

  if (COOKIES_PATH) {
    args.push('--cookies', COOKIES_PATH);
  }

  return args;
}

/**
 * Execute yt-dlp and return { stdout, stderr, exitCode }.
 */
function execYtdlp(args) {
  const ytdlpPath = getYtdlpPath();

  return new Promise((resolve) => {
    execFile(
      ytdlpPath,
      args,
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      },
      (err, stdout, stderr) => {
        const result = {
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          exitCode: err ? (err.code || 1) : 0,
          killed: Boolean(err && err.killed),
        };
        resolve(result);
      }
    );
  });
}

/**
 * Find ALL files in tmpDir that match our baseName prefix and are subtitle files.
 */
async function findSubtitleFiles(tmpDir, baseName) {
  let files;
  try {
    files = await fs.readdir(tmpDir);
  } catch {
    return [];
  }

  return files
    .filter((f) => f.startsWith(baseName) && isSubtitleFile(f))
    .map((f) => ({ name: f, format: getSubtitleFormat(f), fullPath: path.join(tmpDir, f) }))
    .sort((a, b) => {
      // Prefer json3 > vtt > srv1 > others
      const order = { json3: 0, vtt: 1, srv1: 2, srv2: 3, srv3: 4, srt: 5, ttml: 6 };
      return (order[a.format] ?? 99) - (order[b.format] ?? 99);
    });
}

/**
 * Find ALL files in tmpDir that match our baseName prefix (for debug logging).
 */
async function findRelatedFiles(tmpDir, baseName) {
  let files;
  try {
    files = await fs.readdir(tmpDir);
  } catch {
    return [];
  }
  return files.filter((f) => f.startsWith(baseName));
}

/**
 * Main yt-dlp strategy: run yt-dlp and parse the resulting subtitle files.
 */
async function fetchViaYtdlp(videoId) {
  const tmpDir = os.tmpdir();
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const baseName = 'yt_tr_' + videoId + '_' + ts + '_' + rand;

  // Try with preferred format cascade first, then fall back to 'best'
  const formatAttempts = [
    'json3/vtt/srv1/srt/ttml/best',
    'best',
  ];

  const langCascade = 'vi,en,vi.*,en.*,all';

  for (const subFormat of formatAttempts) {
    const label = 'B-ytdlp-' + subFormat.replace(/\//g, '_');
    const attemptBaseName = baseName + '_' + subFormat.replace(/\//g, '_');

    // Re-generate unique outputPath for this attempt
    const attemptOutput = path.join(tmpDir, attemptBaseName + '.%(ext)s');

    tlog(videoId, label, 'Running yt-dlp', {
      subFormat,
      langs: langCascade,
      proxy: proxyEnabled() ? 'enabled' : 'disabled',
      cookies: COOKIES_PATH ? 'configured' : 'none',
      outputPath: attemptOutput,
    });

    const args = buildYtdlpArgs(videoId, attemptOutput, subFormat, langCascade);
    const result = await execYtdlp(args);

    // Log full yt-dlp output for debugging
    tlog(videoId, label, 'yt-dlp finished', {
      exitCode: result.exitCode,
      killed: result.killed,
      stdoutLen: result.stdout.length,
      stderrLen: result.stderr.length,
      stdoutSnippet: result.stdout.slice(0, 300),
      stderrSnippet: result.stderr.slice(0, 500),
    });

    // Check if yt-dlp timed out
    if (result.killed) {
      tlog(videoId, label, 'yt-dlp timed out');
      await cleanupFiles(tmpDir, attemptBaseName);
      throw new Error('yt-dlp timed out after ' + TIMEOUT_MS + 'ms');
    }

    // Find ALL files generated (for debug)
    const relatedFiles = await findRelatedFiles(tmpDir, attemptBaseName);
    tlog(videoId, label, 'Files found in /tmp', {
      count: relatedFiles.length,
      files: relatedFiles,
    });

    // Find subtitle files specifically
    const subtitleFiles = await findSubtitleFiles(tmpDir, attemptBaseName);

    if (subtitleFiles.length === 0) {
      tlog(videoId, label, 'No subtitle files found', {
        exitCode: result.exitCode,
        relatedFiles,
      });
      await cleanupFiles(tmpDir, attemptBaseName);

      // If exit code was non-zero, log stderr for diagnosis
      if (result.exitCode !== 0) {
        tlog(videoId, label, 'yt-dlp error stderr', {
          stderr: result.stderr.slice(0, 1000),
        });
      }

      // Continue to next format attempt
      continue;
    }

    // Try to parse each subtitle file
    for (const subFile of subtitleFiles) {
      tlog(videoId, label, 'Trying to parse', {
        file: subFile.name,
        format: subFile.format,
      });

      try {
        const content = await fs.readFile(subFile.fullPath, 'utf-8');
        const segments = parseSubtitleContent(content, subFile.format);

        tlog(videoId, label, 'Parse result', {
          file: subFile.name,
          format: subFile.format,
          segments: segments.length,
        });

        if (segments.length > 0) {
          await cleanupFiles(tmpDir, attemptBaseName);
          return segments;
        }
      } catch (parseErr) {
        tlog(videoId, label, 'Parse failed', {
          file: subFile.name,
          format: subFile.format,
          error: parseErr.message,
        });
      }
    }

    // Files found but none could be parsed
    await cleanupFiles(tmpDir, attemptBaseName);
    throw new Error(
      'yt-dlp produced subtitle files but could not parse them: ' +
      subtitleFiles.map((f) => f.name + '(' + f.format + ')').join(', ')
    );
  }

  // Both format attempts failed — run --list-subs for diagnosis
  const diagResult = await diagnoseSubtitles(videoId);

  throw new Error(
    'No subtitle files could be generated by yt-dlp. ' + diagResult
  );
}

/**
 * Run yt-dlp --list-subs to check if the video has any subtitles available.
 */
async function diagnoseSubtitles(videoId) {
  const url = 'https://www.youtube.com/watch?v=' + videoId;
  const ytdlpPath = getYtdlpPath();
  const args = ['--list-subs', '--no-warnings', '--no-check-certificates'];

  if (PROXY_URL) {
    args.push('--proxy', PROXY_URL);
  }
  if (COOKIES_PATH) {
    args.push('--cookies', COOKIES_PATH);
  }
  args.push(url);

  return new Promise((resolve) => {
    execFile(
      ytdlpPath,
      args,
      { timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout || '').trim();
        const errOut = String(stderr || '').trim();

        logger.info({
          videoId,
          proxy: proxyEnabled() ? 'enabled' : 'disabled',
          exitCode: err ? (err.code || 1) : 0,
          stdout: out.slice(0, 1000),
          stderr: errOut.slice(0, 1000),
        }, '[TranscriptService] --list-subs diagnostic');

        const hasAvailable = out.includes('Available') || out.includes('Language');
        const hasNoSubs = out.includes('has no subtitles') || errOut.includes('has no subtitles');

        if (hasNoSubs) {
          resolve('This YouTube video has no subtitles/captions available at all.');
        } else if (hasAvailable) {
          resolve(
            'The video has subtitles but yt-dlp could not download them. ' +
            'Check proxy/cookies configuration. Stderr: ' + errOut.slice(0, 300)
          );
        } else {
          resolve(
            'yt-dlp could not determine subtitle availability. ' +
            (proxyEnabled()
              ? 'The proxy may be blocked by YouTube. Stderr: '
              : 'No proxy configured. Configure YOUTUBE_PROXY_URL. Stderr: '
            ) + errOut.slice(0, 300)
          );
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Subtitle parsers
// ---------------------------------------------------------------------------

function parseSubtitleContent(content, format) {
  switch (format) {
    case 'json3':
      return parseJson3(content);
    case 'vtt':
      return parseVtt(content);
    case 'srv1':
    case 'srv2':
    case 'srv3':
      return parseSrv1(content);
    case 'srt':
      return parseSrt(content);
    case 'ttml':
      return parseTtml(content);
    default:
      // Try all parsers
      return parseJson3(content) || parseVtt(content) || parseSrv1(content) || parseSrt(content) || [];
  }
}

/**
 * Parse YouTube JSON3 subtitle format.
 * Structure: { events: [{ tStartMs, dDurationMs, segs: [{ utf8 }] }] }
 */
function parseJson3(content) {
  try {
    const data = JSON.parse(content);
    const events = Array.isArray(data && data.events) ? data.events : [];
    const segments = [];

    for (const event of events) {
      if (!event || !Array.isArray(event.segs)) continue;

      const text = event.segs
        .map((seg) => String(seg && seg.utf8 || ''))
        .join('')
        .trim()
        .replace(/\n/g, ' ');

      if (!text) continue;

      segments.push({
        text: decodeEntities(text),
        offset: Math.max(0, Number(event.tStartMs) || 0) / 1000,
        duration: Math.max(0, Number(event.dDurationMs) || 0) / 1000,
      });
    }

    return segments;
  } catch {
    return [];
  }
}

/**
 * Parse SRV1 (YouTube XML subtitle format).
 * Also works for srv2, srv3 which use the same XML structure.
 */
function parseSrv1(xmlContent) {
  const segments = [];
  const regex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;

  while ((match = regex.exec(xmlContent)) !== null) {
    const offset = parseFloat(match[1]);
    const duration = parseFloat(match[2]);
    const text = decodeEntities(match[3].trim());

    if (text) {
      segments.push({ offset, duration, text });
    }
  }

  return segments;
}

/**
 * Parse WebVTT subtitle format.
 */
function parseVtt(content) {
  const segments = [];
  const lines = content.split(/\r?\n/);

  let i = 0;
  // Skip WEBVTT header and metadata
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.includes('-->')) {
      // Support both HH:MM:SS.mmm and MM:SS.mmm formats
      const timeMatch = line.match(
        /(\d{1,2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}\.\d{3})/
      ) || line.match(
        /(\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}\.\d{3})/
      );

      if (timeMatch) {
        const start = vttTimeToSeconds(timeMatch[1]);
        const end = vttTimeToSeconds(timeMatch[2]);
        const textLines = [];

        i++;
        while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
          textLines.push(lines[i]);
          i++;
        }

        const text = decodeEntities(
          textLines.join(' ').replace(/<[^>]+>/g, '').trim()
        );
        if (text) {
          segments.push({
            text,
            offset: start,
            duration: Math.max(0, end - start),
          });
        }
        continue;
      }
    }
    i++;
  }

  return segments;
}

/**
 * Parse SRT subtitle format.
 * Format:
 *   1
 *   00:00:01,000 --> 00:00:04,000
 *   Hello world
 */
function parseSrt(content) {
  const segments = [];
  const blocks = content.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 2) continue;

    // Find the time line (contains -->)
    let timeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIndex = i;
        break;
      }
    }

    if (timeLineIndex < 0) continue;

    const timeMatch = lines[timeLineIndex].match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
    );

    if (!timeMatch) continue;

    const start = srtTimeToSeconds(timeMatch[1]);
    const end = srtTimeToSeconds(timeMatch[2]);
    const textLines = lines.slice(timeLineIndex + 1);
    const text = decodeEntities(
      textLines.join(' ').replace(/<[^>]+>/g, '').trim()
    );

    if (text) {
      segments.push({
        text,
        offset: start,
        duration: Math.max(0, end - start),
      });
    }
  }

  return segments;
}

/**
 * Parse TTML/DFXP subtitle format.
 */
function parseTtml(content) {
  const segments = [];

  // Match <p begin="..." end="..." ...>text</p>
  const regex = /<p[^>]*begin="([^"]*)"[^>]*(?:end="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const start = ttmlTimeToSeconds(match[1]);
    const end = match[2] ? ttmlTimeToSeconds(match[2]) : start + 3;
    const text = decodeEntities(
      match[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    );

    if (text) {
      segments.push({
        text,
        offset: start,
        duration: Math.max(0, end - start),
      });
    }
  }

  return segments;
}

function vttTimeToSeconds(timeStr) {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseFloat(parts[2]) || 0;
    return (h * 3600) + (m * 60) + s;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseFloat(parts[1]) || 0;
    return (m * 60) + s;
  }
  return 0;
}

function srtTimeToSeconds(timeStr) {
  // SRT uses comma for decimal: 00:01:23,456
  const normalized = timeStr.replace(',', '.');
  return vttTimeToSeconds(normalized);
}

function ttmlTimeToSeconds(timeStr) {
  // TTML formats: "76.48s", "00:01:16.480", "1:16.480"
  if (/^\d+(\.\d+)?s$/.test(timeStr)) {
    return parseFloat(timeStr) || 0;
  }
  return vttTimeToSeconds(timeStr);
}

// ---------------------------------------------------------------------------
// Entity decoding (using \x26 for & to prevent formatter unescaping)
// ---------------------------------------------------------------------------

// Compiled once at module scope — decodeEntities runs per subtitle segment.
// Safe to share: String.prototype.replace resets a global regex's lastIndex after each call.
const ENTITY_AMP = /\x26amp;/g;
const ENTITY_LT = /\x26lt;/g;
const ENTITY_GT = /\x26gt;/g;
const ENTITY_QUOT = /\x26quot;/g;
const ENTITY_APOS = /\x26apos;/g;
const ENTITY_HASH39 = /\x26#39;/g;
const ENTITY_HEX = /\x26#x([0-9a-fA-F]+);/g;
const ENTITY_DEC = /\x26#(\d+);/g;

function decodeEntities(str) {
  return String(str || '')
    .replace(ENTITY_AMP, '&')
    .replace(ENTITY_LT, '<')
    .replace(ENTITY_GT, '>')
    .replace(ENTITY_QUOT, '"')
    .replace(ENTITY_HASH39, "'")
    .replace(ENTITY_APOS, "'")
    .replace(ENTITY_HEX, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(ENTITY_DEC, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanupFiles(tmpDir, baseName) {
  try {
    const files = await fs.readdir(tmpDir);
    for (const f of files) {
      if (f.startsWith(baseName)) {
        await fs.unlink(path.join(tmpDir, f)).catch(() => {});
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// Health check (for startup logging)
// ---------------------------------------------------------------------------

async function checkYtdlpAvailability() {
  const ytdlpPath = getYtdlpPath();

  return new Promise((resolve) => {
    execFile(ytdlpPath, ['--version'], { timeout: 10000 }, (err, stdout, _stderr) => {
      if (err) {
        logger.warn({
          ytdlpPath,
          error: err.message,
        }, '[TranscriptService] yt-dlp NOT available');
        resolve({ available: false, version: null, path: ytdlpPath });
        return;
      }

      const version = String(stdout || '').trim().split('\n')[0];
      logger.info({
        ytdlpPath,
        version,
        proxy: proxyEnabled() ? 'configured' : 'none',
        cookies: COOKIES_PATH ? 'configured' : 'none',
      }, '[TranscriptService] yt-dlp available');
      resolve({ available: true, version, path: ytdlpPath });
    });
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function fetchTranscript(videoId) {
  const errors = [];

  // Strategy A: youtube-transcript library
  try {
    const result = await fetchViaLibrary(videoId);
    if (result.length > 0) return result;
  } catch (err) {
    errors.push({ strategy: 'A-library', message: err.message });
    tlog(videoId, 'A-library', 'Failed', { error: err.message });
  }

  // Strategy B: yt-dlp
  try {
    const result = await fetchViaYtdlp(videoId);
    if (result.length > 0) return result;
  } catch (err) {
    errors.push({ strategy: 'B-ytdlp', message: err.message });
    tlog(videoId, 'B-ytdlp', 'Failed', { error: err.message });
  }

  // All strategies failed
  logger.error({
    videoId,
    strategies_tried: errors.length,
    errors: errors.map((e) => ({ s: e.strategy, m: e.message.slice(0, 200) })),
    proxy_configured: proxyEnabled(),
    cookies_configured: !!COOKIES_PATH,
  }, '[TranscriptService] All transcript strategies failed');

  const lower = errors.map((e) => e.message.toLowerCase()).join(' ');

  if (lower.includes('no subtitles') && lower.includes('available')) {
    throw new Error('This YouTube video has no subtitles or captions available.');
  }

  if (lower.includes('blocked') || lower.includes('sign in')) {
    throw new Error(
      'YouTube blocked transcript access from this server. ' +
      'Configure YOUTUBE_PROXY_URL or YTDLP_COOKIES_PATH environment variables.'
    );
  }

  if (lower.includes('timed out')) {
    throw new Error('Transcript extraction timed out. YouTube may be rate-limiting this server.');
  }

  if (lower.includes('not installed') || lower.includes('enoent')) {
    throw new Error(
      'yt-dlp is not installed. Set YTDLP_PATH or ensure it is in PATH.'
    );
  }

  const firstError = errors[errors.length - 1];
  const detail = firstError ? firstError.message.slice(0, 400) : 'Unknown error';
  throw new Error(
    'Could not fetch transcript for this video. Detail: ' + detail
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  fetchTranscript,
  checkYtdlpAvailability,
};