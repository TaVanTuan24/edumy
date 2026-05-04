const Joi = require('joi');
const { wantsJson } = require('../utils/requestHelpers');

/**
 * Generic Joi validation middleware factory.
 * @param {Joi.ObjectSchema} schema - Joi schema to validate against
 * @param {'body'|'query'|'params'} source - which part of the request to validate
 * @returns Express middleware
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      convert: true
    });

    if (!error) {
      req[source] = value;
      return next();
    }

    const messages = error.details.map((detail) => detail.message);
    const firstMessage = messages[0] || 'Invalid request data.';

    // Support both JSON API and HTML form responses
    if (wantsJson(req)) {
      return res.status(400).json({
        success: false,
        error: firstMessage,
        errors: messages
      });
    }

    req.flash('error', firstMessage);
    const backUrl = req.get('Referrer') || '/';
    return res.redirect(backUrl);
  };
}

// ===================== SCHEMAS =====================

const registerSchema = Joi.object({
  email: Joi.string().email().trim().lowercase().required().max(255)
    .messages({ 'string.email': 'Please provide a valid email address.' }),
  username: Joi.string().trim().min(2).max(50).required()
    .messages({ 'string.min': 'Username must be at least 2 characters.' }),
  password: Joi.string().min(6).max(128).required()
    .messages({ 'string.min': 'Password must be at least 6 characters.' })
});

const loginSchema = Joi.object({
  username: Joi.string().trim().min(1).max(255).required(),
  password: Joi.string().required().max(128)
});

const courseCreateSchema = Joi.object({
  course: Joi.object({
    title: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().trim().max(5000).allow('', null).optional(),
    driveLink: Joi.string().trim().max(500).allow('', null).optional(),
    topic: Joi.string().valid('Software', 'Hardware', 'AI', 'Network', 'Language', 'Security', 'Other').required(),
    sections: Joi.array().items(Joi.object()).optional(),
    sectionsJson: Joi.string().max(100000).allow('', null).optional(),
    importSource: Joi.string().valid('drive', 'youtube').optional(),
    imageUrl: Joi.string().trim().max(500).allow('', null).optional(),
    thumbnailMode: Joi.string().valid('upload', 'url').optional()
  }).required().options({ allowUnknown: true })
});

const courseUpdateSchema = Joi.object({
  course: Joi.object({
    title: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().trim().max(5000).allow('', null).optional(),
    driveLink: Joi.string().trim().max(500).allow('', null).optional(),
    topic: Joi.string().valid('Software', 'Hardware', 'AI', 'Network', 'Language', 'Security', 'Other').required(),
    sections: Joi.array().items(Joi.object()).optional(),
    sectionsJson: Joi.string().max(100000).allow('', null).optional(),
    imageUrl: Joi.string().trim().max(500).allow('', null).optional(),
    thumbnailMode: Joi.string().valid('upload', 'url').optional()
  }).required().options({ allowUnknown: true })
});

const noteSchema = Joi.object({
  sectionIndex: Joi.number().integer().min(0).required(),
  content: Joi.string().max(10000).allow('').required()
});

const aiChatMessageSchema = Joi.object({
  message: Joi.string().trim().min(1).max(10000).required(),
  model: Joi.string().trim().max(50).optional(),
  chatId: Joi.string().trim().max(50).allow('', null).optional(),
  courseId: Joi.string().trim().max(50).allow('', null).optional(),
  question: Joi.string().trim().max(10000).allow('', null).optional(),
  lessonId: Joi.string().trim().max(50).allow('', null).optional(),
  context: Joi.object().allow(null).optional()
});

const aiQuizGenerateSchema = Joi.object({
  prompt: Joi.string().trim().min(1).max(1000).required(),
  difficulty: Joi.string().valid('easy', 'medium', 'hard').optional(),
  count: Joi.number().integer().min(1).max(10).optional()
});

const aiSlideGenerateSchema = Joi.object({
  prompt: Joi.string().trim().min(1).max(1000).required(),
  style: Joi.string().valid('professional', 'minimal', 'modern', 'dark').optional(),
  count: Joi.number().integer().min(3).max(8).optional(),
  language: Joi.string().trim().max(50).optional()
});

const progressUpdateSchema = Joi.object({
  video: Joi.string().trim().max(500).allow('', null).optional(),
  completed: Joi.boolean().optional(),
  lessonId: Joi.string().trim().max(100).allow('', null).optional(),
  lessonName: Joi.string().trim().max(200).allow('', null).optional(),
  lessonType: Joi.string().trim().max(50).allow('', null).optional(),
  sectionIndex: Joi.number().integer().min(0).allow(null).optional(),
  lessonIndex: Joi.number().integer().min(0).allow(null).optional(),
  watchTime: Joi.number().min(0).optional()
});

const quizResultSchema = Joi.object({
  quizId: Joi.string().trim().max(100).required(),
  score: Joi.number().min(0).required(),
  total: Joi.number().min(0).required(),
  lessonName: Joi.string().trim().max(200).allow('', null).optional(),
  lessonType: Joi.string().trim().max(50).allow('', null).optional(),
  sectionIndex: Joi.number().integer().min(0).allow(null).optional(),
  lessonIndex: Joi.number().integer().min(0).allow(null).optional()
});

const reviewCreateSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().trim().max(2000).allow('', null).optional()
});

module.exports = {
  validate,
  registerSchema,
  loginSchema,
  courseCreateSchema,
  courseUpdateSchema,
  noteSchema,
  aiChatMessageSchema,
  aiQuizGenerateSchema,
  aiSlideGenerateSchema,
  progressUpdateSchema,
  quizResultSchema,
  reviewCreateSchema
};