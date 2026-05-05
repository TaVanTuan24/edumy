(function() {
  'use strict';

  var EVENTS = Object.freeze({
    LESSON_STARTED: 'lesson_started',
    LESSON_COMPLETED: 'lesson_completed',
    VIDEO_PROGRESS: 'video_progress',
    COURSE_ENROLLED: 'course_enrolled',
    COURSE_COMPLETED: 'course_completed',
    QUIZ_ATTEMPT_STARTED: 'quiz_attempt_started',
    QUIZ_QUESTION_ANSWERED: 'quiz_question_answered',
    QUIZ_COMPLETED: 'quiz_completed',
    AI_QUESTION_ASKED: 'ai_question_asked',
    NOTIFICATION_CLICKED: 'notification_clicked'
  });

  var VIDEO_THROTTLE_MS = Number(window.VIDEO_PROGRESS_THROTTLE_MS || 30000);
  var videoProgressState = new Map();
  var milestones = [25, 50, 75, 90, 100];

  function getCsrfToken() {
    if (window.__CSRF_TOKEN__) return window.__CSRF_TOKEN__;

    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;

    try {
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i += 1) {
        var cookie = cookies[i].trim();
        if (cookie.indexOf('XSRF-TOKEN=') === 0) {
          return decodeURIComponent(cookie.substring('XSRF-TOKEN='.length));
        }
      }
    } catch (_err) {}

    return '';
  }

  function isValidEventType(eventType) {
    return Object.keys(EVENTS).some(function(key) {
      return EVENTS[key] === eventType;
    });
  }

  function normalizePayload(eventType, payload) {
    var source = payload && typeof payload === 'object' ? payload : {};
    return {
      eventType: eventType,
      courseId: source.courseId || source.course || undefined,
      lessonId: source.lessonId || undefined,
      quizId: source.quizId || undefined,
      sessionId: source.sessionId || undefined,
      metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : {}
    };
  }

  function getVideoStateKey(payload) {
    return [
      payload.courseId || '',
      payload.lessonId || '',
      payload.metadata && payload.metadata.videoId || ''
    ].join(':');
  }

  function shouldSendVideoProgress(payload) {
    var metadata = payload.metadata || {};
    var currentTime = Number(metadata.currentTime || 0);
    var duration = Number(metadata.duration || 0);
    var watchedPercent = Number(metadata.watchedPercent);

    if (!Number.isFinite(watchedPercent) && duration > 0) {
      watchedPercent = Math.round((currentTime / duration) * 100);
      metadata.watchedPercent = watchedPercent;
    }

    watchedPercent = Math.max(0, Math.min(100, Number(watchedPercent) || 0));
    var key = getVideoStateKey(payload);
    var now = Date.now();
    var state = videoProgressState.get(key);

    if (!state) {
      state = { lastSentAt: 0, sentMilestones: new Set() };
      videoProgressState.set(key, state);
    }

    var crossedMilestone = milestones.find(function(milestone) {
      return watchedPercent >= milestone && !state.sentMilestones.has(milestone);
    });

    if (crossedMilestone) {
      state.sentMilestones.add(crossedMilestone);
      state.lastSentAt = now;
      metadata.progressMilestone = crossedMilestone;
      return true;
    }

    if (now - state.lastSentAt >= VIDEO_THROTTLE_MS) {
      state.lastSentAt = now;
      return true;
    }

    return false;
  }

  function sendEvent(payload, options) {
    var body = JSON.stringify(Object.assign({}, payload, { _csrf: getCsrfToken() }));
    var useBeacon = options && options.beacon && typeof navigator.sendBeacon === 'function';

    if (useBeacon) {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/analytics/events', blob)) {
          return Promise.resolve();
        }
      } catch (_err) {}
    }

    var fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch;
    if (typeof fetcher !== 'function') return Promise.resolve();

    return fetcher('/analytics/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body,
      keepalive: Boolean(options && options.keepalive)
    }).catch(function(err) {
      if (window.console && typeof window.console.debug === 'function') {
        window.console.debug('[Analytics Tracking Error]', err);
      }
    });
  }

  window.ANALYTICS_EVENTS = EVENTS;

  window.trackAnalyticsEvent = function(eventType, payload, options) {
    if (!isValidEventType(eventType)) return Promise.resolve();
    if (navigator && navigator.onLine === false) return Promise.resolve();

    var normalized = normalizePayload(eventType, payload);

    if (eventType === EVENTS.VIDEO_PROGRESS && !shouldSendVideoProgress(normalized)) {
      return Promise.resolve();
    }

    return sendEvent(normalized, options || {});
  };

  window.trackAnalyticsEventBeacon = function(eventType, payload) {
    return window.trackAnalyticsEvent(eventType, payload, {
      beacon: true,
      keepalive: true
    });
  };
})();
