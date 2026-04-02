(function() {
  'use strict';

  const state = {
    courseId: '',
    sectionIndex: 0,
    lessonIndex: 0,
    quizzes: [],
    dragging: false,
    dragMoved: false,
    dragStartX: 0,
    dragStartY: 0,
    iconStartX: 0,
    iconStartY: 0
  };

  function init() {
    let payload = window.__VIDEO_SETTINGS__ || {};
    const payloadEl = document.getElementById('video-settings-data');
    if (payloadEl && payloadEl.textContent) {
      try {
        payload = JSON.parse(payloadEl.textContent);
      } catch (err) {
        console.error('[Video Settings] Failed to parse payload', err);
      }
    }
    state.courseId = String(payload.courseId || '');
    state.sectionIndex = Number(payload.sectionIndex || 0);
    state.lessonIndex = Number(payload.lessonIndex || 0);
    state.quizzes = normalizeQuizzes(payload.interactiveQuizzes || []);

    initVideoPreview(payload.videoUrl || '');
    renderProviderHint(payload.videoUrl || '');

    bindFabDragAndOpen();
    bindPopoverActions();
    bindCorrectCheckboxes();
    renderQuizList();
  }

  function getYouTubeId(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';

    let parsed;
    try {
      parsed = new URL(raw, window.location.origin);
    } catch (err) {
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

    const shortMatch = raw.match(/youtu\.be\/([a-zA-Z0-9_-]+)/i);
    if (shortMatch) return shortMatch[1];

    const watchMatch = raw.match(/[?&](?:v|vi)=([a-zA-Z0-9_-]+)/i);
    if (watchMatch) return watchMatch[1];

    return '';
  }

  function buildYouTubeEmbedUrl(videoId) {
    const id = String(videoId || '').trim();
    if (!id) return '';
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?rel=0';
  }

  function initVideoPreview(rawUrl) {
    const iframe = document.getElementById('videoSettingsIframe');
    if (!iframe) return;

    const url = String(rawUrl || '').trim();
    if (!url) {
      iframe.src = '';
      return;
    }

    if (/(?:youtube\.com|youtu\.be)/i.test(url)) {
      const id = getYouTubeId(url);
      if (id) {
        iframe.src = buildYouTubeEmbedUrl(id);
        return;
      }
      iframe.src = '';
      return;
    }

    iframe.src = url;
  }

  function renderProviderHint(videoUrl) {
    const hint = document.getElementById('videoProviderHint');
    if (!hint) return;

    const url = String(videoUrl || '').trim();
    const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(url);
    const isDrive = /drive\.google\.com/i.test(url);
    const isDirect = /\.(mp4|webm|ogg)(\?|$)/i.test(url);

    if (isYouTube || isDirect) {
      hint.className = 'video-provider-hint show reliable';
      hint.textContent = 'Timed quizzes are precise with this video source.';
      return;
    }

    if (isDrive) {
      hint.className = 'video-provider-hint show limited';
      hint.textContent = 'Google Drive iframe does not expose exact playback time API. Timed quizzes may be approximate. Recommended: use YouTube or direct MP4 URL for precise triggers.';
      return;
    }

    hint.className = 'video-provider-hint show limited';
    hint.textContent = 'This source may not provide exact playback time events. Use YouTube or direct MP4 for precise timed quizzes.';
  }

  function normalizeQuizzes(quizzes) {
    const source = Array.isArray(quizzes) ? quizzes : [];

    return source
      .map(function(entry, index) {
        const options = Array.isArray(entry && entry.options)
          ? entry.options.map(function(opt) { return String(opt || '').trim(); }).slice(0, 4)
          : [];

        while (options.length < 4) options.push('');

        return {
          _id: String((entry && entry._id) || ''),
          triggerTimeSec: parseTimestampToSeconds(entry && entry.triggerTimeSec),
          question: String(entry && entry.question || '').trim(),
          options: options,
          correctOptionIndex: Math.min(3, Math.max(0, Number(entry && entry.correctOptionIndex) || 0)),
          explanation: String(entry && entry.explanation || '').trim(),
          pauseOnShow: entry && entry.pauseOnShow === false ? false : true,
          order: Number.isFinite(Number(entry && entry.order)) ? Number(entry.order) : index
        };
      })
      .filter(function(entry) { return entry.question; })
      .sort(function(a, b) {
        if (a.triggerTimeSec !== b.triggerTimeSec) return a.triggerTimeSec - b.triggerTimeSec;
        return a.order - b.order;
      })
      .map(function(entry, index) { return { ...entry, order: index }; });
  }

  function parseTimestampToSeconds(raw) {
    const value = String(raw || '').trim();
    if (!value) return 0;

    if (/^\d+$/.test(value)) {
      return Math.max(0, parseInt(value, 10));
    }

    const parts = value.split(':').map(function(part) { return part.trim(); });
    if (parts.length === 2) {
      const m = parseInt(parts[0], 10);
      const s = parseInt(parts[1], 10);
      if (!Number.isNaN(m) && !Number.isNaN(s)) {
        return Math.max(0, (m * 60) + s);
      }
    }

    return 0;
  }

  function formatSeconds(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function bindFabDragAndOpen() {
    const fab = document.getElementById('timedQuizFab');
    if (!fab) return;

    fab.addEventListener('mousedown', function(e) {
      state.dragging = true;
      state.dragMoved = false;
      state.dragStartX = e.clientX;
      state.dragStartY = e.clientY;

      const rect = fab.getBoundingClientRect();
      state.iconStartX = rect.left;
      state.iconStartY = rect.top;

      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!state.dragging) return;

      const dx = e.clientX - state.dragStartX;
      const dy = e.clientY - state.dragStartY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        state.dragMoved = true;
      }

      const fabRect = fab.getBoundingClientRect();
      const maxX = window.innerWidth - fabRect.width - 8;
      const maxY = window.innerHeight - fabRect.height - 8;

      const nextX = Math.min(maxX, Math.max(8, state.iconStartX + dx));
      const nextY = Math.min(maxY, Math.max(8, state.iconStartY + dy));

      fab.style.left = nextX + 'px';
      fab.style.top = nextY + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', function() {
      if (!state.dragging) return;
      const moved = state.dragMoved;
      state.dragging = false;

      if (!moved) {
        togglePopoverNearFab();
      }
    });

    window.addEventListener('resize', positionPopoverNearFab);
  }

  function getPopover() {
    return document.getElementById('timedQuizPopover');
  }

  function togglePopoverNearFab() {
    const popover = getPopover();
    if (!popover) return;

    if (popover.classList.contains('show')) {
      closePopover();
      return;
    }

    positionPopoverNearFab();
    popover.classList.add('show');
    popover.setAttribute('aria-hidden', 'false');
  }

  function closePopover() {
    const popover = getPopover();
    if (!popover) return;

    popover.classList.remove('show');
    popover.setAttribute('aria-hidden', 'true');
  }

  function positionPopoverNearFab() {
    const fab = document.getElementById('timedQuizFab');
    const popover = getPopover();
    if (!fab || !popover) return;

    const fabRect = fab.getBoundingClientRect();
    const width = popover.offsetWidth || 360;
    const height = popover.offsetHeight || 460;

    let left = fabRect.left - width - 14;
    let top = fabRect.top;

    if (left < 8) left = fabRect.right + 14;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
    if (top < 8) top = 8;

    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
  }

  function bindPopoverActions() {
    const closeBtn = document.getElementById('timedQuizCloseBtn');
    const saveBtn = document.getElementById('timedQuizSaveBtn');
    const resetBtn = document.getElementById('timedQuizResetBtn');

    if (closeBtn) {
      closeBtn.addEventListener('click', closePopover);
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', upsertQuizFromForm);
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', resetForm);
    }

    const list = document.getElementById('timedQuizList');
    if (list) {
      list.addEventListener('click', handleListAction);
    }
  }

  function bindCorrectCheckboxes() {
    document.querySelectorAll('.timedQuizCorrectCheck').forEach(function(check) {
      check.addEventListener('change', function() {
        if (!check.checked) return;
        document.querySelectorAll('.timedQuizCorrectCheck').forEach(function(other) {
          if (other !== check) other.checked = false;
        });
      });
    });
  }

  function getFormValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  function setFormValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function upsertQuizFromForm() {
    const editIndex = Number(getFormValue('timedQuizEditIndex'));
    const question = String(getFormValue('timedQuizQuestion') || '').trim();
    const timestamp = parseTimestampToSeconds(getFormValue('timedQuizTimestamp'));
    const explanation = String(getFormValue('timedQuizExplanation') || '').trim();
    const pauseOnShowEl = document.getElementById('timedQuizPauseOnShow');
    const pauseOnShow = Boolean(pauseOnShowEl && pauseOnShowEl.checked);

    const options = Array.from(document.querySelectorAll('.timedQuizOptionInput')).map(function(input) {
      return String(input.value || '').trim();
    });

    const checked = Array.from(document.querySelectorAll('.timedQuizCorrectCheck')).find(function(input) {
      return input.checked;
    });
    const correctOptionIndex = checked ? Number(checked.dataset.correctIndex) : -1;

    if (!question) {
      window.alert('Please enter a quiz question.');
      return;
    }

    if (options.some(function(opt) { return !opt; })) {
      window.alert('Please fill all 4 options.');
      return;
    }

    if (correctOptionIndex < 0) {
      window.alert('Please select the correct option.');
      return;
    }

    const previous = editIndex >= 0 ? state.quizzes[editIndex] : null;
    const nextQuiz = {
      _id: previous && previous._id ? previous._id : '',
      triggerTimeSec: timestamp,
      question: question,
      options: options,
      correctOptionIndex: correctOptionIndex,
      explanation: explanation,
      pauseOnShow: pauseOnShow,
      order: editIndex >= 0 ? editIndex : state.quizzes.length
    };

    if (editIndex >= 0 && state.quizzes[editIndex]) {
      state.quizzes[editIndex] = nextQuiz;
    } else {
      state.quizzes.push(nextQuiz);
    }

    persistQuizzes();
  }

  function persistQuizzes() {
    const sorted = normalizeQuizzes(state.quizzes);

    fetch(`/admin/course/${encodeURIComponent(state.courseId)}/lesson/${encodeURIComponent(state.sectionIndex)}/${encodeURIComponent(state.lessonIndex)}/interactive-quizzes`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ interactiveQuizzes: sorted })
    })
      .then(function(res) {
        return res.json().then(function(data) {
          if (!res.ok || !data || !data.success) {
            throw new Error(data && data.error ? data.error : 'Failed to save timed quizzes.');
          }
          return data;
        });
      })
      .then(function(data) {
        state.quizzes = normalizeQuizzes(data.interactiveQuizzes || sorted);
        renderQuizList();
        resetForm();
        closePopover();
      })
      .catch(function(err) {
        console.error('[Timed Quiz Save Error]', err);
        window.alert(err && err.message ? err.message : 'Failed to save timed quizzes.');
      });
  }

  function handleListAction(e) {
    const button = e.target.closest('[data-quiz-action]');
    if (!button) return;

    const action = button.dataset.quizAction;
    const index = Number(button.dataset.quizIndex);
    if (!Number.isFinite(index) || !state.quizzes[index]) return;

    if (action === 'edit') {
      loadQuizIntoForm(index);
      positionPopoverNearFab();
      const popover = getPopover();
      if (popover) {
        popover.classList.add('show');
        popover.setAttribute('aria-hidden', 'false');
      }
      return;
    }

    if (action === 'delete') {
      if (!window.confirm('Delete this timed quiz?')) return;
      state.quizzes.splice(index, 1);
      persistQuizzes();
    }
  }

  function loadQuizIntoForm(index) {
    const quiz = state.quizzes[index];
    if (!quiz) return;

    setFormValue('timedQuizEditIndex', String(index));
    setFormValue('timedQuizTimestamp', formatSeconds(quiz.triggerTimeSec));
    setFormValue('timedQuizQuestion', quiz.question || '');
    setFormValue('timedQuizExplanation', quiz.explanation || '');

    const pauseOnShowEl = document.getElementById('timedQuizPauseOnShow');
    if (pauseOnShowEl) pauseOnShowEl.checked = quiz.pauseOnShow !== false;

    document.querySelectorAll('.timedQuizOptionInput').forEach(function(input, i) {
      input.value = quiz.options[i] || '';
    });

    document.querySelectorAll('.timedQuizCorrectCheck').forEach(function(input, i) {
      input.checked = i === Number(quiz.correctOptionIndex);
    });

    const title = document.getElementById('timedQuizPopoverTitle');
    if (title) title.textContent = 'Edit Timed Quiz';
  }

  function resetForm() {
    setFormValue('timedQuizEditIndex', '-1');
    setFormValue('timedQuizTimestamp', '');
    setFormValue('timedQuizQuestion', '');
    setFormValue('timedQuizExplanation', '');

    const pauseOnShowEl = document.getElementById('timedQuizPauseOnShow');
    if (pauseOnShowEl) pauseOnShowEl.checked = true;

    document.querySelectorAll('.timedQuizOptionInput').forEach(function(input) {
      input.value = '';
    });

    document.querySelectorAll('.timedQuizCorrectCheck').forEach(function(input) {
      input.checked = false;
    });

    const title = document.getElementById('timedQuizPopoverTitle');
    if (title) title.textContent = 'Add Timed Quiz';
  }

  function renderQuizList() {
    const list = document.getElementById('timedQuizList');
    if (!list) return;

    state.quizzes = normalizeQuizzes(state.quizzes);

    if (!state.quizzes.length) {
      list.innerHTML = '<div class="text-muted small">No timed quizzes yet. Click the floating + button to add one.</div>';
      return;
    }

    list.innerHTML = state.quizzes.map(function(quiz, index) {
      return '' +
        '<article class="quiz-item">' +
          '<div class="quiz-item-top">' +
            '<span class="quiz-time">' + formatSeconds(quiz.triggerTimeSec) + '</span>' +
            '<div class="quiz-item-actions">' +
              '<button type="button" class="btn btn-sm btn-outline-primary" data-quiz-action="edit" data-quiz-index="' + index + '">Edit</button>' +
              '<button type="button" class="btn btn-sm btn-outline-danger" data-quiz-action="delete" data-quiz-index="' + index + '">Delete</button>' +
            '</div>' +
          '</div>' +
          '<p class="quiz-question-preview">' + escapeHtml(quiz.question || '') + '</p>' +
        '</article>';
    }).join('');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
