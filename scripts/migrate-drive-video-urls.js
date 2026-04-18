if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const Course = require('../models/course');

const MONGO_URL = process.env.MONGODB_URL || process.env.DB_URL || 'mongodb://localhost:27017/edumy';
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

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

  const filePathMatch = pathname.match(/\/file\/d\/([^/]+)/i);
  if (filePathMatch) {
    fileId = filePathMatch[1];
  }

  if (!fileId) {
    fileId = parsed.searchParams.get('id') || '';
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

function normalizeDriveVideoUrl(inputUrl) {
  const meta = extractDriveFileMeta(inputUrl);
  if (!meta) return String(inputUrl || '');
  return buildDrivePreviewUrl(meta.fileId, meta.resourceKey);
}

function migrateSectionLesson(lesson) {
  if (!lesson || typeof lesson !== 'object') return false;

  const beforeVideoUrl = String(lesson.videoUrl || '');
  const beforePreview = String(lesson.preview || '');
  const beforeContentVideoUrl = String(lesson.content && lesson.content.videoUrl || '');

  const normalizedVideoUrl = normalizeDriveVideoUrl(beforeVideoUrl);
  const normalizedPreview = normalizeDriveVideoUrl(beforePreview);
  const normalizedContentVideoUrl = normalizeDriveVideoUrl(beforeContentVideoUrl);

  let changed = false;

  if (beforeVideoUrl && normalizedVideoUrl && beforeVideoUrl !== normalizedVideoUrl) {
    lesson.videoUrl = normalizedVideoUrl;
    changed = true;
  }

  if (beforePreview && normalizedPreview && beforePreview !== normalizedPreview) {
    lesson.preview = normalizedPreview;
    changed = true;
  }

  if (lesson.content && typeof lesson.content === 'object' && !Array.isArray(lesson.content)) {
    if (beforeContentVideoUrl && normalizedContentVideoUrl && beforeContentVideoUrl !== normalizedContentVideoUrl) {
      lesson.content.videoUrl = normalizedContentVideoUrl;
      changed = true;
    }
  }

  return changed;
}

async function run() {
  await mongoose.connect(MONGO_URL);
  console.log(`[migration:drive-urls] connected: ${MONGO_URL}`);
  console.log(`[migration:drive-urls] mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const courses = await Course.find({});

  let touchedCourses = 0;
  let touchedLessons = 0;

  for (const course of courses) {
    let changedCourse = false;

    for (const section of Array.isArray(course.sections) ? course.sections : []) {
      if (!section || !Array.isArray(section.lessons)) continue;

      for (const lesson of section.lessons) {
        if (migrateSectionLesson(lesson)) {
          changedCourse = true;
          touchedLessons += 1;
        }
      }
    }

    if (changedCourse) {
      touchedCourses += 1;
      if (VERBOSE) {
        console.log(`[migration:drive-urls] touch course: ${course._id} - ${course.title}`);
      }
      if (APPLY) {
        await course.save();
      }
    }
  }

  console.log(`[migration:drive-urls] courses touched: ${touchedCourses}`);
  console.log(`[migration:drive-urls] lessons updated: ${touchedLessons}`);
  console.log('[migration:drive-urls] completed');

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('[migration:drive-urls] failed:', err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect error
  }
  process.exit(1);
});
