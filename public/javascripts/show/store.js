(function() {
  'use strict';

  const store = {
    course: null,
    sections: [],
    lessons: [],
    lessonsById: new Map(),
    currentLesson: null,
    currentSectionIndex: 0,
    progress: {}
  };

  const STORAGE_SUFFIX = {
    progress: 'progress',
    lastLesson: 'lastLesson',
    lastSection: 'lastSection'
  };

  function initStore(coursePayload, completedVideosPayload) {
    store.course = coursePayload || {};
    store.sections = normalizeSections(store.course);
    store.lessons = flattenLessons(store.course);
    store.lessonsById = new Map();

    store.lessons.forEach(function(lesson) {
      store.lessonsById.set(String(lesson._id), lesson);
    });

    hydrateProgress(Array.isArray(completedVideosPayload) ? completedVideosPayload : []);
  }

  function normalizeSections(course) {
    if (Array.isArray(course.sections) && course.sections.length) {
      return course.sections.map(function(section, sectionIndex) {
        return {
          _id: String(section && section._id ? section._id : 'section-' + sectionIndex),
          title: section && section.title ? section.title : ('Section ' + (sectionIndex + 1)),
          items: normalizeItems(section && (section.items || section.lessons), sectionIndex)
        };
      });
    }

    const legacy = Array.isArray(course.driveStructure) ? course.driveStructure : [];
    return legacy.map(function(section, sectionIndex) {
      return {
        _id: String(section && section._id ? section._id : 'section-' + sectionIndex),
        title: section && section.section ? section.section : ('Section ' + (sectionIndex + 1)),
        items: normalizeItems(section && section.videos, sectionIndex)
      };
    });
  }

  function normalizeItems(items, sectionIndex) {
    const source = Array.isArray(items) ? items : [];
    return source.map(function(item, index) {
      return normalizeLesson(item, sectionIndex, index);
    });
  }

  function normalizeLesson(item, sectionIndex, index) {
    const rawType = String(item && item.type ? item.type : 'video').toLowerCase();
    const type = rawType === 'video' ? 'lecture' : rawType;
    const content = (item && typeof item.content === 'object' && item.content) ? item.content : {};

    return {
      _id: String(item && item._id ? item._id : ('lesson-' + sectionIndex + '-' + index)),
      sectionIndex: sectionIndex,
      type: type,
      title: item && (item.title || item.name) ? (item.title || item.name) : 'Untitled Lesson',
      preview: item && item.preview ? item.preview : '',
      content: {
        videoUrl: content.videoUrl || (item && (item.videoUrl || item.preview)) || '',
        slides: Array.isArray(content.slides) ? content.slides : [],
        questions: Array.isArray(content.questions) ? content.questions : Array.isArray(item && item.questions) ? item.questions : Array.isArray(item && item.quiz) ? item.quiz : [],
        interactiveQuizzes: Array.isArray(content.interactiveQuizzes)
          ? content.interactiveQuizzes
          : Array.isArray(item && item.interactiveQuizzes)
            ? item.interactiveQuizzes
            : []
      }
    };
  }

  function flattenLessons(course) {
    const result = [];
    const sections = normalizeSections(course);

    sections.forEach(function(section) {
      (section.items || []).forEach(function(item) {
        result.push(item);
      });
    });

    return result;
  }

  function hydrateProgress(completedVideos) {
    const localProgress = readJson(storageKey(STORAGE_SUFFIX.progress), {});
    store.progress = {};

    store.lessons.forEach(function(lesson) {
      const id = String(lesson._id);
      const mediaKey = normalizeMediaKey(lesson.preview || lesson.content.videoUrl || '');
      const backendDone = mediaKey && completedVideos.some(function(v) {
        return normalizeMediaKey(v) === mediaKey;
      });
      store.progress[id] = !!(backendDone || localProgress[id]);
    });
  }

  function getLessonById(id) {
    return store.lessonsById.get(String(id)) || null;
  }

  function selectLesson(id) {
    const lesson = getLessonById(id);
    if (!lesson) return null;

    store.currentLesson = lesson;
    store.currentSectionIndex = lesson.sectionIndex;
    return lesson;
  }

  function getAdjacentLesson(direction) {
    if (!store.currentLesson) return null;

    const idx = store.lessons.findIndex(function(lesson) {
      return String(lesson._id) === String(store.currentLesson._id);
    });

    if (idx < 0) return null;

    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= store.lessons.length) return null;
    return store.lessons[nextIdx];
  }

  function setLessonProgress(id, completed) {
    store.progress[String(id)] = !!completed;
    writeJson(storageKey(STORAGE_SUFFIX.progress), store.progress);
  }

  function isLessonCompleted(id) {
    return !!store.progress[String(id)];
  }

  function getCompletedCount() {
    return store.lessons.reduce(function(count, lesson) {
      return count + (isLessonCompleted(lesson._id) ? 1 : 0);
    }, 0);
  }

  function storageKey(suffix) {
    return 'course:' + String(store.course && store.course._id || '') + ':' + suffix;
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage write errors.
    }
  }

  function normalizeMediaKey(url) {
    return String(url || '').split('?')[0];
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function capitalize(value) {
    const str = String(value || '');
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  window.LearningStore = {
    store: store,
    STORAGE_SUFFIX: STORAGE_SUFFIX,
    initStore: initStore,
    flattenLessons: flattenLessons,
    normalizeSections: normalizeSections,
    getLessonById: getLessonById,
    selectLesson: selectLesson,
    getAdjacentLesson: getAdjacentLesson,
    setLessonProgress: setLessonProgress,
    isLessonCompleted: isLessonCompleted,
    getCompletedCount: getCompletedCount,
    storageKey: storageKey,
    readJson: readJson,
    writeJson: writeJson,
    normalizeMediaKey: normalizeMediaKey,
    escapeHtml: escapeHtml,
    capitalize: capitalize
  };
})();
