const { google } = require('googleapis');

function logDriveDurationDebug(enabled, message, payload) {
  if (!enabled) return;
  console.log(`[drive-duration] ${message}`, payload);
}

function extractDriveFileMeta(inputUrl) {
  const raw = String(inputUrl || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw, 'https://drive.google.com');
  } catch {
    return null;
  }

  const host = String(parsed.hostname || '').toLowerCase();
  if (!host.includes('drive.google.com')) return null;

  const pathname = String(parsed.pathname || '');
  let fileId = '';
  const pathMatchers = [
    /\/file\/d\/([^/?#]+)/i,
    /\/document\/d\/([^/?#]+)/i,
    /\/presentation\/d\/([^/?#]+)/i,
    /\/spreadsheets\/d\/([^/?#]+)/i
  ];

  for (const matcher of pathMatchers) {
    const match = pathname.match(matcher);
    if (match && match[1]) {
      fileId = match[1];
      break;
    }
  }

  if (!fileId) {
    fileId = parsed.searchParams.get('id')
      || parsed.searchParams.get('fileId')
      || parsed.searchParams.get('docid')
      || '';
  }

  if (!fileId) return null;

  return {
    fileId,
    resourceKey: parsed.searchParams.get('resourcekey') || ''
  };
}

function buildDrivePreviewUrl(fileId, resourceKey) {
  const safeId = String(fileId || '').trim();
  if (!safeId) return '';

  const url = new URL(`https://drive.google.com/file/d/${safeId}/preview`);
  if (resourceKey) {
    url.searchParams.set('resourcekey', String(resourceKey));
  }
  url.searchParams.set('usp', 'drivesdk');
  return url.toString();
}

function createDriveClient() {
  const apiKey = String(process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) return null;

  return google.drive({
    version: 'v3',
    auth: apiKey
  });
}

function buildDurationResolutionResult(overrides = {}) {
  return {
    ok: false,
    fileId: '',
    name: '',
    mimeType: '',
    metadataFound: false,
    durationMillis: null,
    durationSeconds: null,
    skipReason: '',
    ...overrides
  };
}

function isDriveVideoMimeType(mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('video/');
}

async function fetchGoogleDriveFileMetadata(fileId, options = {}) {
  const safeFileId = String(fileId || '').trim();
  if (!safeFileId) {
    return buildDurationResolutionResult({
      fileId: '',
      skipReason: 'missing file id'
    });
  }

  const drive = createDriveClient();
  if (!drive) {
    return buildDurationResolutionResult({
      fileId: safeFileId,
      skipReason: 'missing GOOGLE_API_KEY'
    });
  }

  try {
    const response = await drive.files.get({
      fileId: safeFileId,
      fields: 'id,name,mimeType,videoMediaMetadata',
      ...(options.resourceKey ? { resourceKey: String(options.resourceKey) } : {}),
      supportsAllDrives: true
    });

    const file = response && response.data ? response.data : {};
    const mimeType = String(file.mimeType || '');
    const metadata = file.videoMediaMetadata || null;
    const durationMillis = Number(metadata && metadata.durationMillis);

    logDriveDurationDebug(options.debug, 'metadata response', {
      fileId: safeFileId,
      name: String(file.name || ''),
      mimeType,
      metadataFound: Boolean(metadata),
      durationMillis: Number.isFinite(durationMillis) ? durationMillis : null
    });

    if (mimeType === 'application/vnd.google-apps.shortcut') {
      return buildDurationResolutionResult({
        fileId: safeFileId,
        name: String(file.name || ''),
        mimeType,
        metadataFound: Boolean(metadata),
        skipReason: 'shortcut file'
      });
    }

    if (!isDriveVideoMimeType(mimeType)) {
      return buildDurationResolutionResult({
        fileId: safeFileId,
        name: String(file.name || ''),
        mimeType,
        metadataFound: Boolean(metadata),
        skipReason: mimeType ? 'non-video file' : 'missing mime type'
      });
    }

    if (!metadata) {
      return buildDurationResolutionResult({
        fileId: safeFileId,
        name: String(file.name || ''),
        mimeType,
        metadataFound: false,
        skipReason: 'video metadata not available yet'
      });
    }

    if (!Number.isFinite(durationMillis) || durationMillis <= 0) {
      return buildDurationResolutionResult({
        fileId: safeFileId,
        name: String(file.name || ''),
        mimeType,
        metadataFound: true,
        durationMillis: Number.isFinite(durationMillis) ? durationMillis : null,
        skipReason: 'videoMediaMetadata.durationMillis missing'
      });
    }

    return buildDurationResolutionResult({
      ok: true,
      fileId: safeFileId,
      name: String(file.name || ''),
      mimeType,
      metadataFound: true,
      durationMillis,
      durationSeconds: Math.floor(durationMillis / 1000)
    });
  } catch (error) {
    logDriveDurationDebug(options.debug, 'metadata request failed', {
      fileId: safeFileId,
      error: error && error.message ? error.message : String(error || 'Unknown error')
    });

    return buildDurationResolutionResult({
      fileId: safeFileId,
      skipReason: error && error.message ? error.message : 'Drive API request failed'
    });
  }
}

async function resolveGoogleDriveVideoDuration(input, options = {}) {
  const meta = typeof input === 'string'
    ? extractDriveFileMeta(input)
    : (input && typeof input === 'object'
      ? {
          fileId: String(input.fileId || '').trim(),
          resourceKey: String(input.resourceKey || '').trim()
        }
      : null);

  if (!meta || !meta.fileId) {
    logDriveDurationDebug(options.debug, 'skip resolve', {
      fileId: '',
      skipReason: 'malformed or non-drive link'
    });
    return buildDurationResolutionResult({
      skipReason: 'malformed or non-drive link'
    });
  }

  const result = await fetchGoogleDriveFileMetadata(meta.fileId, {
    resourceKey: meta.resourceKey,
    debug: options.debug
  });

  logDriveDurationDebug(options.debug, 'duration resolve result', {
    fileId: result.fileId,
    mimeType: result.mimeType,
    metadataFound: result.metadataFound,
    durationSeconds: result.durationSeconds,
    skipReason: result.skipReason || ''
  });

  return result;
}

async function fetchGoogleDriveVideoDurationSeconds(fileId, options = {}) {
  const result = await resolveGoogleDriveVideoDuration({ fileId, resourceKey: options.resourceKey }, options);
  return result.ok ? result.durationSeconds : null;
}

module.exports = {
  buildDrivePreviewUrl,
  extractDriveFileMeta,
  fetchGoogleDriveFileMetadata,
  fetchGoogleDriveVideoDurationSeconds,
  isDriveVideoMimeType,
  resolveGoogleDriveVideoDuration
};
