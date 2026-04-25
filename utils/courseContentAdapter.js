function clonePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function parseDurationValue(rawDuration) {
  if (typeof rawDuration === 'number') {
    return Number.isFinite(rawDuration) && rawDuration > 0 ? Math.floor(rawDuration) : null;
  }

  if (typeof rawDuration !== 'string') return null;

  const normalized = rawDuration.trim();
  if (!normalized) return null;

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    const numericValue = Number(normalized);
    return Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : null;
  }

  if (!/^\d{1,3}:\d{1,2}(:\d{1,2})?$/.test(normalized)) return null;

  const parts = normalized.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) return null;

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (seconds >= 60) return null;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    if (minutes >= 60 || seconds >= 60) return null;
    return (hours * 3600) + (minutes * 60) + seconds;
  }

  return null;
}

function formatDurationValue(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes <= 0) return '1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} hr ${String(minutes).padStart(2, '0')} min`;
}

function normalizeOrder(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLessonType(rawType, lesson) {
  const type = String(rawType || '').trim().toLowerCase();
  if (type === 'lecture') return 'video';
  if (['video', 'slide', 'quiz'].includes(type)) return type;

  if (Array.isArray(lesson && lesson.quiz) && lesson.quiz.length > 0) return 'quiz';
  if (lesson && lesson.content && Array.isArray(lesson.content.questions) && lesson.content.questions.length > 0) return 'quiz';
  if (lesson && lesson.content && Array.isArray(lesson.content.slides) && lesson.content.slides.length > 0) return 'slide';
  if (lesson && lesson.content && lesson.content.pdf && typeof lesson.content.pdf === 'object' && String(lesson.content.pdf.url || '').trim()) return 'slide';

  return 'video';
}

function normalizeInteractiveQuizzes(rawQuizzes) {
  const source = Array.isArray(rawQuizzes) ? rawQuizzes : [];

  return source
    .map((entry, index) => {
      const rawOptions = Array.isArray(entry && entry.options) ? entry.options : [];
      const options = rawOptions.map((opt) => String(opt || '').trim()).slice(0, 4);
      while (options.length < 4) options.push('');

      return {
        ...(entry && entry._id ? { _id: entry._id } : {}),
        triggerTimeSec: Math.max(0, Number(entry && entry.triggerTimeSec) || 0),
        question: String(entry && entry.question || '').trim(),
        options,
        correctOptionIndex: Math.max(0, Math.min(3, Number(entry && entry.correctOptionIndex) || 0)),
        explanation: String(entry && entry.explanation || '').trim(),
        pauseOnShow: entry && entry.pauseOnShow === false ? false : true,
        order: normalizeOrder(entry && entry.order, index)
      };
    })
    .filter((entry) => entry.question || entry.triggerTimeSec || entry.options.some(Boolean))
    .sort((a, b) => {
      const byTime = a.triggerTimeSec - b.triggerTimeSec;
      if (byTime !== 0) return byTime;
      return a.order - b.order;
    })
    .map((entry, index) => ({ ...entry, order: index }));
}

function normalizeQuizQuestions(rawQuestions) {
  const source = Array.isArray(rawQuestions) ? rawQuestions : [];

  return source.map((question) => {
    const rawOptions = Array.isArray(question && question.options) && question.options.length
      ? question.options
      : Array.isArray(question && question.answers) && question.answers.length
        ? question.answers
        : Array.isArray(question && question.choices) && question.choices.length
          ? question.choices
          : [];

    const options = rawOptions.map((opt) => {
      if (typeof opt === 'string') return opt.trim();
      if (opt && typeof opt === 'object') return String(opt.text || opt.answer || opt.value || '').trim();
      return '';
    }).filter(Boolean);

    let correctAnswer = question && question.correctAnswer ? question.correctAnswer : '';
    if (!correctAnswer && rawOptions.length) {
      const correctOption = rawOptions.find((opt) => opt && typeof opt === 'object' && (opt.correct || opt.isCorrect));
      if (correctOption) {
        correctAnswer = String(correctOption.text || correctOption.answer || correctOption.value || '').trim();
      }
    }

    if (!correctAnswer) {
      const numericCorrectIndex = Number(
        question && (
          question.correctIndex
          ?? question.correctOptionIndex
          ?? question.correctAnswerIndex
        )
      );
      if (Number.isInteger(numericCorrectIndex) && numericCorrectIndex >= 0 && numericCorrectIndex < options.length) {
        correctAnswer = options[numericCorrectIndex];
      }
    }

    return {
      ...(question && question._id ? { _id: question._id } : {}),
      question: String(question && question.question || '').trim(),
      options,
      correctAnswer: String(correctAnswer || '').trim()
    };
  }).filter((question) => question.question || question.options.length > 0);
}

function normalizeSlides(rawSlides, fallbackTitle) {
  if (Array.isArray(rawSlides)) return rawSlides;

  const text = typeof rawSlides === 'string' ? rawSlides.trim() : '';
  if (!text) return [];

  return [{
    id: `slide-${Date.now()}`,
    title: fallbackTitle || 'Slide',
    elements: [{
      id: `el-${Date.now()}`,
      type: 'text',
      x: 80,
      y: 80,
      text,
      fontSize: 28,
      color: '#1c1d1f',
      align: 'left',
      bold: false
    }]
  }];
}

function normalizeLessonContent(lesson, fallbackTitle) {
  const contentObject = clonePlainObject(lesson && lesson.content);
  const type = normalizeLessonType(lesson && lesson.type, lesson);
  const quiz = normalizeQuizQuestions(
    Array.isArray(contentObject.questions) ? contentObject.questions : lesson && lesson.quiz
  );
  const interactiveQuizzes = normalizeInteractiveQuizzes(
    Array.isArray(contentObject.interactiveQuizzes) ? contentObject.interactiveQuizzes : lesson && lesson.interactiveQuizzes
  );

  if (type === 'slide') {
    return {
      ...contentObject,
      slides: normalizeSlides(contentObject.slides, fallbackTitle)
    };
  }

  if (type === 'quiz') {
    return {
      ...contentObject,
      questions: quiz
    };
  }

  return {
    ...contentObject,
    videoUrl: String(
      contentObject.videoUrl
      || (lesson && lesson.videoUrl)
      || (lesson && lesson.preview)
      || (lesson && lesson.refId)
      || ''
    ).trim(),
    interactiveQuizzes,
    durationSeconds: parseDurationValue(
      contentObject.durationSeconds != null
        ? contentObject.durationSeconds
        : (lesson && lesson.durationSeconds)
    ),
    durationFormatted: String(contentObject.durationFormatted || (lesson && lesson.durationFormatted) || '').trim(),
    durationSyncPending: Boolean(
      contentObject.durationSyncPending != null
        ? contentObject.durationSyncPending
        : (lesson && lesson.durationSyncPending)
    )
  };
}

function normalizeCanonicalLesson(lesson, lessonIndex) {
  const type = normalizeLessonType(lesson && lesson.type, lesson);
  const title = String(lesson && lesson.title || '').trim() || `Lesson ${lessonIndex + 1}`;
  const content = normalizeLessonContent(lesson, title);
  const durationSeconds = parseDurationValue(
    lesson && lesson.durationSeconds != null
      ? lesson.durationSeconds
      : (
        lesson && lesson.duration != null
          ? lesson.duration
          : (content && content.duration)
      )
  );
  const quiz = normalizeQuizQuestions(
    Array.isArray(lesson && lesson.quiz) ? lesson.quiz : content.questions
  );
  const interactiveQuizzes = normalizeInteractiveQuizzes(
    Array.isArray(lesson && lesson.interactiveQuizzes) ? lesson.interactiveQuizzes : content.interactiveQuizzes
  );

  return {
    ...(lesson && lesson._id ? { _id: lesson._id } : {}),
    title,
    type,
    videoUrl: String(
      (lesson && lesson.videoUrl)
      || (lesson && lesson.preview)
      || (content && content.videoUrl)
      || (lesson && lesson.refId)
      || ''
    ).trim(),
    preview: String((lesson && lesson.preview) || (lesson && lesson.videoUrl) || (content && content.videoUrl) || '').trim(),
    refId: String(lesson && lesson.refId || '').trim(),
    description: String(lesson && lesson.description || '').trim(),
    duration: lesson && lesson.duration != null ? lesson.duration : null,
    durationSeconds,
    durationFormatted: String(lesson && lesson.durationFormatted || '').trim() || formatDurationValue(durationSeconds),
    durationSyncPending: Boolean(lesson && lesson.durationSyncPending),
    aiGenerated: Boolean(lesson && lesson.aiGenerated),
    content,
    quiz,
    interactiveQuizzes,
    order: normalizeOrder(lesson && lesson.order, lessonIndex)
  };
}

function normalizeCanonicalSection(section, sectionIndex) {
  const lessonsSource = Array.isArray(section && section.lessons) ? section.lessons : [];
  const lessons = lessonsSource
    .map((lesson, lessonIndex) => normalizeCanonicalLesson(lesson, lessonIndex))
    .sort((a, b) => a.order - b.order)
    .map((lesson, lessonIndex) => ({ ...lesson, order: lessonIndex }));

  return {
    ...(section && section._id ? { _id: section._id } : {}),
    title: String(section && section.title || '').trim() || `Section ${sectionIndex + 1}`,
    lessons,
    order: normalizeOrder(section && section.order, sectionIndex)
  };
}

function assertCourseContentShape(course) {
  if (!course || typeof course !== 'object') {
    throw new Error('Course content is missing');
  }

  if (!Array.isArray(course.sections)) {
    throw new Error('Course sections must be an array');
  }

  course.sections.forEach((section, sectionIndex) => {
    if (!section || typeof section !== 'object') {
      throw new Error(`Course section at index ${sectionIndex} is invalid`);
    }

    if (!Array.isArray(section.lessons)) {
      throw new Error(`Course section at index ${sectionIndex} must contain a lessons array`);
    }
  });
}

function getCanonicalSections(course) {
  assertCourseContentShape(course);

  return course.sections
    .map((section, sectionIndex) => normalizeCanonicalSection(section, sectionIndex))
    .sort((a, b) => a.order - b.order)
    .map((section, sectionIndex) => ({ ...section, order: sectionIndex }));
}

function normalizeCourseContent(course) {
  return {
    sections: getCanonicalSections(course)
  };
}

function syncCourseContent(course) {
  if (!course) return course;

  if (!Array.isArray(course.sections)) {
    course.sections = [];
  }

  course.sections = getCanonicalSections(course);
  return course;
}

module.exports = {
  assertCourseContentShape,
  getCanonicalSections,
  normalizeCourseContent,
  normalizeInteractiveQuizzes,
  normalizeQuizQuestions,
  syncCourseContent
};
