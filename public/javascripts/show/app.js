(function() {
  'use strict';

  function init() {
    if (!window.LearningStore || !window.LearningRender) {
      console.error('Learning modules are not loaded');
      return;
    }

    window.LearningStore.initStore(window.__COURSE__ || window.course || {}, window.completedVideos || []);

    bindEvents();
    exposeLegacyHooks();
    resumeLastContext();
    updateProgressUI();
  }

  function bindEvents() {
    document.addEventListener('click', function(e) {
      const checkbox = e.target.closest('.lesson-progress-checkbox');
      if (checkbox) return;

      const itemEl = e.target.closest('.lesson-item');
      if (!itemEl) return;

      selectLesson(itemEl.dataset.id);
    });

    const listContainer = document.getElementById('videoListContainer');
    if (listContainer) {
      listContainer.addEventListener('change', function(e) {
        const checkbox = e.target.closest('.lesson-progress-checkbox');
        if (!checkbox) return;

        const itemEl = checkbox.closest('.lesson-item');
        if (!itemEl) return;

        const lessonId = itemEl.dataset.id;
        setLessonProgress(lessonId, checkbox.checked, true);
        window.LearningRender.renderLessonList(window.LearningStore.store.currentSectionIndex);
        window.LearningRender.updateSidebarUI();
        updateProgressUI();
      });
    }

    document.addEventListener('keydown', function(e) {
      const tag = String((e.target && e.target.tagName) || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'ArrowRight') goNextLesson();
      if (e.key === 'ArrowLeft') goPrevLesson();
    });
  }

  function exposeLegacyHooks() {
    window.showVideos = function(sectionIndex) {
      window.LearningRender.showSection(sectionIndex);
    };

    window.saveNote = saveNote;
    window.__learningMarkCurrent = markCurrentLessonCompleted;
  }

  function resumeLastContext() {
    const deps = window.LearningStore;
    const store = deps.store;

    const savedSection = Number(localStorage.getItem(deps.storageKey(deps.STORAGE_SUFFIX.lastSection)) || 0);
    const sectionIndex = Number.isFinite(savedSection) && store.sections[savedSection] ? savedSection : 0;
    window.LearningRender.showSection(sectionIndex);

    const savedLesson = localStorage.getItem(deps.storageKey(deps.STORAGE_SUFFIX.lastLesson));
    if (savedLesson && deps.getLessonById(savedLesson)) {
      selectLesson(savedLesson);
      return;
    }

    const firstLesson = store.sections[sectionIndex] && store.sections[sectionIndex].items[0];
    if (firstLesson) {
      selectLesson(firstLesson._id);
    }
  }

  function selectLesson(id) {
    const deps = window.LearningStore;
    const lesson = deps.selectLesson(id);
    if (!lesson) return;

    localStorage.setItem(deps.storageKey(deps.STORAGE_SUFFIX.lastLesson), String(lesson._id));
    localStorage.setItem(deps.storageKey(deps.STORAGE_SUFFIX.lastSection), String(lesson.sectionIndex));

    if (lesson.sectionIndex !== deps.store.currentSectionIndex) {
      window.LearningRender.showSection(lesson.sectionIndex);
    }

    window.LearningRender.renderContent();
    window.LearningRender.updateSidebarUI();
  }

  function setLessonProgress(lessonId, completed, syncBackend) {
    const deps = window.LearningStore;
    deps.setLessonProgress(lessonId, completed);

    if (syncBackend) {
      const lesson = deps.getLessonById(lessonId);
      const videoUrl = lesson && (lesson.preview || (lesson.content && lesson.content.videoUrl));
      if (videoUrl) {
        syncProgressBackend(videoUrl, completed);
      }
    }
  }

  function syncProgressBackend(videoUrl, completed) {
    const course = window.LearningStore.store.course || {};
    fetch('/courses/' + String(course._id || '') + '/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video: videoUrl, completed: !!completed })
    }).catch(function(err) {
      console.error('[Progress Sync Error]', err);
    });
  }

  function markCurrentLessonCompleted() {
    const current = window.LearningStore.store.currentLesson;
    if (!current) return;

    setLessonProgress(current._id, true, true);
    window.LearningRender.renderLessonList(window.LearningStore.store.currentSectionIndex);
    window.LearningRender.updateSidebarUI();
    updateProgressUI();
  }

  function updateProgressUI() {
    const deps = window.LearningStore;
    const total = deps.store.lessons.length || 1;
    const completed = deps.getCompletedCount();
    const percent = Math.round((completed / total) * 100);

    const bar = document.querySelector('.progress-bar');
    const label = document.querySelector('.text-success');
    if (!bar || !label) return;

    bar.style.width = percent + '%';
    bar.setAttribute('aria-valuenow', completed);
    label.innerText = 'Tiến độ học: ' + completed + ' / ' + total + ' video (' + percent + '%)';
  }

  function goNextLesson() {
    const deps = window.LearningStore;
    const next = deps.getAdjacentLesson(1);
    if (!next) return;

    if (next.sectionIndex !== deps.store.currentSectionIndex) {
      window.LearningRender.showSection(next.sectionIndex);
    }
    selectLesson(next._id);
  }

  function goPrevLesson() {
    const deps = window.LearningStore;
    const prev = deps.getAdjacentLesson(-1);
    if (!prev) return;

    if (prev.sectionIndex !== deps.store.currentSectionIndex) {
      window.LearningRender.showSection(prev.sectionIndex);
    }
    selectLesson(prev._id);
  }

  function saveNote(index) {
    const course = window.LearningStore.store.course || {};
    const input = document.getElementById('note-section-' + index);
    const content = input ? input.value : '';

    fetch('/courses/' + String(course._id || '') + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionIndex: index, content: content })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.success) {
          alert('Lưu ghi chú thất bại');
        }
      })
      .catch(function(err) {
        console.error('[Lỗi lưu ghi chú]', err);
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
