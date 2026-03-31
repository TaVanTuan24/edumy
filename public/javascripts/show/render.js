(function() {
  'use strict';

  let currentQuestionIndex = 0;
  let score = 0;
  let answered = false;
  let quizData = [];
  let selectedAnswers = [];
  let submittedQuestions = [];
  let currentSlideIndex = 0;
  let slideData = [];
  const SLIDE_BASE_WIDTH = 1003;
  const SLIDE_BASE_HEIGHT = 563;
  let slideResizeBound = false;
  let lastQuizReportKey = '';
  let quizAttemptCount = 0;
  let youtubePlayer = null;
  let youtubePollId = null;
  let lastYoutubeTime = 0;
  let youtubeReadyPromise = null;

  function getDeps() {
    const deps = window.LearningStore;
    if (!deps) throw new Error('LearningStore not loaded');
    return deps;
  }

  function renderLessonList(sectionIndex) {
    const deps = getDeps();
    const store = deps.store;
    const container = document.getElementById('sectionsAccordion') || document.getElementById('videoListContainer');
    if (!container) return;

    if (!Array.isArray(store.sections) || !store.sections.length) {
      container.innerHTML = '<p class="text-warning">No sections found.</p>';
      return;
    }

    const activeSectionIndex = Number.isFinite(Number(sectionIndex)) ? Number(sectionIndex) : store.currentSectionIndex;
    store.currentSectionIndex = activeSectionIndex;

    const html = store.sections.map(function(section, idx) {
      const items = Array.isArray(section.items) ? section.items : [];
      const isOpen = idx === store.currentSectionIndex;

      const lessonsHtml = items.length
        ? items.map(function(item) {
            const id = String(item._id);
            const checked = deps.isLessonCompleted(id) ? 'checked' : '';
            const completedBadge = deps.isLessonCompleted(id) ? '<span class="lesson-completed-badge">Completed</span>' : '';

            return '' +
              '<li class="lesson-item d-flex justify-content-between align-items-center" data-id="' + deps.escapeHtml(id) + '">' +
                '<div>' +
                  '<span class="lesson-title">' + deps.escapeHtml(item.title) + '</span>' +
                  '<small class="text-muted ms-2">' + deps.capitalize(item.type) + '</small>' +
                  completedBadge +
                '</div>' +
                '<input type="checkbox" class="form-check-input lesson-progress-checkbox" ' + checked + '>' +
              '</li>';
          }).join('')
        : '<div class="section-empty">No lessons in this section.</div>';

      return '' +
        '<section class="learning-section' + (isOpen ? ' open' : '') + '" data-section-index="' + idx + '">' +
          '<button class="section-header" type="button" data-section-index="' + idx + '">' +
            '<span>' + deps.escapeHtml(section.title || ('Section ' + (idx + 1))) + '</span>' +
            '<span class="section-count">' + items.length + '</span>' +
          '</button>' +
          '<div class="section-body">' +
            '<ul class="lesson-list">' + lessonsHtml + '</ul>' +
          '</div>' +
        '</section>';
    }).join('');

    container.innerHTML = html;
  }

  function updateSidebarUI() {
    const deps = getDeps();
    const store = deps.store;
    const currentId = store.currentLesson ? String(store.currentLesson._id) : null;

    document.querySelectorAll('.learning-section').forEach(function(sectionEl) {
      const index = Number(sectionEl.dataset.sectionIndex);
      sectionEl.classList.toggle('open', index === store.currentSectionIndex);
    });

    document.querySelectorAll('.lesson-item').forEach(function(el) {
      el.classList.remove('active');
      if (currentId && String(el.dataset.id) === currentId) {
        el.classList.add('active');
        const parentSection = el.closest('.learning-section');
        if (parentSection) parentSection.classList.add('open');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

    document.querySelectorAll('.section-note').forEach(function(note, idx) {
      note.style.display = idx === store.currentSectionIndex ? 'block' : 'none';
    });
  }

  function toggleSection(sectionIndex) {
    const deps = getDeps();
    const store = deps.store;
    const idx = Number(sectionIndex);
    if (!Number.isFinite(idx) || !store.sections[idx]) return;

    const sectionEl = document.querySelector('.learning-section[data-section-index="' + idx + '"]');
    if (!sectionEl) {
      showSection(idx);
      return;
    }

    const willOpen = !sectionEl.classList.contains('open');
    document.querySelectorAll('.learning-section').forEach(function(el) {
      el.classList.remove('open');
    });

    if (willOpen) {
      sectionEl.classList.add('open');
      showSection(idx);
      return;
    }

    store.currentSectionIndex = idx;
    localStorage.setItem(deps.storageKey(deps.STORAGE_SUFFIX.lastSection), String(idx));
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

    if (isYouTubeUrl(url)) {
      const videoId = getYouTubeId(url);
      if (!videoId) {
        if (iframe) iframe.src = url;
        if (player) player.style.display = 'block';
        return;
      }

      setupYouTubePlayer(videoId, lesson);
      if (player) player.style.display = 'block';
      return;
    }

    teardownYouTubePlayer();
    if (iframe) iframe.src = url;
    if (player) player.style.display = 'block';

    window.__videoPlayback = window.__videoPlayback || {};
    window.__videoPlayback.isPlaying = true;
  }

  function renderSlide(lesson) {
    console.log('SLIDE LESSON:', lesson);
    console.log('Slides:', lesson && lesson.content);

    const slides = lesson && lesson.content ? lesson.content.slides : undefined;

    if (!slides || !Array.isArray(slides) || slides.length === 0) {
      console.error('No slide data', lesson);
      renderPanel('Slide', lesson && lesson.title, '<p class="text-danger mb-0">No slide data</p>', false);
      return;
    }

    window.slideData = slides;
    slideData = window.slideData;
    currentSlideIndex = 0;

    if (!slideResizeBound) {
      window.addEventListener('resize', function() {
        showSlide(lesson);
      });
      slideResizeBound = true;
    }

    showSlide(lesson);
  }

  function showSlide(lesson) {
    const deps = getDeps();
    const slide = slideData[currentSlideIndex];
    if (!slide) {
      renderPanel('Slide', lesson.title, '<p class="text-muted mb-0">Slide not found.</p>', false);
      return;
    }

    const html = '' +
      '<div class="slide-wrapper">' +
        '<div id="slide-stage">' +
          '<div id="slide-canvas"></div>' +
          '<div class="slide-nav">' +
            '<button class="btn btn-light" type="button" data-slide-nav="prev" ' + (currentSlideIndex === 0 ? 'disabled' : '') + '>←</button>' +
            '<span id="slide-indicator"></span>' +
            '<button class="btn btn-light" type="button" data-slide-nav="next" ' + (currentSlideIndex >= slideData.length - 1 ? 'disabled' : '') + '>→</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    renderPanel('Slide', lesson.title, html, false);

    renderSlideElements(slide, deps);

    const panel = document.getElementById('lessonFallbackPanel');
    if (!panel) return;

    const prevBtn = panel.querySelector('[data-slide-nav="prev"]');
    const nextBtn = panel.querySelector('[data-slide-nav="next"]');

    if (prevBtn) {
      prevBtn.addEventListener('click', function() {
        prevSlide(lesson);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        nextSlide(lesson);
      });
    }

    updateSlideIndicator();

    if (typeof window.__trackSlideChange === 'function') {
      window.__trackSlideChange(String(lesson._id || ''), String(lesson.type || 'slide'), currentSlideIndex);
    }
  }

  function getSlideElements(slide) {
    if (Array.isArray(slide && slide.elements) && slide.elements.length) {
      return slide.elements;
    }

    const fallbackText = [slide && slide.title, slide && slide.content].filter(Boolean).join('\n');
    if (!fallbackText) return [];

    return [{
      type: 'text',
      x: 64,
      y: 64,
      text: fallbackText,
      fontSize: 30,
      color: '#1c1d1f',
      bold: false,
      align: 'left'
    }];
  }

  function renderSlideElements(slide, deps) {
    const canvas = document.getElementById('slide-canvas');
    if (!canvas) return;

    canvas.innerHTML = '';
    const scale = getSlideScale();
    const elements = getSlideElements(slide);

    elements.forEach(function(el) {
      if (!el || typeof el !== 'object') return;

      if (el.type === 'text') {
        const div = document.createElement('div');
        div.className = 'slide-text';
        div.style.left = (Number(el.x || 0) * scale) + 'px';
        div.style.top = (Number(el.y || 0) * scale) + 'px';
        div.style.fontSize = (Number(el.fontSize || 28) * scale) + 'px';
        div.style.color = String(el.color || '#1c1d1f');
        div.style.fontWeight = el.bold ? '700' : '400';
        div.style.textAlign = ['left', 'center', 'right'].includes(el.align) ? el.align : 'left';
        div.style.whiteSpace = 'pre-wrap';
        div.textContent = String(el.text || '');
        canvas.appendChild(div);
        return;
      }

      if (el.type === 'image') {
        const img = document.createElement('img');
        img.className = 'slide-image';
        img.src = String(el.src || '');
        img.alt = 'Slide image';
        img.style.left = (Number(el.x || 0) * scale) + 'px';
        img.style.top = (Number(el.y || 0) * scale) + 'px';
        const width = Number(el.width || 200);
        if (Number.isFinite(width)) {
          img.style.width = (width * scale) + 'px';
        }
        canvas.appendChild(img);
      }
    });
  }

  function getSlideScale() {
    const stage = document.getElementById('slide-stage');
    if (!stage) return 1;
    return stage.offsetWidth / SLIDE_BASE_WIDTH;
  }

  function updateSlideIndicator() {
    const indicator = document.getElementById('slide-indicator');
    if (!indicator) return;
    indicator.textContent = (currentSlideIndex + 1) + ' / ' + slideData.length;
  }

  function nextSlide(lesson) {
    if (currentSlideIndex < slideData.length - 1) {
      currentSlideIndex += 1;
      showSlide(lesson);
    }
  }

  function prevSlide(lesson) {
    if (currentSlideIndex > 0) {
      currentSlideIndex -= 1;
      showSlide(lesson);
    }
  }

  function renderQuiz(lesson) {
    const questions = Array.isArray(lesson.content.questions) ? lesson.content.questions : [];
    if (!questions.length) {
      renderPanel('Quiz', lesson.title, '<p class="text-muted mb-0">No quiz data.</p>', true);
      return;
    }

    window.quizData = questions;
    quizData = window.quizData;
    currentQuestionIndex = 0;
    score = 0;
    answered = false;
    selectedAnswers = new Array(quizData.length).fill(-1);
    submittedQuestions = new Array(quizData.length).fill(false);
    quizAttemptCount = 0;

    showQuestion(lesson);
  }

  function showQuestion(lesson) {
    const deps = getDeps();
    const q = quizData[currentQuestionIndex];
    if (!q) {
      showResult(lesson);
      return;
    }

    const options = Array.isArray(q.options) ? q.options : [];
    answered = Boolean(submittedQuestions[currentQuestionIndex]);
    const selectedIndex = selectedAnswers[currentQuestionIndex];

    const optionsHtml = options.map(function(opt, i) {
      const meta = normalizeOption(opt, q);

      let stateClass = '';
      if (answered) {
        if (meta.isCorrect) {
          stateClass = ' correct';
        } else if (selectedIndex === i) {
          stateClass = ' wrong';
        }
      }

      return '' +
        '<button class="option-btn' + stateClass + '" type="button" data-option-index="' + i + '" ' + (answered ? 'disabled' : '') + '>' +
          deps.escapeHtml(meta.text) +
        '</button>';
    }).join('');

    const feedback = getQuestionFeedback(q, selectedIndex, answered);
    const feedbackHtml = feedback.text
      ? '<div class="quiz-feedback ' + feedback.kind + '">' + deps.escapeHtml(feedback.text) + '</div>'
      : '';

    const html = '' +
      '<div class="quiz-shell">' +
        '<div class="quiz-progress">Question ' + (currentQuestionIndex + 1) + ' / ' + quizData.length + '</div>' +
        '<h5 class="mb-3">Q' + (currentQuestionIndex + 1) + '. ' + deps.escapeHtml(q.question || 'Question') + '</h5>' +
        '<div class="quiz-options">' + optionsHtml + '</div>' +
        feedbackHtml +
        '<div class="quiz-nav mt-3">' +
          '<button class="btn btn-outline-secondary" type="button" data-quiz-nav="prev" ' + (currentQuestionIndex === 0 ? 'disabled' : '') + '>Prev</button>' +
          '<button class="btn btn-primary" type="button" data-quiz-nav="next">' + (currentQuestionIndex === quizData.length - 1 ? 'Finish' : 'Next') + '</button>' +
        '</div>' +
      '</div>';

    renderPanel('Quiz', lesson.title, html, false);

    const panel = document.getElementById('lessonFallbackPanel');
    if (!panel) return;

    panel.querySelectorAll('.option-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const idx = Number(btn.dataset.optionIndex);
        selectAnswer(idx, lesson);
      });
    });

    const prevBtn = panel.querySelector('[data-quiz-nav="prev"]');
    const nextBtn = panel.querySelector('[data-quiz-nav="next"]');

    if (prevBtn) {
      prevBtn.addEventListener('click', function() {
        prevQuestion(lesson);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        nextQuestion(lesson);
      });
    }
  }

  function selectAnswer(index, lesson) {
    if (answered) return;

    const q = quizData[currentQuestionIndex];
    const options = Array.isArray(q && q.options) ? q.options : [];
    if (!q || index < 0 || index >= options.length) return;

    selectedAnswers[currentQuestionIndex] = index;
    submittedQuestions[currentQuestionIndex] = true;

    const selectedMeta = normalizeOption(options[index], q);
    if (selectedMeta.isCorrect) {
      score += 1;
    }

    answered = true;
    showQuestion(lesson);
  }

  function nextQuestion(lesson) {
    if (currentQuestionIndex < quizData.length - 1) {
      currentQuestionIndex += 1;
      showQuestion(lesson);
      return;
    }

    showResult(lesson);
  }

  function prevQuestion(lesson) {
    if (currentQuestionIndex > 0) {
      currentQuestionIndex -= 1;
      showQuestion(lesson);
    }
  }

  function showResult(lesson) {
    const deps = getDeps();
    const percent = quizData.length ? Math.round((score / quizData.length) * 100) : 0;
    const html = '' +
      '<div class="quiz-result">' +
        '<h3 class="mb-2">Your score: ' + score + '/' + quizData.length + '</h3>' +
        '<p class="text-muted mb-3">Accuracy: ' + percent + '%</p>' +
        '<div class="d-flex gap-2">' +
          '<button class="btn btn-outline-secondary" type="button" id="quizRetryBtn">Retry Quiz</button>' +
          '<button class="btn btn-primary" type="button" id="completeCurrentLessonBtn">Mark as Completed</button>' +
        '</div>' +
      '</div>';

    renderPanel('Quiz', lesson.title, html, false);

    saveQuizResult(lesson, score, quizData.length);

    quizAttemptCount += 1;
    if (typeof window.__trackQuizResult === 'function') {
      window.__trackQuizResult(String(lesson._id || ''), String(lesson.type || 'quiz'), score, quizData.length, quizAttemptCount);
    }

    const retryBtn = document.getElementById('quizRetryBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function() {
        currentQuestionIndex = 0;
        score = 0;
        answered = false;
        selectedAnswers = new Array(quizData.length).fill(-1);
        submittedQuestions = new Array(quizData.length).fill(false);
        showQuestion(lesson);
      });
    }

    const completeBtn = document.getElementById('completeCurrentLessonBtn');
    if (completeBtn && typeof window.__learningMarkCurrent === 'function') {
      completeBtn.addEventListener('click', window.__learningMarkCurrent);
    }
  }

  function saveQuizResult(lesson, scoreValue, totalValue) {
    const deps = getDeps();
    const course = deps.store.course || {};
    const quizId = lesson && lesson._id ? String(lesson._id) : '';
    const reportKey = quizId + ':' + scoreValue + ':' + totalValue;

    if (!quizId || reportKey === lastQuizReportKey) return;
    lastQuizReportKey = reportKey;

    fetch('/courses/' + String(course._id || '') + '/quiz-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quizId: quizId, score: scoreValue, total: totalValue })
    }).catch(function(err) {
      console.error('[Quiz Result Sync Error]', err);
    });
  }

  function normalizeOption(option, question) {
    const optionText = getOptionText(option);
    return {
      text: optionText,
      isCorrect: isOptionCorrect(option, optionText, question && question.correctAnswer)
    };
  }

  function getQuestionFeedback(question, selectedIndex, isAnswered) {
    if (!isAnswered || selectedIndex < 0) {
      return { text: '', kind: '' };
    }

    const options = Array.isArray(question && question.options) ? question.options : [];
    const selected = options[selectedIndex];
    const selectedMeta = normalizeOption(selected, question);

    if (selectedMeta.isCorrect) {
      return { text: 'Correct answer', kind: 'correct' };
    }

    return { text: 'Wrong answer', kind: 'wrong' };
  }

  function getOptionText(option) {
    if (typeof option === 'string') return option;
    if (option && typeof option.text === 'string') return option.text;
    return '';
  }

  function isOptionCorrect(option, optionText, correctAnswer) {
    if (option && typeof option === 'object' && option.isCorrect === true) return true;
    if (option && typeof option === 'object' && option.correct === true) return true;
    return String(optionText) === String(correctAnswer || '');
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

  function isYouTubeUrl(url) {
    return /(?:youtube\.com|youtu\.be)/i.test(String(url || ''));
  }

  function getYouTubeId(url) {
    const value = String(url || '');
    const shortMatch = value.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
    if (shortMatch) return shortMatch[1];

    const longMatch = value.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    if (longMatch) return longMatch[1];

    const embedMatch = value.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
    if (embedMatch) return embedMatch[1];

    return '';
  }

  function setupYouTubePlayer(videoId, lesson) {
    ensureYouTubeApi().then(function() {
      const iframe = ensureVideoIframe();
      if (!iframe) return;

      if (!youtubePlayer) {
        youtubePlayer = new window.YT.Player('videoIframe', {
          videoId: videoId,
          playerVars: { rel: 0, origin: window.location.origin },
          events: {
            onStateChange: function(event) {
              handleYouTubeStateChange(event, lesson);
            }
          }
        });
      } else {
        youtubePlayer.loadVideoById(videoId);
      }

      startYouTubePolling(lesson);
    }).catch(function(err) {
      console.error('[YouTube API Error]', err);
    });
  }

  function handleYouTubeStateChange(event, lesson) {
    if (!window.YT || !window.YT.PlayerState) return;

    const state = event.data;
    const player = event.target;
    const position = player && typeof player.getCurrentTime === 'function'
      ? player.getCurrentTime()
      : 0;

    if (state === window.YT.PlayerState.PLAYING) {
      lastYoutubeTime = position;
      if (typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('play', position);
      }
    }

    if (state === window.YT.PlayerState.PAUSED) {
      if (typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('pause', position);
      }
    }

    if (state === window.YT.PlayerState.ENDED) {
      if (typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('ended', position);
      }
    }
  }

  function startYouTubePolling(lesson) {
    if (youtubePollId) clearInterval(youtubePollId);
    youtubePollId = setInterval(function() {
      if (!youtubePlayer || typeof youtubePlayer.getCurrentTime !== 'function') return;
      const current = youtubePlayer.getCurrentTime();
      const delta = Math.abs(current - lastYoutubeTime);

      if (lastYoutubeTime && delta > 4) {
        if (typeof window.__trackVideoEvent === 'function') {
          window.__trackVideoEvent('seek', current);
        }
      }

      lastYoutubeTime = current;
    }, 2000);
  }

  function teardownYouTubePlayer() {
    if (youtubePollId) {
      clearInterval(youtubePollId);
      youtubePollId = null;
    }

    if (youtubePlayer && typeof youtubePlayer.destroy === 'function') {
      youtubePlayer.destroy();
    }

    youtubePlayer = null;
    lastYoutubeTime = 0;

    ensureVideoIframe();
  }

  function ensureVideoIframe() {
    const container = document.getElementById('videoPlayerContainer');
    if (!container) return null;

    let iframe = document.getElementById('videoIframe');
    if (iframe) return iframe;

    iframe = document.createElement('iframe');
    iframe.id = 'videoIframe';
    iframe.src = '';
    iframe.allow = 'autoplay';
    iframe.allowFullscreen = true;
    container.appendChild(iframe);
    return iframe;
  }

  function ensureYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();

    if (!youtubeReadyPromise) {
      youtubeReadyPromise = new Promise(function(resolve) {
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function() {
          if (typeof previous === 'function') previous();
          resolve();
        };
      });
    }

    return youtubeReadyPromise;
  }

  window.LearningRender = {
    showSection: showSection,
    toggleSection: toggleSection,
    renderLessonList: renderLessonList,
    renderContent: renderContent,
    updateSidebarUI: updateSidebarUI
  };
})();
