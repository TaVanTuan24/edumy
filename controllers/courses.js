const Course = require('../models/course');
const scanDriveStructure = require('../utils/driveScanner');
const { cloudinary } = require('../cloudinary');
const Progress = require('../models/progress');
const Note = require('../models/note');
const User = require('../models/user');
const mongoose = require('mongoose');

module.exports.index = async (req, res) => {
  const user = await User.findById(req.user._id).populate('enrolledCourses');
  const courses = user.enrolledCourses || [];
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

  // Normalize driveStructure - ensure all items have type field
  if (course.driveStructure) {
    course.driveStructure.forEach(section => {
      if (section.videos && Array.isArray(section.videos)) {
        section.videos.forEach(item => {
          if (!item.type) {
            item.type = "video"; // Default to video for backward compatibility
          }
        });
      }
    });
  }

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

  res.render('courses/show', { course, completedVideos, sectionNotes });
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

  // Normalize driveStructure - ensure all items have type field
  if (course.driveStructure) {
    course.driveStructure.forEach(section => {
      if (section.videos && Array.isArray(section.videos)) {
        section.videos.forEach(item => {
          if (!item.type) {
            item.type = "video"; // Default to video for backward compatibility
          }
        });
      }
    });
  }

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
    completedCount 
  });
};
