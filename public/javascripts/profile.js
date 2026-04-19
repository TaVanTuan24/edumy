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

  function initVrPairingForm() {
    const form = document.getElementById('vrPairingForm');
    const input = document.getElementById('vrPairingCodeInput');
    const submit = document.getElementById('vrPairingSubmit');
    const message = document.getElementById('vrPairingMessage');
    const modalElement = document.getElementById('vrPairingModal');
    if (!form || !input || !submit || !message || !modalElement) return;

    function sanitizeCode(value) {
      return String(value || '').replace(/\D/g, '').slice(0, 5);
    }

    function updateSubmitState() {
      submit.disabled = sanitizeCode(input.value).length !== 5;
    }

    function setMessage(type, text) {
      message.className = 'alert mt-3 mb-0';
      message.classList.add(type === 'success' ? 'alert-success' : 'alert-danger');
      message.textContent = text;
    }

    function clearMessage() {
      message.className = 'alert d-none mt-3 mb-0';
      message.textContent = '';
    }

    modalElement.addEventListener('shown.bs.modal', function() {
      window.setTimeout(function() {
        input.focus();
        input.select();
      }, 80);
    });

    modalElement.addEventListener('hidden.bs.modal', function() {
      input.value = '';
      clearMessage();
      updateSubmitState();
    });

    input.addEventListener('input', function() {
      input.value = sanitizeCode(input.value);
      clearMessage();
      updateSubmitState();
    });

    form.addEventListener('submit', async function(event) {
      event.preventDefault();

      const code = sanitizeCode(input.value);
      if (code.length !== 5) {
        updateSubmitState();
        return;
      }

      submit.disabled = true;
      clearMessage();

      try {
        const response = await fetch('/api/vr-auth/approve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ code: code })
        });

        const payload = await response.json().catch(function() {
          return null;
        });

        if (!response.ok || !payload || !payload.success) {
          const errorMessage = payload && payload.message
            ? payload.message
            : 'Unable to pair this VR device.';
          setMessage('error', errorMessage);
          updateSubmitState();
          return;
        }

        setMessage('success', payload.message || 'VR device paired successfully.');
        input.value = '';
        updateSubmitState();
      } catch (_err) {
        setMessage('error', 'Unable to reach the server right now.');
        updateSubmitState();
      }
    });

    updateSubmitState();
  }

  document.addEventListener('DOMContentLoaded', function() {
    initXpProgress();
    initAvatarForm();
    initVrPairingForm();
  });
})();
