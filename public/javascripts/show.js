const store = {
  course: null,
  sections: [],
  lessons: [],
  lessonsById: new Map(),
  lessonsBySection: new Map(),
  currentLesson: null,
  currentSectionIndex: 0,
  progress: {}
};

const STORAGE_SUFFIX = {
  progress: 'progress',
  lastLesson: 'lastLesson',
  lastSection: 'lastSection'
};

document.addEventListener('DOMContentLoaded', initLearningSystem);

function initLearningSystem() {
  store.course = window.__COURSE__ || window.course || {};
  store.sections = normalizeSections(store.course);
  store.lessons = flattenLessons({ sections: store.sections });
  store.lessons.forEach((lesson) => store.lessonsById.set(String(lesson._id), lesson));

  store.sections.forEach((section, idx) => {
    const ids = section.items.map((item) => String(item._id));
    store.lessonsBySection.set(idx, ids);
  });

  hydrateProgress();
  bindGlobalEvents();
  resumeLastContext();
  updateProgressUI();
}

function storageKey(suffix) {
  return 'course:' + String(store.course && store.course._id || '') + ':' + suffix;
}

function normalizeSections(course) {
  if (Array.isArray(course.sections) && course.sections.length) {
    return course.sections.map((section, sIndex) => ({
      _id: String(section._id || ('section-' + sIndex)),
      title: section.title || ('Section ' + (sIndex + 1)),
      items: normalizeSectionItems(Array.isArray(section.items) ? section.items : section.lessons, sIndex)
    }));
  }

  const drive = Array.isArray(course.driveStructure) ? course.driveStructure : [];
  return drive.map((section, sIndex) => ({
    _id: String(section._id || ('section-' + sIndex)),
    title: section.section || ('Section ' + (sIndex + 1)),
    items: normalizeSectionItems(section.videos || [], sIndex)
  }));
}

function normalizeSectionItems(items, sectionIndex) {
  const source = Array.isArray(items) ? items : [];
  return source.map((item, index) => normalizeLesson(item, sectionIndex, index));
}

function normalizeLesson(item, sectionIndex, index) {
  const rawType = String(item && item.type || 'video').toLowerCase();
  const type = rawType === 'video' ? 'lecture' : rawType;
  const lessonId = String(item && item._id || ('lesson-' + sectionIndex + '-' + index));

  const contentObject = (item && typeof item.content === 'object' && item.content) ? item.content : {};
  const questions = Array.isArray(contentObject.questions)
    ? contentObject.questions
    : Array.isArray(item && item.questions)
      ? item.questions
      : Array.isArray(item && item.quiz)
        ? item.quiz
        : [];

  const slides = Array.isArray(contentObject.slides)
    ? contentObject.slides
    : Array.isArray(item && item.slides)
      ? item.slides
      : [];

  const videoUrl = contentObject.videoUrl || item.preview || item.videoUrl || '';

  return {
    _id: lessonId,
    sectionIndex,
    type,
    title: item.name || item.title || 'Untitled Lesson',
    preview: item.preview || '',
    content: {
      videoUrl,
      questions,
      slides
    }
  };
}

function flattenLessons(course) {
  const result = [];
  const sections = Array.isArray(course.sections) ? course.sections : [];

  sections.forEach((section) => {
    const items = Array.isArray(section.items) ? section.items : [];
    items.forEach((item) => result.push(item));
  });

  return result;
}

