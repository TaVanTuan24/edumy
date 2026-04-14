(function() {
  'use strict';

  const DEFAULT_ICON_X_PERCENT = 93;
  const DEFAULT_ICON_Y_PERCENT = 12;

  const state = {
    courseId: '',
    videoId: '',
    sectionIndex: 0,
    lessonIndex: 0,
    videoUrl: '',
    quizzes: [],
    previewIsYouTube: false,
    previewPlayer: null,
    previewPollId: null,
    previewPendingQuiz: null,
    previewShownQuizIds: new Set(),
    youtubeReadyPromise: null,
    markerDragging: false,
    markerStartClientX: 0,
    markerStartClientY: 0,
    markerStartX: DEFAULT_ICON_X_PERCENT,
    markerStartY: DEFAULT_ICON_Y_PERCENT,
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
    state.videoId = String(payload.videoId || '');
    state.sectionIndex = Number(payload.sectionIndex || 0);
    state.lessonIndex = Number(payload.lessonIndex || 0);
    state.videoUrl = String(payload.videoUrl || '');
    state.quizzes = normalizeQuizzes(payload.interactiveQuizzes || []);

    initVideoPreview(payload.videoUrl || '');
    renderProviderHint(payload.videoUrl || '');

    bindFabDragAndOpen();
    bindPopoverActions();
    bindCorrectCheckboxes();
    bindPositionInputs();
    bindOverlayMarker();
    bindPreviewHotspot();
    bindAiAutoQuiz();
    syncMarkerFromInputs();
    renderQuizList();
  }

  function bindAiAutoQuiz() {
    const aiBtn = document.getElementById('aiAutoQuizBtn');
    if (!aiBtn) return;

    aiBtn.addEventListener('click', async function() {
      if (!state.videoId) {
        setAiStatus('Không tìm thấy videoId cho bài học này.', true);
        return;
      }

      const countInput = document.getElementById('aiAutoQuizCount');
      const count = Math.min(Math.max(parseInt(countInput && countInput.value, 10) || 5, 1), 15);
      const strictModeEl = document.getElementById('aiAutoQuizStrictMode');
      const strictMode = Boolean(strictModeEl && strictModeEl.checked);

      aiBtn.disabled = true;

      try {
        setAiStatus('Đang lấy transcript từ YouTube...');

        const transcriptRes = await fetch(`/videos/${encodeURIComponent(state.videoId)}/transcript`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json'
          }
        });

        const transcriptData = await parseApiResponse(transcriptRes);
        if (!transcriptRes.ok || !transcriptData || !transcriptData.success) {
          throw new Error(transcriptData && transcriptData.message ? transcriptData.message : 'Không thể tạo transcript.');
        }

        setAiStatus('Transcript đã lưu. Đang tạo quiz bằng AI...');

        const quizRes = await fetch(`/videos/${encodeURIComponent(state.videoId)}/ai-quiz`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ numberOfQuestions: count, strictMode: strictMode })
        });

        const quizData = await parseApiResponse(quizRes);
        if (!quizRes.ok || !quizData || !quizData.success) {
          throw new Error(quizData && quizData.message ? quizData.message : 'Không thể tạo quiz bằng AI.');
        }

        const generated = Array.isArray(quizData.quiz) ? quizData.quiz : [];
        if (!generated.length) {
          throw new Error('AI không trả về câu hỏi hợp lệ.');
        }

        console.log('[AI Quiz Generated]', generated);

        state.quizzes = normalizeQuizzes(generated.map(function(entry, index) {
          const letter = String(entry && entry.correctAnswer || 'A').trim().toUpperCase();
          const letterMap = { A: 0, B: 1, C: 2, D: 3 };

          return {
            triggerTimeSec: parseSuggestedTimestamp(entry && entry.suggestedTimestamp),
            question: String(entry && entry.question || '').trim(),
            options: Array.isArray(entry && entry.options)
              ? entry.options.map(function(opt) { return String(opt || '').trim(); }).slice(0, 4)
              : ['', '', '', ''],
            correctOptionIndex: Number.isFinite(letterMap[letter]) ? letterMap[letter] : 0,
            explanation: String(entry && entry.explanation || '').trim(),
            pauseOnShow: false,
            order: index,
            position: { xPercent: DEFAULT_ICON_X_PERCENT, yPercent: DEFAULT_ICON_Y_PERCENT }
          };
        }));

        setAiStatus(`Đã tạo ${generated.length} câu hỏi${strictMode ? ' (strict mode)' : ''}. Đang lưu vào video settings...`);
        persistQuizzes();
      } catch (err) {
        console.error('[AI Auto Quiz Error]', err);
        setAiStatus(err && err.message ? err.message : 'Đã có lỗi khi tạo quiz AI.', true);
      } finally {
        aiBtn.disabled = false;
      }
    });
  }

  async function parseApiResponse(response) {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      return response.json();
    }

    const text = await response.text();
    const looksLikeHtml = /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);

    if (response.redirected || looksLikeHtml) {
      const loginHint = response.url && response.url.includes('/users/login')
        ? 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'
        : 'Server trả về HTML thay vì JSON. Vui lòng kiểm tra đăng nhập/quyền truy cập.';

      return { success: false, message: loginHint };
    }

    return { success: false, message: text || 'Phản hồi không hợp lệ từ server.' };
  }

  function parseSuggestedTimestamp(raw) {
    const value = String(raw || '').trim();
    if (!value) return 0;

    if (/^\d+$/.test(value)) {
      return Math.max(0, parseInt(value, 10));
    }

    const hhmmss = value.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (hhmmss) {
      const h = parseInt(hhmmss[1], 10);
      const m = parseInt(hhmmss[2], 10);
      const s = parseInt(hhmmss[3], 10);
      return (h * 3600) + (m * 60) + s;
    }

    const mmss = value.match(/^(\d{1,3}):(\d{2})$/);
    if (mmss) {
      const m = parseInt(mmss[1], 10);
      const s = parseInt(mmss[2], 10);
      return (m * 60) + s;
    }

    return 0;
  }

  function setAiStatus(message, isError) {
    const statusEl = document.getElementById('aiAutoQuizStatus');
    if (!statusEl) return;

    statusEl.textContent = String(message || '');
    statusEl.classList.toggle('text-danger', Boolean(isError));
  }

  function _ensureYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (state.youtubeReadyPromise) return state.youtubeReadyPromise;

    state.youtubeReadyPromise = new Promise(function(resolve, reject) {
      const timeoutId = setTimeout(function() {
        reject(new Error('YouTube API timeout'));
      }, 7000);

      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function() {
        if (typeof previous === 'function') previous();
        clearTimeout(timeoutId);
        resolve();
      };

      const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existing) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    });

    return state.youtubeReadyPromise;
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

    const shortMatch = raw.match(/youtu\.be\/([a-zA-Z0-9_-]+)/i);
    if (shortMatch) return shortMatch[1];

    const watchMatch = raw.match(/[?&](?:v|vi)=([a-zA-Z0-9_-]+)/i);
    if (watchMatch) return watchMatch[1];

    return '';
  }

  function buildYouTubeEmbedUrl(videoId) {
    const id = String(videoId || '').trim();
    if (!id) return '';
    const url = new URL('https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id));
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', window.location.origin);
    url.searchParams.set('rel', '0');
    return url.toString();
  }

  function normalizePercent(raw, fallback) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
  }

  function initVideoPreview(rawUrl) {
    const iframe = document.getElementById('videoSettingsIframe');
    if (!iframe) return;

    clearPreviewPolling();
    hidePreviewHotspot();
    hidePreviewQuizPopup();
    state.previewPendingQuiz = null;
    state.previewShownQuizIds = new Set();

    const url = String(rawUrl || '').trim();
    if (!url) {
      iframe.src = '';
      return;
    }

    if (/(?:youtube\.com|youtu\.be)/i.test(url)) {
      state.previewIsYouTube = true;
      const id = getYouTubeId(url);
      if (id) {
        // Keep admin preview simple and reliable: always render iframe immediately.
        iframe.src = buildYouTubeEmbedUrl(id);
        return;
      }
      iframe.src = '';
      return;
    }

    state.previewIsYouTube = false;
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
          pauseOnShow: Boolean(entry && entry.pauseOnShow),
          order: Number.isFinite(Number(entry && entry.order)) ? Number(entry.order) : index,
          position: {
            xPercent: normalizePercent(entry && entry.position && entry.position.xPercent, DEFAULT_ICON_X_PERCENT),
            yPercent: normalizePercent(entry && entry.position && entry.position.yPercent, DEFAULT_ICON_Y_PERCENT)
          }
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

    // Keep the FAB fixed and use click only.
    fab.addEventListener('click', function() {
      togglePopoverNearFab();
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

    popover.classList.add('show');
    popover.setAttribute('aria-hidden', 'false');
    positionPopoverNearFab();
    window.requestAnimationFrame(positionPopoverNearFab);
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
    const height = popover.offsetHeight || 520;
    const margin = 8;
    const gap = 14;
    const viewportBottomPadding = 24;

    let left = fabRect.left - width - gap;

    // Prefer opening upward so the full form is easier to see.
    let top = fabRect.bottom - height;
    const minTop = margin;
    const maxTop = window.innerHeight - height - viewportBottomPadding;

    if (top < minTop) {
      // Fallback when there is not enough space above.
      top = Math.min(maxTop, fabRect.bottom + gap);
    }

    if (left < margin) left = fabRect.right + gap;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    if (top + height > window.innerHeight - viewportBottomPadding) top = window.innerHeight - height - viewportBottomPadding;
    if (top < margin) top = margin;

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

  function bindPositionInputs() {
    const xInput = document.getElementById('timedQuizPosX');
    const yInput = document.getElementById('timedQuizPosY');
    if (!xInput || !yInput) return;

    function onInput() {
      xInput.value = String(normalizePercent(xInput.value, DEFAULT_ICON_X_PERCENT));
      yInput.value = String(normalizePercent(yInput.value, DEFAULT_ICON_Y_PERCENT));
      syncMarkerFromInputs();
    }

    xInput.addEventListener('input', onInput);
    yInput.addEventListener('input', onInput);
  }

  function bindOverlayMarker() {
    const marker = document.getElementById('videoSettingsMarker');
    const overlay = document.getElementById('videoPreviewOverlay');
    if (!marker || !overlay) return;

    marker.addEventListener('mousedown', function(e) {
      state.markerDragging = true;
      state.markerStartClientX = e.clientX;
      state.markerStartClientY = e.clientY;
      state.markerStartX = normalizePercent(getFormValue('timedQuizPosX'), DEFAULT_ICON_X_PERCENT);
      state.markerStartY = normalizePercent(getFormValue('timedQuizPosY'), DEFAULT_ICON_Y_PERCENT);
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!state.markerDragging) return;
      const rect = overlay.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dx = e.clientX - state.markerStartClientX;
      const dy = e.clientY - state.markerStartClientY;

      const nextX = state.markerStartX + ((dx / rect.width) * 100);
      const nextY = state.markerStartY + ((dy / rect.height) * 100);

      setFormValue('timedQuizPosX', String(normalizePercent(nextX, DEFAULT_ICON_X_PERCENT).toFixed(1)));
      setFormValue('timedQuizPosY', String(normalizePercent(nextY, DEFAULT_ICON_Y_PERCENT).toFixed(1)));
      syncMarkerFromInputs();
    });

    document.addEventListener('mouseup', function() {
      state.markerDragging = false;
    });
  }

  function syncMarkerFromInputs() {
    const marker = document.getElementById('videoSettingsMarker');
    if (!marker) return;

    const x = normalizePercent(getFormValue('timedQuizPosX'), DEFAULT_ICON_X_PERCENT);
    const y = normalizePercent(getFormValue('timedQuizPosY'), DEFAULT_ICON_Y_PERCENT);
    marker.style.left = 'calc(' + x + '% - 18px)';
    marker.style.top = 'calc(' + y + '% - 18px)';
  }

  function bindPreviewHotspot() {
    const hotspot = document.getElementById('videoPreviewHotspot');
    if (!hotspot || hotspot.dataset.bound === '1') return;
    hotspot.dataset.bound = '1';

    hotspot.addEventListener('click', function() {
      const quiz = state.previewPendingQuiz;
      if (!quiz) return;
      showPreviewQuizPopup(quiz);
      hidePreviewHotspot();
      state.previewPendingQuiz = null;
    });
  }

  function _startPreviewPolling() {
    clearPreviewPolling();
    if (!state.previewPlayer || typeof state.previewPlayer.getCurrentTime !== 'function') return;

    state.previewPollId = setInterval(function() {
      if (!state.previewPlayer || typeof state.previewPlayer.getCurrentTime !== 'function') return;
      const popup = document.getElementById('videoPreviewQuizPopup');
      if (popup && popup.style.display !== 'none') return;

      let current = 0;
      try {
        current = Number(state.previewPlayer.getCurrentTime() || 0);
      } catch {
        current = 0;
      }

      const next = state.quizzes.find(function(quiz) {
        const id = String(quiz && quiz._id || '');
        if (!id) return false;
        if (state.previewShownQuizIds.has(id)) return false;
        return current >= Number(quiz.triggerTimeSec || 0);
      });

      if (!next) return;
      state.previewShownQuizIds.add(String(next._id));
      state.previewPendingQuiz = next;
      showPreviewHotspot(next);
    }, 300);
  }

  function clearPreviewPolling() {
    if (state.previewPollId) {
      clearInterval(state.previewPollId);
      state.previewPollId = null;
    }
  }

  function showPreviewHotspot(quiz) {
    const overlay = document.getElementById('videoPreviewOverlay');
    const hotspot = document.getElementById('videoPreviewHotspot');
    if (!overlay || !hotspot || !quiz) return;

    const rect = overlay.getBoundingClientRect();
    const xPercent = normalizePercent(quiz && quiz.position && quiz.position.xPercent, DEFAULT_ICON_X_PERCENT);
    const yPercent = normalizePercent(quiz && quiz.position && quiz.position.yPercent, DEFAULT_ICON_Y_PERCENT);
    const size = 34;

    const left = Math.max(0, Math.min(rect.width - size, (rect.width * (xPercent / 100)) - (size / 2)));
    const top = Math.max(0, Math.min(rect.height - size, (rect.height * (yPercent / 100)) - (size / 2)));

    hotspot.style.left = left + 'px';
    hotspot.style.top = top + 'px';
    hotspot.style.display = 'inline-flex';
  }

  function hidePreviewHotspot() {
    const hotspot = document.getElementById('videoPreviewHotspot');
    if (!hotspot) return;
    hotspot.style.display = 'none';
  }

  function showPreviewQuizPopup(quiz) {
    const popup = document.getElementById('videoPreviewQuizPopup');
    if (!popup || !quiz) return;

    popup.innerHTML = '' +
      '<div class="video-preview-quiz-head">' +
        '<div class="video-preview-quiz-title">Quiz Preview</div>' +
        '<button class="video-preview-quiz-close" type="button" data-preview-close>×</button>' +
      '</div>' +
      '<div class="video-preview-quiz-question">' + escapeHtml(quiz.question || '') + '</div>' +
      '<div class="video-preview-quiz-options">' +
        (quiz.options || []).map(function(opt, idx) {
          const cls = idx === Number(quiz.correctOptionIndex) ? 'video-preview-quiz-option correct' : 'video-preview-quiz-option';
          return '<button class="' + cls + '" type="button">' + escapeHtml(opt || ('Option ' + (idx + 1))) + '</button>';
        }).join('') +
      '</div>';

    popup.style.display = 'block';
    popup.setAttribute('aria-hidden', 'false');

    const closeBtn = popup.querySelector('[data-preview-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        hidePreviewQuizPopup();
      });
    }
  }

  function hidePreviewQuizPopup() {
    const popup = document.getElementById('videoPreviewQuizPopup');
    if (!popup) return;
    popup.style.display = 'none';
    popup.setAttribute('aria-hidden', 'true');
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
    const posX = normalizePercent(getFormValue('timedQuizPosX'), DEFAULT_ICON_X_PERCENT);
    const posY = normalizePercent(getFormValue('timedQuizPosY'), DEFAULT_ICON_Y_PERCENT);
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
      order: editIndex >= 0 ? editIndex : state.quizzes.length,
      position: {
        xPercent: posX,
        yPercent: posY
      }
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
        state.previewShownQuizIds = new Set();
        state.previewPendingQuiz = null;
        hidePreviewHotspot();
        hidePreviewQuizPopup();
        renderQuizList();
        resetForm();
        closePopover();
        setAiStatus(`Đã lưu ${state.quizzes.length} câu hỏi vào video thành công.`);
      })
      .catch(function(err) {
        console.error('[Timed Quiz Save Error]', err);
        setAiStatus(err && err.message ? err.message : 'Failed to save timed quizzes.', true);
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
      const popover = getPopover();
      if (popover) {
        popover.classList.add('show');
        popover.setAttribute('aria-hidden', 'false');
        positionPopoverNearFab();
        window.requestAnimationFrame(positionPopoverNearFab);
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
    setFormValue('timedQuizPosX', String(normalizePercent(quiz && quiz.position && quiz.position.xPercent, DEFAULT_ICON_X_PERCENT)));
    setFormValue('timedQuizPosY', String(normalizePercent(quiz && quiz.position && quiz.position.yPercent, DEFAULT_ICON_Y_PERCENT)));

    const pauseOnShowEl = document.getElementById('timedQuizPauseOnShow');
    if (pauseOnShowEl) pauseOnShowEl.checked = Boolean(quiz.pauseOnShow);

    document.querySelectorAll('.timedQuizOptionInput').forEach(function(input, i) {
      input.value = quiz.options[i] || '';
    });

    document.querySelectorAll('.timedQuizCorrectCheck').forEach(function(input, i) {
      input.checked = i === Number(quiz.correctOptionIndex);
    });

    const title = document.getElementById('timedQuizPopoverTitle');
    if (title) title.textContent = 'Edit Timed Quiz';
    syncMarkerFromInputs();
  }

  function resetForm() {
    setFormValue('timedQuizEditIndex', '-1');
    setFormValue('timedQuizTimestamp', '');
    setFormValue('timedQuizQuestion', '');
    setFormValue('timedQuizExplanation', '');
    setFormValue('timedQuizPosX', String(DEFAULT_ICON_X_PERCENT));
    setFormValue('timedQuizPosY', String(DEFAULT_ICON_Y_PERCENT));

    const pauseOnShowEl = document.getElementById('timedQuizPauseOnShow');
    if (pauseOnShowEl) pauseOnShowEl.checked = false;

    document.querySelectorAll('.timedQuizOptionInput').forEach(function(input) {
      input.value = '';
    });

    document.querySelectorAll('.timedQuizCorrectCheck').forEach(function(input) {
      input.checked = false;
    });

    const title = document.getElementById('timedQuizPopoverTitle');
    if (title) title.textContent = 'Add Timed Quiz';
    syncMarkerFromInputs();
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
