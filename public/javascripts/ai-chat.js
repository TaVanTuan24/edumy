(function() {
  'use strict';

  const root = document.querySelector('.ai-chat-page');
  if (!root) return;

  const state = {
    currentChat: null,
    isLoading: false,
    chats: [],
    settings: null,
    shouldAutoScroll: true
  };

  const els = {
    sidebar: document.getElementById('aiSidebar'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    openSidebarBtn: document.getElementById('openSidebarBtn'),
    closeSidebarBtn: document.getElementById('closeSidebarBtn'),
    newChatBtn: document.getElementById('newChatBtn'),
    headerNewChatBtn: document.getElementById('headerNewChatBtn'),
    chatList: document.getElementById('chatList'),
    chatCountLabel: document.getElementById('chatCountLabel'),
    title: document.getElementById('currentChatTitle'),
    modelSelect: document.getElementById('modelSelect'),
    modelLabel: document.getElementById('conversationModelLabel'),
    headerModelLabel: document.getElementById('headerModelLabel'),
    modelEndpointHint: document.getElementById('modelEndpointHint'),
    settingsBtn: document.getElementById('aiSettingsBtn'),
    settingsModal: document.getElementById('aiSettingsModal'),
    settingsCloseBtn: document.getElementById('aiSettingsCloseBtn'),
    settingsForm: document.getElementById('aiSettingsForm'),
    settingsTestBtn: document.getElementById('aiSettingsTestBtn'),
    settingsDeleteBtn: document.getElementById('aiSettingsDeleteBtn'),
    settingsKeyStatus: document.getElementById('aiSettingsKeyStatus'),
    settingsBaseUrlStatus: document.getElementById('aiSettingsBaseUrlStatus'),
    settingsApiKeyHint: document.getElementById('aiSettingsApiKeyHint'),
    errorBanner: document.getElementById('errorBanner'),
    emptyState: document.getElementById('emptyState'),
    messages: document.getElementById('messages'),
    form: document.getElementById('chatForm'),
    input: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    regenerateBtn: document.getElementById('regenerateBtn')
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    syncModelLabel();
    showEmptyState();
    loadChats();
    refreshSettingsSnapshot({ silent: true, updateForm: false });
    els.input.focus();

    els.form.addEventListener('submit', function(event) {
      event.preventDefault();
      sendMessage();
    });

    els.input.addEventListener('keydown', function(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    els.input.addEventListener('input', function() {
      autoResize(els.input);
    });

    els.modelSelect.addEventListener('input', syncModelLabel);
    els.newChatBtn.addEventListener('click', newChat);
    els.headerNewChatBtn.addEventListener('click', newChat);
    els.regenerateBtn.addEventListener('click', regenerateLastReply);
    if (els.settingsBtn) els.settingsBtn.addEventListener('click', openSettings);
    if (els.settingsCloseBtn) els.settingsCloseBtn.addEventListener('click', closeSettings);
    if (els.settingsModal) {
      els.settingsModal.addEventListener('click', function(event) {
        if (event.target === els.settingsModal) closeSettings();
      });
    }
    if (els.settingsForm) {
      els.settingsForm.addEventListener('submit', saveSettings);
    }
    if (els.settingsTestBtn) els.settingsTestBtn.addEventListener('click', testSettingsConnection);
    if (els.settingsDeleteBtn) els.settingsDeleteBtn.addEventListener('click', deleteSettings);
    els.openSidebarBtn.addEventListener('click', openSidebar);
    els.closeSidebarBtn.addEventListener('click', closeSidebar);
    els.sidebarBackdrop.addEventListener('click', closeSidebar);

    document.querySelectorAll('[data-suggestion]').forEach(function(button) {
      button.addEventListener('click', function() {
        els.input.value = button.dataset.suggestion || '';
        autoResize(els.input);
        els.input.focus();
      });
    });

    els.messages.addEventListener('click', function(event) {
      const copyBtn = event.target.closest('[data-copy-message]');
      if (copyBtn) {
        copyMessage(copyBtn);
        return;
      }

      const codeBtn = event.target.closest('[data-copy-code]');
      if (codeBtn) {
        copyCodeBlock(codeBtn);
      }
    });

    els.messages.addEventListener('scroll', function() {
      state.shouldAutoScroll = isNearBottom();
    });
  }

  async function sendMessage() {
    const text = String(els.input.value || '').trim();
    if (!text || state.isLoading) return;

    clearError();
    showConversation();
    appendMessage({
      role: 'user',
      content: text,
      model: selectedModel(),
      status: 'ok',
      createdAt: new Date().toISOString()
    }, true, { forceScroll: true });

    els.input.value = '';
    autoResize(els.input);
    setLoading(true);
    const assistant = addStreamingMessage('Thinking');

    try {
      await requestAssistant('/ai/chat', {
        message: text,
        chatId: state.currentChat,
        model: selectedModel()
      }, assistant);
      await loadChats();
    } catch (error) {
      finalizeStreamingMessage(assistant, error.message || 'Could not connect to the AI service.', {
        status: 'error',
        model: selectedModel()
      });
      showError(error.message || 'Could not connect to the AI service.');
    } finally {
      setLoading(false);
      els.input.focus();
    }
  }

  async function regenerateLastReply() {
    if (!state.currentChat || state.isLoading) return;

    clearError();
    setLoading(true);
    const existingLast = [...els.messages.querySelectorAll('.ai-message')].reverse()
      .find(function(node) { return !node.id; });
    if (existingLast && existingLast.classList.contains('is-assistant')) {
      existingLast.remove();
    }
    const assistant = addStreamingMessage('Regenerating');

    try {
      await requestAssistant('/ai/' + encodeURIComponent(state.currentChat) + '/regenerate', {
        model: selectedModel()
      }, assistant);
      await loadChats();
    } catch (error) {
      finalizeStreamingMessage(assistant, error.message || 'Failed to regenerate response.', {
        status: 'error',
        model: selectedModel()
      });
      showError(error.message || 'Failed to regenerate response.');
    } finally {
      setLoading(false);
    }
  }

  async function loadChats() {
    try {
      const res = await fetch('/ai/list');
      const chats = await safeJson(res);
      state.chats = Array.isArray(chats) ? chats : [];
      renderChatList();
    } catch (_error) {
      els.chatList.innerHTML = '<div class="ai-history-empty">Could not load conversations.</div>';
    }
  }

  async function requestAssistant(url, payload, assistant) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'AI request failed.');
    handleStreamMeta(data, assistant);
    finalizeStreamingMessage(assistant, data.reply || '', {
      status: 'ok',
      model: data.model || selectedModel()
    });
  }

  function handleStreamMeta(data, assistant) {
    if (!data) return;
    if (data.chatId) state.currentChat = String(data.chatId);
    if (data.title) els.title.textContent = data.title;
    if (data.model) {
      assistant.model = data.model;
      setModel(data.model);
    }
  }

  async function loadChat(id) {
    clearError();
    state.currentChat = String(id);
    clearMessages();
    showConversation();
    setLoading(true, false);

    try {
      const res = await fetch('/ai/' + encodeURIComponent(id));
      const chat = await safeJson(res);
      if (!res.ok || !chat || !Array.isArray(chat.messages)) {
        throw new Error(chat.error || 'Chat not found');
      }

      els.title.textContent = chat.title || 'Conversation';
      setModel(chat.defaultModel || chat.lastModel || selectedModel());
      if (chat.messages.length) {
        chat.messages.forEach(function(message) {
          appendMessage(message, false, { preserveScroll: true });
        });
        scrollToBottom();
      } else {
        showEmptyState();
      }
      renderChatList();
      closeSidebar();
    } catch (error) {
      showError(error.message || 'Failed to load chat.');
    } finally {
      setLoading(false);
      updateRegenerateState();
    }
  }

  async function deleteChat(id) {
    const chat = state.chats.find(function(entry) {
      return String(entry && entry._id) === String(id);
    });
    const chatTitle = chat && chat.title ? chat.title : 'this conversation';
    try {
      const confirmed = await window.showConfirmModal({
        title: 'Delete Conversation',
        message: `Delete "${chatTitle}"?`,
        warning: 'This action cannot be undone.',
        confirmText: 'Delete Conversation',
        confirmingText: 'Deleting...',
        variant: 'danger',
        onConfirm: async function() {
          const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
          const res = await fetcher('/ai/' + encodeURIComponent(id), { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete chat');
        }
      });
      if (!confirmed) return;

      if (state.currentChat === String(id)) newChat();
      await loadChats();
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Conversation deleted.', 'success');
      }
    } catch (error) {
      showError(error.message || 'Failed to delete chat.');
    }
  }

  function renderChatList() {
    els.chatCountLabel.textContent = String(state.chats.length);
    els.chatList.innerHTML = '';

    if (!state.chats.length) {
      els.chatList.innerHTML =
        '<div class="ai-history-empty">' +
          '<i class="fa-regular fa-comments"></i>' +
          '<span>No conversations yet.</span>' +
          '<small>Your chats will appear here after you send a message.</small>' +
        '</div>';
      return;
    }

    state.chats.forEach(function(chat) {
      const item = document.createElement('div');
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.className = 'ai-history-item' + (String(chat._id) === state.currentChat ? ' is-active' : '');
      item.addEventListener('click', function() {
        loadChat(chat._id);
      });
      item.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          loadChat(chat._id);
        }
      });

      const text = document.createElement('div');
      text.innerHTML =
        '<div class="ai-history-title"></div>' +
        '<div class="ai-history-meta"></div>';
      text.querySelector('.ai-history-title').textContent = chat.title || 'New chat';
      text.querySelector('.ai-history-meta').textContent = modelLabel(chat.lastModel || chat.defaultModel) + ' - ' + (chat.messageCount || 0) + ' messages';

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ai-history-delete';
      remove.innerHTML = '<i class="fa-solid fa-trash"></i>';
      remove.setAttribute('aria-label', 'Delete conversation');
      remove.addEventListener('click', function(event) {
        event.stopPropagation();
        deleteChat(chat._id);
      });

      item.appendChild(text);
      item.appendChild(remove);
      els.chatList.appendChild(item);
    });
  }

  function appendMessage(message, animate, options) {
    showConversation();

    const settings = options || {};
    const role = message.role === 'user' ? 'user' : 'assistant';
    const status = message.status || 'ok';
    const shouldScroll = settings.forceScroll || (!settings.preserveScroll && state.shouldAutoScroll);
    const wrap = document.createElement('article');
    wrap.className = 'ai-message is-' + role + (status === 'error' ? ' is-error' : '');
    if (animate === false) wrap.style.animation = 'none';

    const head = document.createElement('div');
    head.className = 'ai-message-head';
    head.innerHTML = role === 'user'
      ? '<span>You</span><span></span>'
      : '<span>Assistant</span><span class="ai-model-chip"></span><span class="ai-status-chip"></span><span></span>';

    if (role === 'user') {
      head.lastElementChild.textContent = formatTime(message.createdAt);
    } else {
      head.querySelector('.ai-model-chip').textContent = modelBadgeLabel(message.model);
      const statusChip = head.querySelector('.ai-status-chip');
      statusChip.textContent = status === 'error' ? 'Error' : 'Generated';
      statusChip.classList.toggle('is-error', status === 'error');
      head.lastElementChild.textContent = formatTime(message.createdAt);
    }

    const bubble = document.createElement('div');
    bubble.className = 'ai-message-bubble';
    const body = document.createElement('div');
    body.className = 'ai-message-body';
    body.innerHTML = renderMarkdown(message.content || '');
    decorateRenderedMessage(body);
    bubble.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'ai-message-actions';
    if (role === 'assistant') {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'ai-message-action';
      copy.dataset.copyMessage = message.content || '';
      copy.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
      actions.appendChild(copy);
    }

    const stack = document.createElement('div');
    stack.className = 'ai-message-stack';
    stack.appendChild(head);
    stack.appendChild(bubble);
    if (actions.children.length) {
      stack.appendChild(actions);
    }

    if (role === 'assistant') {
      const avatar = document.createElement('div');
      avatar.className = 'ai-message-avatar';
      avatar.innerHTML = '<i class="fa-solid fa-graduation-cap"></i>';
      wrap.appendChild(avatar);
    }
    wrap.appendChild(stack);

    els.messages.appendChild(wrap);
    if (shouldScroll) {
      scrollToBottom();
    }
    updateRegenerateState();
    return {
      wrap: wrap,
      body: body,
      head: head,
      bubble: bubble,
      raw: message.content || '',
      model: message.model || selectedModel()
    };
  }

  function addStreamingMessage(label) {
    const assistant = appendMessage({
      role: 'assistant',
      model: selectedModel(),
      status: 'ok',
      createdAt: new Date().toISOString(),
      content: ''
    }, true, { forceScroll: true });

    assistant.wrap.id = 'aiStreamingMessage';
    assistant.wrap.classList.add('is-streaming', 'is-thinking');
    assistant.startedAt = Date.now();
    assistant.minTypingMs = 420;
    assistant.revealTimer = null;
    assistant.body.innerHTML =
      '<div class="ai-typing-indicator" role="status" aria-label="Assistant is generating">' +
        '<span></span><span></span><span></span>' +
      '</div>';
    els.messages.classList.add('is-streaming-active');
    const statusChip = assistant.head.querySelector('.ai-status-chip');
    if (statusChip) statusChip.textContent = label || 'Thinking';
    assistant.raw = '';
    return assistant;
  }

  function finalizeStreamingMessage(assistant, text, options) {
    const settings = options || {};
    const waitMs = getTypingDelay(assistant);
    if (settings.status !== 'error' && waitMs > 0 && !settings.skipTypingDelay) {
      window.setTimeout(function() {
        finalizeStreamingMessage(assistant, text, { ...settings, skipTypingDelay: true });
      }, waitMs);
      return;
    }

    if (assistant.revealTimer) {
      window.clearTimeout(assistant.revealTimer);
      assistant.revealTimer = null;
    }

    assistant.raw = String(text || '');
    assistant.wrap.id = '';
    assistant.wrap.classList.remove('is-streaming', 'is-thinking');
    assistant.wrap.classList.toggle('is-error', settings.status === 'error');
    assistant.body.innerHTML = renderMarkdown(assistant.raw);
    decorateRenderedMessage(assistant.body);
    els.messages.classList.remove('is-streaming-active');

    assistant.wrap.querySelectorAll('[data-copy-message]').forEach(function(button) {
      button.dataset.copyMessage = assistant.raw;
    });

    const modelChip = assistant.head.querySelector('.ai-model-chip');
    if (modelChip) modelChip.textContent = modelBadgeLabel(settings.model || assistant.model || selectedModel());
    const statusChip = assistant.head.querySelector('.ai-status-chip');
    if (statusChip) {
      statusChip.textContent = settings.status === 'error' ? 'Error' : 'Generated';
      statusChip.classList.toggle('is-error', settings.status === 'error');
    }
    updateRegenerateState();
    if (state.shouldAutoScroll) {
      scrollToBottom();
    }
  }

  function getTypingDelay(assistant) {
    const elapsed = Date.now() - (assistant.startedAt || Date.now());
    return Math.max(0, (assistant.minTypingMs || 0) - elapsed);
  }

  function newChat() {
    state.currentChat = null;
    els.title.textContent = 'New conversation';
    clearMessages();
    showEmptyState();
    els.input.value = '';
    autoResize(els.input);
    clearError();
    renderChatList();
    updateRegenerateState();
    closeSidebar();
    els.input.focus();
  }

  function showConversation() {
    els.emptyState.hidden = true;
  }

  function showEmptyState() {
    els.emptyState.hidden = false;
  }

  function clearMessages() {
    els.messages.querySelectorAll('.ai-message').forEach(function(node) {
      node.remove();
    });
  }

  function setLoading(isLoading, lockInput) {
    state.isLoading = !!isLoading;
    root.classList.toggle('is-loading', state.isLoading);
    els.sendBtn.disabled = !!isLoading;
    els.sendBtn.innerHTML = isLoading
      ? '<i class="fa-solid fa-circle-notch"></i>'
      : '<i class="fa-solid fa-paper-plane"></i>';
    els.input.disabled = lockInput === false ? false : !!isLoading;
    els.modelSelect.disabled = !!isLoading;
    syncModelLabel();
    updateRegenerateState();
  }

  function updateRegenerateState() {
    const last = [...els.messages.querySelectorAll('.ai-message')].reverse()
      .find(function(node) { return !node.id; });
    const canRegenerate = !!state.currentChat && !state.isLoading && last && last.classList.contains('is-assistant');
    els.regenerateBtn.disabled = !canRegenerate;
  }

  function selectedModel() {
    return String(els.modelSelect.value || root.dataset.defaultModel || '').trim();
  }

  function setModel(model) {
    els.modelSelect.value = model || '';
    syncModelLabel();
  }

  function syncModelLabel() {
    const label = modelLabel(selectedModel());
    els.modelLabel.textContent = (state.isLoading ? 'Thinking - ' : 'Ready - ') + label;
    if (els.headerModelLabel) {
      els.headerModelLabel.textContent = label;
    }
    updateModelEndpointHint();
  }

  function modelLabel(model) {
    return model || 'No model configured';
  }

  function modelBadgeLabel(model) {
    return modelLabel(model);
  }

  function updateModelEndpointHint() {
    if (!els.modelEndpointHint) return;
    if (state.settings && state.settings.baseUrl) {
      els.modelEndpointHint.hidden = false;
      els.modelEndpointHint.textContent = 'Using custom Base URL';
      return;
    }
    els.modelEndpointHint.hidden = true;
    els.modelEndpointHint.textContent = '';
  }

  function populateSettingsForm(settings) {
    if (!els.settingsForm) return;
    const data = settings || {};
    const baseUrlField = els.settingsForm.querySelector('[name="baseUrl"]');
    const modelField = els.settingsForm.querySelector('[name="model"]');
    const apiKeyField = els.settingsForm.querySelector('[name="apiKey"]');
    if (baseUrlField) baseUrlField.value = data.baseUrl || '';
    if (modelField) modelField.value = data.model || '';
    if (apiKeyField) apiKeyField.value = '';
  }

  async function openSettings() {
    if (!els.settingsModal) return;
    els.settingsModal.hidden = false;
    await refreshSettingsSnapshot({ silent: false, updateForm: true });
    const firstInput = els.settingsForm && els.settingsForm.querySelector('input[type="password"], input[type="url"]');
    if (firstInput) firstInput.focus();
  }

  function closeSettings() {
    if (!els.settingsModal) return;
    els.settingsModal.hidden = true;
  }

  async function refreshSettingsSnapshot(options) {
    const settings = options || {};
    try {
      const res = await fetch('/ai/settings');
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || data.message || 'Could not load AI settings');
      state.settings = data.settings || {};
      updateSettingsStatus(data.settings || {});
      if (settings.updateForm !== false) populateSettingsForm(data.settings || {});
      if (!selectedModel() && data.settings && data.settings.model) setModel(data.settings.model);
    } catch (error) {
      if (!settings.silent) {
        showSettingsToast({
          type: 'error',
          title: 'AI Settings',
          message: error.message || 'Could not load AI settings.'
        });
      }
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!els.settingsForm) return;

    const formData = new FormData(els.settingsForm);
    const payload = {
      baseUrl: String(formData.get('baseUrl') || '').trim(),
      model: String(formData.get('model') || '').trim()
    };
    const apiKey = String(formData.get('apiKey') || '').trim();
    if (apiKey || !(state.settings && state.settings.hasApiKey)) payload.apiKey = apiKey;

    try {
      const res = await fetch('/ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || data.message || 'Could not save AI settings');
      state.settings = data.settings || {};
      populateSettingsForm(data.settings || {});
      updateSettingsStatus(data.settings || {});
      setModel(data.settings && data.settings.model ? data.settings.model : payload.model);
      showSettingsToast({
        type: 'success',
        title: 'Settings saved',
        message: 'AI settings updated.'
      });
    } catch (error) {
      showSettingsToast({
        type: isLikelyValidationMessage(error && error.message) ? 'warning' : 'error',
        title: 'Save failed',
        message: error.message || 'Could not save AI settings.'
      });
    }
  }

  async function deleteSettings() {
    try {
      const confirmed = await window.showConfirmModal({
        title: 'Delete AI Config',
        message: 'Delete your saved AI configuration?',
        warning: 'You will need to enter Base URL, API key, and model again before using AI chat.',
        confirmText: 'Delete Config',
        confirmingText: 'Deleting...',
        variant: 'warning',
        onConfirm: async function() {
          try {
            const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
            const res = await fetcher('/ai/settings', { method: 'DELETE' });
            const data = await safeJson(res);
            if (!res.ok) throw new Error(data.error || data.message || 'Could not delete AI config');
            state.settings = data.settings || {};
            populateSettingsForm(data.settings || {});
            updateSettingsStatus(data.settings || {});
            setModel('');
            showSettingsToast({
              type: 'success',
              title: 'Config deleted',
              message: 'The saved AI configuration was deleted.'
            });
          } catch (error) {
            showSettingsToast({
              type: 'error',
              title: 'Delete failed',
              message: error.message || 'Could not delete AI config.'
            });
            throw error;
          }
        }
      });
      if (!confirmed) return;
    } catch (error) {
      if (!error || !error.message) {
        showSettingsToast({
          type: 'error',
          title: 'Delete failed',
          message: 'Could not delete AI config.'
        });
      }
    }
  }

  async function testSettingsConnection() {
    if (!els.settingsForm) return;
    const formData = new FormData(els.settingsForm);
    const payload = {
      baseUrl: String(formData.get('baseUrl') || '').trim(),
      model: String(formData.get('model') || '').trim()
    };
    const apiKey = String(formData.get('apiKey') || '').trim();
    if (apiKey || !(state.settings && state.settings.hasApiKey)) payload.apiKey = apiKey;
    try {
      const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
      const res = await fetcher('/ai/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || data.error || 'Connection test failed.');
      showSettingsToast({
        type: 'success',
        title: 'Connection successful',
        message: data.message || 'The endpoint responded successfully.'
      });
    } catch (error) {
      showSettingsToast({
        type: 'error',
        title: 'Connection failed',
        message: error.message || 'Connection test failed.'
      });
    }
  }

  function updateSettingsStatus(status) {
    const data = status || {};
    if (els.settingsKeyStatus) {
      els.settingsKeyStatus.textContent = data.hasApiKey
        ? 'Saved key: ' + (data.apiKeyMasked || 'encrypted')
        : 'No saved key';
      els.settingsKeyStatus.classList.toggle('is-connected', Boolean(data.hasApiKey));
    }
    if (els.settingsApiKeyHint) {
      els.settingsApiKeyHint.textContent = data.hasApiKey
        ? 'Leave blank to keep the saved key. The saved key is never shown.'
        : 'The key will not be shown again after saving.';
    }
    if (els.settingsBaseUrlStatus) {
      els.settingsBaseUrlStatus.textContent = data.baseUrl ? 'Base URL configured' : 'No endpoint configured';
      els.settingsBaseUrlStatus.classList.toggle('is-custom', Boolean(data.baseUrl));
    }
    updateModelEndpointHint();
  }

  function showSettingsToast(config) {
    const options = config || {};
    const title = options.title || 'Notice';

    if (typeof window.showToast === 'function') {
      window.showToast({
        type: options.type || 'info',
        title: title,
        message: options.message || '',
        duration: options.duration
      });
      return;
    }

    if (typeof window.showAppToast === 'function') {
      const variant = options.type === 'error' ? 'danger' : (options.type || 'info');
      window.showAppToast(options.message || '', variant, {
        title: title,
        duration: options.duration
      });
    }
  }

  function isLikelyValidationMessage(message) {
    return /(required|invalid|must|cannot|too short|too long|enter|save your changes)/i.test(String(message || ''));
  }

  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 168) + 'px';
  }

  function renderMarkdown(text) {
    if (window.marked && typeof window.marked.parse === 'function') {
      if (typeof window.marked.setOptions === 'function') {
        window.marked.setOptions({
          breaks: true,
          gfm: true,
          headerIds: false,
          mangle: false
        });
      }
      const html = window.marked.parse(String(text || ''));
      if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
        return window.DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          ADD_ATTR: ['target', 'rel']
        });
      }
      return html;
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function decorateRenderedMessage(rootNode) {
    rootNode.querySelectorAll('a[href]').forEach(function(link) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });

    rootNode.querySelectorAll('pre > code').forEach(function(code) {
      const pre = code.parentElement;
      if (!pre || pre.parentElement.classList.contains('ai-code-block')) return;

      if (window.hljs && typeof window.hljs.highlightElement === 'function') {
        window.hljs.highlightElement(code);
      }

      const language = getCodeLanguage(code);
      const wrap = document.createElement('div');
      wrap.className = 'ai-code-block';
      const toolbar = document.createElement('div');
      toolbar.className = 'ai-code-toolbar';
      toolbar.innerHTML =
        '<span>' + escapeHtml(language || 'code') + '</span>' +
        '<button type="button" data-copy-code><i class="fa-regular fa-copy"></i> Copy</button>';

      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(toolbar);
      wrap.appendChild(pre);
    });
  }

  function getCodeLanguage(code) {
    const className = code.className || '';
    const match = className.match(/language-([a-z0-9_-]+)/i);
    return match ? match[1] : '';
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async function copyMessage(button) {
    try {
      await navigator.clipboard.writeText(button.dataset.copyMessage || '');
      const old = button.innerHTML;
      button.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
      setTimeout(function() {
        button.innerHTML = old;
      }, 1200);
    } catch {
      showError('Could not copy this message.');
    }
  }

  async function copyCodeBlock(button) {
    const block = button.closest('.ai-code-block');
    const code = block && block.querySelector('pre code');
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code.textContent || '');
      const old = button.innerHTML;
      button.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
      setTimeout(function() {
        button.innerHTML = old;
      }, 1200);
    } catch {
      showError('Could not copy this code block.');
    }
  }

  function showError(message) {
    els.errorBanner.textContent = message;
    els.errorBanner.classList.remove('is-hidden');
  }

  function clearError() {
    els.errorBanner.textContent = '';
    els.errorBanner.classList.add('is-hidden');
  }

  function scrollToBottom() {
    window.requestAnimationFrame(function() {
      els.messages.scrollTop = els.messages.scrollHeight;
      state.shouldAutoScroll = true;
    });
  }

  function isNearBottom(offset) {
    const threshold = typeof offset === 'number' ? offset : 96;
    return els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight <= threshold;
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  function openSidebar() {
    els.sidebar.classList.add('is-open');
    els.sidebarBackdrop.classList.add('is-open');
  }

  function closeSidebar() {
    els.sidebar.classList.remove('is-open');
    els.sidebarBackdrop.classList.remove('is-open');
  }
})();
