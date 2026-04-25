(function() {
  'use strict';

  function init() {
    const chatToggle = document.getElementById('aiChatToggle');
    const popup = document.getElementById('aiChatPopup');
    if (!chatToggle || !popup) return;

    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    const messages = document.getElementById('chatMessages');
    const typing = document.getElementById('chatTyping');
    const status = document.getElementById('aiStatus');
    const contextLabel = document.getElementById('aiLessonContext');
    const modelSelect = document.getElementById('courseAiModel');

    const courseId = popup.dataset.courseId || '';
    if (!input || !sendBtn || !messages || !courseId) return;

    chatToggle.addEventListener('click', function() {
      toggleChat(popup);
      syncLessonContext(contextLabel, status);
    });

    const closeBtn = popup.querySelector('[data-chat-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        toggleChat(popup, false);
      });
    }

    sendBtn.addEventListener('click', function() {
      sendCustomMessage(courseId, input, messages, typing, status, contextLabel, sendBtn, modelSelect);
    });

    input.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendCustomMessage(courseId, input, messages, typing, status, contextLabel, sendBtn, modelSelect);
      }
    });

    document.querySelectorAll('[data-ai-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const action = btn.dataset.aiAction || 'custom';
        runLessonAiAction(courseId, action, input.value, messages, typing, status, contextLabel, sendBtn, modelSelect);
      });
    });

    window.addEventListener('lessonchange', function() {
      syncLessonContext(contextLabel, status);
    });

    syncLessonContext(contextLabel, status);
  }

  function sendCustomMessage(courseId, input, messages, typing, status, contextLabel, sendBtn, modelSelect) {
    const message = String(input.value || '').trim();
    if (!message) return;

    addMessage(messages, 'user', message);
    input.value = '';
    runLessonAiAction(courseId, 'custom', message, messages, typing, status, contextLabel, sendBtn, modelSelect);
  }

  function runLessonAiAction(courseId, action, message, messages, typing, status, contextLabel, sendBtn, modelSelect) {
    const model = modelSelect && modelSelect.value ? modelSelect.value : 'llama3.2';
    const context = getCurrentContext();

    if (!context.lessonId && (context.sectionIndex == null || context.lessonIndex == null)) {
      addMessage(messages, 'ai', 'Open a lesson first so the AI tutor knows what to explain.', model);
      return;
    }

    if (action !== 'custom') {
      addMessage(messages, 'user', buildActionLabel(action));
    }

    setLoading(true, typing, status, sendBtn);
    syncLessonContext(contextLabel, status);

    fetch('/courses/' + encodeURIComponent(courseId) + '/lessons/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        addMessage(messages, 'ai', answer, data && data.model ? data.model : model);
        refreshGamificationWidget();
      })
      .catch(function(err) {
        console.error('[Lesson AI Error]', err);
        addMessage(messages, 'ai', 'Unable to reach the lesson AI tutor right now.', model);
      })
      .finally(function() {
        setLoading(false, typing, status, sendBtn);
        syncLessonContext(contextLabel, status);
      });
  }

  function addMessage(messages, role, text, model) {
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role;

    if (role === 'ai') {
      const meta = document.createElement('span');
      meta.className = 'ai-msg-model';
      meta.textContent = formatModelLabel(model) + ' • AI Tutor';
      div.appendChild(meta);

      const body = document.createElement('div');
      body.className = 'ai-msg-body';
      body.innerHTML = renderMarkdown(text);
      div.appendChild(body);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-sm btn-outline-secondary mt-2';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(String(text || ''));
      });
      div.appendChild(copyBtn);
    } else {
      div.textContent = text;
    }

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      const html = window.marked.parse(String(text || ''));
      return window.DOMPurify.sanitize(html);
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function toggleChat(popup, forceOpen) {
    const isHidden = popup.classList.contains('hidden');
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : isHidden;
    popup.classList.toggle('hidden', !shouldOpen);
  }

  function setLoading(isLoading, typing, status, sendBtn) {
    if (typing) typing.style.display = isLoading ? 'block' : 'none';
    if (status) status.textContent = isLoading ? 'Generating tutor response...' : 'Ready';
    if (sendBtn) sendBtn.disabled = !!isLoading;
  }

  function syncLessonContext(contextLabel, status) {
    const lessonMeta = getCurrentLessonMeta();
    if (contextLabel) {
      contextLabel.textContent = lessonMeta
        ? ('Current lesson: ' + lessonMeta.sectionTitle + ' • ' + lessonMeta.lessonTitle + ' • ' + lessonMeta.lessonType)
        : 'Lesson context will appear here.';
    }

    if (status) {
      status.textContent = lessonMeta
        ? ('Ready • ' + lessonMeta.lessonTitle)
        : 'Ready';
    }
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
    return {
      lessonTitle: String(lesson.title || 'Lesson'),
      lessonType: String(lesson.type || 'lesson'),
      sectionTitle: String(section && section.title || 'Section'),
      sectionIndex: lesson.sectionIndex,
      lessonIndex: lesson.lessonIndex
    };
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
