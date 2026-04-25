const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin, requireCourseAccess, requireCourseManagement } = require('../middleware');
const catchAsync = require('../utils/catchAsync');
const course = require('../controllers/courses');
const multer = require('multer');
const { storage, imageFileFilter, MAX_IMAGE_UPLOAD_BYTES } = require('../config/cloudinary');
const { uploadLimiter } = require('../utils/rateLimiters');
const { aiChatLimiter } = require('../utils/rateLimiters');
const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
    files: 6
  }
});

router
  .route('/')
  .get(isLoggedIn, catchAsync(course.index))
  .post(isLoggedIn, isAdmin, uploadLimiter, upload.array('image'), catchAsync(course.createCourse));


router.get('/new', isLoggedIn, isAdmin, course.renderNewForm);

router
  .route('/:id')
  .get(isLoggedIn, requireCourseAccess, catchAsync(course.showCourses))
  .put(isLoggedIn, requireCourseManagement, uploadLimiter, upload.array('image'), catchAsync(course.updateCourse))
  .delete(isLoggedIn, requireCourseManagement, catchAsync(course.deleteCourse));

router.get('/:id/edit', isLoggedIn, requireCourseManagement, catchAsync(course.renderEditForm));

router.post('/:courseId/progress', isLoggedIn, requireCourseAccess, catchAsync(course.updateProgress));
router.post('/:courseId/notes', isLoggedIn, requireCourseAccess, catchAsync(course.saveNote));
router.post('/:courseId/quiz-results', isLoggedIn, requireCourseAccess, catchAsync(course.saveQuizResult));
router.post('/:courseId/lessons/ai', isLoggedIn, requireCourseAccess, aiChatLimiter, catchAsync(course.askLessonAi));
router.post('/:id/review', isLoggedIn, requireCourseAccess, catchAsync(course.createReview));
router.get('/:id/reviews', isLoggedIn, requireCourseAccess, catchAsync(course.getReviews));

module.exports = router;
