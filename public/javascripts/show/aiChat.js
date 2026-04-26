(function() {
  'use strict';

  function init() {
    const chatToggle = document.getElementById('aiChatToggle');
    const popup = document.getElementById('aiChatPopup');
    if (!popup) return;

    const composer = document.getElementById('aiChatComposer');
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    const messages = document.getElementById('chatMessages');
    const transcript = document.getElementById('chatTranscript');
    const typing = document.getElementById('chatTyping');
    const status = document.getElementById('aiStatus');
    const contextSummary = document.getElementById('aiLessonContextSummary');
    const contextDetails = document.getElementById('aiLessonContextDetails');
    const contextToggle = document.getElementById('aiContextToggle');
    const modelSelect = document.getElementById('courseAiModel');
    const unreadIndicator = document.getElementById('aiChatUnreadIndicator');

    const courseId = popup.dataset.courseId || '';
    if (!input || !sendBtn || !messages || !transcript || !composer || !courseId) return;

    const state = {
      contextExpanded: false,
      loading: false,
      isOpen: false,
      unread: false,
      lastFocusedElement: null
    };

    ensureWelcomeMessage(transcript);
    resizeComposer(input);

    if (chatToggle) {
      chatToggle.addEventListener('click', function() {
        toggleChat(popup, chatToggle, state);
        syncLessonContext(contextSummary, contextDetails, contextToggle, status, state);
        scrollMessagesToBottom(messages);
        if (state.isOpen && input) {
          input.focus();
        }
      });
    }

    const closeBtn = popup.querySelector('[data-chat-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        toggleChat(popup, chatToggle, state, false);
      });
    }

    composer.addEventListener('submit', function(event) {
      event.preventDefault();
      sendCustomMessage(courseId, input, messages, transcript, typing, status, contextSummary, contextDetails, contextToggle, sendBtn, modelSelect, state, popup, unreadIndicator);
    });

    input.addEventListener('keydown', function(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });

    input.addEventListener('input', function() {
      resizeComposer(input);
    });

    document.querySelectorAll('[data-ai-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const action = btn.dataset.aiAction || 'custom';
        runLessonAiAction(courseId, action, input.value, messages, transcript, typing, status, contextSummary, contextDetails, contextToggle, sendBtn, modelSelect, state, popup, unreadIndicator);
      });
    });

    if (contextToggle) {
      contextToggle.addEventListener('click', function() {
        state.contextExpanded = !state.contextExpanded;
        syncLessonContext(contextSummary, contextDetails, contextToggle, status, state);
      });
    }

    window.addEventListener('lessonchange', function() {
      syncLessonContext(contextSummary, contextDetails, contextToggle, status, state);
    });

    document.addEventListener('keydown', function(event) {
      if (event.key !== 'Escape' || !state.isOpen) return;
      event.preventDefault();
      toggleChat(popup, chatToggle, state, false);
    });

    document.addEventListener('click', function(event) {
      if (!state.isOpen) return;
      if (popup.contains(event.target) || (chatToggle && chatToggle.contains(event.target))) return;
      toggleChat(popup, chatToggle, state, false);
    });

    syncLessonContext(contextSummary, contextDetails, contextToggle, status, state);
    syncUnreadIndicator(unreadIndicator, state);
    setWidgetOpenState(popup, chatToggle, state, false);
  }

  function sendCustomMessage(courseId, input, messages, transcript, typing, status, contextSummary, contextDetails, contextToggle, sendBtn, modelSelect, state, popup, unreadIndicator) {
    const message = String(input.value || '').trim();
    if (!message || state.loading) return;

    addMessage(transcript, 'user', message);
    input.value = '';
    resizeComposer(input);
    scrollMessagesToBottom(messages);
    runLessonAiAction(courseId, 'custom', message, messages, transcript, typing, status, contextSummary, contextDetails, contextToggle, sendBtn, modelSelect, state, popup, unreadIndicator);
  }

  function runLessonAiAction(courseId, action, message, messages, transcript, typing, status, contextSummary, contextDetails, contextToggle, sendBtn, modelSelect, state, popup, unreadIndicator) {
    const model = modelSelect && modelSelect.value ? modelSelect.value : 'llama3.2';
    const context = getCurrentContext();

    if (!context.lessonId && (context.sectionIndex == null || context.lessonIndex == null)) {
      addMessage(transcript, 'ai', 'Open a lesson first so the AI tutor knows what to explain.', model);
      scrollMessagesToBottom(messages);
      notifyClosedReply(state, unreadIndicator);
      return;
    }

    if (action !== 'custom') {
      addMessage(transcript, 'user', buildActionLabel(action));
      scrollMessagesToBottom(messages);
    }

    setLoading(true, typing, status, sendBtn, state);
    syncLessonContext(contextSummary, contextDetails, contextToggle, status, state);
    scrollMessagesToBottom(messages);

    const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
    fetcher('/courses/' + encodeURIComponent(courseId) + '/lessons/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        lessonId: context.lessonId,
        sectionIndex: context.sectionIndex,
        lessonIndex: context.lessonIndex,
        action: action,
        question: message,
        model: model
      })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        const answer = data && data.answer ? data.answer : (data && data.error ? data.error : 'No response.');
        addMessage(transcript, 'ai', answer, data && data.model ? data.model : model);
        scrollMessagesToBottom(messages);
        refreshGamificationWidget();
        notifyClosedReply(state, unreadIndicator);
      })
      .catch(function(err) {
        console.error('[Lesson AI Error]', err);
        addMessage(transcript, 'ai', 'Unable to reach the lesson AI tutor right now.', model);
        scrollMessagesToBottom(messages);
        notifyClosedReply(state, unreadIndicator);
      })
      .finally(function() {
        setLoading(false, typing, status, sendBtn, state);
        syncLessonContext(contextSummary, contextDetails, contextToggle, status, state);
        scrollMessagesToBottom(messages);
      });
  }

  function ensureWelcomeMessage(transcript) {
    if (!transcript || transcript.childElementCount > 0) return;
    addMessage(transcript, 'ai', 'Ask about the current lesson, request a summary, or generate practice prompts.', 'llama3.2');
  }

  function addMessage(transcript, role, text, model) {
    const div = document.createElement('article');
    div.className = 'ai-msg lesson-ai-message ' + role;

    if (role === 'ai') {
      const meta = document.createElement('span');
      meta.className = 'ai-msg-model lesson-ai-message-meta';
      meta.textContent = formatModelLabel(model) + ' • AI Tutor';
      div.appendChild(meta);

      const body = document.createElement('div');
      body.className = 'ai-msg-body lesson-ai-message-body';
      body.innerHTML = renderMarkdown(text);
      div.appendChild(body);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-sm btn-outline-secondary lesson-ai-copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(String(text || ''));
      });
      div.appendChild(copyBtn);
    } else {
      div.textContent = text;
    }

    transcript.appendChild(div);
  }

  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      const html = window.marked.parse(String(text || ''));
      return window.DOMPurify.sanitize(html);
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function toggleChat(popup, chatToggle, state, forceOpen) {
    const isHidden = popup.hidden;
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : isHidden;
    setWidgetOpenState(popup, chatToggle, state, shouldOpen);
  }

  function setWidgetOpenState(popup, chatToggle, state, isOpen) {
    if (!popup) return;

    const toggle = chatToggle || document.getElementById('aiChatToggle');
    const widgetState = state || {};
    const activeToggle = toggle instanceof HTMLElement ? toggle : null;

    if (!isOpen && !widgetState.isOpen && popup.hidden) {
      popup.classList.remove('is-open');
      popup.setAttribute('aria-hidden', 'true');
      if (activeToggle) {
        activeToggle.setAttribute('aria-expanded', 'false');
      }
      syncUnreadIndicator(document.getElementById('aiChatUnreadIndicator'), widgetState);
      return;
    }

    if (isOpen) {
      widgetState.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : activeToggle;
      popup.hidden = false;
      popup.classList.add('is-open');
      popup.setAttribute('aria-hidden', 'false');
      if (activeToggle) {
        activeToggle.setAttribute('aria-expanded', 'true');
      }
      widgetState.isOpen = true;
      widgetState.unread = false;
      syncUnreadIndicator(document.getElementById('aiChatUnreadIndicator'), widgetState);
      window.requestAnimationFrame(function() {
        const focusTarget = popup.querySelector('#chatInput') || popup.querySelector('[data-chat-close]') || popup;
        if (focusTarget && typeof focusTarget.focus === 'function') {
          focusTarget.focus();
        }
      });
      return;
    }

    popup.classList.remove('is-open');
    popup.setAttribute('aria-hidden', 'true');
    if (activeToggle) {
      activeToggle.setAttribute('aria-expanded', 'false');
    }
    widgetState.isOpen = false;
    window.setTimeout(function() {
      popup.hidden = true;
      const returnFocusTarget = widgetState.lastFocusedElement instanceof HTMLElement
        ? widgetState.lastFocusedElement
        : activeToggle;
      if (returnFocusTarget && typeof returnFocusTarget.focus === 'function') {
        returnFocusTarget.focus();
      }
    }, 160);
  }

  function setLoading(isLoading, typing, status, sendBtn, state) {
    if (state) {
      state.loading = !!isLoading;
    }
    if (typing) {
      typing.classList.toggle('hidden', !isLoading);
    }
    if (status) {
      status.textContent = isLoading ? 'AI is answering...' : 'Ready';
    }
    if (sendBtn) {
      sendBtn.disabled = !!isLoading;
    }
  }

  function syncLessonContext(contextSummary, contextDetails, contextToggle, status, state) {
    const lessonMeta = getCurrentLessonMeta();
    const isExpanded = !!(state && state.contextExpanded);

    if (contextSummary) {
      contextSummary.textContent = lessonMeta
        ? ('Current lesson: ' + lessonMeta.lessonTitle + (lessonMeta.contentMode ? ' (' + lessonMeta.contentMode + ')' : ''))
        : 'Lesson context will appear here.';
      contextSummary.title = lessonMeta
        ? (lessonMeta.sectionTitle + ' • ' + lessonMeta.lessonTitle + ' • ' + lessonMeta.lessonType)
        : '';
    }

    if (contextDetails) {
      contextDetails.classList.toggle('hidden', !isExpanded);
      contextDetails.innerHTML = lessonMeta
        ? (
          '<div><strong>Section</strong>: ' + escapeHtml(lessonMeta.sectionTitle) + '</div>' +
          '<div><strong>Lesson</strong>: ' + escapeHtml(lessonMeta.lessonTitle) + '</div>' +
          '<div><strong>Type</strong>: ' + escapeHtml(lessonMeta.lessonType) + '</div>' +
          (lessonMeta.contentMode ? '<div><strong>Content</strong>: ' + escapeHtml(lessonMeta.contentMode) + '</div>' : '')
        )
        : '<div>No lesson is currently open.</div>';
    }

    if (contextToggle) {
      contextToggle.textContent = isExpanded ? 'Hide context' : 'Show context';
      contextToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }

    if (status && !state.loading) {
      status.textContent = lessonMeta ? 'Ready' : 'Open a lesson to begin';
    }
  }

  function resizeComposer(input) {
    if (!(input instanceof HTMLTextAreaElement)) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  function scrollMessagesToBottom(messages) {
    if (!messages) return;
    messages.scrollTop = messages.scrollHeight;
  }

  function notifyClosedReply(state, unreadIndicator) {
    if (!state || state.isOpen) return;
    state.unread = true;
    syncUnreadIndicator(unreadIndicator, state);
  }

  function syncUnreadIndicator(unreadIndicator, state) {
    if (!unreadIndicator) return;
    const hasUnread = Boolean(state && state.unread);
    unreadIndicator.classList.toggle('hidden', !hasUnread);
  }

  function buildActionLabel(action) {
    const labels = {
      summarize: 'Summarize this lesson',
      explain: 'Explain like I am a beginner',
      practice: 'Generate practice questions',
      flashcards: 'Create flashcards'
    };
    return labels[action] || 'Ask AI Tutor';
  }

  function formatModelLabel(model) {
    if (model === 'grok') return 'Grok';
    if (model === 'gpt-5.4') return 'GPT-5.4';
    return 'llama3.2';
  }

  function getCurrentContext() {
    if (window.currentContext) {
      return {
        lessonId: window.currentContext.lessonId || null,
        type: window.currentContext.type || null,
        slideIndex: window.currentContext.slideIndex != null ? window.currentContext.slideIndex : null,
        sectionIndex: window.currentContext.sectionIndex != null ? window.currentContext.sectionIndex : null,
        lessonIndex: window.currentContext.lessonIndex != null ? window.currentContext.lessonIndex : null
      };
    }
    return { lessonId: null, type: null, slideIndex: null, sectionIndex: null, lessonIndex: null };
  }

  function getCurrentLessonMeta() {
    if (!window.LearningStore || !window.LearningStore.store || !window.LearningStore.store.currentLesson) {
      return null;
    }
    const lesson = window.LearningStore.store.currentLesson;
    const section = window.LearningStore.store.sections[lesson.sectionIndex];
    const displayTitle = lesson.displayTitle
      || (typeof window.LearningStore.formatLessonTitle === 'function' ? window.LearningStore.formatLessonTitle(lesson.title) : String(lesson.title || 'Lesson'));
    return {
      lessonTitle: String(displayTitle || 'Lesson'),
      lessonType: String(lesson.type || 'lesson'),
      contentMode: getLessonContentModeLabel(lesson),
      sectionTitle: String(section && section.title || 'Section'),
      sectionIndex: lesson.sectionIndex,
      lessonIndex: lesson.lessonIndex
    };
  }

  function getLessonContentModeLabel(lesson) {
    if (!lesson || lesson.type !== 'slide') return '';
    const content = lesson.content && typeof lesson.content === 'object' ? lesson.content : {};
    const slides = Array.isArray(content.slides)
      ? content.slides
      : Array.isArray(lesson.slides)
        ? lesson.slides
        : [];
    const pdf = content.pdf || lesson.pdf;
    const hasPdf = typeof pdf === 'string'
      ? Boolean(pdf.trim())
      : Boolean(pdf && typeof pdf === 'object' && String(pdf.url || '').trim());
    const hasSlides = slides.length > 0;
    if (hasSlides && hasPdf) return 'Slides + PDF';
    if (hasPdf) return 'PDF';
    if (hasSlides) return 'Slides';
    return 'Empty';
  }

  function refreshGamificationWidget() {
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
        console.error('[Gamification Refresh Error]', err);
      });
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
