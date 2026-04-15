(function() {
  'use strict';

  function initXpProgress() {
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

  function initAvatarForm() {
    const input = document.getElementById('profileAvatarInput');
    const submit = document.getElementById('profileAvatarSubmit');
    if (!input || !submit) return;

    input.addEventListener('change', function() {
      submit.disabled = !(input.files && input.files.length);
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    initXpProgress();
    initAvatarForm();
  });
})();
