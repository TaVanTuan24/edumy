if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const Course = require('../models/course');
const { buildStoredCourseStats, rebuildCourseDurationData } = require('../utils/courseStats');

const MONGO_URI = String(process.env.MONGO_URI || '').trim();
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

async function run() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  await mongoose.connect(MONGO_URI);
  console.log('[backfill:drive-durations] connected');
  console.log(`[backfill:drive-durations] mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const courses = await Course.find({});

  let touchedCourses = 0;
  let updatedLessons = 0;
  let parsedLessons = 0;
  let driveResolvedLessons = 0;
  let skippedLessons = 0;

  for (const course of courses) {
    const beforeStats = buildStoredCourseStats(course);
    const summary = await rebuildCourseDurationData(course, {
      debug: VERBOSE,
      resolveMissingDurations: true,
      save: APPLY
    });
    const afterStats = buildStoredCourseStats(course);

    updatedLessons += summary.updatedLessons;
    parsedLessons += summary.parsedLessons;
    driveResolvedLessons += summary.driveResolvedLessons;
    skippedLessons += summary.skippedLessons;

    const changed = beforeStats.totalDurationSeconds !== afterStats.totalDurationSeconds
      || beforeStats.totalLessonCount !== afterStats.totalLessonCount
      || beforeStats.totalVideoCount !== afterStats.totalVideoCount
      || beforeStats.totalSectionCount !== afterStats.totalSectionCount;

    if (changed) {
      touchedCourses += 1;
    }

    console.log('[backfill:drive-durations] course summary', {
      courseId: summary.courseId,
      updatedLessons: summary.updatedLessons,
      parsedLessons: summary.parsedLessons,
      driveResolvedLessons: summary.driveResolvedLessons,
      skippedLessons: summary.skippedLessons,
      totalDurationSeconds: afterStats.totalDurationSeconds,
      totalDurationFormatted: afterStats.formattedDuration,
      totalLessonCount: afterStats.totalLessonCount,
      totalVideoCount: afterStats.totalVideoCount
    });
  }

  console.log('[backfill:drive-durations] summary', {
    coursesScanned: courses.length,
    touchedCourses,
    updatedLessons,
    parsedLessons,
    driveResolvedLessons,
    skippedLessons
  });

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('[backfill:drive-durations] failed', error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
