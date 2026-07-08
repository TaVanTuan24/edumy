const Discussion = require('../models/discussion');
const Course = require('../models/course');
const { syncCourseContent } = require('../utils/courseContentAdapter');

function normalizeTags(input) {
  const source = Array.isArray(input) ? input.join(',') : String(input || '');
  return source
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

function toLeanScore(entry) {
  const up = Array.isArray(entry.upvoters) ? entry.upvoters.length : 0;
  const down = Array.isArray(entry.downvoters) ? entry.downvoters.length : 0;
  return up - down;
}

function getUserVote(entry, userId) {
  if (!userId) return 'none';
  const userIdStr = String(userId);
  const up = Array.isArray(entry && entry.upvoters) ? entry.upvoters.map((id) => String(id)) : [];
  const down = Array.isArray(entry && entry.downvoters) ? entry.downvoters.map((id) => String(id)) : [];
  if (up.includes(userIdStr)) return 'up';
  if (down.includes(userIdStr)) return 'down';
  return 'none';
}

function sortAnswers(answers, sortBy) {
  const source = Array.isArray(answers) ? answers.slice() : [];
  if (sortBy === 'newest') {
    source.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else {
    source.sort((a, b) => {
      if (Boolean(b.isAccepted) !== Boolean(a.isAccepted)) {
        return b.isAccepted ? -1 : 1;
      }
      const scoreDiff = toLeanScore(b) - toLeanScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }
  return source;
}

module.exports.listQuestions = async (req, res) => {
  const { courseId } = req.params;
  const { lessonId = '', tag = '', sort = 'best', format = 'html' } = req.query;

  const filter = { course: courseId };
  if (lessonId) filter.lessonId = String(lessonId);
  if (tag) filter.tags = String(tag).toLowerCase();

  const docs = await Discussion.find(filter)
    .populate('author', 'username')
    .sort({ createdAt: -1 })
    .lean();

  const questions = docs
    .map((entry) => ({
      ...entry,
      score: toLeanScore(entry),
      answersCount: Array.isArray(entry.answers) ? entry.answers.length : 0
    }))
    .sort((a, b) => {
      if (sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
      const voteDiff = b.score - a.score;
      if (voteDiff !== 0) return voteDiff;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

  if (format === 'json') {
    return res.json({ success: true, questions });
  }

  const course = await Course.findById(courseId).select('title');
  res.render('discussions/index', {
    course,
    questions,
    query: { lessonId, tag, sort }
  });
};

module.exports.renderAskForm = async (req, res) => {
  const { courseId } = req.params;
  const lessonId = String(req.query.lessonId || '');
  const course = await Course.findById(courseId).select('title sections');
  syncCourseContent(course);

  res.render('discussions/new', { course, lessonId });
};

module.exports.createQuestion = async (req, res) => {
  const { courseId } = req.params;
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const lessonId = String(req.body.lessonId || '').trim();
  const tags = normalizeTags(req.body.tags);

  if (!title || !body) {
    req.flash('error', 'Title and body are required.');
    return res.redirect(`/courses/${courseId}/discussions/new`);
  }

  const discussion = await Discussion.create({
    course: courseId,
    lessonId,
    title,
    body,
    tags,
    author: req.user._id
  });

  req.flash('success', 'Question posted successfully.');
  res.redirect(`/courses/${courseId}/discussions/${discussion._id}`);
};

module.exports.showQuestion = async (req, res) => {
  const { courseId, discussionId } = req.params;
  const { sortAnswersBy = 'best', format = 'html' } = req.query;
  const currentUserId = req.user && req.user._id;

  const discussion = await Discussion.findOne({ _id: discussionId, course: courseId })
    .populate('author', 'username')
    .populate('answers.author', 'username')
    .lean();

  if (!discussion) {
    return res.status(404).render('error', { err: { statusCode: 404, message: 'Question not found' } });
  }

  const prepared = {
    ...discussion,
    score: toLeanScore(discussion),
    userVote: getUserVote(discussion, currentUserId),
    answers: sortAnswers(discussion.answers || [], sortAnswersBy).map((answer) => ({
      ...answer,
      score: toLeanScore(answer),
      userVote: getUserVote(answer, currentUserId)
    }))
  };

  if (format === 'json') {
    return res.json({ success: true, discussion: prepared });
  }

  const course = await Course.findById(courseId).select('title');

  res.render('discussions/show', {
    course,
    discussion: prepared,
    sortAnswersBy
  });
};

module.exports.postAnswer = async (req, res) => {
  const { courseId, discussionId } = req.params;
  const isJsonRequest =
    req.xhr ||
    req.is('application/json') ||
    (req.headers.accept && req.headers.accept.includes('application/json'));
  const body = String((req.body && req.body.body) || '').trim();

  if (!body) {
    if (isJsonRequest) {
      return res.status(400).json({ success: false, error: 'Answer cannot be empty.' });
    }
    req.flash('error', 'Answer cannot be empty.');
    return res.redirect(`/courses/${courseId}/discussions/${discussionId}`);
  }

  const discussion = await Discussion.findOne({ _id: discussionId, course: courseId });
  if (!discussion) {
    return res.status(404).json({ success: false, error: 'Question not found' });
  }

  discussion.answers.push({
    author: req.user._id,
    body
  });

  await discussion.save();

  if (isJsonRequest) {
    return res.json({ success: true });
  }

  req.flash('success', 'Answer posted.');
  res.redirect(`/courses/${courseId}/discussions/${discussionId}`);
};

module.exports.voteQuestion = async (req, res) => {
  const { courseId, discussionId } = req.params;
  const type = String(req.body.type || '').toLowerCase();
  const userId = String(req.user._id);

  if (!['up', 'down'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Invalid vote type' });
  }

  const discussion = await Discussion.findOne({ _id: discussionId, course: courseId });
  if (!discussion) {
    return res.status(404).json({ success: false, error: 'Question not found' });
  }

  const up = new Set(discussion.upvoters.map((id) => String(id)));
  const down = new Set(discussion.downvoters.map((id) => String(id)));

  if (type === 'up') {
    if (up.has(userId)) up.delete(userId);
    else {
      up.add(userId);
      down.delete(userId);
    }
  } else {
    if (down.has(userId)) down.delete(userId);
    else {
      down.add(userId);
      up.delete(userId);
    }
  }

  discussion.upvoters = Array.from(up);
  discussion.downvoters = Array.from(down);
  await discussion.save();

  res.json({
    success: true,
    score: discussion.upvoters.length - discussion.downvoters.length,
    currentVote: up.has(userId) ? 'up' : down.has(userId) ? 'down' : 'none'
  });
};

module.exports.voteAnswer = async (req, res) => {
  const { courseId, discussionId, answerId } = req.params;
  const type = String(req.body.type || '').toLowerCase();
  const userId = String(req.user._id);

  if (!['up', 'down'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Invalid vote type' });
  }

  const discussion = await Discussion.findOne({ _id: discussionId, course: courseId });
  if (!discussion) {
    return res.status(404).json({ success: false, error: 'Question not found' });
  }

  const answer = discussion.answers.id(answerId);
  if (!answer) {
    return res.status(404).json({ success: false, error: 'Answer not found' });
  }

  const up = new Set(answer.upvoters.map((id) => String(id)));
  const down = new Set(answer.downvoters.map((id) => String(id)));

  if (type === 'up') {
    if (up.has(userId)) up.delete(userId);
    else {
      up.add(userId);
      down.delete(userId);
    }
  } else {
    if (down.has(userId)) down.delete(userId);
    else {
      down.add(userId);
      up.delete(userId);
    }
  }

  answer.upvoters = Array.from(up);
  answer.downvoters = Array.from(down);

  await discussion.save();

  res.json({
    success: true,
    score: answer.upvoters.length - answer.downvoters.length,
    currentVote: up.has(userId) ? 'up' : down.has(userId) ? 'down' : 'none'
  });
};

module.exports.acceptAnswer = async (req, res) => {
  const { courseId, discussionId, answerId } = req.params;

  const discussion = await Discussion.findOne({ _id: discussionId, course: courseId });
  if (!discussion) {
    return res.status(404).json({ success: false, error: 'Question not found' });
  }

  if (String(discussion.author) !== String(req.user._id)) {
    return res.status(403).json({ success: false, error: 'Only question author can accept an answer' });
  }

  const answer = discussion.answers.id(answerId);
  if (!answer) {
    return res.status(404).json({ success: false, error: 'Answer not found' });
  }

  discussion.answers.forEach((entry) => {
    entry.isAccepted = String(entry._id) === String(answerId);
  });
  discussion.acceptedAnswerId = answerId;

  await discussion.save();

  res.json({ success: true });
};

module.exports.deleteAnswer = async (req, res) => {
  const { courseId, discussionId, answerId } = req.params;
  const isJsonRequest =
    req.xhr ||
    req.is('application/json') ||
    (req.headers.accept && req.headers.accept.includes('application/json'));

  const discussion = await Discussion.findOne({ _id: discussionId, course: courseId });
  if (!discussion) {
    return res.status(404).json({ success: false, error: 'Question not found' });
  }

  const answer = discussion.answers.id(answerId);
  if (!answer) {
    return res.status(404).json({ success: false, error: 'Answer not found' });
  }

  if (String(answer.author) !== String(req.user._id)) {
    return res.status(403).json({ success: false, error: 'Only the answer author can delete this answer' });
  }

  answer.deleteOne();

  if (discussion.acceptedAnswerId && String(discussion.acceptedAnswerId) === String(answerId)) {
    discussion.acceptedAnswerId = null;
  }

  await discussion.save();

  if (isJsonRequest) {
    return res.json({ success: true, deletedAnswerId: String(answerId) });
  }

  req.flash('success', 'Answer deleted.');
  return res.redirect(`/courses/${courseId}/discussions/${discussionId}`);
};

