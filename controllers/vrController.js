const mongoose = require('mongoose');
const Course = require('../models/course');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const ExpressError = require('../utils/ExpressError');

function getEnrolledCourseIdStrings(userDoc) {
  const ids = [];

  const enrolledCourses = Array.isArray(userDoc && userDoc.enrolledCourses)
    ? userDoc.enrolledCourses
    : [];
  for (const entry of enrolledCourses) {
    if (!entry) continue;
    if (entry.courseId) {
      ids.push(String(entry.courseId));
      continue;
    }
    ids.push(String(entry));
  }

  const directIds = Array.isArray(userDoc && userDoc.enrolledCourseIds)
    ? userDoc.enrolledCourseIds
    : [];
  for (const id of directIds) {
    if (!id) continue;
    ids.push(String(id));
  }

  return Array.from(new Set(ids.filter((id) => mongoose.isValidObjectId(id))));
}

function isUserEnrolledInCourse(userDoc, courseId) {
  if (!userDoc || !courseId) return false;

  if (typeof userDoc.findEnrollment === 'function' && userDoc.findEnrollment(courseId)) {
    return true;
  }

  return getEnrolledCourseIdStrings(userDoc).includes(String(courseId));
}

function getOrderedLessonsFromSections(sections) {
  const safeSections = Array.isArray(sections) ? sections : [];

  const sortedSections = safeSections
    .slice()
    .sort((a, b) => Number(a && a.order) - Number(b && b.order));

  const lessons = [];
  for (const section of sortedSections) {
    const sectionLessons = Array.isArray(section && section.lessons) ? section.lessons.slice() : [];
    sectionLessons.sort((a, b) => Number(a && a.order) - Number(b && b.order));
    lessons.push(...sectionLessons);
  }

  return lessons;
}

function getOrderedLessonsFromDriveStructure(driveStructure) {
  const safeSections = Array.isArray(driveStructure) ? driveStructure : [];
  const lessons = [];

  for (const section of safeSections) {
    const sectionItems = Array.isArray(section && section.videos) ? section.videos.slice() : [];
    sectionItems.sort((a, b) => Number(a && a.order) - Number(b && b.order));
    lessons.push(...sectionItems);
  }

  return lessons;
}

function getCourseLessons(courseDoc) {
  const sectionLessons = getOrderedLessonsFromSections(courseDoc && courseDoc.sections);
  if (sectionLessons.length > 0) {
    return sectionLessons.map((lesson) => ({
      id: String(lesson && lesson._id),
      title: String((lesson && lesson.title) || 'Untitled Lesson'),
      duration: lesson && lesson.duration ? lesson.duration : null,
      order: Number.isFinite(Number(lesson && lesson.order)) ? Number(lesson.order) : null,
      content: lesson && lesson.content ? lesson.content : null,
      videoUrl: lesson && lesson.videoUrl ? lesson.videoUrl : ''
    }));
  }

  const legacyLessons = getOrderedLessonsFromDriveStructure(courseDoc && courseDoc.driveStructure);
  return legacyLessons.map((item, idx) => ({
    id: String((item && (item._id || item.refId)) || `legacy_lesson_${idx + 1}`),
    title: String((item && (item.title || item.name)) || 'Untitled Lesson'),
    duration: (item && item.duration) || (item && item.content && item.content.duration) || null,
    order: Number.isFinite(Number(item && item.order)) ? Number(item.order) : idx + 1,
    content: item && item.content ? item.content : null,
    videoUrl: item && item.preview ? item.preview : ''
  }));
}

