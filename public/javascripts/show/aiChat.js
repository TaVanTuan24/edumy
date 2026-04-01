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

    const courseId = popup.dataset.courseId || '';

    if (!input || !sendBtn || !messages || !courseId) return;

    chatToggle.addEventListener('click', function() {
      toggleChat(popup);
    });

    const closeBtn = popup.querySelector('[data-chat-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        toggleChat(popup, false);
      });
    }

    sendBtn.addEventListener('click', function() {
      sendMessage(courseId, input, messages, typing, status, sendBtn);
    });

    input.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage(courseId, input, messages, typing, status, sendBtn);
      }
    });

    document.querySelectorAll('[data-ai-quick]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        input.value = btn.dataset.aiQuick || '';
        sendMessage(courseId, input, messages, typing, status, sendBtn);
      });
    });

    updateStatusContext(status);
  }

  function sendMessage(courseId, input, messages, typing, status, sendBtn) {
    const message = String(input.value || '').trim();
    if (!message) return;

    addMessage(messages, 'user', message);
    input.value = '';

    setLoading(true, typing, status, sendBtn);

    const context = getCurrentContext();

    fetch('/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: courseId, question: message, context: context })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        const answer = data && (data.answer || data.reply || data.error) ? (data.answer || data.reply || data.error) : 'Không có phản hồi.';
        addMessage(messages, 'ai', answer);
        refreshGamificationWidget();
      })
      .catch(function(err) {
        console.error('[AI Chat Error]', err);
        addMessage(messages, 'ai', 'Không thể kết nối AI lúc này.');
      })
      .finally(function() {
        setLoading(false, typing, status, sendBtn);
        updateStatusContext(status);
      });
  }

  function addMessage(messages, role, text) {
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function toggleChat(popup, forceOpen) {
    const isHidden = popup.classList.contains('hidden');
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : isHidden;
    popup.classList.toggle('hidden', !shouldOpen);
  }

  function setLoading(isLoading, typing, status, sendBtn) {
    if (typing) typing.style.display = isLoading ? 'block' : 'none';
    if (status) status.textContent = isLoading ? 'Đang trả lời...' : 'Sẵn sàng';
    if (sendBtn) sendBtn.disabled = !!isLoading;
  }

  function updateStatusContext(status) {
    if (!status) return;
    const context = getCurrentContext();
    const parts = [];
    if (context.type) parts.push('Type: ' + context.type);
    if (context.lessonId) parts.push('Lesson: ' + context.lessonId.slice(-6));
    if (context.slideIndex !== null && context.slideIndex !== undefined) {
      parts.push('Slide: ' + (Number(context.slideIndex) + 1));
    }
    status.textContent = parts.length ? parts.join(' | ') : 'Sẵn sàng';
  }

  function getCurrentContext() {
    if (window.currentContext) return window.currentContext;
    if (!window.LearningStore || !window.LearningStore.store) {
      return { lessonId: null, type: null, slideIndex: null };
    }
    const lesson = window.LearningStore.store.currentLesson;
    return {
      lessonId: lesson && lesson._id ? String(lesson._id) : null,
      type: lesson && lesson.type ? String(lesson.type) : null,
      slideIndex: null
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

  document.addEventListener('DOMContentLoaded', init);
})();
