const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin, requireCourseAccess, requireCourseManagement } = require('../middleware');
const catchAsync = require('../utils/catchAsync');
const course = require('../controllers/courses');
const multer = require('multer');
const { storage, imageFileFilter, MAX_IMAGE_UPLOAD_BYTES } = require('../config/cloudinary');
const { uploadLimiter } = require('../utils/rateLimiters');
const { aiChatLimiter } = require('../utils/rateLimiters');
const { validate, courseCreateSchema, courseUpdateSchema, noteSchema, progressUpdateSchema, quizResultSchema, reviewCreateSchema } = require('../middleware/validate');
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
  .post(isLoggedIn, isAdmin, uploadLimiter, upload.array('image'), validate(courseCreateSchema), catchAsync(course.createCourse));


router.get('/new', isLoggedIn, isAdmin, course.renderNewForm);

router
  .route('/:id')
  .get(isLoggedIn, requireCourseAccess, catchAsync(course.showCourses))
  .put(isLoggedIn, requireCourseManagement, uploadLimiter, upload.array('image'), validate(courseUpdateSchema), catchAsync(course.updateCourse))
  .delete(isLoggedIn, requireCourseManagement, catchAsync(course.deleteCourse));

router.get('/:id/edit', isLoggedIn, requireCourseManagement, catchAsync(course.renderEditForm));

router.post('/:courseId/progress', isLoggedIn, requireCourseAccess, validate(progressUpdateSchema), catchAsync(course.updateProgress));
router.post('/:courseId/notes', isLoggedIn, requireCourseAccess, validate(noteSchema), catchAsync(course.saveNote));
router.post('/:courseId/quiz-results', isLoggedIn, requireCourseAccess, validate(quizResultSchema), catchAsync(course.saveQuizResult));
router.post('/:courseId/lessons/ai', isLoggedIn, requireCourseAccess, aiChatLimiter, catchAsync(course.askLessonAi));
router.post('/:id/ai-summary/regenerate', isLoggedIn, requireCourseManagement, aiChatLimiter, catchAsync(course.regenerateAiSummary));
router.post('/:id/review', isLoggedIn, requireCourseAccess, validate(reviewCreateSchema), catchAsync(course.createReview));
router.put('/:id/review', isLoggedIn, requireCourseAccess, validate(reviewCreateSchema), catchAsync(course.updateReview));
router.delete('/:id/review', isLoggedIn, requireCourseAccess, catchAsync(course.deleteReview));
router.get('/:id/reviews', isLoggedIn, requireCourseAccess, catchAsync(course.getReviews));

module.exports = router;
