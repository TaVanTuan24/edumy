(function() {
  'use strict';

  let reviewsLoaded = false;
  let watchStart = 0;
  let activeLessonId = '';
  let activeLessonType = '';
  let lastSlideEventAt = 0;
  let heartbeatId = null;
  let lastActivityAt = Date.now();
  const startedLessons = new Set();
  const heartbeatIntervalMs = 30000;
  const activityGraceMs = 45000;
  const gamificationCollapseStorageKey = 'learning:gamification-collapsed';

  window.currentContext = {
    lessonId: null,
    type: null,
    slideIndex: null,
    sectionIndex: null,
    lessonIndex: null
  };

  window.__videoPlayback = window.__videoPlayback || { isPlaying: false };

  function setVideoPlaybackState(isPlaying) {
    window.__videoPlayback = window.__videoPlayback || {};
    window.__videoPlayback.isPlaying = Boolean(isPlaying);
  }

  function init() {
    if (!window.LearningStore || !window.LearningRender) {
      console.error('Learning modules are not loaded');
      return;
    }

    window.LearningStore.initStore(
      window.__COURSE__ || window.course || {},
      window.completedVideos || [],
      window.completedLessons || []
    );

    bindEvents();
    exposeLegacyHooks();
    resumeLastContext();
    updateProgressUI();
    initializeTabs();
    initializeSidebarCollapsibles();
    toggleNotesVisibility(false);
    bindTrackingFlush();
    bindActivityTracking();
    startHeartbeat();

    window.__setVideoPlaybackState = setVideoPlaybackState;
    syncLearningStageHeader();
  }

  function bindEvents() {
    document.addEventListener('click', function(e) {
      const tabBtn = e.target.closest('.tab-btn');
      if (tabBtn) {
        const tab = tabBtn.dataset.tab;
        if (!tab) return;

        document.querySelectorAll('.tab-btn').forEach(function(btn) {
          btn.classList.remove('active');
        });
        document.querySelectorAll('.tab-pane').forEach(function(pane) {
          pane.classList.remove('active');
        });

        tabBtn.classList.add('active');
        const target = document.getElementById('tab-' + tab);
        if (target) target.classList.add('active');
        handleTabActivation(tab);
        return;
      }

      const sectionHeader = e.target.closest('.section-header');
      if (sectionHeader) {
        const sectionIndex = Number(sectionHeader.dataset.sectionIndex);
        if (Number.isFinite(sectionIndex) && window.LearningRender && typeof window.LearningRender.toggleSection === 'function') {
          window.LearningRender.toggleSection(sectionIndex);
        }
        return;
      }

      const checkbox = e.target.closest('.lesson-progress-checkbox');
      if (checkbox) return;

      const stageNavBtn = e.target.closest('[data-stage-nav]');
      if (stageNavBtn) {
        const direction = stageNavBtn.dataset.stageNav === 'prev' ? -1 : 1;
        if (direction < 0) {
          goPrevLesson();
        } else {
          goNextLesson();
        }
        return;
      }

      const itemEl = e.target.closest('.lesson-item');
      if (!itemEl) return;

      selectLesson(itemEl.dataset.id);
    });

    const listContainer = document.getElementById('sectionsAccordion') || document.getElementById('videoListContainer');
    if (listContainer) {
      listContainer.addEventListener('change', function(e) {
        const checkbox = e.target.closest('.lesson-progress-checkbox');
        if (!checkbox) return;

        const itemEl = checkbox.closest('.lesson-item');
        if (!itemEl) return;

        const lessonId = itemEl.dataset.id;
        preserveOpenSections();
        syncLessonProgressChange(lessonId, checkbox.checked);
      });
    }

    document.addEventListener('keydown', function(e) {
      const tag = String((e.target && e.target.tagName) || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'ArrowRight') goNextLesson();
      if (e.key === 'ArrowLeft') goPrevLesson();
    });

    const reviewBtn = document.getElementById('reviewSubmitBtn');
    if (reviewBtn) {
      reviewBtn.addEventListener('click', submitReview);
    }
  }

  function exposeLegacyHooks() {
    window.showVideos = function(sectionIndex) {
      window.LearningRender.showSection(sectionIndex);
    };

    window.saveNote = saveNote;
    window.__learningMarkCurrent = markCurrentLessonCompleted;
  }

  function initializeSidebarCollapsibles() {
    const btn = document.getElementById('gamificationCollapseBtn');
    const body = document.getElementById('learningGamificationBody');
    if (!btn || !body) return;

    const savedState = localStorage.getItem(gamificationCollapseStorageKey) === 'true';
    setSidebarCollapsedState(btn, body, savedState);

    btn.addEventListener('click', function() {
      const nextCollapsed = btn.getAttribute('aria-expanded') === 'true';
      setSidebarCollapsedState(btn, body, nextCollapsed);
      localStorage.setItem(gamificationCollapseStorageKey, String(nextCollapsed));
    });
  }

  function setSidebarCollapsedState(button, body, collapsed) {
    const isCollapsed = Boolean(collapsed);
    button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    body.classList.toggle('is-collapsed', isCollapsed);
  }

  function resumeLastContext() {
    const deps = window.LearningStore;
    const store = deps.store;
    const search = new URLSearchParams(window.location.search);
    const queryLesson = String(search.get('lesson') || '').trim();
    const querySection = Number(search.get('section'));
    const queryItem = Number(search.get('item'));

    const savedSection = Number(localStorage.getItem(deps.storageKey(deps.STORAGE_SUFFIX.lastSection)) || 0);
    const sectionIndex = Number.isFinite(savedSection) && store.sections[savedSection] ? savedSection : 0;
    window.LearningRender.showSection(sectionIndex);

    if (queryLesson && deps.getLessonById(queryLesson)) {
      selectLesson(queryLesson);
      return;
    }

    if (Number.isFinite(querySection) && Number.isFinite(queryItem)) {
      const section = store.sections[querySection];
      const lesson = section && section.items && section.items[queryItem];
      if (lesson) {
        selectLesson(lesson._id);
        return;
      }
    }

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
    flushWatchTime();
    const deps = window.LearningStore;
    const lesson = deps.selectLesson(id);
    if (!lesson) return;

    activeLessonId = String(lesson._id || '');
    activeLessonType = String(lesson.type || '');
    watchStart = Date.now();
    updateContext({
      lessonId: activeLessonId,
      type: activeLessonType === 'lecture' ? 'video' : activeLessonType,
      slideIndex: null,
      sectionIndex: lesson.sectionIndex,
      lessonIndex: lesson.lessonIndex
    });
    window.__videoPlayback = window.__videoPlayback || {};
    if (activeLessonType !== 'lecture') {
      setVideoPlaybackState(true);
    }
    if (activeLessonType === 'lecture') {
      const url = (lesson.preview || (lesson.content && lesson.content.videoUrl)) || '';
      if (!isYouTubeUrl(url)) {
        trackEvent('play', lesson, null);
        setVideoPlaybackState(true);
      }
    }

    localStorage.setItem(deps.storageKey(deps.STORAGE_SUFFIX.lastLesson), String(lesson._id));
    localStorage.setItem(deps.storageKey(deps.STORAGE_SUFFIX.lastSection), String(lesson.sectionIndex));
    trackLessonOpen(lesson);
    trackLessonStarted(lesson);

    if (lesson.sectionIndex !== deps.store.currentSectionIndex) {
      window.LearningRender.showSection(lesson.sectionIndex);
    }

    window.LearningRender.renderContent();
    window.LearningRender.updateSidebarUI();
    syncLearningStageHeader();
    window.dispatchEvent(new CustomEvent('lessonchange', { detail: { lessonId: activeLessonId } }));
  }

  function setLessonProgress(lessonId, completed, syncBackend) {
    const deps = window.LearningStore;
    deps.setLessonProgress(lessonId, completed);

    if (syncBackend) {
      const lesson = deps.getLessonById(lessonId);
      const videoUrl = lesson && (lesson.preview || (lesson.content && lesson.content.videoUrl)) || '';
      syncProgressBackend(videoUrl, completed, lessonId);
    }
  }

  function syncLessonProgressChange(lessonId, completed) {
    const deps = window.LearningStore;
    const previous = deps.isLessonCompleted(lessonId);

    syncProgressBackendByLesson(lessonId, completed)
      .then(function(success) {
        if (!success) {
          deps.setLessonProgress(lessonId, previous);
        } else {
          deps.setLessonProgress(lessonId, completed);
        }

        window.LearningRender.renderLessonList(window.LearningStore.store.currentSectionIndex);
        window.LearningRender.updateSidebarUI({ preserveCollapsedActiveSection: true });
        updateProgressUI();
      })
      .catch(function() {
        deps.setLessonProgress(lessonId, previous);
        window.LearningRender.renderLessonList(window.LearningStore.store.currentSectionIndex);
        window.LearningRender.updateSidebarUI({ preserveCollapsedActiveSection: true });
        updateProgressUI();
      });
  }

  function syncProgressBackend(videoUrl, completed, lessonId) {
    const course = window.LearningStore.store.course || {};
    const lesson = window.LearningStore.getLessonById(lessonId);
    return fetch('/courses/' + String(course._id || '') + '/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video: videoUrl,
        completed: !!completed,
        lessonId: lessonId,
        lessonName: lesson && lesson.title || '',
        lessonType: lesson && lesson.type || '',
        sectionIndex: lesson && lesson.sectionIndex,
        lessonIndex: lesson && lesson.lessonIndex
      })
    })
      .then(function(res) {
        if (!res.ok) {
          throw new Error('Progress sync failed');
        }
        return res.json().catch(function() {
          return { success: true };
        });
      })
      .then(function(payload) {
        if (!payload || payload.success === false) {
          throw new Error(payload && payload.error ? payload.error : 'Progress sync failed');
        }
        if (completed) {
          refreshGamificationUI();
        }
        return true;
      })
      .catch(function(err) {
        console.error('[Progress Sync Error]', err);
        return false;
      });
  }

  function syncProgressBackendByLesson(lessonId, completed) {
    const lesson = window.LearningStore.getLessonById(lessonId);
    const videoUrl = lesson && (lesson.preview || (lesson.content && lesson.content.videoUrl)) || '';
    return syncProgressBackend(videoUrl, completed, lessonId);
  }

  function markCurrentLessonCompleted() {
    const current = window.LearningStore.store.currentLesson;
    if (!current) return;

    trackEvent('completed', current, null);
    preserveOpenSections();
    syncLessonProgressChange(current._id, true);
  }

  function bindTrackingFlush() {
    window.addEventListener('beforeunload', flushWatchTime);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState !== 'visible') {
        flushWatchTime();
      }
    });
  }

  function bindActivityTracking() {
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function(evt) {
      document.addEventListener(evt, function() {
        lastActivityAt = Date.now();
      }, { passive: true });
    });
  }

  function startHeartbeat() {
    if (heartbeatId) {
      clearInterval(heartbeatId);
    }
    heartbeatId = setInterval(heartbeatTick, heartbeatIntervalMs);
  }

  function heartbeatTick() {
    if (!activeLessonId) return;
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastActivityAt > activityGraceMs) return;

    if (activeLessonType === 'lecture') {
      const playback = window.__videoPlayback || {};
      if (!playback.isPlaying) return;
    }

    sendWatchTime(activeLessonId, activeLessonType, heartbeatIntervalMs);
  }

  function flushWatchTime() {
    if (!activeLessonId || !watchStart) return;
    const delta = Date.now() - watchStart;
    if (delta < 2000) return;
    sendWatchTime(activeLessonId, activeLessonType, delta);
    watchStart = Date.now();
  }

  function trackEvent(eventType, lesson, position) {
    const course = window.LearningStore.store.course || {};
    if (!lesson || !course._id) return;

    const payload = {
      courseId: String(course._id),
      lessonId: String(lesson._id || ''),
      lessonType: String(lesson.type || ''),
      lessonName: String(lesson.title || ''),
      sectionIndex: Number.isFinite(Number(lesson.sectionIndex)) ? Number(lesson.sectionIndex) : undefined,
      lessonIndex: Number.isFinite(Number(lesson.lessonIndex)) ? Number(lesson.lessonIndex) : undefined,
      eventType: eventType,
      position: Number.isFinite(Number(position)) ? Number(position) : undefined
    };

    postTrack('/track/event', payload);
  }

  function sendWatchTime(lessonId, lessonType, watchTimeMs) {
    const course = window.LearningStore.store.course || {};
    if (!course._id || !lessonId) return;
    const lesson = window.LearningStore.getLessonById(lessonId);

    const payload = {
      courseId: String(course._id),
      lessonId: String(lessonId),
      lessonType: String(lessonType || ''),
      lessonName: lesson && lesson.title || '',
      sectionIndex: lesson && lesson.sectionIndex,
      lessonIndex: lesson && lesson.lessonIndex,
      watchTime: Math.max(0, Math.round(watchTimeMs))
    };

    postTrack('/track/watch-time', payload);
  }

  function sendSlideEvent(lessonId, lessonType, slideIndex) {
    const course = window.LearningStore.store.course || {};
    if (!course._id || !lessonId) return;
    const lesson = window.LearningStore.getLessonById(lessonId);

    const now = Date.now();
    if (now - lastSlideEventAt < 800) return;
    lastSlideEventAt = now;

    const payload = {
      courseId: String(course._id),
      lessonId: String(lessonId),
      lessonType: String(lessonType || 'slide'),
      lessonName: lesson && lesson.title || '',
      sectionIndex: lesson && lesson.sectionIndex,
      lessonIndex: lesson && lesson.lessonIndex,
      slideIndex: Number.isFinite(Number(slideIndex)) ? Number(slideIndex) : 0
    };

    postTrack('/track/slide', payload);
  }

  function sendQuizEvent(lessonId, lessonType, score, total, attempts) {
    const course = window.LearningStore.store.course || {};
    if (!course._id || !lessonId) return;
    const lesson = window.LearningStore.getLessonById(lessonId);

    const payload = {
      courseId: String(course._id),
      lessonId: String(lessonId),
      lessonType: String(lessonType || 'quiz'),
      lessonName: lesson && lesson.title || '',
      sectionIndex: lesson && lesson.sectionIndex,
      lessonIndex: lesson && lesson.lessonIndex,
      score: Number(score) || 0,
      total: Number(total) || 0,
      attempts: Number(attempts) || 1
    };

    postTrack('/track/quiz', payload, true);
  }

  function postTrack(url, payload, shouldRefreshGamification) {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function() {
        if (shouldRefreshGamification) {
          refreshGamificationUI();
        }
      })
      .catch(function(err) {
        console.error('[Track Error]', err);
      });
  }

  function refreshGamificationUI() {
    const card = document.getElementById('learningGamificationCard');
    if (!card) return;

    fetch('/api/gamification')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.success || !data.gamification) return;
        const gm = data.gamification;

        const levelEl = document.getElementById('gmLevelValue');
        const xpEl = document.getElementById('gmXpValue');
        const streakEl = document.getElementById('gmStreakValue');
        const barEl = document.getElementById('gmLevelProgress');
        const nextEl = document.getElementById('gmNextLevelText');

        if (levelEl) levelEl.textContent = String(gm.currentLevel || 1);
        if (xpEl) xpEl.textContent = String(gm.totalXP || 0) + ' XP';
        if (streakEl) streakEl.textContent = String(gm.currentStreak || 0);
        if (barEl) barEl.style.width = String((gm.levelProgress && gm.levelProgress.progressPercent) || 0) + '%';
        if (nextEl) {
          if (gm.levelProgress && gm.levelProgress.nextLevel) {
            nextEl.textContent = String(gm.levelProgress.xpToNextLevel || 0) + ' XP to Level ' + String(gm.levelProgress.nextLevel);
          } else {
            nextEl.textContent = 'Max level reached';
          }
        }
      })
      .catch(function(err) {
        console.error('[Gamification UI Refresh Error]', err);
      });
  }

  function updateContext(payload) {
    const next = payload || {};
    window.currentContext = {
      lessonId: next.lessonId !== undefined ? next.lessonId : window.currentContext.lessonId,
      type: next.type !== undefined ? next.type : window.currentContext.type,
      slideIndex: next.slideIndex !== undefined ? next.slideIndex : window.currentContext.slideIndex,
      sectionIndex: next.sectionIndex !== undefined ? next.sectionIndex : window.currentContext.sectionIndex,
      lessonIndex: next.lessonIndex !== undefined ? next.lessonIndex : window.currentContext.lessonIndex
    };
    syncLearningStageHeader();
  }

  function isYouTubeUrl(url) {
    return /(?:youtube\.com|youtu\.be)/i.test(String(url || ''));
  }

  function getCurrentLessonContentLabel(lesson) {
    if (!lesson) return 'Course';
    if (lesson.type === 'slide') {
      const content = lesson.content && typeof lesson.content === 'object' ? lesson.content : {};
      const slides = Array.isArray(content.slides) ? content.slides : [];
      const pdf = content.pdf || lesson.pdf;
      const hasPdf = typeof pdf === 'string'
        ? Boolean(pdf.trim())
        : Boolean(pdf && typeof pdf === 'object' && String(pdf.url || '').trim());
      if (slides.length && hasPdf) return 'Slides + PDF';
      if (hasPdf) return 'PDF';
      if (slides.length) return 'Slides';
    }
    if (lesson.type === 'quiz') return 'Quiz';
    if (lesson.type === 'lecture') return 'Video';
    return String(lesson.type || 'Lesson');
  }

  function syncLearningStageHeader() {
    const deps = window.LearningStore;
    if (!deps || !deps.store) return;

    const courseTitleEl = document.getElementById('learningStageCourseTitle');
    const lessonTitleEl = document.getElementById('learningStageLessonTitle');
    const lessonTypeEl = document.getElementById('learningStageLessonType');
    const prevBtn = document.querySelector('[data-stage-nav="prev"]');
    const nextBtn = document.querySelector('[data-stage-nav="next"]');
    const course = deps.store.course || {};
    const lesson = deps.store.currentLesson;

    if (courseTitleEl) {
      courseTitleEl.textContent = String(course.title || 'Course');
    }

    if (lessonTitleEl) {
      lessonTitleEl.textContent = lesson
        ? (lesson.displayTitle || deps.formatLessonTitle(lesson.title) || lesson.title)
        : 'Select a lesson from the course outline.';
    }

    if (lessonTypeEl) {
      lessonTypeEl.textContent = getCurrentLessonContentLabel(lesson);
    }

    const prevLesson = deps.getAdjacentLesson(-1);
    const nextLesson = deps.getAdjacentLesson(1);
    if (prevBtn) prevBtn.disabled = !prevLesson;
    if (nextBtn) nextBtn.disabled = !nextLesson;
  }

  function updateProgressUI() {
    const deps = window.LearningStore;
    const total = deps.store.lessons.length || 1;
    const completed = deps.getCompletedCount();
    const percent = Math.round((completed / total) * 100);

    const bar = document.getElementById('learningProgressBar');
    const label = document.getElementById('learningProgressLabel');
    const badge = document.getElementById('learningProgressPercent');
    if (!bar || !label || !badge) return;

    bar.style.width = percent + '%';
    bar.setAttribute('aria-valuenow', completed);
    label.innerText = completed + ' / ' + total + ' lessons completed';
    badge.innerText = percent + '%';
    syncLearningStageHeader();
  }

  function preserveOpenSections() {
    const deps = window.LearningStore;
    document.querySelectorAll('.learning-section').forEach(function(sectionEl) {
      const index = Number(sectionEl.dataset.sectionIndex);
      if (!Number.isFinite(index)) return;
      deps.setSectionOpen(index, sectionEl.classList.contains('open'));
    });
  }

  function initializeTabs() {
    const hasTabs = document.querySelector('.course-tabs');
    if (!hasTabs) return;

    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.tab === 'overview');
    });
    document.querySelectorAll('.tab-pane').forEach(function(pane) {
      pane.classList.toggle('active', pane.id === 'tab-overview');
    });

    handleTabActivation('overview');
  }

  function handleTabActivation(tab) {
    toggleNotesVisibility(tab === 'notes');
    if (tab === 'reviews') {
      loadReviews(false);
    }
  }

  function toggleNotesVisibility(isVisible) {
    const sectionCard = document.getElementById('videoNoteSection');
    if (!sectionCard) return;
    sectionCard.style.display = isVisible ? 'block' : 'none';
  }

  var editingReviewId = null;

  function getCsrfToken() {
    var el = document.querySelector('#reviewForm input[name="_csrf"]');
    return el ? el.value : '';
  }

  function resetReviewForm() {
    editingReviewId = null;
    var ratingInput = document.getElementById('rating');
    var commentInput = document.getElementById('comment');
    var button = document.getElementById('reviewSubmitBtn');
    if (ratingInput) ratingInput.value = '';
    if (commentInput) commentInput.value = '';
    if (button) {
      button.textContent = 'Submit';
      button.classList.remove('btn-warning');
      button.classList.add('btn-primary');
    }
    var cancelBtn = document.getElementById('reviewCancelBtn');
    if (cancelBtn) cancelBtn.classList.add('d-none');
  }

  function submitReview() {
    var deps = window.LearningStore;
    var course = deps.store.course || {};
    var ratingInput = document.getElementById('rating');
    var commentInput = document.getElementById('comment');
    var button = document.getElementById('reviewSubmitBtn');

    var rating = ratingInput ? Number(ratingInput.value) : 0;
    var comment = commentInput ? commentInput.value.trim() : '';
    var notify = typeof window.showAppToast === 'function'
      ? window.showAppToast
      : function(message) { window.alert(message); };

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      notify('Please select a rating from 1 to 5 stars.', 'warning');
      return;
    }

    if (button) button.disabled = true;

    var isEditing = !!editingReviewId;
    var url = '/courses/' + String(course._id || '') + '/review';
    var method = isEditing ? 'PUT' : 'POST';

    fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: rating, comment: comment })
    })
      .then(function(res) {
        return res.json().then(function(data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function(result) {
        if (!result.data || !result.data.success) {
          var errMsg = result.data && result.data.error ? result.data.error : 'Review submit failed';
          throw new Error(errMsg);
        }

        resetReviewForm();
        loadReviews(true);
        notify(isEditing ? 'Review updated successfully!' : 'Review submitted successfully!', 'success');
      })
      .catch(function(err) {
        console.error('[Review Submit Error]', err);
        notify(err.message || 'Failed to submit review.', 'danger');
      })
      .finally(function() {
        if (button) button.disabled = false;
      });
  }

  function editReview(reviewId) {
    var deps = window.LearningStore;
    var store = deps.store;
    var reviews = store._cachedReviews || [];
    var review = null;

    for (var i = 0; i < reviews.length; i++) {
      if (reviews[i].isOwn) {
        review = reviews[i];
        break;
      }
    }

    if (!review) return;

    editingReviewId = reviewId || review.id;
    var ratingInput = document.getElementById('rating');
    var commentInput = document.getElementById('comment');
    var button = document.getElementById('reviewSubmitBtn');

    if (ratingInput) ratingInput.value = String(review.rating);
    if (commentInput) commentInput.value = review.comment || '';
    if (button) {
      button.textContent = 'Update Review';
      button.classList.remove('btn-primary');
      button.classList.add('btn-warning');
    }

    var cancelBtn = document.getElementById('reviewCancelBtn');
    if (!cancelBtn) {
      var form = document.getElementById('reviewForm');
      if (form) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'reviewCancelBtn';
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-outline-secondary mt-2';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
          resetReviewForm();
        });
        form.appendChild(cancelBtn);
      }
    } else {
      cancelBtn.classList.remove('d-none');
    }

    var ratingInputEl = document.getElementById('rating');
    if (ratingInputEl) ratingInputEl.focus();
  }

  function deleteReview(reviewId) {
    var deps = window.LearningStore;
    var course = deps.store.course || {};
    var notify = typeof window.showAppToast === 'function'
      ? window.showAppToast
      : function(message) { window.alert(message); };

    if (!confirm('Are you sure you want to delete your review?')) return;

    fetch('/courses/' + String(course._id || '') + '/review', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.success) {
          throw new Error(data && data.error ? data.error : 'Delete failed');
        }

        resetReviewForm();
        loadReviews(true);
        notify('Review deleted successfully!', 'success');
      })
      .catch(function(err) {
        console.error('[Review Delete Error]', err);
        notify(err.message || 'Failed to delete review.', 'danger');
      });
  }

  window.editReview = editReview;
  window.deleteReview = deleteReview;

  function loadReviews(force) {
    if (!force && reviewsLoaded) return;

    const deps = window.LearningStore;
    const course = deps.store.course || {};
    const list = document.getElementById('review-list');
    const summary = document.getElementById('ratingSummary');

    if (!list) return;

    list.innerHTML = '<div class="text-muted">Loading reviews...</div>';

    fetch('/courses/' + String(course._id || '') + '/reviews')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.success) {
          throw new Error(data && data.error ? data.error : 'Review fetch failed');
        }

        renderReviewList(list, data.reviews);
        updateReviewSummary(summary, data.averageRating, data.reviewCount);
        reviewsLoaded = true;
      })
      .catch(function(err) {
        console.error('[Review Fetch Error]', err);
        list.innerHTML = '<p class="text-muted mb-0">Failed to load reviews.</p>';
      });
  }

  function renderReviewList(list, reviews) {
    const deps = window.LearningStore;
    const store = deps.store;
    const items = Array.isArray(reviews) ? reviews : [];

    store._cachedReviews = items;

    if (!items.length) {
      list.innerHTML = '<p class="text-muted mb-0">No reviews yet.</p>';
      toggleReviewForm(true);
      return;
    }

    var hasOwnReview = false;

    list.innerHTML = items.map(function(review) {
      var rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
      var stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
      var author = review.user ? String(review.user) : 'User';
      var comment = review.comment ? deps.escapeHtml(review.comment) : '';
      var isOwn = !!review.isOwn;

      if (isOwn) hasOwnReview = true;

      var actionsHtml = '';
      if (isOwn) {
        actionsHtml = '' +
          '<div class="review-actions mt-2">' +
            '<button class="btn btn-sm btn-outline-primary me-1" onclick="editReview()" title="Edit review">' +
              '<i class="fa-solid fa-pen-to-square"></i> Edit' +
            '</button>' +
            '<button class="btn btn-sm btn-outline-danger" onclick="deleteReview()" title="Delete review">' +
              '<i class="fa-solid fa-trash"></i> Delete' +
            '</button>' +
          '</div>';
      }

      return '' +
        '<div class="review-item mb-3 p-2 border rounded">' +
          '<div class="d-flex justify-content-between align-items-start">' +
            '<div>' +
              '<strong>' + stars + '</strong>' +
              (isOwn ? ' <span class="badge bg-info">Your review</span>' : '') +
            '</div>' +
          '</div>' +
          '<p class="mb-1 mt-1">' + comment + '</p>' +
          '<small class="text-muted">by ' + deps.escapeHtml(author) + '</small>' +
          actionsHtml +
        '</div>';
    }).join('');

    toggleReviewForm(!hasOwnReview);
  }

  function toggleReviewForm(showForm) {
    var form = document.getElementById('reviewForm');
    if (!form) return;
    form.style.display = showForm ? '' : 'none';
  }

  function updateReviewSummary(summaryEl, averageRating, reviewCount) {
    if (!summaryEl) return;

    const count = Number(reviewCount) || 0;
    if (!count) {
      summaryEl.textContent = 'No reviews yet.';
      return;
    }

    const avg = Math.round((Number(averageRating) || 0) * 10) / 10;
    summaryEl.textContent = avg + ' / 5 (' + count + ' reviews)';
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
    const notify = typeof window.showAppToast === 'function'
      ? window.showAppToast
      : function(message) { window.alert(message); };

    fetch('/courses/' + String(course._id || '') + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionIndex: index, content: content })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.success) {
          notify('Failed to save notes', 'danger');
        }
      })
      .catch(function(err) {
        console.error('[Save notes error]', err);
      });
  }

  function trackLessonOpen(lesson) {
    const course = window.LearningStore.store.course || {};
    if (!course._id || !lesson || !lesson._id) return;

    postTrack('/track/event', {
      courseId: String(course._id),
      lessonId: String(lesson._id),
      lessonType: String(lesson.type || ''),
      lessonName: String(lesson.title || ''),
      sectionIndex: Number.isFinite(Number(lesson.sectionIndex)) ? Number(lesson.sectionIndex) : undefined,
      lessonIndex: Number.isFinite(Number(lesson.lessonIndex)) ? Number(lesson.lessonIndex) : undefined,
      eventType: 'open'
    });
  }

  function trackLessonStarted(lesson) {
    const course = window.LearningStore.store.course || {};
    if (!course._id || !lesson || !lesson._id || typeof window.trackAnalyticsEvent !== 'function') return;

    const key = String(lesson._id);
    if (startedLessons.has(key)) return;
    startedLessons.add(key);

    window.trackAnalyticsEvent('lesson_started', {
      courseId: String(course._id),
      lessonId: key,
      metadata: {
        lessonTitle: String(lesson.displayTitle || lesson.title || ''),
        lessonType: String(lesson.type || ''),
        sectionIndex: Number.isFinite(Number(lesson.sectionIndex)) ? Number(lesson.sectionIndex) : null,
        lessonIndex: Number.isFinite(Number(lesson.lessonIndex)) ? Number(lesson.lessonIndex) : null
      }
    });
  }

  function trackVideoProgress(lesson, currentTime, duration, forceComplete) {
    const course = window.LearningStore.store.course || {};
    if (!course._id || !lesson || typeof window.trackAnalyticsEvent !== 'function') return;

    const current = Math.max(0, Number(currentTime) || 0);
    const total = Math.max(0, Number(duration) || 0);
    const percent = total > 0
      ? Math.min(100, Math.round((current / total) * 100))
      : (forceComplete ? 100 : 0);

    window.trackAnalyticsEvent('video_progress', {
      courseId: String(course._id),
      lessonId: String(lesson._id || ''),
      metadata: {
        videoId: String((lesson.content && lesson.content.videoUrl) || lesson.preview || '').slice(0, 200),
        currentTime: Math.round(current),
        duration: Math.round(total),
        watchedPercent: percent,
        playbackRate: getPlaybackRate(),
        sectionIndex: Number.isFinite(Number(lesson.sectionIndex)) ? Number(lesson.sectionIndex) : null,
        lessonIndex: Number.isFinite(Number(lesson.lessonIndex)) ? Number(lesson.lessonIndex) : null
      }
    });
  }

  function getPlaybackRate() {
    const html5 = document.getElementById('html5VideoPlayer');
    if (html5 && Number.isFinite(Number(html5.playbackRate))) {
      return Number(html5.playbackRate);
    }
    return 1;
  }

  document.addEventListener('DOMContentLoaded', init);

  window.__trackSlideChange = function(lessonId, lessonType, slideIndex) {
    sendSlideEvent(lessonId, lessonType, slideIndex);
    updateContext({ lessonId: lessonId, type: 'slide', slideIndex: slideIndex });
  };

  window.__trackQuizResult = function(lessonId, lessonType, scoreValue, totalValue, attempts) {
    sendQuizEvent(lessonId, lessonType, scoreValue, totalValue, attempts);
  };

  window.__updateContext = updateContext;

  window.__trackVideoEvent = function(eventType, position) {
    const deps = window.LearningStore;
    const lesson = deps.store.currentLesson;
    if (!lesson) return;

    if (eventType === 'play') {
      watchStart = Date.now();
      window.__videoPlayback = window.__videoPlayback || {};
      window.__videoPlayback.isPlaying = true;
    }

    if (eventType === 'pause' || eventType === 'seek') {
      flushWatchTime();
    }

    if (eventType === 'ended') {
      flushWatchTime();
      window.__videoPlayback = window.__videoPlayback || {};
      window.__videoPlayback.isPlaying = false;
      trackVideoProgress(lesson, position, position, true);
    }

    trackEvent(eventType, lesson, position);
  };

  window.__trackVideoProgress = function(currentTime, duration) {
    const deps = window.LearningStore;
    const lesson = deps && deps.store ? deps.store.currentLesson : null;
    if (!lesson) return;
    trackVideoProgress(lesson, currentTime, duration, false);
  };
})();
