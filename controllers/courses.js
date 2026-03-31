const Course = require('../models/course');
const scanDriveStructure = require('../utils/driveScanner');
const { cloudinary } = require('../cloudinary');
const Progress = require('../models/progress');
const Note = require('../models/note');
const User = require('../models/user');
const mongoose = require('mongoose');

function getEnrolledCourseIds(user) {
  if (!user || typeof user.getEnrolledCourseIdSet !== 'function') return [];

  return Array.from(user.getEnrolledCourseIdSet())
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

async function markCourseSeenForUser(userId, course) {
  if (!userId || !course) return { hadUpdate: false, markedSeen: false };

  const user = await User.findById(userId);
  if (!user) return { hadUpdate: false, markedSeen: false };

  let enrollment = user.findEnrollment(course._id);
  if (!enrollment) return { hadUpdate: false, markedSeen: false };

  if (!enrollment.courseId) {
    const idx = (user.enrolledCourses || []).findIndex((entry) => String(entry) === String(course._id));
    if (idx !== -1) {
      user.enrolledCourses[idx] = {
        courseId: course._id,
        progress: {
          completedCount: 0,
          lastLessonId: ''
        },
        lastSeenUpdatedAt: null,
        enrolledAt: new Date()
      };
      enrollment = user.enrolledCourses[idx];
    }
  }

  if (!enrollment || !enrollment.courseId) return { hadUpdate: false, markedSeen: false };

  const courseUpdatedAt = course.updatedAt ? new Date(course.updatedAt) : new Date();
  const lastSeen = enrollment.lastSeenUpdatedAt ? new Date(enrollment.lastSeenUpdatedAt) : null;
  const hadUpdate = !lastSeen || courseUpdatedAt > lastSeen;

  if (hadUpdate) {
    enrollment.lastSeenUpdatedAt = courseUpdatedAt;
    await user.save();
    return { hadUpdate: true, markedSeen: true };
  }

  return { hadUpdate: false, markedSeen: false };
}

function normalizeLessonContent(item) {
  if (!item || typeof item !== 'object') return;

  const rawType = String(item.type || 'video').toLowerCase();
  const type = rawType === 'video' ? 'lecture' : rawType;

  let normalizedContent = {};

  if (type === 'quiz') {
    const questionsFromContent = Array.isArray(item.content && item.content.questions) ? item.content.questions : [];
    const questionsFromLegacy = Array.isArray(item.questions) ? item.questions : [];
    const questions = questionsFromContent.length ? questionsFromContent : questionsFromLegacy;

    normalizedContent = {
      questions: questions.map((q) => ({
        question: q && q.question ? q.question : '',
        options: Array.isArray(q && q.options) ? q.options : [],
        correctAnswer: q && q.correctAnswer ? q.correctAnswer : '',
        explanation: q && q.explanation ? q.explanation : ''
      }))
    };
  } else if (type === 'slide') {
    const slidesFromContent = Array.isArray(item.content && item.content.slides) ? item.content.slides : [];

    normalizedContent = {
      slides: slidesFromContent
    };
  } else {
    normalizedContent = {
      videoUrl: item.preview || item.videoUrl || ''
    };
  }

  item.type = type;
  item.title = item.name || item.title || 'Untitled Lesson';
  item.content = normalizedContent;
}

function normalizeCourseContent(course) {
  if (!course) return;

  const hasDriveStructure = Array.isArray(course.driveStructure) && course.driveStructure.length > 0;
  const hasSections = Array.isArray(course.sections) && course.sections.length > 0;

  if (!hasDriveStructure && hasSections) {
    course.driveStructure = course.sections.map((section) => {
      const lessons = Array.isArray(section.lessons) ? section.lessons : [];

      return {
        section: section.title || 'Section',
        videos: lessons.map((lesson) => ({
          _id: lesson._id,
          type: lesson.type === 'video' ? 'lecture' : lesson.type,
          name: lesson.title || 'Untitled Lesson',
          title: lesson.title || 'Untitled Lesson',
          preview: lesson.videoUrl || '',
          content: {
            videoUrl: lesson.videoUrl || '',
            questions: Array.isArray(lesson.quiz) ? lesson.quiz : [],
            slides: Array.isArray(lesson.content && lesson.content.slides) ? lesson.content.slides : []
          },
          questions: Array.isArray(lesson.quiz) ? lesson.quiz : [],
          slides: Array.isArray(lesson.content && lesson.content.slides) ? lesson.content.slides : []
        }))
      };
    });
  }

  if (!Array.isArray(course.driveStructure)) return;

  course.driveStructure.forEach((section) => {
    if (!section || !Array.isArray(section.videos)) return;

    section.videos.forEach((item) => {
      normalizeLessonContent(item);
    });
  });
}

module.exports.index = async (req, res) => {
  const user = await User.findById(req.user._id);
  const enrolledIds = getEnrolledCourseIds(user);
  const idOrder = new Map(enrolledIds.map((id, idx) => [String(id), idx]));

  const courses = await Course.find({ _id: { $in: enrolledIds } }).sort({ updatedAt: -1 });
  courses.sort((a, b) => {
    const orderA = idOrder.get(String(a._id));
    const orderB = idOrder.get(String(b._id));
    return (orderA ?? 0) - (orderB ?? 0);
  });

  res.render('courses/index', { courses });
};

module.exports.renderNewForm = (req, res) => {
  res.render('courses/new');
};

module.exports.createCourse = async (req, res, next) => {
  const course = new Course(req.body.course);
  course.images = req.files ? req.files.map(f => ({ url: f.path, filename: f.filename })) : [];
  course.author = req.user._id;

  const match = course.driveLink.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) {
    const folderId = match[1];
    try {
      const structure = await scanDriveStructure(folderId);
      course.driveStructure = structure.reverse();
    } catch (err) {
      console.error("Lỗi khi quét Google Drive:", err.message);
      req.flash('error', 'Không thể quét nội dung Drive. Vui lòng kiểm tra link!');
    }
  } else {
    req.flash('error', 'Drive link không hợp lệ!');
  }

  await course.save();
  req.flash('success', 'Successfully made a new course!');
  res.redirect(`/courses/${course._id}`);
};

