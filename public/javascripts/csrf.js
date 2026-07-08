(function() {
  'use strict';

  function getCsrfToken() {
    // 1. Try meta tag first (server-rendered)
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) {
      const token = String(meta.getAttribute('content') || '');
      if (token) return token;
    }

    // 2. Fallback: read from cookie (Double Submit Cookie pattern)
    var cookieValue = '';
    try {
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i++) {
        var cookie = cookies[i].trim();
        if (cookie.indexOf('XSRF-TOKEN=') === 0) {
          cookieValue = decodeURIComponent(cookie.substring('XSRF-TOKEN='.length));
          break;
        }
      }
    } catch (_e) { /* ignore cookie read errors */ }

    return cookieValue;
  }

  function isSameOriginRequest(input) {
    const rawUrl = input instanceof Request ? input.url : String(input || '');
    if (!rawUrl) return true;

    try {
      const parsed = new URL(rawUrl, window.location.href);
      return parsed.origin === window.location.origin;
    } catch {
      return true;
    }
  }

  function isStateChangingMethod(method) {
    const normalized = String(method || 'GET').toUpperCase();
    return !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(normalized);
  }

  function buildHeaders(input, init, shouldAttachToken) {
    const baseHeaders = input instanceof Request ? input.headers : undefined;
    const overrideHeaders = init && init.headers ? init.headers : undefined;
    const headers = new Headers(baseHeaders || undefined);

    if (overrideHeaders) {
      new Headers(overrideHeaders).forEach(function(value, key) {
        headers.set(key, value);
      });
    }

    if (!headers.has('X-Requested-With')) {
      headers.set('X-Requested-With', 'XMLHttpRequest');
    }

    if (shouldAttachToken) {
      const token = getCsrfToken();
      if (token && !headers.has('CSRF-Token') && !headers.has('X-CSRF-Token')) {
        headers.set('CSRF-Token', token);
      }
    }

    return headers;
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function') return;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      if (!isSameOriginRequest(input)) {
        return nativeFetch(input, init);
      }

      const requestMethod = init && init.method
        ? init.method
        : (input instanceof Request ? input.method : 'GET');
      const shouldAttachToken = isStateChangingMethod(requestMethod);
      const headers = buildHeaders(input, init, shouldAttachToken);

      if (input instanceof Request) {
        const request = new Request(input, {
          ...init,
          headers
        });
        return nativeFetch(request);
      }

      return nativeFetch(input, {
        ...init,
        headers
      });
    };
  }

  function csrfFetch(input, init) {
    if (typeof window.fetch !== 'function') {
      return Promise.reject(new Error('Fetch is not available in this browser.'));
    }

    return window.fetch(input, init);
  }

  function ensureFormToken(form) {
    if (!(form instanceof HTMLFormElement)) return;

    const method = String(form.getAttribute('method') || form.method || 'GET').toUpperCase();
    if (!isStateChangingMethod(method)) return;

    const token = getCsrfToken();
    if (!token) return;

    let input = form.querySelector('input[name="_csrf"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      form.appendChild(input);
    }

    input.value = token;
  }

  function ensureAllFormTokens(root) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('form').forEach(ensureFormToken);
  }

  function observeForms() {
    if (typeof MutationObserver !== 'function' || !document.body) return;

    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (!(node instanceof HTMLElement)) return;
          if (node.tagName === 'FORM') {
            ensureFormToken(node);
            return;
          }
          ensureAllFormTokens(node);
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    window.__CSRF_TOKEN__ = getCsrfToken();
    patchFetch();
    window.csrfFetch = csrfFetch;
    ensureAllFormTokens(document);
    observeForms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
