const express = require('express');
const router = express.Router({ mergeParams: true });
const catchAsync = require('../utils/catchAsync');
const { isLoggedIn } = require('../middleware');
const discussions = require('../controllers/discussions');

router.get('/', isLoggedIn, catchAsync(discussions.listQuestions));
router.get('/new', isLoggedIn, catchAsync(discussions.renderAskForm));
router.post('/', isLoggedIn, catchAsync(discussions.createQuestion));

router.get('/api/questions', isLoggedIn, (req, res, next) => {
	req.query.format = 'json';
	next();
}, catchAsync(discussions.listQuestions));
router.get('/:discussionId', isLoggedIn, catchAsync(discussions.showQuestion));
router.get('/api/questions/:discussionId', isLoggedIn, (req, res, next) => {
	req.query.format = 'json';
	next();
}, catchAsync(discussions.showQuestion));

router.post('/:discussionId/answers', isLoggedIn, catchAsync(discussions.postAnswer));
router.delete('/:discussionId/answers/:answerId', isLoggedIn, catchAsync(discussions.deleteAnswer));
router.post('/:discussionId/vote', isLoggedIn, catchAsync(discussions.voteQuestion));
router.post('/:discussionId/answers/:answerId/vote', isLoggedIn, catchAsync(discussions.voteAnswer));
router.post('/:discussionId/answers/:answerId/accept', isLoggedIn, catchAsync(discussions.acceptAnswer));
router.post('/:discussionId/ai-answer', isLoggedIn, catchAsync(discussions.generateAiAnswer));

module.exports = router;
