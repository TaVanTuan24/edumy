(function() {
  'use strict';

  const root = document.querySelector('[data-grok-setup]');
  if (!root) return;

  const els = {
    ready: root.querySelector('[data-grok-ready]'),
    path: root.querySelector('[data-grok-path]'),
    message: root.querySelector('[data-grok-message]'),
    log: root.querySelector('[data-grok-log]'),
    setupBtn: root.querySelector('[data-grok-setup-btn]'),
    completeBtn: root.querySelector('[data-grok-complete-btn]'),
    enableBtn: root.querySelector('[data-grok-enable-btn]'),
    disableBtn: root.querySelector('[data-grok-disable-btn]')
  };

  const checks = {
    enabled: root.querySelector('[data-check="enabled"]'),
    path: root.querySelector('[data-check="path"]'),
    deps: root.querySelector('[data-check="deps"]'),
    session: root.querySelector('[data-check="session"]')
  };

  let pollTimer = null;

  document.addEventListener('DOMContentLoaded', function() {
    bindEvents();
    refreshStatus();
  });

  function bindEvents() {
    els.setupBtn.addEventListener('click', function() {
      postAction('/admin/ai/grok/setup', 'Starting setup...');
    });

    els.completeBtn.addEventListener('click', function() {
      postAction('/admin/ai/grok/setup/complete', 'Saving session...');
    });

    els.enableBtn.addEventListener('click', function() {
      postAction('/admin/ai/grok/enable', 'Enabling Grok...');
    });

    els.disableBtn.addEventListener('click', function() {
      postAction('/admin/ai/grok/disable', 'Disabling Grok...');
    });
  }

  async function postAction(url, loadingMessage) {
    setBusy(true, loadingMessage);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await safeJson(res);
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Action failed.');
      }
      await refreshStatus();
      startPolling();
    } catch (error) {
      els.message.textContent = error.message || 'Action failed.';
      setReadyBadge('error', 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/admin/ai/grok/status');
      const status = await safeJson(res);
      renderStatus(status);
      if (shouldPoll(status)) startPolling();
      return status;
    } catch (error) {
      els.message.textContent = error.message || 'Could not load Grok status.';
      setReadyBadge('error', 'Error');
      return null;
    }
  }

  function renderStatus(status) {
    setCheck(checks.enabled, status.enabled, status.enabled ? 'Enabled' : 'Disabled');
    setCheck(checks.path, status.scraperPathExists, status.scraperPathExists ? 'Found' : 'Missing');
    setCheck(checks.deps, status.dependenciesInstalled, status.dependenciesInstalled ? 'Installed' : 'Missing');
    setCheck(checks.session, status.sessionAvailable, status.sessionAvailable ? 'Available' : 'Missing');

    els.path.textContent = 'Path: ' + (status.scraperPath || '(not configured)');
    const setup = status.setup || {};
    els.message.textContent = setup.message || statusMessage(status);

    els.completeBtn.hidden = !setup.waitingForLogin;
    els.setupBtn.disabled = Boolean(setup.running);
    els.enableBtn.disabled = status.enabled || !status.sessionAvailable || !status.dependenciesInstalled || !status.scraperPathExists;
    els.disableBtn.disabled = !status.enabled;

    if (status.ready) {
      setReadyBadge('ready', 'Ready');
    } else if (setup.status === 'error') {
      setReadyBadge('error', 'Needs attention');
    } else {
      setReadyBadge('warning', setup.running ? 'Setting up' : 'Not ready');
    }

    if (Array.isArray(setup.logs) && setup.logs.length) {
      els.log.hidden = false;
      els.log.textContent = setup.logs.join('\n');
    } else {
      els.log.hidden = true;
      els.log.textContent = '';
    }
  }

  function statusMessage(status) {
    if (!status.interactiveAvailable) {
      return 'Grok login requires a local interactive browser session. This server appears to be headless.';
    }
    if (!status.scraperPathExists) return 'Grok scraper path is missing.';
    if (!status.dependenciesInstalled) return 'Dependencies need to be installed. Click Set up Grok.';
    if (!status.sessionAvailable) return 'Browser login session is missing. Click Set up Grok.';
    if (!status.enabled) return 'Grok is set up but disabled.';
    return 'Grok is ready.';
  }

  function setCheck(node, ok, text) {
    node.classList.toggle('ok', Boolean(ok));
    node.classList.toggle('bad', !ok);
    node.querySelector('[data-value]').textContent = text;
  }

  function setReadyBadge(kind, text) {
    els.ready.className = 'integration-status ' + kind;
    els.ready.textContent = text;
  }

  function shouldPoll(status) {
    const setup = status && status.setup;
    return Boolean(setup && (setup.running || setup.waitingForLogin || setup.status === 'starting'));
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = window.setInterval(async function() {
      const status = await refreshStatus();
      if (!shouldPoll(status)) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    }, 2000);
  }

  function setBusy(isBusy, message) {
    [els.setupBtn, els.completeBtn, els.enableBtn, els.disableBtn].forEach(function(button) {
      if (button) button.classList.toggle('disabled', Boolean(isBusy));
    });
    if (message) els.message.textContent = message;
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
})();
