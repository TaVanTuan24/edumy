const Course = require('../models/course');
const scanDriveStructure = require('../utils/driveScanner');
const Progress = require('../models/progress');
const Note = require('../models/note');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');
const mongoose = require('mongoose');
const { awardGamification, buildGamificationViewModel } = require('../utils/gamification');
const Discussion = require('../models/discussion');

function countCourseLessons(course) {
  if (!course || !Array.isArray(course.driveStructure)) return 0;
  return course.driveStructure.reduce((total, section) => {
    const items = Array.isArray(section && section.videos) ? section.videos : [];
    return total + items.length;
  }, 0);
}

function sanitizeCourseInput(rawCourse) {
  const source = rawCourse && typeof rawCourse === 'object' ? rawCourse : {};
  const allowedFields = ['title', 'description', 'driveLink', 'topic', 'driveStructure', 'sections'];

  return allowedFields.reduce((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      acc[key] = source[key];
    }
    return acc;
  }, {});
}

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
      questions: questions.map((q) => {
        const rawOptions = Array.isArray(q && q.options)
          ? q.options
          : Array.isArray(q && q.answers)
            ? q.answers
            : [];

        const options = rawOptions.map((opt) => {
          if (typeof opt === 'string') return opt;
          if (opt && typeof opt === 'object') {
            return String(opt.text || opt.answer || '').trim();
          }
          return '';
        }).filter(Boolean);

        let correctAnswer = q && q.correctAnswer ? q.correctAnswer : '';
        if (!correctAnswer) {
          const correctOption = rawOptions.find((opt) => opt && (opt.correct === true || opt.isCorrect === true));
          if (correctOption) {
            correctAnswer = typeof correctOption === 'string'
              ? correctOption
              : String(correctOption.text || correctOption.answer || '').trim();
          }
        }

        return {
          question: q && q.question ? q.question : '',
          options: options,
          correctAnswer: correctAnswer,
          explanation: q && q.explanation ? q.explanation : ''
        };
      })
    };
  } else if (type === 'slide') {
    const slidesFromContent = Array.isArray(item.content && item.content.slides) ? item.content.slides : [];

    normalizedContent = {
      slides: slidesFromContent
    };
  } else {
    const contentInteractiveQuizzes = Array.isArray(item.content && item.content.interactiveQuizzes)
      ? item.content.interactiveQuizzes
      : [];
    const rootInteractiveQuizzes = Array.isArray(item.interactiveQuizzes)
      ? item.interactiveQuizzes
      : [];
    const interactiveQuizzes = (contentInteractiveQuizzes.length ? contentInteractiveQuizzes : rootInteractiveQuizzes)
      .map((entry, index) => {
        const rawOptions = Array.isArray(entry && entry.options) ? entry.options : [];
        const options = rawOptions.map((opt) => String(opt || '').trim()).slice(0, 4);
        while (options.length < 4) options.push('');

        const triggerTimeSec = Number(entry && entry.triggerTimeSec);
        const correctOptionIndex = Number(entry && entry.correctOptionIndex);

        return {
          _id: entry && entry._id,
          triggerTimeSec: Number.isFinite(triggerTimeSec) && triggerTimeSec >= 0 ? triggerTimeSec : 0,
          question: String(entry && entry.question || '').trim(),
          options,
          correctOptionIndex: Number.isFinite(correctOptionIndex) && correctOptionIndex >= 0 && correctOptionIndex <= 3 ? correctOptionIndex : 0,
          explanation: String(entry && entry.explanation || '').trim(),
          pauseOnShow: entry && entry.pauseOnShow === false ? false : true,
          order: Number.isFinite(Number(entry && entry.order)) ? Number(entry.order) : index
        };
      })
      .filter((entry) => entry.question)
      .sort((a, b) => {
        const byTime = a.triggerTimeSec - b.triggerTimeSec;
        if (byTime !== 0) return byTime;
        return a.order - b.order;
      })
      .map((entry, index) => ({ ...entry, order: index }));

    normalizedContent = {
      videoUrl: item.preview || item.videoUrl || '',
      interactiveQuizzes
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

module.exports.createCourse = async (req, res) => {
  const course = new Course(sanitizeCourseInput(req.body.course));
  course.images = req.files ? req.files.map(f => ({ url: f.path, filename: f.filename })) : [];
  course.author = req.user._id;

  const driveLink = String(course.driveLink || '');
  const match = driveLink.match(/\/folders\/([a-zA-Z0-9_-]+)/);
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

  let completedVideos = [];
  let gamification = null;
  if (req.user) {
    const progress = await Progress.findOne({ user: req.user._id, course: course._id });
    if (progress?.completedVideos) completedVideos = progress.completedVideos;

    const profileUser = await User.findById(req.user._id);
    if (profileUser) {
      gamification = buildGamificationViewModel(profileUser);
    }
  }

  const notes = await Note.find({ user: req.user?._id, course: course._id });
  const discussionHighlights = await Discussion.find({ course: course._id })
    .populate('author', 'username')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  const normalizedDiscussionHighlights = (discussionHighlights || []).map((entry) => {
    const answersCount = Array.isArray(entry.answers) ? entry.answers.length : 0;
    const score = (Array.isArray(entry.upvoters) ? entry.upvoters.length : 0)
      - (Array.isArray(entry.downvoters) ? entry.downvoters.length : 0);

    return {
      ...entry,
      answersCount,
      score
    };
  });

  const sectionNotes = Array(course.driveStructure.length).fill('');
  notes.forEach(n => {
    sectionNotes[n.sectionIndex] = n.content;
  });

  res.render('courses/show', {
    course,
    completedVideos,
    sectionNotes,
    hasCourseUpdate: updateStatus.hadUpdate,
    gamification,
    discussionHighlights: normalizedDiscussionHighlights
  });
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
  const course = await Course.findByIdAndUpdate(req.params.id, sanitizeCourseInput(req.body.course), { new: true, runValidators: true });
  if (!course) {
    req.flash('error', 'Cannot find that course!');
    return res.redirect('/courses');
  }

  const imgs = Array.isArray(req.files) ? req.files.map(f => ({ url: f.path, filename: f.filename })) : [];
  if (imgs.length) {
    course.images.push(...imgs);
  }
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
    const { video, completed, lessonId } = req.body;
    const userId = req.user._id;

    const hasLessonId = !!lessonId;
    const hasVideo = typeof video === 'string' && video.length > 0;
    if (!hasVideo && !hasLessonId) throw new Error('Thiếu hoặc sai định dạng video URL');

    const videoLink = hasVideo ? video.split('?')[0] : '';
    const courseObjectId = new mongoose.Types.ObjectId(courseId);

    if (hasVideo) {
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
    }

    if (lessonId) {
      const progressDoc = await UserCourseProgress.findOneAndUpdate(
        { user: userId, course: courseObjectId },
        { $setOnInsert: { user: userId, course: courseObjectId } },
        { new: true, upsert: true }
      );

      const lessonKey = String(lessonId);
      const hasLesson = progressDoc.completedLessons.includes(lessonKey);

      let lessonJustCompleted = false;
      if (completed === true || completed === 'true') {
        if (!hasLesson) progressDoc.completedLessons.push(lessonKey);
        lessonJustCompleted = !hasLesson;
      } else if (hasLesson) {
        progressDoc.completedLessons = progressDoc.completedLessons.filter((id) => id !== lessonKey);
      }

      if (progressDoc.lessonViews && typeof progressDoc.lessonViews.get === 'function') {
        const current = Number(progressDoc.lessonViews.get(lessonKey) || 0);
        progressDoc.lessonViews.set(lessonKey, current + 1);
      } else {
        progressDoc.lessonViews = progressDoc.lessonViews || {};
        const current = Number(progressDoc.lessonViews[lessonKey] || 0);
        progressDoc.lessonViews[lessonKey] = current + 1;
      }

      progressDoc.lastAccessed = new Date();

      const watchDelta = Number(req.body.watchTime);
      if (Number.isFinite(watchDelta) && watchDelta > 0) {
        progressDoc.watchTime = Number(progressDoc.watchTime || 0) + watchDelta;
      }

      const course = await Course.findById(courseObjectId).select('driveStructure');
      const totalLessons = countCourseLessons(course);
      progressDoc.completionRate = totalLessons
        ? Math.round((progressDoc.completedLessons.length / totalLessons) * 100)
        : 0;

      await progressDoc.save();

      if (lessonJustCompleted) {
        const user = await User.findById(userId);
        if (user) {
          await awardGamification(user, { action: 'lessonComplete' });

          if (progressDoc.completionRate === 100) {
            await awardGamification(user, { action: 'courseComplete' });
          }
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[❌ Lỗi khi lưu progress]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.saveQuizResult = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { quizId, score, total } = req.body;
    const userId = req.user._id;

    if (!quizId) {
      return res.status(400).json({ success: false, error: 'Missing quizId' });
    }

    const courseObjectId = new mongoose.Types.ObjectId(courseId);
    const progressDoc = await UserCourseProgress.findOneAndUpdate(
      { user: userId, course: courseObjectId },
      { $setOnInsert: { user: userId, course: courseObjectId } },
      { new: true, upsert: true }
    );

    const quizKey = String(quizId);
    const nextScore = Number(score) || 0;
    const nextTotal = Number(total) || 0;
    const existingIndex = progressDoc.quizResults.findIndex((entry) => String(entry.quizId) === quizKey);

    if (existingIndex >= 0) {
      progressDoc.quizResults[existingIndex].score = nextScore;
      progressDoc.quizResults[existingIndex].total = nextTotal;
    } else {
      progressDoc.quizResults.push({ quizId: quizKey, score: nextScore, total: nextTotal });
    }

    progressDoc.lastAccessed = new Date();

    await progressDoc.save();

    res.json({ success: true });
  } catch (err) {
    console.error('[Quiz Result Save Error]', err);
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

module.exports.createReview = async (req, res) => {
  try {
    const courseId = req.params.id;
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || '').trim();

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Invalid rating' });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    course.reviewEntries = Array.isArray(course.reviewEntries) ? course.reviewEntries : [];
    course.reviewEntries.push({
      user: req.user && req.user._id,
      rating: rating,
      comment: comment
    });

    await course.save();
    res.json({ success: true });
  } catch (err) {
    console.error('[Review Create Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports.getReviews = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('reviewEntries.user', 'username');

    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    const reviews = Array.isArray(course.reviewEntries) ? course.reviewEntries : [];
    const total = reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0);
    const avg = reviews.length ? total / reviews.length : 0;

    res.json({
      success: true,
      reviews: reviews.map((r) => ({
        user: r.user && r.user.username ? r.user.username : '',
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt
      })),
      averageRating: avg,
      reviewCount: reviews.length
    });
  } catch (err) {
    console.error('[Review Fetch Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

