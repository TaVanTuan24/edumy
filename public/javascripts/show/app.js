(function() {
  'use strict';

  let reviewsLoaded = false;
  let watchStart = 0;
  let activeLessonId = '';
  let activeLessonType = '';
  let lastSlideEventAt = 0;
  let heartbeatId = null;
  let lastActivityAt = Date.now();
  const heartbeatIntervalMs = 30000;
  const activityGraceMs = 45000;

  window.currentContext = {
    lessonId: null,
    type: null,
    slideIndex: null
  };

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
    initializeTabs();
    toggleNotesVisibility(false);
    bindTrackingFlush();
    bindActivityTracking();
    startHeartbeat();
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
      slideIndex: null
    });
    window.__videoPlayback = window.__videoPlayback || {};
    if (activeLessonType !== 'lecture') {
      window.__videoPlayback.isPlaying = true;
    }
    if (activeLessonType === 'lecture') {
      const url = (lesson.preview || (lesson.content && lesson.content.videoUrl)) || '';
      if (!isYouTubeUrl(url)) {
        trackEvent('play', lesson, null);
        window.__videoPlayback.isPlaying = true;
      }
    }

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
      const videoUrl = lesson && (lesson.preview || (lesson.content && lesson.content.videoUrl)) || '';
      syncProgressBackend(videoUrl, completed, lessonId);
    }
  }

  function syncProgressBackend(videoUrl, completed, lessonId) {
    const course = window.LearningStore.store.course || {};
    fetch('/courses/' + String(course._id || '') + '/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video: videoUrl, completed: !!completed, lessonId: lessonId })
    })
      .then(function() {
        if (completed) {
          refreshGamificationUI();
        }
      })
      .catch(function(err) {
        console.error('[Progress Sync Error]', err);
      });
  }

  function markCurrentLessonCompleted() {
    const current = window.LearningStore.store.currentLesson;
    if (!current) return;

    setLessonProgress(current._id, true, true);
    trackEvent('completed', current, null);
    window.LearningRender.renderLessonList(window.LearningStore.store.currentSectionIndex);
    window.LearningRender.updateSidebarUI();
    updateProgressUI();
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
      eventType: eventType,
      position: Number.isFinite(Number(position)) ? Number(position) : undefined
    };

    console.log('[Track Event]', payload);
    postTrack('/track/event', payload);
  }

  function sendWatchTime(lessonId, lessonType, watchTimeMs) {
    const course = window.LearningStore.store.course || {};
    if (!course._id || !lessonId) return;

    const payload = {
      courseId: String(course._id),
      lessonId: String(lessonId),
      lessonType: String(lessonType || ''),
      watchTime: Math.max(0, Math.round(watchTimeMs))
    };

    console.log('[Track WatchTime]', payload);
    postTrack('/track/watch-time', payload);
  }

  function sendSlideEvent(lessonId, lessonType, slideIndex) {
    const course = window.LearningStore.store.course || {};
    if (!course._id || !lessonId) return;

    const now = Date.now();
    if (now - lastSlideEventAt < 800) return;
    lastSlideEventAt = now;

    const payload = {
      courseId: String(course._id),
      lessonId: String(lessonId),
      lessonType: String(lessonType || 'slide'),
      slideIndex: Number.isFinite(Number(slideIndex)) ? Number(slideIndex) : 0
    };

    console.log('[Track Slide]', payload);
    postTrack('/track/slide', payload);
  }

  function sendQuizEvent(lessonId, lessonType, score, total, attempts) {
    const course = window.LearningStore.store.course || {};
    if (!course._id || !lessonId) return;

    const payload = {
      courseId: String(course._id),
      lessonId: String(lessonId),
      lessonType: String(lessonType || 'quiz'),
      score: Number(score) || 0,
      total: Number(total) || 0,
      attempts: Number(attempts) || 1
    };

    console.log('[Track Quiz]', payload);
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
      lessonId: next.lessonId || null,
      type: next.type || null,
      slideIndex: next.slideIndex !== undefined ? next.slideIndex : null
    };

    console.log('[Context Updated]', window.currentContext);

    const ctxLabel = document.getElementById('aiContextLabel') || document.getElementById('aiStatus');
    if (ctxLabel) {
      const typeLabel = window.currentContext.type || 'N/A';
      const lessonLabel = window.currentContext.lessonId || 'N/A';
      ctxLabel.innerText = 'Type: ' + typeLabel + ' | Lesson: ' + lessonLabel;
    }
  }

  function isYouTubeUrl(url) {
    return /(?:youtube\.com|youtu\.be)/i.test(String(url || ''));
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

  function submitReview() {
    const deps = window.LearningStore;
    const course = deps.store.course || {};
    const ratingInput = document.getElementById('rating');
    const commentInput = document.getElementById('comment');
    const button = document.getElementById('reviewSubmitBtn');

    const rating = ratingInput ? Number(ratingInput.value) : 0;
    const comment = commentInput ? commentInput.value.trim() : '';

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      alert('Vui lòng chọn số sao từ 1 đến 5.');
      return;
    }

    if (button) button.disabled = true;

    fetch('/courses/' + String(course._id || '') + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: rating, comment: comment })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.success) {
          throw new Error(data && data.error ? data.error : 'Review submit failed');
        }

        if (ratingInput) ratingInput.value = '';
        if (commentInput) commentInput.value = '';
        loadReviews(true);
      })
      .catch(function(err) {
        console.error('[Review Submit Error]', err);
        alert('Gửi đánh giá thất bại.');
      })
      .finally(function() {
        if (button) button.disabled = false;
      });
  }

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
    const items = Array.isArray(reviews) ? reviews : [];

    if (!items.length) {
      list.innerHTML = '<p class="text-muted mb-0">No reviews yet.</p>';
      return;
    }

    list.innerHTML = items.map(function(review) {
      const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
      const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
      const author = review.user ? String(review.user) : 'User';
      const comment = review.comment ? deps.escapeHtml(review.comment) : '';

      return '' +
        '<div class="review-item mb-3">' +
          '<strong>' + stars + '</strong>' +
          '<p class="mb-1">' + comment + '</p>' +
          '<small class="text-muted">by ' + deps.escapeHtml(author) + '</small>' +
        '</div>';
    }).join('');
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
    }

    trackEvent(eventType, lesson, position);
  };
})();