module.exports.showCourses = async (req, res) => {
  const course = await Course.findById(req.params.id)
    .populate({ path: 'reviews', populate: { path: 'author' } })
    .populate('author');

  if (!course) {
    req.flash('error', 'Cannot find that course!');
    return res.redirect('/courses');
  }

  const updateStatus = await markCourseSeenForUser(req.user && req.user._id, course);

  normalizeCourseContent(course);
  console.log(JSON.stringify(course.sections, null, 2));

  let completedVideos = [];
  if (req.user) {
    const progress = await Progress.findOne({ user: req.user._id, course: course._id });
    if (progress?.completedVideos) completedVideos = progress.completedVideos;
  }

  const notes = await Note.find({ user: req.user?._id, course: course._id });
  const sectionNotes = Array(course.driveStructure.length).fill('');
  notes.forEach(n => {
    sectionNotes[n.sectionIndex] = n.content;
  });

  res.render('courses/show', { course, completedVideos, sectionNotes, hasCourseUpdate: updateStatus.hadUpdate });
};

module.exports.renderEditForm = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) {
    req.flash('error', 'Cannot find that course!');
    return res.redirect('/courses');
  }
  res.render('courses/edit', { course });
};

module.exports.updateCourse = async (req, res) => {
  const course = await Course.findByIdAndUpdate(req.params.id, req.body.course);
  const imgs = req.files.map(f => ({ url: f.path, filename: f.filename }));
  course.images.push(...imgs);
  await course.save();
  req.flash('success', 'Successfully updated course!');
  res.redirect(`/courses/${course._id}`);
};

module.exports.deleteCourse = async (req, res) => {
  await Course.findByIdAndDelete(req.params.id);
  req.flash('success', 'Successfully deleted course!');
  res.redirect('/courses');
};

module.exports.updateProgress = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { video, completed } = req.body;
    const userId = req.user._id;

    if (!video || typeof video !== 'string') throw new Error('Thiếu hoặc sai định dạng video URL');

    const videoLink = video.split('?')[0];
    const courseObjectId = new mongoose.Types.ObjectId(courseId);

    let progress = await Progress.findOne({ user: userId, course: courseObjectId });
    if (!progress) {
      progress = new Progress({ user: userId, course: courseObjectId, completedVideos: [] });
    }

    const alreadyExists = progress.completedVideos.some(v => v.split('?')[0] === videoLink);

    if (completed === true || completed === 'true') {
      if (!alreadyExists) progress.completedVideos.push(videoLink);
    } else {
      progress.completedVideos = progress.completedVideos.filter(v => v.split('?')[0] !== videoLink);
    }

    await progress.save();
    res.json({ success: true });
  } catch (err) {
    console.error('[❌ Lỗi khi lưu progress]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.saveNote = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { sectionIndex, content } = req.body;
    const userId = req.user._id;

    let note = await Note.findOne({ user: userId, course: courseId, sectionIndex });
    if (!note) {
      note = new Note({ user: userId, course: courseId, sectionIndex, content });
    } else {
      note.content = content;
    }

    await note.save();
    res.json({ success: true });
  } catch (err) {
    console.error('[Lỗi ghi chú]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Render the new Udemy-style learning page
module.exports.renderLearnPage = async (req, res) => {
  const course = await Course.findById(req.params.id)
    .populate('author');

  if (!course) {
    req.flash('error', 'Cannot find that course!');
    return res.redirect('/courses');
  }

  const updateStatus = await markCourseSeenForUser(req.user && req.user._id, course);

  normalizeCourseContent(course);
  console.log(JSON.stringify(course.sections, null, 2));

  // Get completed videos
  let completedVideos = [];
  if (req.user) {
    const progress = await Progress.findOne({ user: req.user._id, course: course._id });
    if (progress?.completedVideos) completedVideos = progress.completedVideos;
  }

  // Calculate total lessons
  const totalLessons = course.driveStructure.reduce((acc, sec) => acc + (sec.videos || []).length, 0);

  const completedCount = completedVideos.length;

  res.render('courses/learn', { 
    course, 
    completedVideos, 
    totalLessons,
    completedCount,
    hasCourseUpdate: updateStatus.hadUpdate
  });
};
