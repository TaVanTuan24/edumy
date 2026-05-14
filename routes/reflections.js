'use strict';

const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin, requireCourseAccess } = require('../middleware');
const catchAsync = require('../utils/catchAsync');
const { adminActionLimiter } = require('../utils/rateLimiters');
const reflectionsController = require('../controllers/reflections');

// ==================== Admin routes ====================
// All admin routes require login + admin role

// Get reflection config for a lesson
router.get(
  '/:id/lessons/:sectionIndex/:lessonIndex/reflection',
  isLoggedIn,
  isAdmin,
  catchAsync(reflectionsController.getReflectionConfig)
);

// Save reflection config for a lesson
router.put(
  '/:id/lessons/:sectionIndex/:lessonIndex/reflection',
  isLoggedIn,
  isAdmin,
  adminActionLimiter,
  catchAsync(reflectionsController.saveReflectionConfig)
);

// Generate AI reflection suggestions
router.post(
  '/:id/lessons/:sectionIndex/:lessonIndex/reflection/generate-ai',
  isLoggedIn,
  isAdmin,
  adminActionLimiter,
  catchAsync(reflectionsController.generateAiSuggestions)
);

// Get all reflection submissions for a lesson
router.get(
  '/:courseId/lessons/:sectionIndex/:lessonIndex/reflection/submissions',
  isLoggedIn,
  isAdmin,
  catchAsync(reflectionsController.getSubmissions)
);

// Generate AI summary of reflection submissions
router.post(
  '/:courseId/lessons/:sectionIndex/:lessonIndex/reflection/ai-summary',
  isLoggedIn,
  isAdmin,
  adminActionLimiter,
  catchAsync(reflectionsController.generateAiSummary)
);

// ==================== Learner routes ====================
// Learner must be logged in and have course access

// Get reflection for a lesson (learner view)
router.get(
  '/:courseId/lessons/:sectionIndex/:lessonIndex/reflection/view',
  isLoggedIn,
  catchAsync(reflectionsController.getLessonReflection)
);

// Submit reflection
router.post(
  '/:courseId/lessons/:sectionIndex/:lessonIndex/reflection/submit',
  isLoggedIn,
  catchAsync(reflectionsController.submitReflection)
);

// Error handler for reflection routes
router.use((err, req, res, next) => {
  const statusCode = Number(err && err.statusCode) || 500;
  const message = String(
    (err && err.message)
    || 'Something went wrong'
  );

  if (res.headersSent) {
    return next(err);
  }

  console.error('[Reflections API Error]', {
    path: req.originalUrl,
    method: req.method,
    statusCode,
    message
  });

  return res.status(statusCode).json({
    success: false,
    error: message
  });
});

module.exports = router;