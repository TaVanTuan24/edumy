const {
  computeLessonDurationDelta,
  formatDuration,
  getResolvableLessonDurationSeconds,
  getStoredLessonDurationSeconds,
  syncLessonDuration
} = require('./duration');

function isObjectLike(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getSafeSections(course) {
  if (!course || !Array.isArray(course.sections)) return [];

  return course.sections
    .slice()
    .filter(isObjectLike)
    .sort((left, right) => {
      const leftOrder = Number.isFinite(Number(left.order)) ? Number(left.order) : 0;
      const rightOrder = Number.isFinite(Number(right.order)) ? Number(right.order) : 0;
      return leftOrder - rightOrder;
    });
}

function getSectionLessons(section) {
  if (!isObjectLike(section) || !Array.isArray(section.lessons)) return [];
  return section.lessons.filter(isObjectLike);
}

function isVideoLesson(lesson) {
  return String(lesson && lesson.type || '').trim().toLowerCase() === 'video';
}

function buildStoredCourseStats(course) {
  const totalDurationSeconds = Math.max(0, Number(course && course.totalDurationSeconds) || 0);
  const totalLessonCount = Math.max(0, Number(course && course.totalLessonCount) || 0);
  const totalVideoCount = Math.max(0, Number(course && course.totalVideoCount) || 0);
  const totalSectionCount = Math.max(0, Number(course && course.totalSectionCount) || 0);
  const formattedDuration = String(course && course.totalDurationFormatted || '').trim()
    || (totalDurationSeconds > 0 ? formatDuration(totalDurationSeconds) : 'Duration unavailable');

  return {
    totalDurationSeconds,
    formattedDuration,
    totalSectionCount,
    totalLessonCount,
    totalVideoCount,
    hasDuration: totalDurationSeconds > 0
  };
}

function rebuildStoredCourseStats(course) {
  const sections = getSafeSections(course);

  const totals = sections.reduce((accumulator, section) => {
    const lessons = getSectionLessons(section);
    accumulator.totalLessonCount += lessons.length;

    lessons.forEach((lesson) => {
      if (!isVideoLesson(lesson)) return;

      accumulator.totalVideoCount += 1;
      const durationSeconds = getResolvableLessonDurationSeconds(lesson);
      if (durationSeconds) {
        accumulator.totalDurationSeconds += durationSeconds;
      }
    });

    return accumulator;
  }, {
    totalDurationSeconds: 0,
    totalLessonCount: 0,
    totalVideoCount: 0
  });

  return {
    totalDurationSeconds: Math.max(0, totals.totalDurationSeconds),
    totalDurationFormatted: totals.totalDurationSeconds > 0 ? formatDuration(totals.totalDurationSeconds) : '',
    totalVideoCount: Math.max(0, totals.totalVideoCount),
    totalLessonCount: Math.max(0, totals.totalLessonCount),
    totalSectionCount: sections.length
  };
}

function applyCourseStatsDelta(course, delta = {}) {
  if (!course || typeof course !== 'object') return course;

  const nextDuration = Math.max(0, (Number(course.totalDurationSeconds) || 0) + (Number(delta.totalDurationSeconds) || 0));
  const nextLessons = Math.max(0, (Number(course.totalLessonCount) || 0) + (Number(delta.totalLessonCount) || 0));
  const nextVideos = Math.max(0, (Number(course.totalVideoCount) || 0) + (Number(delta.totalVideoCount) || 0));

  course.totalDurationSeconds = nextDuration;
  course.totalDurationFormatted = nextDuration > 0 ? formatDuration(nextDuration) : '';
  course.totalLessonCount = nextLessons;
  course.totalVideoCount = nextVideos;
  course.totalSectionCount = Array.isArray(course.sections) ? course.sections.length : 0;
  return course;
}

function syncCourseAggregateFields(course) {
  if (!course || typeof course !== 'object') return course;

  const rebuilt = rebuildStoredCourseStats(course);
  course.totalDurationSeconds = rebuilt.totalDurationSeconds;
  course.totalDurationFormatted = rebuilt.totalDurationFormatted;
  course.totalVideoCount = rebuilt.totalVideoCount;
  course.totalLessonCount = rebuilt.totalLessonCount;
  course.totalSectionCount = rebuilt.totalSectionCount;
  return course;
}

async function prepareLessonForWrite(lesson, options = {}) {
  return syncLessonDuration(lesson, options);
}

async function rebuildCourseDurationData(course, options = {}) {
  const debug = Boolean(options.debug);
  const resolveMissingDurations = options.resolveMissingDurations !== false;
  const sections = getSafeSections(course);
  const courseId = course && course._id ? String(course._id) : null;

  const summary = {
    courseId,
    sectionCount: sections.length,
    updatedLessons: 0,
    parsedLessons: 0,
    driveResolvedLessons: 0,
    skippedLessons: 0
  };

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const lessons = getSectionLessons(section);

    for (let lessonIndex = 0; lessonIndex < lessons.length; lessonIndex += 1) {
      const lesson = lessons[lessonIndex];
      const lessonTitle = lesson && lesson.title ? String(lesson.title) : `Lesson ${lessonIndex + 1}`;

      if (!isVideoLesson(lesson)) continue;

      const beforeDuration = getStoredLessonDurationSeconds(lesson);
      const result = await prepareLessonForWrite(lesson, {
        debug,
        allowDriveLookup: resolveMissingDurations
      });
      const afterDuration = getStoredLessonDurationSeconds(lesson);

      if (debug) {
        console.log('[course-stats] rebuild lesson', {
          courseId,
          sectionIndex,
          lessonIndex,
          lessonTitle,
          fileId: result.fileId || '',
          source: result.source,
          beforeDurationSeconds: beforeDuration,
          afterDurationSeconds: afterDuration,
          reason: result.skipReason || ''
        });
      }

      if (afterDuration && afterDuration !== beforeDuration) {
        summary.updatedLessons += 1;
        if (result.source === 'duration') summary.parsedLessons += 1;
        if (result.source === 'drive') summary.driveResolvedLessons += 1;
      } else if (!afterDuration) {
        summary.skippedLessons += 1;
      }
    }
  }

  syncCourseAggregateFields(course);

  if (options.save && course && typeof course.markModified === 'function') {
    course.markModified('sections');
    await course.save();
  }

  return summary;
}

module.exports = {
  applyCourseStatsDelta,
  buildStoredCourseStats,
  computeLessonDurationDelta,
  getSafeSections,
  getSectionLessons,
  isVideoLesson,
  prepareLessonForWrite,
  rebuildCourseDurationData,
  rebuildStoredCourseStats,
  syncCourseAggregateFields
};
