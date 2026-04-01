const Discussion = require('../models/discussion');
const Course = require('../models/course');
const ollama = require('../config/ollama');

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

function getLessonDocs(course) {
  const docs = [];
  const sections = Array.isArray(course && course.driveStructure) ? course.driveStructure : [];

  sections.forEach((section) => {
    const sectionName = String(section && section.section || '');
    const lessons = Array.isArray(section && section.videos) ? section.videos : [];

    lessons.forEach((lesson) => {
      const lessonId = String(lesson && lesson._id || '');
      const title = String(lesson && (lesson.title || lesson.name) || '');
      const type = String(lesson && lesson.type || 'video');

      const chunks = [title, sectionName, type];

      if (type === 'slide') {
        const slides = Array.isArray(lesson && lesson.content && lesson.content.slides) ? lesson.content.slides : [];
        slides.forEach((slide) => {
          const elements = Array.isArray(slide && slide.elements) ? slide.elements : [];
          elements.forEach((el) => {
            if (el && el.type === 'text' && el.text) {
              chunks.push(String(el.text));
            }
          });
        });
      }

      if (type === 'quiz') {
        const questions = Array.isArray(lesson && lesson.content && lesson.content.questions)
          ? lesson.content.questions
          : Array.isArray(lesson && lesson.questions)
            ? lesson.questions
            : [];

        questions.forEach((q) => {
          if (q && q.question) chunks.push(String(q.question));
          const options = Array.isArray(q && q.options) ? q.options : [];
          options.forEach((opt) => chunks.push(String(opt && (opt.text || opt) || '')));
        });
      }

      if (type === 'video') {
        if (lesson && lesson.description) chunks.push(String(lesson.description));
      }

      const content = chunks.join('\n').trim();
      if (content) {
        docs.push({ lessonId, content });
      }
    });
  });

  return docs;
}

function getRelevantContext(docs, question, lessonId) {
  const query = String(question || '').toLowerCase();
  const lessonScoped = lessonId ? docs.filter((d) => d.lessonId === lessonId) : [];
  const source = lessonScoped.length ? lessonScoped : docs;
  const scored = source
    .map((entry) => {
      const text = String(entry.content || '').toLowerCase();
      let score = 0;
      query.split(/\s+/).forEach((token) => {
        if (token && text.includes(token)) score += 1;
      });
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.entry.content);

  return scored;
}

async function generateContextualAnswer(course, discussion, lessonId) {
  const docs = getLessonDocs(course);
  const relevant = getRelevantContext(docs, discussion.title + ' ' + discussion.body, lessonId);

  const prompt = [
    'You are a senior learning assistant.',
    'Answer based ONLY on the course context below.',
    'If context is not sufficient, clearly state what is missing.',
    'Keep answer practical, structured, and helpful.',
    '',
    'Question Title:',
    discussion.title,
    '',
    'Question Body:',
    discussion.body,
    '',
    'Course Context:',
    relevant.join('\n---\n') || 'No matching context found.',
    '',
    'Return answer in markdown format.'
  ].join('\n');

  const response = await ollama.post('/api/generate', {
    model: 'llama3.2',
    prompt,
    stream: false,
    options: {
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 1400
    }
  });

  return String(response && response.data && response.data.response || '').trim();
}

module.exports.listQuestions = async (req, res) => {
  const { courseId } = req.params;
  const { lessonId = '', tag = '', sort = 'best', format = 'html' } = req.query;

  const filter = { course: courseId };
  if (lessonId) filter.lessonId = String(lessonId);
  if (tag) filter.tags = String(tag).toLowerCase();

  const docs = await Discussion.find(filter)
    .populate('author', 'username')
    .sort(sort === 'newest' ? { createdAt: -1 } : { createdAt: -1 })
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
  const course = await Course.findById(courseId).select('title driveStructure');

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

module.exports.generateAiAnswer = async (req, res) => {
  try {
    const { courseId, discussionId } = req.params;

    const discussion = await Discussion.findOne({ _id: discussionId, course: courseId }).lean();
    if (!discussion) {
      return res.status(404).json({ success: false, error: 'Question not found' });
    }

    const course = await Course.findById(courseId).select('title driveStructure').lean();
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    const aiAnswer = await generateContextualAnswer(course, discussion, discussion.lessonId);

    res.json({
      success: true,
      answer: aiAnswer || 'I could not find enough context in this course to answer confidently.'
    });
  } catch (error) {
    console.error('[Discussion AI Answer Error]', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to generate AI answer'
    });
  }
};