function bindGlobalEvents() {
  document.addEventListener('click', (e) => {
    const progressCheckbox = e.target.closest('.lesson-progress-checkbox');
    if (progressCheckbox) return;

    const lessonEl = e.target.closest('.lesson-item');
    if (!lessonEl) return;

    const lessonId = lessonEl.dataset.id;
    selectLesson(lessonId);
  });

  const listContainer = document.getElementById('videoListContainer');
  if (listContainer) {
    listContainer.addEventListener('change', (e) => {
      const checkbox = e.target.closest('.lesson-progress-checkbox');
      if (!checkbox) return;

      const lessonEl = checkbox.closest('.lesson-item');
      if (!lessonEl) return;

      const lessonId = lessonEl.dataset.id;
      setLessonProgress(lessonId, checkbox.checked, true);
      renderLessonList(store.currentSectionIndex);
      updateSidebarUI();
      updateProgressUI();
    });
  }

  document.addEventListener('keydown', (e) => {
    const tag = String((e.target && e.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    if (e.key === 'ArrowRight') goNextLesson();
    if (e.key === 'ArrowLeft') goPrevLesson();
  });
}

function showVideos(sectionIndex) {
  store.currentSectionIndex = Number(sectionIndex) || 0;
  localStorage.setItem(storageKey(STORAGE_SUFFIX.lastSection), String(store.currentSectionIndex));

  renderLessonList(store.currentSectionIndex);
  updateSidebarUI();

  const courseInfo = document.getElementById('courseInfo');
  const notes = document.getElementById('videoNoteSection');
  if (courseInfo) courseInfo.style.display = 'none';
  if (notes) notes.style.display = 'block';

  document.querySelectorAll('.section-note').forEach((note, idx) => {
    note.style.display = idx === store.currentSectionIndex ? 'block' : 'none';
  });
}

function renderLessonList(sectionIndex) {
  const section = store.sections[sectionIndex];
  const container = document.getElementById('videoListContainer');
  if (!container) return;

  if (!section || !Array.isArray(section.items) || !section.items.length) {
    container.innerHTML = '<p class="text-warning">No lessons found in this section.</p>';
    return;
  }

  let html = '<h6>Lessons in ' + escapeHtml(section.title) + ':</h6><ul class="list-group">';

  section.items.forEach((item) => {
    const lessonId = String(item._id);
    const checked = store.progress[lessonId] ? 'checked' : '';
    const completedBadge = store.progress[lessonId] ? '<span class="lesson-completed-badge">Completed</span>' : '';

    html += '' +
      '<li class="list-group-item lesson-item d-flex justify-content-between align-items-center" data-id="' + escapeHtml(lessonId) + '">' +
        '<div>' +
          '<span class="lesson-title">' + escapeHtml(item.title) + '</span>' +
          '<small class="text-muted ms-2">' + capitalize(item.type) + '</small>' +
          completedBadge +
        '</div>' +
        '<div>' +
          '<input type="checkbox" class="form-check-input lesson-progress-checkbox" style="transform: scale(1.5);" ' + checked + '>' +
        '</div>' +
      '</li>';
  });

  html += '</ul>';
  container.innerHTML = html;
}

function selectLesson(id) {
  const lesson = store.lessonsById.get(String(id));
  if (!lesson) return;
  if (store.currentLesson && String(store.currentLesson._id) === String(id)) return;

  store.currentLesson = lesson;
  localStorage.setItem(storageKey(STORAGE_SUFFIX.lastLesson), String(lesson._id));
  localStorage.setItem(storageKey(STORAGE_SUFFIX.lastSection), String(lesson.sectionIndex));

  renderContent();
  updateSidebarUI();
}

function renderContent() {
  if (!store.currentLesson) return;

  withContentFade(() => {
    if (store.currentLesson.type === 'lecture') renderVideo(store.currentLesson);
    if (store.currentLesson.type === 'slide') renderSlide(store.currentLesson);
    if (store.currentLesson.type === 'quiz') renderQuiz(store.currentLesson);
  });
}

function renderVideo(lesson) {
  const imageContainer = document.getElementById('imageContainer');
  const player = document.getElementById('videoPlayerContainer');
  const iframe = document.getElementById('videoIframe');
  const panel = document.getElementById('lessonFallbackPanel');

  if (imageContainer) imageContainer.style.display = 'none';
  if (panel) panel.style.display = 'none';

  const url = lesson.content.videoUrl || lesson.preview || '';
  if (!url) {
    renderPanel('Lecture', lesson.title, '<p class="text-muted mb-0">No video source found.</p>', false);
    return;
  }

  if (iframe) iframe.src = url;
  if (player) player.style.display = 'block';
}

function renderSlide(lesson) {
  const slides = Array.isArray(lesson.content.slides) ? lesson.content.slides : [];
  if (!slides.length) {
    renderPanel('Slide', lesson.title, '<p class="text-muted mb-0">No slide data.</p>', false);
    return;
  }

  const slidesHtml = slides.map((slide, index) => {
    return '' +
      '<div class="border rounded p-2 mb-2">' +
        '<div class="fw-semibold">' + escapeHtml(slide.title || ('Slide ' + (index + 1))) + '</div>' +
        '<div class="text-muted">' + escapeHtml(slide.content || '') + '</div>' +
      '</div>';
  }).join('');

  renderPanel('Slide', lesson.title, slidesHtml, false);
}

function renderQuiz(lesson) {
  const questions = Array.isArray(lesson.content.questions) ? lesson.content.questions : [];
  if (!questions.length) {
    renderPanel('Quiz', lesson.title, '<p class="text-muted mb-0">No quiz data.</p>', true);
    return;
  }

  const questionsHtml = questions.map((q, qIndex) => {
    const options = Array.isArray(q.options) ? q.options : [];
    const optionsHtml = options.map((opt) => {
      const isCorrect = String(opt) === String(q.correctAnswer);
      return '<li class="' + (isCorrect ? 'text-success fw-semibold' : '') + '">' + escapeHtml(opt) + '</li>';
    }).join('');

    return '' +
      '<div class="border rounded p-2 mb-2">' +
        '<div class="fw-semibold mb-1">Q' + (qIndex + 1) + '. ' + escapeHtml(q.question || 'Question') + '</div>' +
        '<ol class="mb-0">' + optionsHtml + '</ol>' +
      '</div>';
  }).join('');

  renderPanel('Quiz', lesson.title, questionsHtml, true);
}

function renderPanel(typeLabel, title, htmlBody, showCompleteButton) {
  const imageContainer = document.getElementById('imageContainer');
  const player = document.getElementById('videoPlayerContainer');
  const iframe = document.getElementById('videoIframe');

  if (imageContainer) imageContainer.style.display = 'none';
  if (iframe) iframe.src = '';
  if (player) player.style.display = 'none';

  let panel = document.getElementById('lessonFallbackPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'lessonFallbackPanel';
    panel.className = 'card mb-3';
    if (player && player.parentNode) player.parentNode.insertBefore(panel, player.nextSibling);
  }

  panel.innerHTML = '' +
    '<div class="card-body">' +
      '<h5 class="card-title mb-3">' + escapeHtml(typeLabel) + ': ' + escapeHtml(title || 'Lesson') + '</h5>' +
      htmlBody +
      (showCompleteButton ? '<button id="completeCurrentLessonBtn" class="btn btn-sm btn-primary mt-2">Mark as Completed</button>' : '') +
    '</div>';
  panel.style.display = 'block';

  const completeBtn = document.getElementById('completeCurrentLessonBtn');
  if (completeBtn) {
    completeBtn.addEventListener('click', () => {
      if (!store.currentLesson) return;
      setLessonProgress(String(store.currentLesson._id), true, true);
      renderLessonList(store.currentSectionIndex);
      updateSidebarUI();
      updateProgressUI();
    });
  }
}

function updateSidebarUI() {
  const currentId = store.currentLesson ? String(store.currentLesson._id) : null;
  document.querySelectorAll('.lesson-item').forEach((el) => {
    el.classList.remove('active');
    if (currentId && String(el.dataset.id) === currentId) {
      el.classList.add('active');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

function withContentFade(renderFn) {
  const container = document.getElementById('content') || document.getElementById('videoPlayerContainer');
  if (!container) {
    renderFn();
    return;
  }

  container.style.transition = 'opacity 0.2s ease';
  container.style.opacity = '0';
  setTimeout(() => {
    renderFn();
    container.style.opacity = '1';
  }, 150);
}

function goNextLesson() {
  if (!store.currentLesson) return;
  const index = store.lessons.findIndex((lesson) => String(lesson._id) === String(store.currentLesson._id));
  if (index === -1 || index >= store.lessons.length - 1) return;

  const next = store.lessons[index + 1];
  if (!next) return;

  if (next.sectionIndex !== store.currentSectionIndex) {
    showVideos(next.sectionIndex);
  }
  selectLesson(next._id);
}

function goPrevLesson() {
  if (!store.currentLesson) return;
  const index = store.lessons.findIndex((lesson) => String(lesson._id) === String(store.currentLesson._id));
  if (index <= 0) return;

  const prev = store.lessons[index - 1];
  if (!prev) return;

  if (prev.sectionIndex !== store.currentSectionIndex) {
    showVideos(prev.sectionIndex);
  }
  selectLesson(prev._id);
}

function hydrateProgress() {
  const completedByBackend = Array.isArray(window.completedVideos) ? window.completedVideos : [];
  const localProgress = readJson(storageKey(STORAGE_SUFFIX.progress), {});

  store.progress = {};

  store.lessons.forEach((lesson) => {
    const lessonId = String(lesson._id);
    const mediaKey = normalizeMediaKey(lesson.preview || lesson.content.videoUrl || '');
    const completedFromBackend = mediaKey && completedByBackend.some((v) => normalizeMediaKey(v) === mediaKey);
    store.progress[lessonId] = !!(completedFromBackend || localProgress[lessonId]);
  });
}

function setLessonProgress(lessonId, completed, syncBackend) {
  store.progress[String(lessonId)] = !!completed;
  writeJson(storageKey(STORAGE_SUFFIX.progress), store.progress);

  if (syncBackend) {
    const lesson = store.lessonsById.get(String(lessonId));
    const videoUrl = lesson && (lesson.preview || lesson.content.videoUrl);
    if (videoUrl) {
      syncProgressBackend(videoUrl, completed);
    }
  }
}

function syncProgressBackend(videoUrl, completed) {
  fetch('/courses/' + String(store.course._id) + '/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video: videoUrl, completed: !!completed })
  }).catch((err) => console.error('[Progress Sync Error]', err));
}

function updateProgressUI() {
  const total = store.lessons.length || 1;
  const completed = store.lessons.reduce((count, lesson) => {
    return count + (store.progress[String(lesson._id)] ? 1 : 0);
  }, 0);
  const percent = Math.round((completed / total) * 100);

  const bar = document.querySelector('.progress-bar');
  const label = document.querySelector('.text-success');
  if (!bar || !label) return;

  bar.style.width = percent + '%';
  bar.setAttribute('aria-valuenow', completed);
  label.innerText = 'Tiến độ học: ' + completed + ' / ' + total + ' video (' + percent + '%)';
}

function resumeLastContext() {
  const savedSection = Number(localStorage.getItem(storageKey(STORAGE_SUFFIX.lastSection)) || 0);
  const sectionIndex = Number.isFinite(savedSection) && store.sections[savedSection] ? savedSection : 0;
  showVideos(sectionIndex);

  const savedLesson = localStorage.getItem(storageKey(STORAGE_SUFFIX.lastLesson));
  if (savedLesson && store.lessonsById.has(String(savedLesson))) {
    selectLesson(savedLesson);
    return;
  }

  const firstSectionLesson = store.sections[sectionIndex] && store.sections[sectionIndex].items[0];
  if (firstSectionLesson) {
    selectLesson(firstSectionLesson._id);
  }
}

window.saveNote = function saveNote(index) {
  const courseObj = store.course || {};
  const content = document.getElementById('note-section-' + index).value;

  fetch('/courses/' + String(courseObj._id) + '/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionIndex: index, content: content })
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) alert('Lưu ghi chú thất bại');
    })
    .catch((err) => console.error('[Lỗi lưu ghi chú]', err));
};

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

function capitalize(value) {
  const str = String(value || '');
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
