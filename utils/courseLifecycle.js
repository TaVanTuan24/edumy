const VALID_STATUSES = new Set(['draft', 'published', 'archived']);

function getEffectiveCourseStatus(course) {
  const status = String(course && course.status || '').trim().toLowerCase();
  if (VALID_STATUSES.has(status)) {
    return status;
  }
  return 'published';
}

function isCourseCatalogVisible(course) {
  return getEffectiveCourseStatus(course) === 'published';
}

function computeCourseReadiness(course) {
  const sections = Array.isArray(course && course.sections) ? course.sections : [];
  const lessons = sections.flatMap((section) => Array.isArray(section && section.lessons) ? section.lessons : []);
  const hasThumbnail = Boolean(Array.isArray(course && course.images) && course.images[0] && course.images[0].url);

  const items = [
    { key: 'title', label: 'Has title', ok: Boolean(String(course && course.title || '').trim()), critical: true },
    { key: 'description', label: 'Has description', ok: Boolean(String(course && course.description || '').trim()), critical: true },
    { key: 'thumbnail', label: 'Has thumbnail', ok: hasThumbnail, critical: true },
    { key: 'topic', label: 'Has topic', ok: Boolean(String(course && course.topic || '').trim()), critical: false },
    { key: 'sections', label: 'Has at least 1 section', ok: sections.length > 0, critical: true },
    { key: 'lessons', label: 'Has at least 1 lesson', ok: lessons.length > 0, critical: true },
    {
      key: 'lessonTitles',
      label: 'All lessons have titles',
      ok: lessons.length > 0 && lessons.every((lesson) => Boolean(String(lesson && lesson.title || '').trim())),
      critical: true
    }
  ];

  return {
    items,
    totalSections: sections.length,
    totalLessons: lessons.length,
    isPublishReady: items.every((item) => !item.critical || item.ok)
  };
}

function setCourseStatus(course, status, options = {}) {
  const nextStatus = VALID_STATUSES.has(String(status || '')) ? String(status) : 'draft';
  const now = new Date();

  course.status = nextStatus;
  course.lastEditedAt = now;

  if (nextStatus === 'published') {
    course.publishedAt = course.publishedAt || now;
    course.archivedAt = null;
    course.unpublishedReason = '';
  }

  if (nextStatus === 'draft') {
    course.unpublishedReason = String(options.unpublishedReason || '').trim();
    course.archivedAt = null;
  }

  if (nextStatus === 'archived') {
    course.archivedAt = now;
  }

  return course;
}

function buildCourseStatusBadge(course) {
  const status = getEffectiveCourseStatus(course);
  return {
    status,
    label: status.charAt(0).toUpperCase() + status.slice(1)
  };
}

module.exports = {
  getEffectiveCourseStatus,
  isCourseCatalogVisible,
  computeCourseReadiness,
  setCourseStatus,
  buildCourseStatusBadge
};
