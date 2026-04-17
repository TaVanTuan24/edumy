const express = require('express');
const router = express.Router({ mergeParams: true });
const catchAsync = require('../utils/catchAsync');
const { isLoggedIn, requireCourseAccess } = require('../middleware');
const discussions = require('../controllers/discussions');

router.use(isLoggedIn, requireCourseAccess);

router.get('/', catchAsync(discussions.listQuestions));
router.get('/new', catchAsync(discussions.renderAskForm));
router.post('/', catchAsync(discussions.createQuestion));

router.get('/api/questions', (req, res, next) => {
	req.query.format = 'json';
	next();
}, catchAsync(discussions.listQuestions));
router.get('/:discussionId', catchAsync(discussions.showQuestion));
router.get('/api/questions/:discussionId', (req, res, next) => {
	req.query.format = 'json';
	next();
}, catchAsync(discussions.showQuestion));

router.post('/:discussionId/answers', catchAsync(discussions.postAnswer));
router.delete('/:discussionId/answers/:answerId', catchAsync(discussions.deleteAnswer));
router.post('/:discussionId/vote', catchAsync(discussions.voteQuestion));
router.post('/:discussionId/answers/:answerId/vote', catchAsync(discussions.voteAnswer));
router.post('/:discussionId/answers/:answerId/accept', catchAsync(discussions.acceptAnswer));
router.post('/:discussionId/ai-answer', catchAsync(discussions.generateAiAnswer));

module.exports = router;
