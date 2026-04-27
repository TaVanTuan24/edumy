(function() {
  'use strict';

  const root = document.querySelector('.ai-chat-page');
  if (!root) return;

  const state = {
    currentChat: null,
    isLoading: false,
    chats: [],
    models: [],
    providerStatus: {},
    savedBaseUrls: {},
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
    hydrateModelsFromSelect();
    syncModelLabel();
    showEmptyState();
    loadChats();
    loadModels();
    refreshSettingsSnapshot({ silent: true, updateForm: false, updateModels: false });
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

    els.modelSelect.addEventListener('change', syncModelLabel);
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
      els.settingsForm.querySelectorAll('[data-clear-key]').forEach(function(button) {
        button.addEventListener('click', function() {
          clearProviderKey(button.dataset.clearKey);
        });
      });
      els.settingsForm.querySelectorAll('[data-reset-base-url]').forEach(function(button) {
        button.addEventListener('click', function() {
          resetProviderBaseUrl(button.dataset.resetBaseUrl);
        });
      });
      els.settingsForm.querySelectorAll('[data-test-provider]').forEach(function(button) {
        button.addEventListener('click', function() {
          testProviderConnection(button.dataset.testProvider);
        });
      });
    }
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
      await streamAssistant('/ai/chat/stream', {
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
      await streamAssistant('/ai/' + encodeURIComponent(state.currentChat) + '/regenerate/stream', {
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

  async function streamAssistant(url, payload, assistant) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });

    if (!res.ok) {
      const data = await safeJson(res);
      throw new Error(data.error || 'AI request failed.');
    }

    if (!res.body || typeof res.body.getReader !== 'function') {
      await fallbackAssistant(payload, assistant);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;

    while (true) {
      const result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      events.forEach(function(block) {
        completed = handleStreamEvent(block, assistant) || completed;
      });
    }

    if (buffer.trim()) {
      completed = handleStreamEvent(buffer, assistant) || completed;
    }

    if (!completed) {
      throw new Error('AI stream ended before the response completed.');
    }
  }

  async function fallbackAssistant(payload, assistant) {
    const fallbackUrl = state.currentChat && !payload.message
      ? '/ai/' + encodeURIComponent(state.currentChat) + '/regenerate'
      : '/ai/chat';
    const res = await fetch(fallbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'AI request failed.');
    if (data.chatId) state.currentChat = String(data.chatId);
    if (data.title) els.title.textContent = data.title;
    finalizeStreamingMessage(assistant, data.reply || '', {
      status: 'ok',
      model: data.model || selectedModel()
    });
  }

  function parseStreamEvent(block) {
    const lines = String(block || '').split('\n');
    let event = 'message';
    let data = '';

    lines.forEach(function(line) {
      if (line.indexOf('event:') === 0) {
        event = line.slice(6).trim();
      } else if (line.indexOf('data:') === 0) {
        data += line.slice(5).trim();
      }
    });

    if (!data) return null;

    try {
      return { event: event, data: JSON.parse(data) };
    } catch {
      return null;
    }
  }

  function handleStreamEvent(block, assistant) {
    const parsed = parseStreamEvent(block);
    if (!parsed) return false;
    if (parsed.event === 'meta') {
      handleStreamMeta(parsed.data, assistant);
    }
    if (parsed.event === 'chunk') {
      appendStreamingToken(assistant, parsed.data.token || '');
    }
    if (parsed.event === 'done') {
      handleStreamMeta(parsed.data, assistant);
      finalizeStreamingMessage(assistant, parsed.data.reply || assistant.raw || '', {
        status: 'ok',
        model: parsed.data.model || selectedModel()
      });
      return true;
    }
    if (parsed.event === 'error') {
      throw new Error(parsed.data.error || 'AI request failed.');
    }
    return false;
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
    const statusChip = assistant.head.querySelector('.ai-status-chip');
    if (statusChip) statusChip.textContent = label || 'Thinking';
    assistant.raw = '';
    return assistant;
  }

  function appendStreamingToken(assistant, token) {
    if (!token) return;
    assistant.raw += token;
    revealStreamingText(assistant);
    if (state.shouldAutoScroll) {
      scrollToBottom();
    }
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

  function revealStreamingText(assistant) {
    const waitMs = getTypingDelay(assistant);
    if (waitMs > 0) {
      if (!assistant.revealTimer) {
        assistant.revealTimer = window.setTimeout(function() {
          assistant.revealTimer = null;
          revealStreamingText(assistant);
        }, waitMs);
      }
      return;
    }

    assistant.wrap.classList.remove('is-thinking');
    assistant.body.textContent = assistant.raw;
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
    return els.modelSelect.value || root.dataset.defaultModel || 'gpt-5.5';
  }

  function setModel(model) {
    const option = Array.from(els.modelSelect.options).find(function(item) {
      return item.value === model && !item.disabled;
    });
    if (option) els.modelSelect.value = model;
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
    const item = state.models.find(function(entry) {
      return entry.id === model;
    });
    return item ? item.label : (model || 'gpt-5.5');
  }

  function providerLabel(model) {
    const item = state.models.find(function(entry) {
      return entry.id === model;
    });
    return item && item.provider ? item.provider : '';
  }

  function providerKey(model) {
    const item = state.models.find(function(entry) {
      return entry.id === model;
    });
    return item && item.providerKey ? item.providerKey : '';
  }

  function modelBadgeLabel(model) {
    const provider = providerLabel(model);
    const label = modelLabel(model);
    return provider ? provider + ' / ' + label : label;
  }

  function hydrateModelsFromSelect() {
    state.models = Array.from(els.modelSelect.options).map(function(option) {
      return {
        id: option.value,
        label: option.textContent.replace(/\s+\((disabled|Requires API key)\)$/i, '').trim(),
        provider: option.dataset.provider || '',
        providerKey: option.dataset.providerKey || '',
        enabled: !option.disabled,
        disabledReason: option.disabled ? 'Requires API key' : ''
      };
    });
  }

  async function loadModels(preferredModel) {
    try {
      const res = await fetch('/ai/models');
      const models = await safeJson(res);
      if (!res.ok || !Array.isArray(models)) throw new Error('Could not load models');
      renderModelOptions(models, preferredModel || selectedModel());
    } catch (_error) {
      hydrateModelsFromSelect();
      syncModelLabel();
    }
  }

  function renderModelOptions(models, preferredModel) {
    state.models = models.map(function(model) {
      return {
        id: String(model.id || ''),
        label: String(model.label || model.id || ''),
        provider: String(model.provider || ''),
        providerKey: String(model.providerKey || ''),
        enabled: model.enabled !== false,
        disabledReason: String(model.disabledReason || '')
      };
    }).filter(function(model) {
      return model.id;
    });

    const enabledModels = state.models.filter(function(model) {
      return model.enabled;
    });
    const nextModel = enabledModels.find(function(model) {
      return model.id === preferredModel;
    }) || enabledModels[0] || state.models[0];

    els.modelSelect.innerHTML = '';
    state.models.forEach(function(model) {
      const option = document.createElement('option');
      option.value = model.id;
      option.disabled = !model.enabled;
      option.dataset.provider = model.provider || '';
      option.dataset.providerKey = model.providerKey || '';
      option.textContent = model.label + (model.provider ? ' - ' + model.provider : '') +
        (model.enabled ? '' : ' (' + (model.disabledReason || 'Unavailable') + ')');
      els.modelSelect.appendChild(option);
    });

    if (nextModel) {
      els.modelSelect.value = nextModel.id;
    }
    syncModelLabel();
    renderChatList();
  }

  function updateModelEndpointHint() {
    if (!els.modelEndpointHint) return;
    const provider = providerKey(selectedModel());
    const entry = provider && state.providerStatus ? state.providerStatus[provider] : null;
    if (entry && entry.baseUrlConfigured) {
      els.modelEndpointHint.hidden = false;
      els.modelEndpointHint.textContent = 'Using custom ' + providerDisplayName(provider) + ' base URL';
      return;
    }
    els.modelEndpointHint.hidden = true;
    els.modelEndpointHint.textContent = '';
  }

  function populateBaseUrlFields(baseUrls) {
    if (!els.settingsForm) return;
    ['openai', 'xai', 'claude', 'gemini'].forEach(function(provider) {
      const field = els.settingsForm.querySelector('[name="' + provider + 'BaseUrl"]');
      if (field) field.value = baseUrls && baseUrls[provider] ? String(baseUrls[provider]) : '';
    });
  }

  function hasUnsavedProviderChanges(provider) {
    if (!els.settingsForm || !provider) return false;
    const keyField = els.settingsForm.querySelector('[name="' + provider + 'Key"]');
    const baseUrlField = els.settingsForm.querySelector('[name="' + provider + 'BaseUrl"]');
    const savedBaseUrl = state.savedBaseUrls && state.savedBaseUrls[provider]
      ? String(state.savedBaseUrls[provider]).trim()
      : '';
    const pendingKey = keyField ? String(keyField.value || '').trim() : '';
    const pendingBaseUrl = baseUrlField ? String(baseUrlField.value || '').trim() : '';
    return Boolean(pendingKey) || pendingBaseUrl !== savedBaseUrl;
  }

  function providerDisplayName(provider) {
    const labels = {
      openai: 'OpenAI',
      xai: 'xAI',
      claude: 'Claude',
      gemini: 'Gemini'
    };
    return labels[String(provider || '').toLowerCase()] || 'Provider';
  }

  async function openSettings() {
    if (!els.settingsModal) return;
    els.settingsModal.hidden = false;
    await refreshSettingsSnapshot({ silent: false, updateForm: true, updateModels: true });
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
      if (!res.ok) throw new Error(data.error || 'Could not load AI settings');
      state.providerStatus = data.status || {};
      state.savedBaseUrls = data.baseUrls || {};
      updateSettingsStatus(data.status || {});
      if (settings.updateForm !== false) populateBaseUrlFields(data.baseUrls || {});
      if (settings.updateModels !== false && Array.isArray(data.models)) renderModelOptions(data.models, selectedModel());
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
    const payload = {};
    ['openaiKey', 'xaiKey', 'claudeKey', 'geminiKey'].forEach(function(field) {
      const value = String(formData.get(field) || '').trim();
      if (value) payload[field] = value;
    });
    ['openaiBaseUrl', 'xaiBaseUrl', 'claudeBaseUrl', 'geminiBaseUrl'].forEach(function(field) {
      const value = String(formData.get(field) || '').trim();
      if (value) payload[field] = value;
    });
    const changedProviders = changedProvidersFromPayload(payload);

    if (!Object.keys(payload).length) {
      showSettingsToast({
        type: 'warning',
        title: 'Nothing to save',
        message: 'Enter a new API key or Base URL first.'
      });
      return;
    }

    try {
      const res = await fetch('/ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Could not save AI settings');
      els.settingsForm.reset();
      state.providerStatus = data.status || {};
      state.savedBaseUrls = data.baseUrls || {};
      populateBaseUrlFields(data.baseUrls || {});
      updateSettingsStatus(data.status || {});
      if (Array.isArray(data.models)) renderModelOptions(data.models, selectedModel());
      showSettingsToast({
        type: 'success',
        provider: changedProviders.length === 1 ? changedProviders[0] : '',
        title: changedProviders.length === 1 ? 'Saved' : 'Settings saved',
        message: changedProviders.length === 1
          ? 'Provider settings updated.'
          : 'Selected provider settings were updated.'
      });
    } catch (error) {
      showSettingsToast({
        type: isLikelyValidationMessage(error && error.message) ? 'warning' : 'error',
        provider: changedProviders.length === 1 ? changedProviders[0] : '',
        title: 'Save failed',
        message: error.message || 'Could not save AI settings.'
      });
    }
  }

  async function clearProviderKey(provider) {
    if (!provider) return;
    try {
      const providerLabel = providerDisplayName(provider);
      const confirmed = await window.showConfirmModal({
        title: 'Remove API Key',
        message: `Remove the saved ${providerLabel} API key?`,
        warning: 'You will need to enter the key again before using this provider.',
        confirmText: 'Remove Key',
        confirmingText: 'Removing...',
        variant: 'warning',
        onConfirm: async function() {
          try {
            const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
            const res = await fetcher('/ai/settings/' + encodeURIComponent(provider), { method: 'DELETE' });
            const data = await safeJson(res);
            if (!res.ok) throw new Error(data.error || 'Could not remove key');
            state.providerStatus = data.status || {};
            state.savedBaseUrls = data.baseUrls || {};
            populateBaseUrlFields(data.baseUrls || {});
            updateSettingsStatus(data.status || {});
            if (Array.isArray(data.models)) renderModelOptions(data.models, selectedModel());
            showSettingsToast({
              type: 'success',
              provider: provider,
              title: 'Key removed',
              message: 'The saved API key was removed.'
            });
          } catch (error) {
            showSettingsToast({
              type: 'error',
              provider: provider,
              title: 'Remove failed',
              message: error.message || 'Could not remove key.'
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
          provider: provider,
          title: 'Remove failed',
          message: 'Could not remove key.'
        });
      }
    }
  }

  async function resetProviderBaseUrl(provider) {
    if (!provider) return;
    try {
      const confirmed = await window.showConfirmModal({
        title: 'Reset Base URL',
        message: `Reset the saved ${providerDisplayName(provider)} Base URL to the default endpoint?`,
        warning: 'Your API key will stay saved.',
        confirmText: 'Reset Base URL',
        confirmingText: 'Resetting...',
        variant: 'warning',
        onConfirm: async function() {
          try {
            const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
            const res = await fetcher('/ai/settings/' + encodeURIComponent(provider) + '/base-url', { method: 'DELETE' });
            const data = await safeJson(res);
            if (!res.ok) throw new Error(data.error || 'Could not reset Base URL');
            state.providerStatus = data.status || {};
            state.savedBaseUrls = data.baseUrls || {};
            populateBaseUrlFields(data.baseUrls || {});
            updateSettingsStatus(data.status || {});
            if (Array.isArray(data.models)) renderModelOptions(data.models, selectedModel());
            showSettingsToast({
              type: 'success',
              provider: provider,
              title: 'Base URL reset',
              message: 'The default endpoint is active again.'
            });
          } catch (error) {
            showSettingsToast({
              type: 'error',
              provider: provider,
              title: 'Reset failed',
              message: error.message || 'Could not reset Base URL.'
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
          provider: provider,
          title: 'Reset failed',
          message: 'Could not reset Base URL.'
        });
      }
    }
  }

  async function testProviderConnection(provider) {
    if (!provider) return;
    if (hasUnsavedProviderChanges(provider)) {
      showSettingsToast({
        type: 'warning',
        provider: provider,
        title: 'Save required',
        message: 'Save your changes before testing this provider.'
      });
      return;
    }

    try {
      const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
      const res = await fetcher('/ai/settings/' + encodeURIComponent(provider) + '/test', { method: 'POST' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Connection test failed.');
      showSettingsToast({
        type: 'success',
        provider: provider,
        title: 'Connection successful',
        message: 'The saved endpoint responded successfully.'
      });
    } catch (error) {
      showSettingsToast({
        type: 'error',
        provider: provider,
        title: 'Connection failed',
        message: error.message || 'Connection test failed.'
      });
    }
  }

  function updateSettingsStatus(status) {
    if (!els.settingsForm) return;
    state.providerStatus = status || {};
    els.settingsForm.querySelectorAll('[data-key-status]').forEach(function(node) {
      const provider = node.dataset.keyStatus;
      const entry = status && status[provider] ? status[provider] : {};
      const connected = Boolean(entry && entry.connected);
      const masked = connected && entry.masked ? ' (' + entry.masked + ')' : '';
      node.textContent = connected ? 'Connected' + masked : 'Not connected';
      node.classList.toggle('is-connected', connected);
    });
    els.settingsForm.querySelectorAll('[data-base-url-status]').forEach(function(node) {
      const provider = node.dataset.baseUrlStatus;
      const entry = status && status[provider] ? status[provider] : {};
      node.textContent = entry && entry.baseUrlConfigured && entry.baseUrlHost
        ? 'Base URL: ' + entry.baseUrlHost
        : 'Default endpoint';
      node.classList.toggle('is-custom', Boolean(entry && entry.baseUrlConfigured));
    });
    updateModelEndpointHint();
  }

  function showSettingsToast(config) {
    const options = config || {};
    const provider = options.provider ? providerDisplayName(options.provider) : '';
    const title = provider && options.title
      ? provider + ': ' + options.title
      : (options.title || 'Notice');

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

  function changedProvidersFromPayload(payload) {
    const providers = [];
    ['openai', 'xai', 'claude', 'gemini'].forEach(function(provider) {
      const hasKey = Object.prototype.hasOwnProperty.call(payload || {}, provider + 'Key');
      const hasBaseUrl = Object.prototype.hasOwnProperty.call(payload || {}, provider + 'BaseUrl');
      if (hasKey || hasBaseUrl) {
        providers.push(provider);
      }
    });
    return providers;
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
