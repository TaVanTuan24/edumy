(function() {
  'use strict';

  function normalizeWidth(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return '0%';
    return Math.max(0, Math.min(100, raw)) + '%';
  }

  function applyProgressWidths(root) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('[data-progress-width]').forEach(function(node) {
      node.style.width = normalizeWidth(node.dataset.progressWidth);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      applyProgressWidths(document);
    });
  } else {
    applyProgressWidths(document);
  }

  window.__applyProgressWidths = applyProgressWidths;
})();
