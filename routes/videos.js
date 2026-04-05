const express = require('express');
const router = express.Router();

const { isLoggedIn, isAdmin } = require('../middleware');
const catchAsync = require('../utils/catchAsync');
const transcriptController = require('../controllers/transcript');

router.post('/:videoId/transcript', isLoggedIn, isAdmin, catchAsync(transcriptController.fetchAndSaveTranscript));
router.post('/:videoId/ai-quiz', isLoggedIn, isAdmin, catchAsync(transcriptController.aiGenerateQuiz));

router.use((err, req, res, next) => {
	const statusCode = Number(err && err.statusCode) || 500;
	const message = String(
		(err && err.message)
		|| (err && err.response && err.response.data && (err.response.data.message || err.response.data.error))
		|| (err && err.code)
		|| 'Something went wrong'
	);

	if (res.headersSent) {
		return next(err);
	}

	console.error('[Videos API Error]', {
		path: req.originalUrl,
		method: req.method,
		statusCode,
		message
	});

	return res.status(statusCode).json({
		success: false,
		message
	});
});

module.exports = router;
