(function() {
  'use strict';

  function getDeps() {
    const deps = window.LearningStore;
    if (!deps) throw new Error('LearningStore not loaded');
    return deps;
  }

  function renderLessonList(sectionIndex) {
    const deps = getDeps();
    const store = deps.store;
    const section = store.sections[sectionIndex];
    const container = document.getElementById('videoListContainer');
    if (!container) return;

    if (!section || !Array.isArray(section.items) || !section.items.length) {
      container.innerHTML = '<p class="text-warning">No lessons found in this section.</p>';
      return;
    }

    let html = '<h6>Lessons in ' + deps.escapeHtml(section.title) + ':</h6><ul class="list-group">';

    section.items.forEach(function(item) {
      const id = String(item._id);
      const checked = deps.isLessonCompleted(id) ? 'checked' : '';
      const completedBadge = deps.isLessonCompleted(id) ? '<span class="lesson-completed-badge">Completed</span>' : '';

      html += '' +
        '<li class="list-group-item lesson-item d-flex justify-content-between align-items-center" data-id="' + deps.escapeHtml(id) + '">' +
          '<div>' +
            '<span class="lesson-title">' + deps.escapeHtml(item.title) + '</span>' +
            '<small class="text-muted ms-2">' + deps.capitalize(item.type) + '</small>' +
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

  function updateSidebarUI() {
    const deps = getDeps();
    const store = deps.store;
    const currentId = store.currentLesson ? String(store.currentLesson._id) : null;

    document.querySelectorAll('.lesson-item').forEach(function(el) {
      el.classList.remove('active');
      if (currentId && String(el.dataset.id) === currentId) {
        el.classList.add('active');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function showSection(sectionIndex) {
    const deps = getDeps();
    const store = deps.store;

    store.currentSectionIndex = Number(sectionIndex) || 0;
    localStorage.setItem(deps.storageKey(deps.STORAGE_SUFFIX.lastSection), String(store.currentSectionIndex));

    renderLessonList(store.currentSectionIndex);
    updateSidebarUI();

    const courseInfo = document.getElementById('courseInfo');
    const noteSection = document.getElementById('videoNoteSection');
    if (courseInfo) courseInfo.style.display = 'none';
    if (noteSection) noteSection.style.display = 'block';

    document.querySelectorAll('.section-note').forEach(function(note, idx) {
      note.style.display = idx === store.currentSectionIndex ? 'block' : 'none';
    });
  }

  function renderContent() {
    const store = getDeps().store;
    if (!store.currentLesson) return;

    withContentFade(function() {
      if (store.currentLesson.type === 'lecture') renderVideo(store.currentLesson);
      if (store.currentLesson.type === 'slide') renderSlide(store.currentLesson);
      if (store.currentLesson.type === 'quiz') renderQuiz(store.currentLesson);
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

    setTimeout(function() {
      renderFn();
      container.style.opacity = '1';
    }, 150);
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
    const deps = getDeps();
    const slides = Array.isArray(lesson.content.slides) ? lesson.content.slides : [];
    if (!slides.length) {
      renderPanel('Slide', lesson.title, '<p class="text-muted mb-0">No slide data.</p>', false);
      return;
    }

    const slidesHtml = slides.map(function(slide, idx) {
      return '' +
        '<div class="border rounded p-2 mb-2">' +
          '<div class="fw-semibold">' + deps.escapeHtml(slide.title || ('Slide ' + (idx + 1))) + '</div>' +
          '<div class="text-muted">' + deps.escapeHtml(slide.content || '') + '</div>' +
        '</div>';
    }).join('');

    renderPanel('Slide', lesson.title, slidesHtml, false);
  }

  function renderQuiz(lesson) {
    const deps = getDeps();
    const questions = Array.isArray(lesson.content.questions) ? lesson.content.questions : [];
    if (!questions.length) {
      renderPanel('Quiz', lesson.title, '<p class="text-muted mb-0">No quiz data.</p>', true);
      return;
    }

    const questionsHtml = questions.map(function(q, qIndex) {
      const options = Array.isArray(q.options) ? q.options : [];
      const optionsHtml = options.map(function(opt) {
        const optionText = getOptionText(opt);
        const isCorrect = isOptionCorrect(opt, optionText, q.correctAnswer);
        return '<li class="' + (isCorrect ? 'text-success fw-semibold' : '') + '">' + deps.escapeHtml(optionText) + '</li>';
      }).join('');

      return '' +
        '<div class="border rounded p-2 mb-2">' +
          '<div class="fw-semibold mb-1">Q' + (qIndex + 1) + '. ' + deps.escapeHtml(q.question || 'Question') + '</div>' +
          '<ol class="mb-0">' + optionsHtml + '</ol>' +
        '</div>';
    }).join('');

    renderPanel('Quiz', lesson.title, questionsHtml, true);
  }

  function getOptionText(option) {
    if (typeof option === 'string') return option;
    if (option && typeof option.text === 'string') return option.text;
    return '';
  }

  function isOptionCorrect(option, optionText, correctAnswer) {
    if (option && typeof option === 'object' && option.isCorrect === true) return true;
    return String(optionText) === String(correctAnswer);
  }

  function renderPanel(typeLabel, title, htmlBody, showCompleteButton) {
    const deps = getDeps();
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
        '<h5 class="card-title mb-3">' + deps.escapeHtml(typeLabel) + ': ' + deps.escapeHtml(title || 'Lesson') + '</h5>' +
        htmlBody +
        (showCompleteButton ? '<button id="completeCurrentLessonBtn" class="btn btn-sm btn-primary mt-2">Mark as Completed</button>' : '') +
      '</div>';
    panel.style.display = 'block';

    const completeBtn = document.getElementById('completeCurrentLessonBtn');
    if (completeBtn && typeof window.__learningMarkCurrent === 'function') {
      completeBtn.addEventListener('click', window.__learningMarkCurrent);
    }
  }

  window.LearningRender = {
    showSection: showSection,
    renderLessonList: renderLessonList,
    renderContent: renderContent,
    updateSidebarUI: updateSidebarUI
  };
})();
