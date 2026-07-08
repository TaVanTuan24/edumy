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

// Every course route requires an authenticated user.
router.use(isLoggedIn);

router
  .route('/')
  .get(catchAsync(course.index))
  .post(isAdmin, uploadLimiter, upload.array('image'), validate(courseCreateSchema), catchAsync(course.createCourse));


router.get('/new', isAdmin, course.renderNewForm);

router
  .route('/:id')
  .get(requireCourseAccess, catchAsync(course.showCourses))
  .put(requireCourseManagement, uploadLimiter, upload.array('image'), validate(courseUpdateSchema), catchAsync(course.updateCourse))
  .delete(requireCourseManagement, catchAsync(course.deleteCourse));

router.get('/:id/edit', requireCourseManagement, catchAsync(course.renderEditForm));

router.post('/:courseId/progress', requireCourseAccess, validate(progressUpdateSchema), catchAsync(course.updateProgress));
router.post('/:courseId/notes', requireCourseAccess, validate(noteSchema), catchAsync(course.saveNote));
router.post('/:courseId/quiz-results', requireCourseAccess, validate(quizResultSchema), catchAsync(course.saveQuizResult));
router.post('/:courseId/lessons/ai', requireCourseAccess, aiChatLimiter, catchAsync(course.askLessonAi));
router.post('/:id/ai-summary/regenerate', requireCourseManagement, aiChatLimiter, catchAsync(course.regenerateAiSummary));
router.post('/:id/review', requireCourseAccess, validate(reviewCreateSchema), catchAsync(course.createReview));
router.put('/:id/review', requireCourseAccess, validate(reviewCreateSchema), catchAsync(course.updateReview));
router.delete('/:id/review', requireCourseAccess, catchAsync(course.deleteReview));
router.get('/:id/reviews', requireCourseAccess, catchAsync(course.getReviews));

module.exports = router;
