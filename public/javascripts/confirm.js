(function() {
  'use strict';

  const state = {
    isOpen: false,
    isBusy: false,
    resolve: null,
    options: null,
    activeElement: null
  };

  let els = null;

  function init() {
    els = {
      modal: document.getElementById('appConfirmModal'),
      dialog: document.querySelector('#appConfirmModal .app-confirm-dialog'),
      title: document.getElementById('appConfirmTitle'),
      message: document.getElementById('appConfirmMessage'),
      warning: document.getElementById('appConfirmWarning'),
      error: document.getElementById('appConfirmError'),
      confirm: document.querySelector('#appConfirmModal [data-confirm-accept]'),
      cancel: document.querySelector('#appConfirmModal [data-confirm-cancel]'),
      close: document.querySelector('#appConfirmModal [data-confirm-close]'),
      dismiss: document.querySelector('#appConfirmModal [data-confirm-dismiss]'),
      toastStack: document.getElementById('appToastStack')
    };

    if (!els.modal || !els.dialog || !els.confirm || !els.cancel || !els.close) return;

    els.confirm.addEventListener('click', handleConfirm);
    els.cancel.addEventListener('click', function() {
      closeModal(false);
    });
    els.close.addEventListener('click', function() {
      closeModal(false);
    });
    if (els.dismiss) {
      els.dismiss.addEventListener('click', function() {
        closeModal(false);
      });
    }

    document.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('submit', interceptConfirmForms, true);
  }

  function normalizeOptions(options) {
    const source = options && typeof options === 'object' ? options : {};
    const confirmText = String(source.confirmText || 'Delete').trim() || 'Delete';
    return {
      title: String(source.title || 'Confirm action').trim() || 'Confirm action',
      message: String(source.message || 'Are you sure you want to continue?').trim() || 'Are you sure you want to continue?',
      warning: String(source.warning || '').trim(),
      confirmText: confirmText,
      cancelText: String(source.cancelText || 'Cancel').trim() || 'Cancel',
      confirmingText: String(source.confirmingText || (confirmText.endsWith('e') ? confirmText + 'ing...' : confirmText + '...')).trim() || 'Working...',
      variant: ['danger', 'warning', 'normal'].includes(String(source.variant || '').trim()) ? String(source.variant).trim() : 'danger',
      onConfirm: typeof source.onConfirm === 'function' ? source.onConfirm : null
    };
  }

  function showConfirmModal(options) {
    if (!els || !els.modal) {
      return Promise.resolve(false);
    }

    if (state.isOpen) {
      closeModal(false);
    }

    const normalized = normalizeOptions(options);
    state.options = normalized;
    state.activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.isOpen = true;
    state.isBusy = false;

    els.dialog.dataset.variant = normalized.variant;
    els.title.textContent = normalized.title;
    els.message.textContent = normalized.message;
    els.confirm.textContent = normalized.confirmText;
    els.cancel.textContent = normalized.cancelText;
    setWarning(normalized.warning);
    setError('');
    setBusy(false);

    els.modal.hidden = false;
    document.body.classList.add('app-confirm-open');

    window.setTimeout(function() {
      if (state.isOpen) {
        els.cancel.focus();
      }
    }, 0);

    return new Promise(function(resolve) {
      state.resolve = resolve;
    });
  }

  async function handleConfirm() {
    if (!state.isOpen || state.isBusy || !state.options) return;

    const options = state.options;
    setError('');
    setBusy(true);

    try {
      if (options.onConfirm) {
        await options.onConfirm();
      }
      closeModal(true);
    } catch (error) {
      setBusy(false);
      setError(error && error.message ? error.message : 'Unable to complete this action.');
    }
  }

  function closeModal(confirmed) {
    if (!state.isOpen) return;
    if (state.isBusy && !confirmed) return;

    const resolve = state.resolve;
    const activeElement = state.activeElement;

    state.isOpen = false;
    state.isBusy = false;
    state.resolve = null;
    state.options = null;
    state.activeElement = null;

    els.modal.hidden = true;
    document.body.classList.remove('app-confirm-open');
    setBusy(false);
    setError('');
    setWarning('');

    if (activeElement && typeof activeElement.focus === 'function') {
      window.setTimeout(function() {
        activeElement.focus();
      }, 0);
    }

    if (resolve) {
      resolve(Boolean(confirmed));
    }
  }

  function setBusy(isBusy) {
    state.isBusy = Boolean(isBusy);
    if (!els || !els.confirm || !els.cancel || !els.close) return;

    const options = state.options || normalizeOptions({});
    els.confirm.disabled = state.isBusy;
    els.cancel.disabled = state.isBusy;
    els.close.disabled = state.isBusy;
    els.confirm.textContent = state.isBusy ? options.confirmingText : options.confirmText;
    els.dialog.classList.toggle('is-busy', state.isBusy);
  }

  function setWarning(message) {
    if (!els || !els.warning) return;
    const text = String(message || '').trim();
    els.warning.hidden = !text;
    els.warning.textContent = text;
  }

  function setError(message) {
    if (!els || !els.error) return;
    const text = String(message || '').trim();
    els.error.hidden = !text;
    els.error.textContent = text;
  }

  function handleKeydown(event) {
    if (!state.isOpen || !els || !els.modal || els.modal.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(false);
      return;
    }

    if (event.key === 'Enter' && !state.isBusy) {
      const target = event.target;
      const tagName = target && target.tagName ? String(target.tagName).toLowerCase() : '';
      if (tagName !== 'textarea') {
        event.preventDefault();
        handleConfirm();
        return;
      }
    }

    if (event.key === 'Tab') {
      trapFocus(event);
    }
  }

  function trapFocus(event) {
    const focusable = getFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function getFocusableElements() {
    if (!els || !els.dialog) return [];
    return Array.from(els.dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(function(node) {
        return !node.disabled && node.offsetParent !== null;
      });
  }

  function interceptConfirmForms(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.matches('[data-confirm-modal]')) return;
    if (form.dataset.confirmBypass === 'true') {
      form.dataset.confirmBypass = 'false';
      return;
    }

    event.preventDefault();

    const submitter = event.submitter instanceof HTMLElement ? event.submitter : form.querySelector('[type="submit"]');
    const source = submitter && submitter.dataset.confirmTitle ? submitter : form;

    showConfirmModal(readConfirmDataset(source))
      .then(function(confirmed) {
        if (!confirmed) return;
        form.dataset.confirmBypass = 'true';
        HTMLFormElement.prototype.submit.call(form);
      });
  }

  function readConfirmDataset(node) {
    const dataset = node && node.dataset ? node.dataset : {};
    return {
      title: dataset.confirmTitle,
      message: dataset.confirmMessage,
      warning: dataset.confirmWarning,
      confirmText: dataset.confirmText,
      cancelText: dataset.confirmCancelText,
      confirmingText: dataset.confirmingText,
      variant: dataset.confirmVariant
    };
  }

  function showAppToast(message, variant, options) {
    if (!els || !els.toastStack) return;

    const normalized = normalizeToastInput(message, variant, options);
    const tone = normalized.tone;
    const toast = document.createElement('div');
    const duration = Number.isFinite(Number(normalized.duration)) ? Math.max(1200, Number(normalized.duration)) : 3200;

    toast.className = 'app-toast is-' + tone;
    toast.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    toast.setAttribute('aria-live', tone === 'danger' ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.innerHTML =
      '<div class="app-toast-copy">' +
        '<strong class="app-toast-title">' + escapeHtml(normalized.title || toastTitleForVariant(tone)) + '</strong>' +
        '<div class="app-toast-message">' + escapeHtml(normalized.message || '') + '</div>' +
      '</div>' +
      '<button type="button" class="app-toast-close" aria-label="Dismiss notification">' +
        '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' +
      '</button>';

    const remove = function() {
      toast.classList.remove('is-visible');
      window.setTimeout(function() {
        if (toast.parentNode) toast.remove();
      }, 180);
    };

    const closeBtn = toast.querySelector('.app-toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', remove);
    }

    els.toastStack.appendChild(toast);
    window.requestAnimationFrame(function() {
      toast.classList.add('is-visible');
    });
    window.setTimeout(remove, duration);
  }

  function showToast(config) {
    const options = config && typeof config === 'object' ? config : {};
    return showAppToast(options.message || '', options.type || 'info', options);
  }

  function normalizeToastInput(message, variant, options) {
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      const config = message;
      return {
        message: String(config.message || '').trim(),
        tone: normalizeToastTone(config.type || config.variant),
        title: String(config.title || '').trim(),
        duration: config.duration
      };
    }

    const config = options && typeof options === 'object' ? options : {};
    return {
      message: String(message || '').trim(),
      tone: normalizeToastTone(variant),
      title: String(config.title || '').trim(),
      duration: config.duration
    };
  }

  function normalizeToastTone(variant) {
    const value = String(variant || '').trim().toLowerCase();
    if (value === 'error') return 'danger';
    if (value === 'normal') return 'info';
    return ['success', 'danger', 'warning', 'info'].includes(value) ? value : 'info';
  }

  function toastTitleForVariant(variant) {
    if (variant === 'success') return 'Success';
    if (variant === 'danger') return 'Error';
    if (variant === 'warning') return 'Warning';
    return 'Info';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.showConfirmModal = showConfirmModal;
  window.showAppToast = showAppToast;
  window.showToast = showToast;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