function getThumbnailUrl(courseDoc) {
  if (Array.isArray(courseDoc && courseDoc.images) && courseDoc.images.length > 0) {
    const firstImage = courseDoc.images.find((img) => img && img.url);
    if (firstImage && firstImage.url) return firstImage.url;
  }

  const lessons = getCourseLessons(courseDoc);
  for (const lesson of lessons) {
    if (lesson.videoUrl) return lesson.videoUrl;

    const slides = Array.isArray(lesson.content && lesson.content.slides)
      ? lesson.content.slides
      : [];
    for (const slide of slides) {
      const elements = Array.isArray(slide && slide.elements) ? slide.elements : [];
      const imageElement = elements.find((el) => el && el.type === 'image' && el.src);
      if (imageElement && imageElement.src) return imageElement.src;
    }
  }

  return '';
}

module.exports.getVrCourses = async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('enrolledCourses enrolledCourseIds')
    .lean();

  if (!user) {
    throw new ExpressError('User not found', 404);
  }

  const enrolledIds = getEnrolledCourseIdStrings(user);
  if (enrolledIds.length === 0) {
    return res.json({ success: true, data: [] });
  }

  const objectIds = enrolledIds.map((id) => new mongoose.Types.ObjectId(id));

  const [courses, progressDocs] = await Promise.all([
    Course.find({ _id: { $in: objectIds } })
      .select('title description images sections driveStructure')
      .lean(),
    UserCourseProgress.find({ user: req.user._id, course: { $in: objectIds } })
      .select('course completedLessons completionRate')
      .lean()
  ]);

  const progressMap = new Map(progressDocs.map((doc) => [String(doc.course), doc]));
  const orderMap = new Map(enrolledIds.map((id, idx) => [id, idx]));

  const data = courses
    .slice()
    .sort((a, b) => (orderMap.get(String(a._id)) || 0) - (orderMap.get(String(b._id)) || 0))
    .map((course) => {
      const lessons = getCourseLessons(course);
      const totalLessons = lessons.length;
      const progress = progressMap.get(String(course._id));
      const rawCompletedLessons = Array.isArray(progress && progress.completedLessons)
        ? progress.completedLessons.length
        : 0;
      const completedLessons = totalLessons
        ? Math.min(rawCompletedLessons, totalLessons)
        : rawCompletedLessons;

      const computedPercentage = totalLessons
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;

      const storedCompletionRate = Number(progress && progress.completionRate);
      const percentage = Number.isFinite(storedCompletionRate)
        ? Math.max(0, Math.min(100, Math.round(storedCompletionRate)))
        : computedPercentage;

      return {
        id: String(course._id),
        title: String(course.title || ''),
        description: String(course.description || ''),
        thumbnailUrl: getThumbnailUrl(course),
        progress: percentage,
        totalLessons,
        completedLessons
      };
    });

  return res.json({ success: true, data });
};

module.exports.getVrCourseLessons = async (req, res) => {
  const { courseId } = req.params;

  if (!mongoose.isValidObjectId(courseId)) {
    throw new ExpressError('Course not found', 404);
  }

  const [user, course, progressDoc] = await Promise.all([
    User.findById(req.user._id)
      .select('enrolledCourses enrolledCourseIds')
      .lean(),
    Course.findById(courseId)
      .select('sections driveStructure')
      .lean(),
    UserCourseProgress.findOne({ user: req.user._id, course: courseId })
      .select('completedLessons')
      .lean()
  ]);

  if (!user) {
    throw new ExpressError('User not found', 404);
  }

  if (!course) {
    throw new ExpressError('Course not found', 404);
  }

  if (!isUserEnrolledInCourse(user, courseId)) {
    throw new ExpressError('Course not found or user not enrolled', 404);
  }

  const completedSet = new Set(
    Array.isArray(progressDoc && progressDoc.completedLessons)
      ? progressDoc.completedLessons.map((id) => String(id))
      : []
  );

  const lessons = getCourseLessons(course).map((lesson, idx) => ({
    id: String(lesson.id),
    title: String(lesson.title || ''),
    duration: lesson.duration || null,
    order: Number.isFinite(Number(lesson.order)) ? Number(lesson.order) : idx + 1,
    isCompleted: completedSet.has(String(lesson.id))
  }));

  return res.json({ success: true, data: lessons });
};