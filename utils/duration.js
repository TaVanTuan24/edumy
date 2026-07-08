const { extractDriveFileMeta, resolveGoogleDriveVideoDuration } = require('./driveVideoMetadata');

function isObjectLike(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDurationToSeconds(rawDuration) {
  if (typeof rawDuration === 'number') {
    return Number.isFinite(rawDuration) && rawDuration > 0 ? Math.floor(rawDuration) : null;
  }

  if (typeof rawDuration !== 'string') return null;

  const normalized = rawDuration.trim();
  if (!normalized) return null;

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    const numericValue = Number(normalized);
    return Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : null;
  }

  if (!/^\d{1,3}:\d{1,2}(:\d{1,2})?$/.test(normalized)) return null;

  const parts = normalized.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) return null;

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (seconds >= 60) return null;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    if (minutes >= 60 || seconds >= 60) return null;
    return (hours * 3600) + (minutes * 60) + seconds;
  }

  return null;
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'Duration unavailable';

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes <= 0) return '1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} hr ${String(minutes).padStart(2, '0')} min`;
}

function ensureLessonContentObject(lesson) {
  if (!isObjectLike(lesson)) return;
  if (!isObjectLike(lesson.content)) {
    lesson.content = {};
  }
}

function clearLessonDurationFields(lesson, pending = false) {
  if (!isObjectLike(lesson)) return;

  ensureLessonContentObject(lesson);
  lesson.durationSeconds = null;
  lesson.durationFormatted = '';
  lesson.durationSyncPending = Boolean(pending);
  lesson.content.durationSeconds = null;
  lesson.content.durationFormatted = '';
  lesson.content.durationSyncPending = Boolean(pending);
}

function applyLessonDurationFields(lesson, durationSeconds) {
  if (!isObjectLike(lesson)) return null;

  const normalizedDurationSeconds = parseDurationToSeconds(durationSeconds);
  if (!normalizedDurationSeconds) {
    clearLessonDurationFields(lesson);
    return null;
  }

  ensureLessonContentObject(lesson);

  const formatted = formatDuration(normalizedDurationSeconds);
  const beforeDurationSeconds = parseDurationToSeconds(lesson.durationSeconds);

  lesson.durationSeconds = normalizedDurationSeconds;
  lesson.durationFormatted = formatted;
  lesson.durationSyncPending = false;
  lesson.content.durationSeconds = normalizedDurationSeconds;
  lesson.content.durationFormatted = formatted;
  lesson.content.durationSyncPending = false;

  return {
    beforeDurationSeconds,
    afterDurationSeconds: normalizedDurationSeconds,
    durationFormatted: formatted
  };
}

function getStoredLessonDurationSeconds(lesson) {
  if (!isObjectLike(lesson)) return null;
  return parseDurationToSeconds(lesson.durationSeconds);
}

function getResolvableLessonDurationSeconds(lesson) {
  if (!isObjectLike(lesson)) return null;

  const storedDuration = parseDurationToSeconds(lesson.durationSeconds);
  if (storedDuration) return storedDuration;

  return parseDurationToSeconds(lesson.duration);
}

function getLessonVideoUrl(lesson) {
  if (!isObjectLike(lesson)) return '';
  return String(lesson.videoUrl || '').trim();
}

async function syncLessonDuration(lesson, options = {}) {
  const debug = Boolean(options.debug);

  if (!isObjectLike(lesson)) {
    return {
      ok: false,
      source: 'skip',
      fileId: '',
      skipReason: 'invalid lesson object'
    };
  }

  const lessonType = String(lesson.type || '').trim().toLowerCase();
  if (lessonType !== 'video') {
    clearLessonDurationFields(lesson, false);
    return {
      ok: false,
      source: 'skip',
      fileId: '',
      skipReason: 'non-video lesson'
    };
  }

  const storedDuration = parseDurationToSeconds(lesson.durationSeconds);
  if (storedDuration) {
    const updateState = applyLessonDurationFields(lesson, storedDuration);
    return {
      ok: true,
      source: 'durationSeconds',
      durationSeconds: storedDuration,
      durationFormatted: updateState ? updateState.durationFormatted : formatDuration(storedDuration),
      fileId: ''
    };
  }

  const parsedDuration = parseDurationToSeconds(lesson.duration);
  if (parsedDuration) {
    const updateState = applyLessonDurationFields(lesson, parsedDuration);
    return {
      ok: true,
      source: 'duration',
      durationSeconds: parsedDuration,
      durationFormatted: updateState ? updateState.durationFormatted : formatDuration(parsedDuration),
      fileId: ''
    };
  }

  const videoUrl = getLessonVideoUrl(lesson);
  const driveMeta = extractDriveFileMeta(videoUrl);
  if (!driveMeta || !driveMeta.fileId) {
    clearLessonDurationFields(lesson, false);
    return {
      ok: false,
      source: 'skip',
      fileId: '',
      skipReason: 'malformed or non-drive lesson.videoUrl'
    };
  }

  if (options.allowDriveLookup === false) {
    clearLessonDurationFields(lesson, true);
    return {
      ok: false,
      source: 'pending',
      fileId: driveMeta.fileId,
      skipReason: 'duration sync deferred'
    };
  }

  const driveResolution = await resolveGoogleDriveVideoDuration(videoUrl, { debug });
  if (!driveResolution.ok || !driveResolution.durationSeconds) {
    clearLessonDurationFields(lesson, true);
    return {
      ok: false,
      source: 'drive',
      fileId: driveResolution.fileId || driveMeta.fileId,
      mimeType: driveResolution.mimeType || '',
      metadataFound: Boolean(driveResolution.metadataFound),
      skipReason: driveResolution.skipReason || 'Drive duration unavailable'
    };
  }

  const updateState = applyLessonDurationFields(lesson, driveResolution.durationSeconds);
  return {
    ok: true,
    source: 'drive',
    fileId: driveResolution.fileId,
    mimeType: driveResolution.mimeType,
    metadataFound: Boolean(driveResolution.metadataFound),
    durationSeconds: driveResolution.durationSeconds,
    durationFormatted: updateState ? updateState.durationFormatted : formatDuration(driveResolution.durationSeconds)
  };
}

module.exports = {
  applyLessonDurationFields,
  clearLessonDurationFields,
  ensureLessonContentObject,
  formatDuration,
  getLessonVideoUrl,
  getResolvableLessonDurationSeconds,
  getStoredLessonDurationSeconds,
  parseDurationToSeconds,
  syncLessonDuration
};
