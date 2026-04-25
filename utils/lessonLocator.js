const { getCanonicalSections } = require('./courseContentAdapter');

function getCourseLessonMap(course) {
  const sections = getCanonicalSections(course);
  const lessons = [];

  sections.forEach((section, sectionIndex) => {
    const sectionLessons = Array.isArray(section && section.lessons) ? section.lessons : [];
    sectionLessons.forEach((lesson, lessonIndex) => {
      lessons.push({
        lesson,
        section,
        sectionIndex,
        lessonIndex
      });
    });
  });

  return lessons;
}

function findLessonContext(course, options = {}) {
  const lessonId = String(options.lessonId || '').trim();
  const sectionIndex = Number.isInteger(Number(options.sectionIndex)) ? Number(options.sectionIndex) : null;
  const lessonIndex = Number.isInteger(Number(options.lessonIndex)) ? Number(options.lessonIndex) : null;
  const all = getCourseLessonMap(course);

  if (lessonId) {
    const byId = all.find((entry) => String(entry.lesson && entry.lesson._id || '') === lessonId);
    if (byId) return byId;
  }

  if (sectionIndex !== null && lessonIndex !== null) {
    const byIndexes = all.find((entry) => entry.sectionIndex === sectionIndex && entry.lessonIndex === lessonIndex);
    if (byIndexes) return byIndexes;
  }

  return null;
}

module.exports = {
  getCourseLessonMap,
  findLessonContext
};
