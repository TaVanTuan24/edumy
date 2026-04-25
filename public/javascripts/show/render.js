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
  const SLIDE_MAX_TEXT_FONT_SIZE = 40;
  let slideResizeBound = false;
  let lastQuizReportKey = '';
  let quizAttemptCount = 0;
  let youtubePlayer = null;
  let youtubePollId = null;
  let youtubePollIntervalMs = 250;
  let lastYoutubeTime = 0;
  let youtubeDurationSec = 0;
  let youtubeZeroPollCount = 0;
  let youtubeFallbackTimerId = null;
  let youtubeFallbackElapsed = 0;
  let youtubeApiWatchdogId = null;
  let youtubeFallbackInteractionBound = false;
  let interactiveHotspotTimeoutId = null;
  let youtubeReadyPromise = null;
  let html5VideoPlayer = null;
  let html5TimeHandler = null;
  let html5PlayHandler = null;
  let html5PauseHandler = null;
  let html5EndedHandler = null;
  let driveTimerId = null;
  let driveElapsedSeconds = 0;
  let driveLastTickAt = 0;
  let playbackTimeBadge = null;
  const SHOW_PLAYBACK_TIME_BADGE = false;
  let playerViewportStateBound = false;
  let interactiveDebugPanel = null;
  let interactiveDebugSnapshot = {
    provider: '',
    lessonId: '',
    quizzesTotal: 0,
    shownCount: 0,
    activeQuizId: '',
    activeQuizTime: '',
    currentTime: 0,
    nextTrigger: '',
    status: 'idle',
    updatedAt: ''
  };
  let interactiveState = {
    lessonId: '',
    quizzes: [],
    shownQuizIds: new Set(),
    activeQuiz: null,
    pendingIconQuiz: null,
    provider: null,
    providerType: '',
    wasPlayingBeforeModal: false
  };

  function isInteractiveDebugEnabled() {
    const existingPanel = interactiveDebugPanel || document.getElementById('interactiveQuizDebugPanel');
    if (existingPanel && existingPanel.parentNode) {
      existingPanel.parentNode.removeChild(existingPanel);
    }
    interactiveDebugPanel = null;
    return false;
  }

  function ensureInteractiveDebugPanel() {
    if (!isInteractiveDebugEnabled()) return null;
    if (interactiveDebugPanel && document.body && document.body.contains(interactiveDebugPanel)) {
      return interactiveDebugPanel;
    }

    const panel = document.createElement('div');
    panel.id = 'interactiveQuizDebugPanel';
    panel.style.position = 'fixed';
    panel.style.right = '12px';
    panel.style.bottom = '12px';
    panel.style.zIndex = '13000';
    panel.style.width = '320px';
    panel.style.maxWidth = 'calc(100vw - 24px)';
    panel.style.background = 'rgba(15, 23, 42, 0.94)';
    panel.style.color = '#e2e8f0';
    panel.style.border = '1px solid rgba(148, 163, 184, 0.35)';
    panel.style.borderRadius = '10px';
    panel.style.padding = '10px 12px';
    panel.style.font = '12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    panel.style.boxShadow = '0 14px 30px rgba(2, 6, 23, 0.45)';
    panel.innerHTML = '<div style="font-weight:700; margin-bottom:6px; color:#93c5fd;">Interactive Quiz Debug</div><div data-iq-debug-body>Initializing...</div>';

    document.body.appendChild(panel);
    interactiveDebugPanel = panel;
    return panel;
  }

  function formatDebugValue(value) {
    if (value === undefined || value === null || value === '') return '-';
    return String(value);
  }

  function updateInteractiveDebug(patch) {
    if (!isInteractiveDebugEnabled()) return;

    interactiveDebugSnapshot = Object.assign({}, interactiveDebugSnapshot, patch || {}, {
      updatedAt: new Date().toLocaleTimeString()
    });

    const panel = ensureInteractiveDebugPanel();
    if (!panel) return;

    const body = panel.querySelector('[data-iq-debug-body]');
    if (!body) return;

    const lines = [
      'provider: ' + formatDebugValue(interactiveDebugSnapshot.provider),
      'lessonId: ' + formatDebugValue(interactiveDebugSnapshot.lessonId),
      'quizzes: ' + formatDebugValue(interactiveDebugSnapshot.quizzesTotal),
      'shown: ' + formatDebugValue(interactiveDebugSnapshot.shownCount),
      'currentTime: ' + formatDebugValue(interactiveDebugSnapshot.currentTime),
      'nextTrigger: ' + formatDebugValue(interactiveDebugSnapshot.nextTrigger),
      'activeQuizId: ' + formatDebugValue(interactiveDebugSnapshot.activeQuizId),
      'activeQuizTime: ' + formatDebugValue(interactiveDebugSnapshot.activeQuizTime),
      'status: ' + formatDebugValue(interactiveDebugSnapshot.status),
      'updatedAt: ' + formatDebugValue(interactiveDebugSnapshot.updatedAt),
      'Tip: localStorage["learning:interactiveQuizDebug"]="0" to hide'
    ];

    body.textContent = lines.join('\n');
  }

  function setPlaybackState(isPlaying) {
    if (typeof window.__setVideoPlaybackState === 'function') {
      window.__setVideoPlaybackState(isPlaying);
      return;
    }
    window.__videoPlayback = window.__videoPlayback || {};
    window.__videoPlayback.isPlaying = Boolean(isPlaying);
  }

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
    deps.setSectionOpen(activeSectionIndex, true);

    const html = store.sections.map(function(section, idx) {
      const items = Array.isArray(section.items) ? section.items : [];
      const isOpen = deps.isSectionOpen(idx);
      const bodyId = 'learning-section-body-' + idx;
      const headerId = 'learning-section-header-' + idx;

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
          '<button class="section-header" id="' + headerId + '" type="button" data-section-index="' + idx + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-controls="' + bodyId + '">' +
            '<span>' + deps.escapeHtml(section.title || ('Section ' + (idx + 1))) + '</span>' +
            '<span class="section-count">' + items.length + '</span>' +
          '</button>' +
          '<div class="section-body" id="' + bodyId + '" role="region" aria-labelledby="' + headerId + '">' +
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
      sectionEl.classList.toggle('open', deps.isSectionOpen(index));
      const header = sectionEl.querySelector('.section-header');
      if (header) {
        header.setAttribute('aria-expanded', deps.isSectionOpen(index) ? 'true' : 'false');
      }
    });

    document.querySelectorAll('.lesson-item').forEach(function(el) {
      el.classList.remove('active');
      if (currentId && String(el.dataset.id) === currentId) {
        el.classList.add('active');
        const parentSection = el.closest('.learning-section');
        if (parentSection) {
          parentSection.classList.add('open');
          const parentIndex = Number(parentSection.dataset.sectionIndex);
          deps.setSectionOpen(parentIndex, true);
          const header = parentSection.querySelector('.section-header');
          if (header) {
            header.setAttribute('aria-expanded', 'true');
          }
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  function showSection(sectionIndex) {
    const deps = getDeps();
    const store = deps.store;

    store.currentSectionIndex = Number(sectionIndex) || 0;
    deps.setSectionOpen(store.currentSectionIndex, true);
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
    store.currentSectionIndex = idx;
    localStorage.setItem(deps.storageKey(deps.STORAGE_SUFFIX.lastSection), String(idx));
    const isOpen = deps.toggleSectionOpen(idx);

    if (!sectionEl) {
      renderLessonList(idx);
      updateSidebarUI();
      return;
    }

    sectionEl.classList.toggle('open', isOpen);
    const header = sectionEl.querySelector('.section-header');
    if (header) {
      header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
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
    const html5 = document.getElementById('html5VideoPlayer');
    const panel = document.getElementById('lessonFallbackPanel');

    if (imageContainer) imageContainer.style.display = 'none';
    if (panel) panel.style.display = 'none';

    const rawUrl = lesson.content.videoUrl || lesson.preview || '';
    const url = normalizeVideoEmbedUrl(rawUrl);
    const interactiveQuizzes = normalizeInteractiveQuizzes(lesson && lesson.content && lesson.content.interactiveQuizzes);
    setPlaybackTimeBadgeVisible(false);
    if (!url) {
      renderPanel('Lecture', lesson.title, '<p class="text-muted mb-0">No video source found.</p>', false);
      return;
    }

    if (isYouTubeUrl(url)) {
      deactivateHtml5Element(html5);
      activateIframeElement(iframe);
      bindPlayerViewportStateHandlers();
      stopDriveTimer();
      teardownHtml5Player();
      const videoId = getYouTubeId(url);
      if (!videoId) {
        renderPanel(
          'Lecture',
          lesson.title,
          '<p class="text-danger mb-2">Invalid YouTube video URL.</p><p class="text-muted mb-0">Use links like https://www.youtube.com/watch?v=VIDEO_ID, https://youtu.be/VIDEO_ID, or https://www.youtube.com/shorts/VIDEO_ID.</p>',
          false
        );
        setProviderNotice('Invalid YouTube URL. Please use a direct video link, not a channel/home URL.', 'warning');
        return;
      }

      // Convert watch/share/shorts links to a stable embeddable URL format.
      const embedUrl = buildYouTubeEmbedUrl(videoId);
      if (iframe) iframe.src = embedUrl;

      setupYouTubePlayer(videoId, lesson);
      startYouTubeApiWatchdog();
      startInteractiveQuizzes(lesson, interactiveQuizzes, createYouTubeProvider(), 'youtube');
      bindYouTubeFallbackInteraction();
      // Start fallback timer immediately; API polling will take over/override when available.
      startYouTubeFallbackTimer();
      setPlaybackTimeBadgeVisible(true);
      updatePlaybackTimeBadge(0, null, 'yt');
      setProviderNotice('Timed quizzes are running in precise mode (YouTube API).', 'success');
      setPlaybackState(false);
      if (player) player.style.display = 'block';
      updatePlayerViewportState();
      if (typeof window.__updateContext === 'function') {
        window.__updateContext({
          lessonId: String(lesson._id || ''),
          type: 'video',
          slideIndex: null
        });
      }
      return;
    }

    if (isDirectVideoFileUrl(url)) {
      stopDriveTimer();
      teardownYouTubePlayer();
      deactivateIframeElement(iframe);
      activateHtml5Element(html5);
      bindPlayerViewportStateHandlers();
      setupHtml5Player(url, lesson);
      startInteractiveQuizzes(lesson, interactiveQuizzes, createHtml5Provider(), 'html5');
      setPlaybackTimeBadgeVisible(true);
      updatePlaybackTimeBadge(0, null, 'html5');
      setProviderNotice('Timed quizzes are running in precise mode (HTML5 video).', 'success');

      if (player) player.style.display = 'block';
      updatePlayerViewportState();
      if (typeof window.__updateContext === 'function') {
        window.__updateContext({
          lessonId: String(lesson._id || ''),
          type: 'video',
          slideIndex: null
        });
      }
      return;
    }

    teardownYouTubePlayer();
    teardownHtml5Player();
    deactivateHtml5Element(html5);
    activateIframeElement(iframe);
    bindPlayerViewportStateHandlers();
    setVideoIframeSourceWithFallback(iframe, url, rawUrl);
    if (player) player.style.display = 'block';
    updatePlayerViewportState();
    startInteractiveQuizzes(lesson, interactiveQuizzes, createFallbackProvider(), 'drive-iframe');
    startDriveTimer();
    setPlaybackTimeBadgeVisible(true);
    updatePlaybackTimeBadge(0, null, 'drive');
    setProviderNotice('Google Drive iframe does not provide exact currentTime API. Timed quizzes run in approximate mode. For precision, use YouTube or direct MP4.', 'warning');

    if (typeof window.__updateContext === 'function') {
      window.__updateContext({
        lessonId: String(lesson._id || ''),
        type: 'video',
        slideIndex: null
      });
    }

    setPlaybackState(true);
  }

  function renderSlide(lesson) {
    resetInteractiveVideoQuizState();
    setPlaybackTimeBadgeVisible(false);
    teardownYouTubePlayer();
    teardownHtml5Player();
    setProviderNotice('', '');
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
    if (typeof window.__updateContext === 'function') {
      window.__updateContext({
        lessonId: String(lesson._id || ''),
        type: 'slide',
        slideIndex: currentSlideIndex
      });
    }
  }

  function showSlide(lesson) {
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

    renderSlideElements(slide);

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

  function renderSlideElements(slide) {
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
        const width = Math.max(40, Number(el.width || 280));
        const height = Math.max(30, Number(el.height || 80));
        div.style.width = (width * scale) + 'px';
        div.style.height = (height * scale) + 'px';
        div.style.fontSize = (getFittedSlideTextFontSize(el) * scale) + 'px';
        div.style.color = String(el.color || '#1c1d1f');
        div.style.fontWeight = el.bold ? '700' : '400';
        div.style.textAlign = ['left', 'center', 'right'].includes(el.align) ? el.align : 'left';
        div.style.whiteSpace = 'pre-wrap';
        div.style.overflowWrap = 'anywhere';
        div.style.overflow = 'hidden';
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
        const height = Number(el.height || 160);
        if (Number.isFinite(width)) {
          img.style.width = (width * scale) + 'px';
        }
        if (Number.isFinite(height)) {
          img.style.height = (height * scale) + 'px';
        }
        canvas.appendChild(img);
      }
    });
  }

  function getFittedSlideTextFontSize(el) {
    const width = Math.max(24, Number(el && el.width || 280) - 16);
    const height = Math.max(24, Number(el && el.height || 80) - 12);
    const content = String(el && el.text || '').trim() || 'Text';
    const fontWeight = el && el.bold ? '700' : '400';
    const textAlign = ['left', 'center', 'right'].includes(el && el.align) ? el.align : 'left';
    const maxFont = Math.min(SLIDE_MAX_TEXT_FONT_SIZE, Math.max(10, Number(el && el.fontSize || 28)));

    const measure = document.createElement('div');
    measure.style.position = 'absolute';
    measure.style.visibility = 'hidden';
    measure.style.pointerEvents = 'none';
    measure.style.left = '-99999px';
    measure.style.top = '-99999px';
    measure.style.width = width + 'px';
    measure.style.whiteSpace = 'pre-wrap';
    measure.style.overflowWrap = 'anywhere';
    measure.style.wordBreak = 'break-word';
    measure.style.lineHeight = '1.3';
    measure.style.fontWeight = fontWeight;
    measure.style.textAlign = textAlign;
    measure.textContent = content;
    document.body.appendChild(measure);

    let fontSize = maxFont;
    while (fontSize > 10) {
      measure.style.fontSize = fontSize + 'px';
      if (measure.scrollWidth <= width + 1 && measure.scrollHeight <= height + 1) {
        break;
      }
      fontSize -= 1;
    }

    document.body.removeChild(measure);
    return Math.max(10, fontSize);
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
    resetInteractiveVideoQuizState();
    setPlaybackTimeBadgeVisible(false);
    teardownYouTubePlayer();
    teardownHtml5Player();
    setProviderNotice('', '');
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

    if (typeof window.__updateContext === 'function') {
      window.__updateContext({
        lessonId: String(lesson._id || ''),
        type: 'quiz',
        slideIndex: null
      });
    }

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
      body: JSON.stringify({
        quizId: quizId,
        score: scoreValue,
        total: totalValue,
        lessonName: lesson && lesson.title || '',
        lessonType: lesson && lesson.type || 'quiz',
        sectionIndex: lesson && lesson.sectionIndex,
        lessonIndex: lesson && lesson.lessonIndex
      })
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

  function normalizeInteractiveQuizzes(quizzes) {
    const source = Array.isArray(quizzes) ? quizzes : [];
    return source
      .map(function(entry, index) {
        const options = Array.isArray(entry && entry.options)
          ? entry.options.map(function(opt) { return String(opt || '').trim(); }).slice(0, 4)
          : [];

        while (options.length < 4) options.push('');

        const trigger = Number(entry && entry.triggerTimeSec);
        const correct = Number(entry && entry.correctOptionIndex);

        return {
          _id: String((entry && entry._id) || ('quiz-' + index + '-' + Math.floor(trigger || 0))),
          triggerTimeSec: Number.isFinite(trigger) && trigger >= 0 ? trigger : 0,
          question: String(entry && entry.question || '').trim(),
          options: options,
          correctOptionIndex: Number.isFinite(correct) && correct >= 0 && correct <= 3 ? correct : 0,
          explanation: String(entry && entry.explanation || '').trim(),
          pauseOnShow: entry && entry.pauseOnShow === false ? false : true,
          order: Number.isFinite(Number(entry && entry.order)) ? Number(entry.order) : index
        };
      })
      .filter(function(entry) { return entry.question; })
      .sort(function(a, b) {
        if (a.triggerTimeSec !== b.triggerTimeSec) return a.triggerTimeSec - b.triggerTimeSec;
        return a.order - b.order;
      });
  }

  function getInteractiveStorageMap() {
    const deps = getDeps();
    const key = deps.storageKey('interactiveSeen');
    return deps.readJson(key, {});
  }

  function setInteractiveStorageMap(map) {
    const deps = getDeps();
    const key = deps.storageKey('interactiveSeen');
    deps.writeJson(key, map || {});
  }

  function _getSeenQuizSet(lessonId) {
    const map = getInteractiveStorageMap();
    const raw = Array.isArray(map && map[lessonId]) ? map[lessonId] : [];
    return new Set(raw.map(function(id) { return String(id); }));
  }

  function _markQuizSeen(lessonId, quizId) {
    const map = getInteractiveStorageMap();
    const key = String(lessonId || '');
    const current = new Set(Array.isArray(map[key]) ? map[key].map(function(id) { return String(id); }) : []);
    current.add(String(quizId));
    map[key] = Array.from(current);
    setInteractiveStorageMap(map);
  }

  function startInteractiveQuizzes(lesson, quizzes, provider, providerType) {
    const lessonId = String(lesson && lesson._id || '');
    interactiveState.lessonId = lessonId;
    interactiveState.quizzes = Array.isArray(quizzes) ? quizzes : [];
    interactiveState.provider = provider || createFallbackProvider();
    interactiveState.providerType = String(providerType || 'fallback');
    // Trigger quizzes fresh on each lesson open so authors/students can retest immediately.
    interactiveState.shownQuizIds = new Set();
    interactiveState.activeQuiz = null;
    interactiveState.pendingIconQuiz = null;
    interactiveState.wasPlayingBeforeModal = false;
    hideInteractiveQuizModal();
    hideInteractiveQuizHotspot();
    bindInteractiveQuizHotspot();

    const next = interactiveState.quizzes.length ? Number(interactiveState.quizzes[0].triggerTimeSec || 0) : '';
    updateInteractiveDebug({
      provider: interactiveState.providerType,
      lessonId: lessonId,
      quizzesTotal: interactiveState.quizzes.length,
      shownCount: 0,
      currentTime: 0,
      nextTrigger: next,
      activeQuizId: '',
      activeQuizTime: '',
      status: interactiveState.quizzes.length ? 'armed' : 'no-quizzes'
    });
  }

  function resetInteractiveVideoQuizState() {
    stopDriveTimer();
    interactiveState.lessonId = '';
    interactiveState.quizzes = [];
    interactiveState.shownQuizIds = new Set();
    interactiveState.activeQuiz = null;
    interactiveState.pendingIconQuiz = null;
    interactiveState.provider = null;
    interactiveState.providerType = '';
    interactiveState.wasPlayingBeforeModal = false;
    hideInteractiveQuizModal();
    hideInteractiveQuizHotspot();

    updateInteractiveDebug({
      provider: '',
      lessonId: '',
      quizzesTotal: 0,
      shownCount: 0,
      currentTime: 0,
      nextTrigger: '',
      activeQuizId: '',
      activeQuizTime: '',
      status: 'reset'
    });
  }

  function checkInteractiveQuizTriggers(currentTimeSec) {
    if (!interactiveState || !interactiveState.lessonId || !interactiveState.quizzes.length) return;
    if (interactiveState.activeQuiz || interactiveState.pendingIconQuiz) return;

    const currentTime = Number(currentTimeSec);
    if (!Number.isFinite(currentTime) || currentTime < 0) return;

    const nextPending = interactiveState.quizzes.find(function(entry) {
      if (!entry || !entry._id) return false;
      return !interactiveState.shownQuizIds.has(String(entry._id));
    });

    updateInteractiveDebug({
      currentTime: currentTime.toFixed(1),
      shownCount: interactiveState.shownQuizIds.size,
      nextTrigger: nextPending ? Number(nextPending.triggerTimeSec || 0) : 'none',
      status: 'checking'
    });

    const trigger = interactiveState.quizzes.find(function(entry) {
      if (!entry || !entry._id) return false;
      if (interactiveState.shownQuizIds.has(String(entry._id))) return false;
      return currentTime >= Number(entry.triggerTimeSec || 0);
    });

    if (!trigger) return;

    interactiveState.activeQuiz = trigger;
    interactiveState.shownQuizIds.add(String(trigger._id));

    updateInteractiveDebug({
      shownCount: interactiveState.shownQuizIds.size,
      activeQuizId: String(trigger._id),
      activeQuizTime: Number(trigger.triggerTimeSec || 0),
      status: 'triggered'
    });

    interactiveState.pendingIconQuiz = trigger;
    interactiveState.activeQuiz = null;
    showInteractiveQuizHotspot(trigger);

    updateInteractiveDebug({
      activeQuizId: String(trigger._id),
      activeQuizTime: Number(trigger.triggerTimeSec || 0),
      status: 'icon-waiting-click'
    });
  }

  function bindInteractiveQuizHotspot() {
    const hotspot = document.getElementById('interactiveQuizHotspot');
    if (!hotspot || hotspot.dataset.bound === '1') return;

    hotspot.dataset.bound = '1';
    hotspot.addEventListener('click', function() {
      const quiz = interactiveState.pendingIconQuiz;
      if (!quiz) return;
      const anchorRect = hotspot.getBoundingClientRect();
      interactiveState.pendingIconQuiz = null;
      interactiveState.activeQuiz = quiz;
      hideInteractiveQuizHotspot();
      showInteractiveQuizModal(quiz, anchorRect);
    });
  }

  function showInteractiveQuizHotspot(quiz) {
    const container = document.getElementById('videoPlayerContainer');
    const hotspot = document.getElementById('interactiveQuizHotspot');
    if (!container || !hotspot || !quiz) return;

    if (interactiveHotspotTimeoutId) {
      clearTimeout(interactiveHotspotTimeoutId);
      interactiveHotspotTimeoutId = null;
    }

    const position = quiz.position || {};
    const xPercent = Number.isFinite(Number(position.xPercent)) ? Number(position.xPercent) : 86;
    const yPercent = Number.isFinite(Number(position.yPercent)) ? Number(position.yPercent) : 82;

    const rect = container.getBoundingClientRect();
    const size = 34;
    const left = Math.max(0, Math.min(rect.width - size, (rect.width * (xPercent / 100)) - (size / 2)));
    const top = Math.max(0, Math.min(rect.height - size, (rect.height * (yPercent / 100)) - (size / 2)));

    hotspot.style.left = left + 'px';
    hotspot.style.top = top + 'px';
    hotspot.style.display = 'inline-flex';

    interactiveHotspotTimeoutId = setTimeout(function() {
      if (!interactiveState.pendingIconQuiz) return;
      interactiveState.pendingIconQuiz = null;
      interactiveState.activeQuiz = null;
      hideInteractiveQuizHotspot();
      updateInteractiveDebug({ status: 'icon-timeout-hidden' });
    }, 5000);
  }

  function hideInteractiveQuizHotspot() {
    const hotspot = document.getElementById('interactiveQuizHotspot');
    if (interactiveHotspotTimeoutId) {
      clearTimeout(interactiveHotspotTimeoutId);
      interactiveHotspotTimeoutId = null;
    }
    if (!hotspot) return;
    hotspot.style.display = 'none';
  }

  function formatQuizTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return mins + ':' + String(secs).padStart(2, '0');
  }

  function showInteractiveQuizModal(quiz, anchorRect) {
    const modal = document.getElementById('interactiveQuizModal');
    if (!modal) return;
    const isMobileInlineQuiz = window.matchMedia('(max-width: 767.98px)').matches;

    const questionEl = modal.querySelector('[data-iq-question]');
    const optionsEl = modal.querySelector('[data-iq-options]');
    const feedbackEl = modal.querySelector('[data-iq-feedback]');
    const closeBtn = modal.querySelector('[data-iq-close]');
    const submitBtn = modal.querySelector('[data-iq-submit]');
    const stampEl = modal.querySelector('[data-iq-stamp]');

    if (questionEl) questionEl.textContent = quiz.question;
    if (stampEl) stampEl.textContent = 'Checkpoint at ' + formatQuizTime(quiz.triggerTimeSec);
    modal.classList.add('inline-quiz-mode');
    modal.classList.toggle('is-mobile', isMobileInlineQuiz);
    if (feedbackEl) {
      feedbackEl.className = 'interactive-quiz-feedback';
      feedbackEl.textContent = '';
    }

    let selectedIndex = -1;
    let answered = false;

    if (optionsEl) {
      optionsEl.innerHTML = quiz.options.map(function(option, idx) {
        return '' +
          '<button class="interactive-quiz-option" type="button" data-iq-option="' + idx + '">' +
            getDeps().escapeHtml(option || ('Option ' + (idx + 1))) +
          '</button>';
      }).join('');

      optionsEl.querySelectorAll('[data-iq-option]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          if (answered) return;
          selectedIndex = Number(btn.dataset.iqOption);

          optionsEl.querySelectorAll('[data-iq-option]').forEach(function(other) {
            other.classList.remove('is-selected');
          });
          btn.classList.add('is-selected');

          if (submitBtn) submitBtn.disabled = false;
        });
      });
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.onclick = function() {
        if (selectedIndex < 0 || answered) return;

        answered = true;
        const isCorrect = selectedIndex === Number(quiz.correctOptionIndex);

        if (optionsEl) {
          optionsEl.querySelectorAll('[data-iq-option]').forEach(function(btn) {
            const idx = Number(btn.dataset.iqOption);
            btn.disabled = true;
            if (idx === Number(quiz.correctOptionIndex)) {
              btn.classList.add('is-correct');
            } else if (idx === selectedIndex && !isCorrect) {
              btn.classList.add('is-wrong');
            }
          });
        }

        if (feedbackEl) {
          feedbackEl.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
          feedbackEl.textContent = isCorrect
            ? 'Correct. Great job.'
            : 'Incorrect. ' + (quiz.explanation || 'Review this part and continue learning.');
        }

        if (closeBtn) closeBtn.disabled = false;
        submitBtn.disabled = true;

        // Give learners more time to read explanation when they answer incorrectly.
        const autoCloseDelayMs = isCorrect ? 850 : 5000;
        setTimeout(function() {
          hideInteractiveQuizModal();
          interactiveState.activeQuiz = null;
          updateInteractiveDebug({
            activeQuizId: '',
            activeQuizTime: '',
            status: 'answered-auto-closed'
          });
        }, autoCloseDelayMs);
      };
    }

    if (closeBtn) {
      closeBtn.disabled = false;
      closeBtn.textContent = 'Skip';
      closeBtn.onclick = function() {
        hideInteractiveQuizModal();
        interactiveState.activeQuiz = null;
        updateInteractiveDebug({
          activeQuizId: '',
          activeQuizTime: '',
          status: 'modal-closed'
        });
      };
    }

    const container = document.getElementById('videoPlayerContainer');
    if (container && modal.parentElement !== container) {
      container.appendChild(modal);
    }

    if (container && isMobileInlineQuiz) {
      modal.style.display = 'block';
      modal.style.left = '50%';
      modal.style.top = '';
      modal.style.bottom = '10px';
      modal.style.display = '';
    } else if (container && anchorRect) {
      const containerRect = container.getBoundingClientRect();
      const gap = 10;

      // Show temporarily to measure dialog size accurately before final placement.
      modal.style.display = 'block';
      modal.style.left = '0px';
      modal.style.top = '0px';
      modal.style.bottom = '';

      const popupWidth = Math.min(340, Math.max(250, modal.offsetWidth || 320));
      const popupHeight = Math.max(170, modal.offsetHeight || 220);

      let left = (anchorRect.right - containerRect.left) + gap;
      if (left + popupWidth > containerRect.width - 8) {
        left = (anchorRect.left - containerRect.left) - popupWidth - gap;
      }

      left = Math.max(8, Math.min(left, containerRect.width - popupWidth - 8));
      let top = (anchorRect.top - containerRect.top) + (anchorRect.height / 2) - (popupHeight / 2);
      top = Math.max(8, Math.min(top, containerRect.height - popupHeight - 8));

      modal.style.left = left + 'px';
      modal.style.top = top + 'px';
      modal.style.display = '';
    }

    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    updateInteractiveDebug({
      activeQuizId: String(quiz && quiz._id || ''),
      activeQuizTime: Number(quiz && quiz.triggerTimeSec || 0),
      status: 'modal-open'
    });
  }

  function hideInteractiveQuizModal() {
    const modal = document.getElementById('interactiveQuizModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.classList.remove('inline-quiz-mode');
    modal.classList.remove('is-mobile');
    modal.style.left = '';
    modal.style.top = '';
    modal.style.bottom = '';
    modal.setAttribute('aria-hidden', 'true');
  }

  function createYouTubeProvider() {
    return {
      pause: function() {
        if (youtubePlayer && typeof youtubePlayer.pauseVideo === 'function') {
          youtubePlayer.pauseVideo();
        }
      },
      play: function() {
        if (youtubePlayer && typeof youtubePlayer.playVideo === 'function') {
          youtubePlayer.playVideo();
        }
      },
      isPlaying: function() {
        if (!window.YT || !window.YT.PlayerState || !youtubePlayer || typeof youtubePlayer.getPlayerState !== 'function') {
          return false;
        }
        return youtubePlayer.getPlayerState() === window.YT.PlayerState.PLAYING;
      }
    };
  }

  function createHtml5Provider() {
    return {
      pause: function() {
        if (html5VideoPlayer && typeof html5VideoPlayer.pause === 'function') {
          html5VideoPlayer.pause();
        }
      },
      play: function() {
        if (html5VideoPlayer && typeof html5VideoPlayer.play === 'function') {
          html5VideoPlayer.play().catch(function() {
            // Ignore autoplay restrictions.
          });
        }
      },
      isPlaying: function() {
        return Boolean(html5VideoPlayer && !html5VideoPlayer.paused && !html5VideoPlayer.ended);
      }
    };
  }

  function setupHtml5Player(url) {
    const player = ensureHtml5VideoPlayer();
    if (!player) return;

    teardownHtml5PlayerListeners();

    html5VideoPlayer = player;
    activateHtml5Element(html5VideoPlayer);
    html5VideoPlayer.src = String(url || '');

    html5PlayHandler = function() {
      setPlaybackState(true);
      if (typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('play', html5VideoPlayer.currentTime || 0);
      }
    };

    html5PauseHandler = function() {
      setPlaybackState(false);
      if (typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('pause', html5VideoPlayer.currentTime || 0);
      }
    };

    html5EndedHandler = function() {
      setPlaybackState(false);
      if (typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('ended', html5VideoPlayer.currentTime || 0);
      }
    };

    html5TimeHandler = function() {
      updatePlaybackTimeBadge(Number(html5VideoPlayer.currentTime || 0), Number(html5VideoPlayer.duration || 0), 'html5');
      updateInteractiveDebug({
        provider: interactiveState.providerType || 'html5',
        currentTime: Number(html5VideoPlayer.currentTime || 0).toFixed(1),
        status: 'html5-timeupdate'
      });
      checkInteractiveQuizTriggers(Number(html5VideoPlayer.currentTime || 0));
    };

    html5VideoPlayer.addEventListener('play', html5PlayHandler);
    html5VideoPlayer.addEventListener('pause', html5PauseHandler);
    html5VideoPlayer.addEventListener('ended', html5EndedHandler);
    html5VideoPlayer.addEventListener('timeupdate', html5TimeHandler);

    html5VideoPlayer.load();
    setPlaybackState(true);
    bindPlayerViewportStateHandlers();
    updatePlayerViewportState();
  }

  function teardownHtml5PlayerListeners() {
    if (!html5VideoPlayer) return;
    if (html5PlayHandler) html5VideoPlayer.removeEventListener('play', html5PlayHandler);
    if (html5PauseHandler) html5VideoPlayer.removeEventListener('pause', html5PauseHandler);
    if (html5EndedHandler) html5VideoPlayer.removeEventListener('ended', html5EndedHandler);
    if (html5TimeHandler) html5VideoPlayer.removeEventListener('timeupdate', html5TimeHandler);
    html5PlayHandler = null;
    html5PauseHandler = null;
    html5EndedHandler = null;
    html5TimeHandler = null;
  }

  function teardownHtml5Player() {
    teardownHtml5PlayerListeners();
    if (!html5VideoPlayer) {
      html5VideoPlayer = document.getElementById('html5VideoPlayer');
    }
    if (html5VideoPlayer) {
      html5VideoPlayer.pause();
      html5VideoPlayer.removeAttribute('src');
      html5VideoPlayer.load();
      deactivateHtml5Element(html5VideoPlayer);
    }
    html5VideoPlayer = null;
    setPlaybackTimeBadgeVisible(false);
    updatePlayerViewportState();
  }

  function createFallbackProvider() {
    return {
      pause: function() {
        setPlaybackState(false);
      },
      play: function() {
        setPlaybackState(true);
      },
      isPlaying: function() {
        const playback = window.__videoPlayback || {};
        return playback.isPlaying !== false;
      }
    };
  }

  function startDriveTimer() {
    stopDriveTimer();
    driveElapsedSeconds = 0;
    driveLastTickAt = Date.now();
    driveTimerId = setInterval(function() {
      if (!interactiveState.lessonId || interactiveState.providerType === 'youtube' || interactiveState.providerType === 'html5') return;

      const playback = window.__videoPlayback || {};
      const isVisible = document.visibilityState === 'visible';
      const now = Date.now();
      const deltaSec = Math.max(0, (now - driveLastTickAt) / 1000);
      driveLastTickAt = now;

      if (!isVisible || playback.isPlaying === false) return;

      driveElapsedSeconds += deltaSec;
      updatePlaybackTimeBadge(driveElapsedSeconds, null, 'drive');
      updateInteractiveDebug({
        provider: interactiveState.providerType || 'drive-iframe',
        currentTime: driveElapsedSeconds.toFixed(1),
        status: 'drive-tick'
      });
      checkInteractiveQuizTriggers(driveElapsedSeconds);
    }, 500);
  }

  function stopDriveTimer() {
    if (driveTimerId) {
      clearInterval(driveTimerId);
      driveTimerId = null;
    }
    driveElapsedSeconds = 0;
    driveLastTickAt = 0;
  }

  function renderPanel(typeLabel, title, htmlBody, showCompleteButton) {
    const deps = getDeps();
    const imageContainer = document.getElementById('imageContainer');
    const player = document.getElementById('videoPlayerContainer');
    const iframe = document.getElementById('videoIframe');
    const html5 = document.getElementById('html5VideoPlayer');

    if (imageContainer) imageContainer.style.display = 'none';
    if (iframe) iframe.src = '';
    if (html5) {
      html5.pause();
      html5.removeAttribute('src');
      html5.load();
      html5.style.display = 'none';
    }
    if (player) player.style.display = 'none';
    setPlaybackTimeBadgeVisible(false);

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

  function buildYouTubeEmbedUrl(videoId) {
    const id = String(videoId || '').trim();
    if (!id) return '';
    const url = new URL('https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id));
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', window.location.origin);
    url.searchParams.set('rel', '0');
    url.searchParams.set('playsinline', '1');
    url.searchParams.set('fs', '0');
    url.searchParams.set('modestbranding', '1');
    url.searchParams.set('iv_load_policy', '3');
    url.searchParams.set('showinfo', '0');
    return url.toString();
  }

  function isDirectVideoFileUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return false;
    return /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(raw);
  }

  function setProviderNotice(message, level) {
    const el = document.getElementById('videoProviderNotice');
    if (!el) return;

    const text = String(message || '').trim();
    if (!text) {
      el.style.display = 'none';
      el.textContent = '';
      el.className = 'small mb-3';
      return;
    }

    el.style.display = 'block';
    el.textContent = text;
    el.className = 'small mb-3 ' + (level === 'success' ? 'notice-success' : 'notice-warning');
  }

  function formatPlaybackTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) {
      return hours + ':' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }
    return mins + ':' + String(secs).padStart(2, '0');
  }

  function ensurePlaybackTimeBadge() {
    if (!SHOW_PLAYBACK_TIME_BADGE) return null;
    if (playbackTimeBadge && document.body && document.body.contains(playbackTimeBadge)) {
      return playbackTimeBadge;
    }

    const container = document.getElementById('videoPlayerContainer');
    if (!container) return null;

    const badge = document.createElement('div');
    badge.id = 'playbackTimeBadge';
    badge.style.position = 'absolute';
    badge.style.right = '16px';
    badge.style.bottom = '16px';
    badge.style.transform = 'none';
    badge.style.minWidth = '148px';
    badge.style.height = '36px';
    badge.style.zIndex = '8';
    badge.style.padding = '0 12px';
    badge.style.borderRadius = '999px';
    badge.style.background = 'rgba(2, 6, 23, 0.72)';
    badge.style.color = 'rgb(248, 250, 252)';
    badge.style.font = '13px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.pointerEvents = 'none';
    badge.textContent = '00:00 / --:--';
    badge.title = 'Playback time';

    container.appendChild(badge);
    playbackTimeBadge = badge;
    return badge;
  }

  function setPlaybackTimeBadgeVisible(visible) {
    if (!SHOW_PLAYBACK_TIME_BADGE) return;
    const badge = ensurePlaybackTimeBadge();
    if (!badge) return;
    badge.style.display = visible ? 'inline-flex' : 'none';
  }

  function updatePlaybackTimeBadge(currentSec, durationSec) {
    if (!SHOW_PLAYBACK_TIME_BADGE) return;
    const badge = ensurePlaybackTimeBadge();
    if (!badge) return;

    const current = formatPlaybackTime(Number(currentSec) || 0);
    const duration = Number(durationSec);
    const durationText = Number.isFinite(duration) && duration > 0 ? formatPlaybackTime(duration) : '--:--';
    badge.textContent = current + ' / ' + durationText;
    badge.title = 'Playback time';
  }

  function extractGoogleDriveMeta(inputUrl) {
    const raw = String(inputUrl || '').trim();
    if (!raw) return null;

    let parsed;
    try {
      parsed = new URL(raw, window.location.origin);
    } catch {
      return null;
    }

    const host = String(parsed.hostname || '').toLowerCase();
    if (!host.includes('drive.google.com')) return null;

    const path = parsed.pathname || '';
    let fileId = '';

    const filePathMatch = path.match(/\/file\/d\/([^/]+)/i);
    if (filePathMatch) fileId = filePathMatch[1];

    if (!fileId) {
      fileId = parsed.searchParams.get('id') || '';
    }

    if (!fileId) return null;

    return {
      fileId,
      resourceKey: parsed.searchParams.get('resourcekey') || ''
    };
  }

  function buildGoogleDriveEmbedUrl(fileId, resourceKey) {
    const url = new URL('https://drive.google.com/file/d/' + encodeURIComponent(String(fileId || '')) + '/preview');
    if (resourceKey) {
      url.searchParams.set('resourcekey', String(resourceKey));
    }
    url.searchParams.set('usp', 'drivesdk');
    return url.toString();
  }

  function normalizeVideoEmbedUrl(inputUrl) {
    const raw = String(inputUrl || '').trim();
    if (!raw) return '';

    if (isYouTubeUrl(raw)) return raw;

    const driveMeta = extractGoogleDriveMeta(raw);
    if (!driveMeta) return raw;

    // Normalize all Drive link variants to the reliable iframe preview endpoint.
    return buildGoogleDriveEmbedUrl(driveMeta.fileId, driveMeta.resourceKey);
  }

  function setVideoIframeSourceWithFallback(iframe, normalizedUrl, originalUrl) {
    if (!iframe) return;

    const primaryUrl = String(normalizedUrl || '').trim();
    if (!primaryUrl) {
      iframe.src = '';
      return;
    }

    iframe.src = primaryUrl;

    const meta = extractGoogleDriveMeta(primaryUrl || originalUrl);
    if (!meta) return;

    // If browser/load policy rejects the keyed URL, retry once without resource key.
    const fallback = buildGoogleDriveEmbedUrl(meta.fileId, '');
    if (fallback === primaryUrl) return;

    let switched = false;
    const timer = window.setTimeout(function() {
      if (switched) return;
      switched = true;
      iframe.src = fallback;
    }, 7000);

    iframe.addEventListener('load', function onLoad() {
      window.clearTimeout(timer);
      iframe.removeEventListener('load', onLoad);
    }, { once: true });
  }

  function getYouTubeId(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';

    let parsed;
    try {
      parsed = new URL(raw, window.location.origin);
    } catch {
      parsed = null;
    }

    if (parsed) {
      const host = String(parsed.hostname || '').toLowerCase();
      const path = String(parsed.pathname || '');

      if (host.includes('youtu.be')) {
        const token = path.replace(/^\//, '').split('/')[0];
        return token || '';
      }

      if (host.includes('youtube.com')) {
        const fromQuery = parsed.searchParams.get('v') || parsed.searchParams.get('vi');
        if (fromQuery) return fromQuery;

        const embedMatch = path.match(/^\/embed\/([^/?#]+)/i);
        if (embedMatch) return embedMatch[1];

        const shortsMatch = path.match(/^\/shorts\/([^/?#]+)/i);
        if (shortsMatch) return shortsMatch[1];

        const liveMatch = path.match(/^\/live\/([^/?#]+)/i);
        if (liveMatch) return liveMatch[1];
      }
    }

    // Fallback regex extraction for malformed but common pasted links.
    const shortMatch = raw.match(/youtu\.be\/([a-zA-Z0-9_-]+)/i);
    if (shortMatch) return shortMatch[1];

    const watchMatch = raw.match(/[?&](?:v|vi)=([a-zA-Z0-9_-]+)/i);
    if (watchMatch) return watchMatch[1];

    return '';
  }

  function setupYouTubePlayer(videoId, lesson) {
    youtubeDurationSec = 0;
    ensureYouTubeApi().then(function() {
      const iframe = ensureVideoIframe();
      if (!iframe) return;

      if (!youtubePlayer) {
        youtubePlayer = new window.YT.Player('videoIframe', {
          host: 'https://www.youtube-nocookie.com',
          videoId: videoId,
          playerVars: {
            rel: 0,
            origin: window.location.origin,
            modestbranding: 1,
            iv_load_policy: 3,
            showinfo: 0,
            playsinline: 1
          },
          events: {
            onReady: function() {
              syncYouTubeTime('youtube-ready');
              startYouTubePolling(lesson);
            },
            onStateChange: function(event) {
              handleYouTubeStateChange(event, lesson);
            },
            onError: function() {
              if (!youtubeFallbackTimerId) {
                startYouTubeFallbackTimer();
              }
              updateInteractiveDebug({
                provider: interactiveState.providerType || 'youtube',
                status: 'youtube-player-error-fallback'
              });
            }
          }
        });
      } else {
        youtubePlayer.loadVideoById(videoId);
        syncYouTubeTime('youtube-load-video');
        startYouTubePolling(lesson);
      }

      // Some embeds report duration a bit later; warm up metadata reads for the first few seconds.
      let warmupTries = 0;
      const warmupId = setInterval(function() {
        warmupTries += 1;
        syncYouTubeTime('youtube-meta-warmup');
        if (youtubeDurationSec > 0 || warmupTries >= 20 || !youtubePlayer) {
          clearInterval(warmupId);
        }
      }, 250);
    }).catch(function(err) {
      console.error('[YouTube API Error]', err);
      if (!youtubeFallbackTimerId) {
        startYouTubeFallbackTimer();
      }
      setProviderNotice('YouTube API unavailable. Timed quizzes are running in fallback mode.', 'warning');
      updateInteractiveDebug({
        provider: interactiveState.providerType || 'youtube',
        status: 'youtube-api-error-fallback'
      });
    });
  }

  function handleYouTubeStateChange(event) {
    if (!window.YT || !window.YT.PlayerState) return;

    const state = event.data;
    const player = event.target;
    const position = player && typeof player.getCurrentTime === 'function'
      ? player.getCurrentTime()
      : 0;

    if (state === window.YT.PlayerState.PLAYING) {
      setPlaybackState(true);
      lastYoutubeTime = position;
      syncYouTubeTime('youtube-state-playing');
      if (typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('play', position);
      }
    }

    if (state === window.YT.PlayerState.PAUSED) {
      setPlaybackState(false);
      syncYouTubeTime('youtube-state-paused');
      if (typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('pause', position);
      }
    }

    if (state === window.YT.PlayerState.ENDED) {
      setPlaybackState(false);
      syncYouTubeTime('youtube-state-ended');
      if (typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('ended', position);
      }
    }
  }

  function syncYouTubeTime(reason) {
    if (!youtubePlayer || typeof youtubePlayer.getCurrentTime !== 'function') return;

    let current = 0;
    let duration = youtubeDurationSec;

    try {
      current = Number(youtubePlayer.getCurrentTime() || 0);
    } catch {
      current = Number(youtubeFallbackElapsed || 0);
    }

    if (typeof youtubePlayer.getDuration === 'function') {
      try {
        const candidate = Number(youtubePlayer.getDuration() || 0);
        if (candidate > 0) {
          youtubeDurationSec = candidate;
          duration = candidate;
        }
      } catch {
        duration = youtubeDurationSec;
      }
    }

    if (current > 0.05) {
      youtubeFallbackElapsed = current;
      youtubeZeroPollCount = 0;
      if (youtubeFallbackTimerId) {
        stopYouTubeFallbackTimer();
      }
    }

    updatePlaybackTimeBadge(current, duration, 'yt');
    checkInteractiveQuizTriggers(current);
    updateInteractiveDebug({
      provider: interactiveState.providerType || 'youtube',
      currentTime: Number(current || 0).toFixed(2),
      status: reason || 'youtube-sync'
    });
    lastYoutubeTime = current;
  }

  function startYouTubePolling() {
    if (youtubePollId) clearInterval(youtubePollId);
    stopYouTubeApiWatchdog();
    youtubeZeroPollCount = 0;

    youtubePollId = setInterval(function() {
      if (!youtubePlayer || typeof youtubePlayer.getCurrentTime !== 'function') return;
      const before = lastYoutubeTime;
      syncYouTubeTime(youtubeFallbackTimerId ? 'youtube-poll-fallback' : 'youtube-poll');
      const current = lastYoutubeTime;

      const delta = Math.abs(current - before);
      if (before && delta > 4 && typeof window.__trackVideoEvent === 'function') {
        window.__trackVideoEvent('seek', current);
      }

      if (current <= 0.2) {
        youtubeZeroPollCount += 1;
      }

      // If API time stays at 0 for ~10s while video is likely playing, switch to approximate wall-clock fallback.
      if (youtubeZeroPollCount >= 5 && !youtubeFallbackTimerId) {
        startYouTubeFallbackTimer();
        setProviderNotice('YouTube API timing unavailable. Timed quizzes are running in approximate fallback mode.', 'warning');
      }
    }, youtubePollIntervalMs);
  }

  function startYouTubeApiWatchdog() {
    stopYouTubeApiWatchdog();
    youtubeApiWatchdogId = setTimeout(function() {
      if (youtubePollId) return;

      // API did not become ready in time; keep interactive quizzes functional via fallback timing.
      if (!youtubeFallbackTimerId) {
        startYouTubeFallbackTimer();
      }
      setProviderNotice('YouTube API did not initialize. Timed quizzes are running in fallback mode.', 'warning');
      updateInteractiveDebug({
        provider: interactiveState.providerType || 'youtube',
        status: 'youtube-api-timeout-fallback'
      });
    }, 6000);
  }

  function stopYouTubeApiWatchdog() {
    if (youtubeApiWatchdogId) {
      clearTimeout(youtubeApiWatchdogId);
      youtubeApiWatchdogId = null;
    }
  }

  function startYouTubeFallbackTimer() {
    if (youtubeFallbackTimerId) return;

    let lastTick = Date.now();
    updateInteractiveDebug({
      provider: interactiveState.providerType || 'youtube',
      status: 'youtube-fallback-started'
    });

    youtubeFallbackTimerId = setInterval(function() {
      const now = Date.now();
      const delta = Math.max(0, (now - lastTick) / 1000);
      lastTick = now;

      if (!interactiveState.lessonId || interactiveState.providerType !== 'youtube') return;

      const playback = window.__videoPlayback || {};
      if (!playback.isPlaying) {
        updateInteractiveDebug({
          provider: interactiveState.providerType || 'youtube',
          status: 'youtube-fallback-waiting-play'
        });
        return;
      }

      youtubeFallbackElapsed += delta;
      updatePlaybackTimeBadge(youtubeFallbackElapsed, youtubeDurationSec, 'yt');
      updateInteractiveDebug({
        provider: interactiveState.providerType || 'youtube',
        currentTime: youtubeFallbackElapsed.toFixed(1),
        status: 'youtube-fallback-tick'
      });
      checkInteractiveQuizTriggers(youtubeFallbackElapsed);
    }, 500);
  }

  function bindYouTubeFallbackInteraction() {
    if (youtubeFallbackInteractionBound) return;
    ensurePlaybackTimeBadge();
    youtubeFallbackInteractionBound = true;
  }

  function stopYouTubeFallbackTimer() {
    if (youtubeFallbackTimerId) {
      clearInterval(youtubeFallbackTimerId);
      youtubeFallbackTimerId = null;
    }
  }

  function teardownYouTubePlayer() {
    stopYouTubeApiWatchdog();
    if (youtubePollId) {
      clearInterval(youtubePollId);
      youtubePollId = null;
    }
    stopYouTubeFallbackTimer();

    if (youtubePlayer && typeof youtubePlayer.destroy === 'function') {
      youtubePlayer.destroy();
    }

    youtubePlayer = null;
    lastYoutubeTime = 0;
    youtubeDurationSec = 0;
    youtubeZeroPollCount = 0;
    youtubeFallbackElapsed = 0;
    setPlaybackTimeBadgeVisible(false);

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
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    container.appendChild(iframe);
    return iframe;
  }

  function activateIframeElement(iframe) {
    if (!iframe) return;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.removeAttribute('allowfullscreen');
    iframe.hidden = false;
    iframe.setAttribute('aria-hidden', 'false');
    iframe.style.display = 'block';
    iframe.style.pointerEvents = 'auto';
  }

  function deactivateIframeElement(iframe) {
    if (!iframe) return;
    iframe.hidden = true;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.display = 'none';
    iframe.style.pointerEvents = 'none';
    iframe.src = '';
  }

  function ensureHtml5VideoPlayer() {
    let video = document.getElementById('html5VideoPlayer');
    if (video) return video;

    const container = document.getElementById('videoPlayerContainer');
    if (!container) return null;

    video = document.createElement('video');
    video.id = 'html5VideoPlayer';
    video.controls = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('controlslist', 'nofullscreen noremoteplayback');
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.background = '#000';
    video.style.display = 'none';
    container.appendChild(video);
    return video;
  }

  function activateHtml5Element(video) {
    if (!video) return;
    video.hidden = false;
    video.setAttribute('aria-hidden', 'false');
    video.controls = true;
    video.setAttribute('controlslist', 'nofullscreen noremoteplayback');
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    video.style.display = 'block';
    video.style.pointerEvents = 'auto';
  }

  function deactivateHtml5Element(video) {
    if (!video) return;
    video.pause();
    video.controls = false;
    video.hidden = true;
    video.setAttribute('aria-hidden', 'true');
    video.style.display = 'none';
    video.style.pointerEvents = 'none';
  }

  function isMobilePlayerViewport() {
    return Boolean(window.matchMedia && window.matchMedia('(max-width: 767.98px)').matches);
  }

  function isLandscapePlayerViewport() {
    return Boolean(window.matchMedia && window.matchMedia('(orientation: landscape)').matches);
  }

  function updatePlayerViewportState() {
    const container = document.getElementById('videoPlayerContainer');
    if (!container) return;

    const isMobile = isMobilePlayerViewport();
    const isLandscape = isLandscapePlayerViewport();
    const isPortraitInline = isMobile && !isLandscape;
    const isLandscapeInline = isMobile && isLandscape;

    container.classList.toggle('is-mobile-viewport', isMobile);
    container.classList.add('is-player-inline');
    container.classList.toggle('is-mobile-portrait-inline', isPortraitInline);
    container.classList.toggle('is-mobile-landscape-inline', isLandscapeInline);
  }

  function bindPlayerViewportStateHandlers() {
    if (playerViewportStateBound) return;

    const handleViewportStateChange = function() {
      updatePlayerViewportState();
    };

    window.addEventListener('resize', handleViewportStateChange);
    window.addEventListener('orientationchange', handleViewportStateChange);
    playerViewportStateBound = true;
  }

  function ensureYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();

    if (!youtubeReadyPromise) {
      youtubeReadyPromise = new Promise(function(resolve, reject) {
        const timeoutId = setTimeout(function() {
          reject(new Error('YouTube iframe API timed out'));
        }, 5000);

        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function() {
          if (typeof previous === 'function') previous();
          clearTimeout(timeoutId);
          resolve();
        };

        // If YT object is already present but callback was missed earlier, resolve immediately.
        if (window.YT && window.YT.Player) {
          clearTimeout(timeoutId);
          resolve();
          return;
        }

        const existingApiScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
        if (!existingApiScript) {
          const tag = document.createElement('script');
          tag.src = 'https://www.youtube.com/iframe_api';
          tag.async = true;
          tag.onerror = function() {
            clearTimeout(timeoutId);
            reject(new Error('Failed to load YouTube iframe API script'));
          };
          document.head.appendChild(tag);
        }
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
