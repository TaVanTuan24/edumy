const express = require('express');
const router = express.Router();
const { isLoggedIn, requireCourseAccess, requireCourseManagement } = require('../middleware');
const catchAsync = require('../utils/catchAsync');
const course = require('../controllers/courses');
const multer = require('multer');
const { storage } = require('../config/cloudinary');
const upload = multer({ storage });

router
  .route('/')
  .get(isLoggedIn, catchAsync(course.index))
  .post(isLoggedIn, upload.array('image'), catchAsync(course.createCourse));


router.get('/new', isLoggedIn, course.renderNewForm);

router
  .route('/:id')
  .get(isLoggedIn, requireCourseAccess, catchAsync(course.showCourses))
  .put(isLoggedIn, requireCourseManagement, upload.array('image'), catchAsync(course.updateCourse))
  .delete(isLoggedIn, requireCourseManagement, catchAsync(course.deleteCourse));

router.get('/:id/edit', isLoggedIn, requireCourseManagement, catchAsync(course.renderEditForm));

router.post('/:courseId/progress', isLoggedIn, requireCourseAccess, catchAsync(course.updateProgress));
router.post('/:courseId/notes', isLoggedIn, requireCourseAccess, catchAsync(course.saveNote));
router.post('/:courseId/quiz-results', isLoggedIn, requireCourseAccess, catchAsync(course.saveQuizResult));
router.post('/:id/review', isLoggedIn, requireCourseAccess, catchAsync(course.createReview));
router.get('/:id/reviews', isLoggedIn, requireCourseAccess, catchAsync(course.getReviews));

module.exports = router;
