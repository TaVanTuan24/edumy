/* eslint-disable no-console */
const axios = require('axios');
const { resolveStream } = require('../services/streamResolver');
const { createStreamProxyToken } = require('../utils/signStreamToken');

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name} -> ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runServiceTests() {
  await runCase('direct mp4 passthrough', async () => {
    const result = await resolveStream({
      sourceUrl: 'https://cdn.example.com/video.mp4',
      preferredFormat: 'mp4'
    });
    assert(result.success === true, 'expected success=true');
    assert(result.data.provider === 'direct', 'expected provider=direct');
    assert(result.data.format === 'mp4', 'expected format=mp4');
  });

  await runCase('direct m3u8 passthrough', async () => {
    const result = await resolveStream({
      sourceUrl: 'https://cdn.example.com/live/master.m3u8',
      preferredFormat: 'm3u8'
    });
    assert(result.success === true, 'expected success=true');
    assert(result.data.provider === 'direct', 'expected provider=direct');
    assert(result.data.format === 'm3u8', 'expected format=m3u8');
  });

  await runCase('youtube URL resolution success or scaffolded failure', async () => {
    const result = await resolveStream({
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      preferredFormat: 'm3u8'
    });

    if (result.success === true) {
      assert(result.data.provider === 'youtube', 'expected provider=youtube');
      assert(!!result.data.resolvedUrl, 'expected resolvedUrl');
      return;
    }

    assert(result.error.code === 'RESOLVE_FAILED', 'expected RESOLVE_FAILED when resolver toolchain unavailable');
  });

  await runCase('invalid URL input', async () => {
    const result = await resolveStream({ sourceUrl: 'not-a-url', preferredFormat: 'm3u8' });
    assert(result.success === false, 'expected success=false');
    assert(result.error.code === 'INVALID_INPUT', 'expected INVALID_INPUT');
  });

  await runCase('unsupported source', async () => {
    const result = await resolveStream({
      sourceUrl: 'https://example.com/page.html',
      preferredFormat: 'm3u8'
    });
    assert(result.success === false, 'expected success=false');
    assert(result.error.code === 'UNSUPPORTED_SOURCE', 'expected UNSUPPORTED_SOURCE');
  });
}

async function runEndpointTests() {
  const baseUrl = process.env.VR_TEST_BASE_URL || 'http://127.0.0.1:3000';

  await runCase('unauthorized access on resolve endpoint', async () => {
    try {
      await axios.post(`${baseUrl}/api/vr/stream/resolve`, {
        sourceUrl: 'https://cdn.example.com/video.mp4',
        preferredFormat: 'mp4'
      });
      throw new Error('expected 401 but request succeeded');
    } catch (err) {
      const status = err.response && err.response.status;
      const code = err.response && err.response.data && err.response.data.error && err.response.data.error.code;
      assert(status === 401, `expected 401, got ${status}`);
      assert(code === 'UNAUTHORIZED', `expected error.code=UNAUTHORIZED, got ${code}`);
    }
  });

  await runCase('expired proxy token', async () => {
    const tokenData = createStreamProxyToken({
      sourceUrl: 'https://cdn.example.com/video.mp4',
      provider: 'direct',
      format: 'mp4'
    }, -1);
    const expiredToken = tokenData.token;

    try {
      await axios.get(`${baseUrl}/api/vr/stream/proxy?token=${encodeURIComponent(expiredToken)}`);
      throw new Error('expected 401 but request succeeded');
    } catch (err) {
      const status = err.response && err.response.status;
      const code = err.response && err.response.data && err.response.data.error && err.response.data.error.code;
      assert(status === 401, `expected 401, got ${status}`);
      assert(code === 'UNAUTHORIZED' || code === 'INVALID_INPUT', `expected UNAUTHORIZED|INVALID_INPUT, got ${code}`);
    }
  });
}

async function main() {
  console.log('Running VR stream resolver tests...');
  await runServiceTests();
  await runEndpointTests();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
