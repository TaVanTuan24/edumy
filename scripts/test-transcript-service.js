'use strict';

/**
 * Manual verification script for the YouTube transcript service.
 *
 * Usage:
 *   node scripts/test-transcript-service.js
 *   TRANSCRIPT_DEBUG=true node scripts/test-transcript-service.js
 *
 * On Render shell:
 *   TRANSCRIPT_DEBUG=true node scripts/test-transcript-service.js
 */

const { fetchTranscript, checkYtdlpAvailability } = require('../services/youtube/transcriptService');

const TEST_VIDEOS = [
  {
    id: 'dQw4w9WgXcQ',
    description: 'Rick Astley - Never Gonna Give You Up (popular, should have captions)',
  },
  {
    id: 'jNQXAC9IVRw',
    description: 'Me at the zoo (first YouTube video, may or may not have captions)',
  },
];

async function runTests() {
  console.log('=== YouTube Transcript Service - Manual Verification ===\n');

  // Step 1: Check yt-dlp availability
  console.log('Step 1: Checking yt-dlp availability...');
  const ytdlpStatus = await checkYtdlpAvailability();
  if (ytdlpStatus.available) {
    console.log('  PASS: yt-dlp found at', ytdlpStatus.path, '- version:', ytdlpStatus.version);
  } else {
    console.log('  WARN: yt-dlp NOT found at', ytdlpStatus.path);
    console.log('  Strategy A (library) will still work on residential IPs.');
    console.log('  Strategies B/C (yt-dlp) will fail. This is expected if yt-dlp is not installed.');
  }
  console.log();

  // Step 2: Test config info
  console.log('Step 2: Environment config:');
  console.log('  TRANSCRIPT_DEBUG:', process.env.TRANSCRIPT_DEBUG || '(not set)');
  console.log('  TRANSCRIPT_FETCH_TIMEOUT_MS:', process.env.TRANSCRIPT_FETCH_TIMEOUT_MS || '(default: 30000)');
  console.log('  YOUTUBE_PROXY_URL:', process.env.YOUTUBE_PROXY_URL || '(not set)');
  console.log('  YTDLP_COOKIES_PATH:', process.env.YTDLP_COOKIES_PATH || '(not set)');
  console.log('  YTDLP_PATH:', process.env.YTDLP_PATH || process.env.VR_STREAM_YTDLP_PATH || '(default: yt-dlp)');
  console.log();

  // Step 3: Test each video
  for (const video of TEST_VIDEOS) {
    console.log('--- Testing:', video.description, '---');
    console.log('  Video ID:', video.id);

    const startTime = Date.now();

    try {
      const segments = await fetchTranscript(video.id);
      const elapsed = Date.now() - startTime;

      console.log('  PASS: Fetched', segments.length, 'segments in', elapsed + 'ms');

      // Validate format
      const isValid = Array.isArray(segments) && segments.length > 0 &&
        segments.every((s) =>
          typeof s.text === 'string' &&
          typeof s.offset === 'number' &&
          typeof s.duration === 'number'
        );

      console.log('  Format valid:', isValid ? 'YES' : 'NO');

      // Show first 3 segments as sample
      console.log('  Sample (first 3):');
      for (let i = 0; i < Math.min(3, segments.length); i++) {
        const s = segments[i];
        console.log('    [' + s.offset.toFixed(1) + 's, dur=' + s.duration.toFixed(1) + 's] ' +
          s.text.slice(0, 80) + (s.text.length > 80 ? '...' : ''));
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.log('  FAIL:', err.message.slice(0, 200));
      console.log('  Elapsed:', elapsed + 'ms');
    }

    console.log();
  }

  console.log('=== Verification complete ===');
}

runTests().catch((err) => {
  console.error('Test script error:', err);
  process.exit(1);
});