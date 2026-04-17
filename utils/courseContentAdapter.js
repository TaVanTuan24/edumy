function clonePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function normalizeOrder(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLessonType(rawType, item) {
  const type = String(rawType || '').trim().toLowerCase();
  if (type === 'lecture') return 'video';
  if (['video', 'slide', 'quiz'].includes(type)) return type;

  if (Array.isArray(item && item.quiz) && item.quiz.length > 0) return 'quiz';
  if (Array.isArray(item && item.questions) && item.questions.length > 0) return 'quiz';
  if (item && item.content && Array.isArray(item.content.questions) && item.content.questions.length > 0) return 'quiz';
  if (item && item.content && Array.isArray(item.content.slides) && item.content.slides.length > 0) return 'slide';
  if (Array.isArray(item && item.slides) && item.slides.length > 0) return 'slide';
  if (typeof (item && item.content) === 'string' && String(item.content).trim()) return 'slide';

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

function normalizeLessonContent(item, fallbackTitle) {
  const rawContent = item && item.content;
  const contentObject = clonePlainObject(rawContent);
  const type = normalizeLessonType(item && item.type, item);

  const slides = normalizeSlides(
    Array.isArray(contentObject.slides) ? contentObject.slides : item && item.slides,
    fallbackTitle
  );
  const quiz = normalizeQuizQuestions(
    Array.isArray(contentObject.questions) ? contentObject.questions : item && (item.quiz || item.questions)
  );
  const interactiveQuizzes = normalizeInteractiveQuizzes(
    Array.isArray(contentObject.interactiveQuizzes) ? contentObject.interactiveQuizzes : item && item.interactiveQuizzes
  );

  if (type === 'slide') {
    return {
      ...contentObject,
      slides
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
      || (item && item.videoUrl)
      || (item && item.preview)
      || (item && item.refId)
      || ''
    ).trim(),
    interactiveQuizzes
  };
}

function normalizeCanonicalLesson(item, lessonIndex) {
  const type = normalizeLessonType(item && item.type, item);
  const title = String(item && (item.title || item.name) || '').trim() || `Lesson ${lessonIndex + 1}`;
  const content = normalizeLessonContent(item, title);
  const quiz = normalizeQuizQuestions(
    Array.isArray(item && item.quiz)
      ? item.quiz
      : Array.isArray(item && item.questions)
        ? item.questions
        : content.questions
  );
  const interactiveQuizzes = normalizeInteractiveQuizzes(
    Array.isArray(item && item.interactiveQuizzes)
      ? item.interactiveQuizzes
      : content.interactiveQuizzes
  );

  return {
    ...(item && item._id ? { _id: item._id } : {}),
    title,
    type,
    videoUrl: String(
      (item && item.videoUrl)
      || (item && item.preview)
      || (content && content.videoUrl)
      || (item && item.refId)
      || ''
    ).trim(),
    preview: String((item && item.preview) || (item && item.videoUrl) || (content && content.videoUrl) || '').trim(),
    refId: String(item && item.refId || '').trim(),
    description: String(item && item.description || '').trim(),
    duration: item && item.duration != null ? item.duration : null,
    aiGenerated: Boolean(item && item.aiGenerated),
    content,
    quiz,
    interactiveQuizzes,
    order: normalizeOrder(item && item.order, lessonIndex)
  };
}

function normalizeCanonicalSection(section, sectionIndex) {
  const lessonsSource = Array.isArray(section && section.lessons)
    ? section.lessons
    : Array.isArray(section && section.items)
      ? section.items
      : [];

  const lessons = lessonsSource
    .map((lesson, lessonIndex) => normalizeCanonicalLesson(lesson, lessonIndex))
    .sort((a, b) => a.order - b.order)
    .map((lesson, lessonIndex) => ({ ...lesson, order: lessonIndex }));

  return {
    ...(section && section._id ? { _id: section._id } : {}),
    title: String(section && (section.title || section.section || section.name) || '').trim() || `Section ${sectionIndex + 1}`,
    lessons,
    order: normalizeOrder(section && section.order, sectionIndex)
  };
}

function convertDriveStructureToSections(driveStructure) {
  const source = Array.isArray(driveStructure) ? driveStructure : [];

  return source
    .map((section, sectionIndex) => ({
      ...(section && section._id ? { _id: section._id } : {}),
      title: String(section && (section.title || section.section || section.name) || '').trim() || `Section ${sectionIndex + 1}`,
      lessons: (Array.isArray(section && section.videos) ? section.videos : [])
        .map((item, lessonIndex) => normalizeCanonicalLesson(item, lessonIndex))
        .sort((a, b) => a.order - b.order)
        .map((lesson, lessonIndex) => ({ ...lesson, order: lessonIndex })),
      order: normalizeOrder(section && section.order, sectionIndex)
    }))
    .sort((a, b) => a.order - b.order)
    .map((section, sectionIndex) => ({ ...section, order: sectionIndex }));
}

function convertSectionsToDriveStructure(sections) {
  const source = Array.isArray(sections) ? sections : [];

  return source
    .map((section, sectionIndex) => normalizeCanonicalSection(section, sectionIndex))
    .sort((a, b) => a.order - b.order)
    .map((section, sectionIndex) => ({
      ...(section && section._id ? { _id: section._id } : {}),
      section: String(section.title || '').trim() || `Section ${sectionIndex + 1}`,
      videos: (Array.isArray(section.lessons) ? section.lessons : [])
        .map((lesson, lessonIndex) => normalizeCanonicalLesson(lesson, lessonIndex))
        .sort((a, b) => a.order - b.order)
        .map((lesson, lessonIndex) => {
          const type = normalizeLessonType(lesson.type, lesson);
          const content = normalizeLessonContent(lesson, lesson.title);
          const quiz = normalizeQuizQuestions(
            Array.isArray(lesson.quiz) ? lesson.quiz : content.questions
          );
          const interactiveQuizzes = normalizeInteractiveQuizzes(
            Array.isArray(lesson.interactiveQuizzes) ? lesson.interactiveQuizzes : content.interactiveQuizzes
          );

          return {
            ...(lesson && lesson._id ? { _id: lesson._id } : {}),
            type,
            name: String(lesson.title || '').trim() || `Lesson ${lessonIndex + 1}`,
            title: String(lesson.title || '').trim() || `Lesson ${lessonIndex + 1}`,
            preview: String(lesson.preview || lesson.videoUrl || (content && content.videoUrl) || '').trim(),
            refId: String(lesson.refId || '').trim(),
            description: String(lesson.description || '').trim(),
            duration: lesson.duration != null ? lesson.duration : null,
            aiGenerated: Boolean(lesson.aiGenerated),
            content,
            questions: quiz,
            interactiveQuizzes,
            order: lessonIndex
          };
        }),
      order: sectionIndex
    }));
}

function hasUsableSections(course) {
  return Array.isArray(course && course.sections) && course.sections.length > 0;
}

function getCanonicalSections(course) {
  if (hasUsableSections(course)) {
    return (course.sections || [])
      .map((section, sectionIndex) => normalizeCanonicalSection(section, sectionIndex))
      .sort((a, b) => a.order - b.order)
      .map((section, sectionIndex) => ({ ...section, order: sectionIndex }));
  }

  return convertDriveStructureToSections(course && course.driveStructure);
}

function normalizeCourseContent(course) {
  const canonicalSections = getCanonicalSections(course);
  const legacyDriveStructure = convertSectionsToDriveStructure(canonicalSections);

  return {
    sections: canonicalSections,
    driveStructure: legacyDriveStructure,
    source: hasUsableSections(course) ? 'sections' : 'driveStructure'
  };
}

function syncCourseContent(course, options = {}) {
  if (!course) return course;

  const normalized = normalizeCourseContent(course);
  course.sections = normalized.sections;

  if (options.includeLegacy !== false) {
    course.driveStructure = normalized.driveStructure;
  }

  return course;
}

function applyLegacyDriveStructure(course, driveStructure, options = {}) {
  if (!course) return course;

  const canonicalSections = convertDriveStructureToSections(driveStructure);
  course.sections = canonicalSections;

  if (options.includeLegacy !== false) {
    course.driveStructure = convertSectionsToDriveStructure(canonicalSections);
  }

  return course;
}

module.exports = {
  applyLegacyDriveStructure,
  convertDriveStructureToSections,
  convertSectionsToDriveStructure,
  getCanonicalSections,
  normalizeCourseContent,
  normalizeInteractiveQuizzes,
  normalizeQuizQuestions,
  syncCourseContent
};
