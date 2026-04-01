(function() {
  'use strict';

  function init() {
    const fill = document.getElementById('xpProgressFill');
    if (!fill) return;

    const rawProgress = Number(fill.dataset.progress || 0);
    const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0;
    const target = progress + '%';
    fill.style.width = '0%';

    window.setTimeout(function() {
      fill.style.width = target;
    }, 120);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
